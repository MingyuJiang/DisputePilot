"""PayPal Payments v2 refund gateway — one POST, verified by GET, never retried.

Flow (mirrors the dispute gateway, same claim/audit discipline):

1. Gate: the executor checks ``DP_PAYPAL_WRITES_ENABLED`` and the exact
   ``<capture_id>:<action>`` allow entry before this class is built; the
   capture-level one-shot claim is taken as the last step before the POST.
2. Pre-GET: ``GET /v2/payments/captures/{capture_id}`` is the only runtime
   authority for the balance. The approved ``capture_snapshot`` is compared
   against it; ANY drift (status, original amount, amount already refunded,
   remaining, currency) blocks with zero POSTs. V14/V15/V16 are then re-run
   against the fresh observation.
3. One POST: partial → exact ``{"amount": {...}}``; full → exactly ``{}``.
   ``PayPal-Request-Id`` is the proposal's fixed idempotency key.
4. Verification: a timeout / 5xx / unusable 2xx is ambiguous. The refund id is
   recovered (response, else a ``refunds[]`` hint on the capture) and the
   refund is GET-ted. Only ``COMPLETED`` with a matching amount, currency and
   capture is ``EXECUTED``. ``PENDING`` stays ``PENDING`` (never a success);
   ``FAILED``/``CANCELLED`` is ``FAILED``; anything unreadable is ``UNVERIFIED``.

A refund moves money. It never accepts a claim, resolves or closes the
dispute, and is never evidence that the buyer accepted anything.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from ...domain.enums import ActionType, ExecutionResult
from ...domain.models import ActionProposal, Approval, CaseRecord, CaseStateSnapshot
from ...domain.policies import ValidationContext
from ...domain.refund_policies import RefundContext, validate_refund_proposal
from .client import HttpResponse, PayPalApiClient
from .config import PayPalConfig
from .errors import PayPalError, PayPalErrorKind
from .gateway import (
    AUDIT_ATTEMPT,
    AUDIT_BLOCKED,
    AUDIT_UNKNOWN,
    AUDIT_VERIFIED,
    LiveExecutionOutcome,
)
from .payments import (
    REFUND_STATUS_CANCELLED,
    REFUND_STATUS_COMPLETED,
    REFUND_STATUS_FAILED,
    REFUND_STATUS_PENDING,
    CaptureParseError,
    CaptureSnapshot,
    capture_id_of_case,
    capture_refunds,
    capture_snapshot,
    from_minor,
    match_refund_entry,
    refund_amount_minor,
    refund_capture_id,
    refund_currency,
    refund_status,
    to_minor,
)

RESULT_EXECUTED = ExecutionResult.EXECUTED.value
RESULT_PENDING = ExecutionResult.PENDING.value
RESULT_UNVERIFIED = ExecutionResult.UNVERIFIED.value
RESULT_BLOCKED = ExecutionResult.BLOCKED.value
RESULT_FAILED = ExecutionResult.FAILED.value

GATEWAY_NAME = "PayPalRefundGateway"

DISPUTE_RESOLUTION_NOTE = (
    "a refund is a payments-side money movement; it does not accept the "
    "claim, resolve or close the dispute, and it is not evidence that the "
    "buyer accepted anything"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PayPalRefundGateway:
    name = GATEWAY_NAME

    def __init__(self, config: PayPalConfig, client: PayPalApiClient) -> None:
        self.config = config
        self.client = client

    # ------------------------------------------------------------------- public
    def execute(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        state: CaseStateSnapshot,
        approval: Approval,
        *,
        audit: Callable[[str, dict[str, Any]], None] | None = None,
        claim: Callable[[str], None] | None = None,
    ) -> LiveExecutionOutcome:
        action = str(proposal.action_type)
        if action not in (
            ActionType.PARTIAL_REFUND.value,
            ActionType.FULL_REFUND.value,
        ):
            return self._blocked(
                proposal,
                case,
                approval,
                reason=f"refund gateway cannot execute action {action!r}",
                stage="action_support",
            )

        capture_id = capture_id_of_case(case)
        if not capture_id:
            return self._blocked(
                proposal,
                case,
                approval,
                reason="case has no capture reference",
                stage="precheck",
            )

        payload = (
            proposal.action_payload if isinstance(proposal.action_payload, dict) else {}
        )
        approved = CaptureSnapshot.from_payload(payload.get("capture_snapshot"))
        if approved is None:
            return self._blocked(
                proposal,
                case,
                approval,
                reason=(
                    "proposal payload has no server capture_snapshot; the refund "
                    "balance was never observed by the server"
                ),
                stage="payload",
            )

        # ---- pre-GET: the balance is re-read, never trusted from the payload
        pre, failure = self._read_capture(capture_id)
        if failure is not None:
            return self._failed(
                proposal,
                case,
                approval,
                failure,
                stage="precheck",
                request_id=None,
                idempotency_key=str(payload.get("idempotency_key") or "") or None,
            )
        assert pre is not None  # _read_capture always sets one side

        drift = self._drift_reason(approved, pre)
        if drift:
            return self._blocked(
                proposal,
                case,
                approval,
                reason=drift,
                stage="precheck",
                pre=pre,
            )

        # ---- V14/V15/V16 against the fresh observation (no POST yet)
        refund_context = RefundContext(
            capture=pre,
            expected_merchant_id=self.config.merchant_id,
        )
        report = validate_refund_proposal(
            proposal,
            ValidationContext(
                case=case,
                state=state,
                policy_version=proposal.policy_version,
                mode="live",
                bound_snapshot_hash=proposal.snapshot_hash,
                extra={
                    "refund_context": refund_context,
                    "retry_audit": {"clean": True, "files": 0},
                },
            ),
            report_id=f"VR-REFUND-{proposal.proposal_id}",
        )
        if not report.passed:
            return self._blocked(
                proposal,
                case,
                approval,
                reason="refund re-validation failed: "
                + "; ".join(report.blocked_reasons),
                stage="refund_validation",
                pre=pre,
                findings=[f.model_dump(mode="json") for f in report.findings],
            )

        try:
            amount_minor = (
                None
                if action == ActionType.FULL_REFUND.value
                else to_minor(payload.get("amount"))
            )
        except CaptureParseError as exc:
            return self._blocked(
                proposal,
                case,
                approval,
                reason=f"refund amount unusable: {exc}",
                stage="payload",
                pre=pre,
            )
        expected_minor = amount_minor if amount_minor is not None else pre.remaining_minor
        idempotency_key = str(payload.get("idempotency_key") or "").strip()
        request_id = idempotency_key or f"refund-{capture_id}"
        amount_text = None if amount_minor is None else from_minor(amount_minor)

        checked_at = _now_iso()
        if audit is not None:
            audit(
                AUDIT_ATTEMPT,
                {
                    "approval_id": approval.approval_id,
                    "action_type": action,
                    "action_family": "PAYMENT",
                    "capture_id": capture_id,
                    "request_id": request_id,
                    "amount": amount_text,
                    "currency": pre.currency,
                    "precheck": {
                        "status": pre.status,
                        "original_amount": pre.original_amount,
                        "total_refunded": pre.total_refunded,
                        "refundable_remaining": pre.refundable_remaining,
                        "checked_at": checked_at,
                    },
                },
            )

        # ---- durable one-shot claim, last step before the single POST
        if claim is not None:
            claim(capture_id)

        # ---- exactly one POST, no redirect, no retry
        try:
            response = self.client.post_refund(
                capture_id, amount_text, pre.currency, request_id
            )
        except PayPalError as exc:
            if self._post_outcome_unknown(exc):
                return self._verify(
                    proposal,
                    case,
                    approval,
                    capture_id=capture_id,
                    approved=approved,
                    before=pre,
                    currency=pre.currency,
                    expected_minor=expected_minor,
                    request_id=request_id,
                    idempotency_key=idempotency_key,
                    state_version=state.state_version,
                    response=None,
                    post_error=exc,
                    audit=audit,
                )
            outcome = self._failed(
                proposal,
                case,
                approval,
                exc,
                stage="post",
                request_id=request_id,
                idempotency_key=idempotency_key,
                pre=pre,
            )
            if audit is not None:
                audit(
                    AUDIT_BLOCKED,
                    {
                        "approval_id": approval.approval_id,
                        "reason": exc.kind.value,
                        "http_status": exc.http_status,
                        "post_issued": True,
                        "request_id": request_id,
                    },
                )
            return outcome

        return self._verify(
            proposal,
            case,
            approval,
            capture_id=capture_id,
            approved=approved,
            before=pre,
            currency=pre.currency,
            expected_minor=expected_minor,
            request_id=request_id,
            idempotency_key=idempotency_key,
            state_version=state.state_version,
            response=response,
            post_error=None,
            audit=audit,
        )

    # -------------------------------------------------------------- verification
    def _verify(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        approval: Approval,
        *,
        capture_id: str,
        approved: CaptureSnapshot,
        before: CaptureSnapshot,
        currency: str,
        expected_minor: int,
        request_id: str,
        idempotency_key: str,
        state_version: int,
        response: HttpResponse | None,
        post_error: PayPalError | None,
        audit: Callable[[str, dict[str, Any]], None] | None,
    ) -> LiveExecutionOutcome:
        checked_at = _now_iso()
        refund_id = self._refund_id_from_response(response)
        hint_source = "POST_RESPONSE" if refund_id else None
        read_error = ""
        refund_body: dict[str, Any] | None = None
        capture_after: CaptureSnapshot | None = None

        # A capture read also recovers a refund id when the POST was ambiguous
        # (a ``refunds[]`` hint) and always documents the balance movement.
        try:
            raw_capture = self.client.get_capture(capture_id)
            capture_after = capture_snapshot(raw_capture)
            if refund_id is None:
                hint = match_refund_entry(
                    capture_refunds(raw_capture),
                    amount_minor=expected_minor,
                    currency=currency,
                )
                if hint is not None:
                    refund_id = str(hint.get("id"))
                    hint_source = "CAPTURE_REFUNDS_HINT"
        except (PayPalError, CaptureParseError) as exc:
            read_error = (
                exc.kind.value if isinstance(exc, PayPalError) else "PROTOCOL"
            )

        if refund_id:
            try:
                refund_body = self.client.get_refund(refund_id)
            except PayPalError as exc:
                read_error = read_error or exc.kind.value
                refund_body = None

        status = refund_status(refund_body)
        observed_amount = refund_amount_minor(refund_body)
        observed_currency = refund_currency(refund_body)
        declared_capture = refund_capture_id(refund_body)
        amount_match = observed_amount == expected_minor
        currency_match = bool(observed_currency) and observed_currency == currency
        capture_match = declared_capture in (None, capture_id)
        matched = bool(refund_id) and amount_match and currency_match and capture_match

        uncertain = ""
        failed_reason = ""
        if status == REFUND_STATUS_COMPLETED and matched:
            result = RESULT_EXECUTED
        elif status == REFUND_STATUS_PENDING and matched:
            result = RESULT_PENDING
            uncertain = (
                "refund is PENDING at PayPal — accepted but not settled; this is "
                "NOT a success and must be reconciled by a later refund GET"
            )
        elif status in (REFUND_STATUS_FAILED, REFUND_STATUS_CANCELLED):
            result = RESULT_FAILED
            failed_reason = f"refund settled as {status} at PayPal"
        elif status == REFUND_STATUS_COMPLETED and not matched:
            result = RESULT_UNVERIFIED
            uncertain = (
                "refund reads COMPLETED but the amount/currency/capture does not "
                "match the approved refund"
            )
        elif refund_body is None:
            result = RESULT_UNVERIFIED
            if read_error:
                uncertain = (
                    "post outcome could not be verified: read-back failed "
                    f"({read_error})"
                )
            else:
                uncertain = (
                    "post outcome unknown and no refund could be read back; "
                    "a human must reconcile before any further refund"
                )
        else:
            result = RESULT_UNVERIFIED
            uncertain = f"refund status {status or 'UNKNOWN'} is not terminal"

        confirmed = result == RESULT_EXECUTED
        amount_after = capture_after.remaining_minor if capture_after else None

        verification: dict[str, Any] = {
            "method": "LIVE_GET",
            "basis": "REMOTE_GET",
            "confirmed": confirmed,
            "checked_at": checked_at,
            "capture_id": capture_id,
            "matched_refund_id": refund_id,
            "matched_refund_id_source": hint_source,
            "refund_status": status or None,
            "amount": (
                from_minor(observed_amount)
                if observed_amount is not None
                else from_minor(expected_minor)
            ),
            "currency": observed_currency or currency,
            "amount_matches_approval": amount_match,
            "currency_matches_capture": currency_match,
            "capture_matches_refund": capture_match,
            "capture_status_before": before.status,
            "capture_status_after": capture_after.status if capture_after else None,
            "refundable_remaining_before": before.refundable_remaining,
            "refundable_remaining_after": (
                capture_after.refundable_remaining if capture_after else None
            ),
            "remaining_delta_minor": (
                before.remaining_minor - amount_after if amount_after is not None else None
            ),
            "dispute_resolution": "NONE",
            "dispute_resolution_note": DISPUTE_RESOLUTION_NOTE,
        }
        if uncertain:
            verification["uncertain_reason"] = uncertain
        if failed_reason:
            verification["failure_reason"] = failed_reason
            verification["failed_stage"] = "verify"
        if post_error is not None:
            verification["post_outcome_unknown"] = True
            verification["post_error"] = post_error.to_public()

        response_snapshot: dict[str, Any] = {
            "simulated": False,
            "execution_mode": "LIVE",
            "http_status": response.status_code if response else None,
            "request_id": (response.request_id if response else None) or request_id,
            "remote_summary": {
                "capture_status": capture_after.status if capture_after else None,
                "refund_status": status or None,
                "refund_id": refund_id,
                "amount": verification["amount"],
                "currency": verification["currency"],
            },
            "raw_sha256": response.raw_sha256 if response else "",
        }

        outcome = LiveExecutionOutcome(
            result=result,
            gateway=GATEWAY_NAME,
            request_snapshot={
                "action_type": proposal.action_type,
                "action_family": "PAYMENT",
                "action_payload": proposal.action_payload,
                "idempotency_key": idempotency_key,
                "capture_id": capture_id,
                "amount": verification["amount"],
                "currency": verification["currency"],
                "case_snapshot_hash": case.snapshot_hash,
                "approval_id": approval.approval_id,
                "state_version": state_version,
                "approved_capture_snapshot": approved.to_payload(),
                "remote_precheck": {
                    "status": before.status,
                    "original_amount": before.original_amount,
                    "total_refunded": before.total_refunded,
                    "refundable_remaining": before.refundable_remaining,
                    "checked_at": checked_at,
                },
            },
            response_snapshot=response_snapshot,
            verification=verification,
        )

        if audit is not None:
            if result == RESULT_EXECUTED:
                audit(
                    AUDIT_VERIFIED,
                    {
                        "approval_id": approval.approval_id,
                        "http_status": response_snapshot["http_status"],
                        "capture_id": capture_id,
                        "matched_refund_id": refund_id,
                        "refund_status": status,
                        "amount": verification["amount"],
                        "currency": verification["currency"],
                        "confirmed": True,
                        "checked_at": checked_at,
                        "request_id": request_id,
                    },
                )
            elif result in (RESULT_PENDING, RESULT_UNVERIFIED):
                audit(
                    AUDIT_UNKNOWN,
                    {
                        "approval_id": approval.approval_id,
                        "reason": uncertain,
                        "result": result,
                        "http_status": response_snapshot["http_status"],
                        "capture_id": capture_id,
                        "matched_refund_id": refund_id,
                        "refund_status": status or None,
                        "confirmed": False,
                        "checked_at": checked_at,
                        "next_action": (
                            "RECONCILE_PENDING_REFUND"
                            if result == RESULT_PENDING
                            else "HUMAN_REVIEW"
                        ),
                        "request_id": request_id,
                    },
                )
            else:
                audit(
                    AUDIT_BLOCKED,
                    {
                        "approval_id": approval.approval_id,
                        "reason": failed_reason or uncertain,
                        "result": result,
                        "http_status": response_snapshot["http_status"],
                        "capture_id": capture_id,
                        "refund_status": status or None,
                        "confirmed": False,
                        "post_issued": True,
                        "request_id": request_id,
                    },
                )
        return outcome

    # ------------------------------------------------------------------ helpers
    def _read_capture(
        self, capture_id: str
    ) -> tuple[CaptureSnapshot | None, PayPalError | None]:
        try:
            raw = self.client.get_capture(capture_id)
        except PayPalError as exc:
            return None, exc
        try:
            return capture_snapshot(raw), None
        except CaptureParseError as exc:
            return None, PayPalError(
                PayPalErrorKind.PROTOCOL, f"capture could not be read: {exc}"
            )

    @staticmethod
    def _drift_reason(
        approved: CaptureSnapshot, observed: CaptureSnapshot
    ) -> str:
        """Any material difference blocks: the approval no longer describes
        the capture it would move money against."""
        if approved.capture_id != observed.capture_id:
            return (
                "approved capture id "
                f"{approved.capture_id!r} != observed {observed.capture_id!r}"
            )
        if approved.currency != observed.currency:
            return (
                f"capture currency changed since approval: "
                f"{approved.currency} → {observed.currency}"
            )
        if approved.status != observed.status:
            return (
                "capture status changed since approval: "
                f"{approved.status} → {observed.status}"
            )
        if approved.original_minor != observed.original_minor:
            return (
                "capture amount changed since approval: "
                f"{approved.original_amount} → {observed.original_amount}"
            )
        if approved.refunded_minor != observed.refunded_minor:
            return (
                "already-refunded amount changed since approval: "
                f"{approved.total_refunded} → {observed.total_refunded}"
            )
        if approved.remaining_minor != observed.remaining_minor:
            return (
                "refundable remaining changed since approval: "
                f"{approved.refundable_remaining} → {observed.refundable_remaining}"
            )
        return ""

    @staticmethod
    def _refund_id_from_response(response: HttpResponse | None) -> str | None:
        if response is None:
            return None
        body = response.json_body or {}
        value = str(body.get("id") or "").strip()
        return value or None

    @staticmethod
    def _post_outcome_unknown(exc: PayPalError) -> bool:
        """True when the POST may have landed (timeout, 5xx, unusable 2xx)."""
        if exc.http_status is None:
            return True
        return exc.http_status >= 500 or 200 <= exc.http_status < 300

    # --------------------------------------------------------------- outcomes
    def _blocked(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        approval: Approval,
        *,
        reason: str,
        stage: str,
        pre: CaptureSnapshot | None = None,
        findings: list[dict[str, Any]] | None = None,
    ) -> LiveExecutionOutcome:
        verification: dict[str, Any] = {
            "method": "LIVE_GET",
            "basis": "REMOTE_GET",
            "confirmed": False,
            "checked_at": _now_iso(),
            "blocked_stage": stage,
            "blocked_reason": reason,
            "post_issued": False,
            "capture_id": pre.capture_id if pre else capture_id_of_case(case) or None,
            "matched_refund_id": None,
            "refund_status": None,
            "dispute_resolution": "NONE",
            "dispute_resolution_note": DISPUTE_RESOLUTION_NOTE,
        }
        if findings:
            verification["refund_validation"] = findings
        return LiveExecutionOutcome(
            result=RESULT_BLOCKED,
            gateway=GATEWAY_NAME,
            request_snapshot={
                "action_type": proposal.action_type,
                "action_family": "PAYMENT",
                "action_payload": proposal.action_payload,
                "case_snapshot_hash": case.snapshot_hash,
                "approval_id": approval.approval_id,
                "remote_precheck": {
                    "status": pre.status if pre else "UNKNOWN",
                    "refundable_remaining": (
                        pre.refundable_remaining if pre else None
                    ),
                    "checked_at": _now_iso(),
                },
            },
            response_snapshot={
                "simulated": False,
                "execution_mode": "LIVE",
                "http_status": None,
                "request_id": None,
                "remote_summary": {"status": pre.status if pre else "UNKNOWN"},
                "raw_sha256": "",
            },
            verification=verification,
        )

    def _failed(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        approval: Approval,
        error: PayPalError,
        *,
        stage: str,
        request_id: str | None,
        idempotency_key: str | None,
        pre: CaptureSnapshot | None = None,
    ) -> LiveExecutionOutcome:
        return LiveExecutionOutcome(
            result=RESULT_FAILED,
            gateway=GATEWAY_NAME,
            request_snapshot={
                "action_type": proposal.action_type,
                "action_family": "PAYMENT",
                "action_payload": proposal.action_payload,
                "idempotency_key": idempotency_key,
                "case_snapshot_hash": case.snapshot_hash,
                "approval_id": approval.approval_id,
                "remote_precheck": {
                    "status": pre.status if pre else "UNKNOWN",
                    "checked_at": _now_iso(),
                },
            },
            response_snapshot={
                "simulated": False,
                "execution_mode": "LIVE",
                "http_status": error.http_status,
                "request_id": error.request_id or request_id,
                "remote_summary": {"status": "UNKNOWN"},
                "raw_sha256": "",
            },
            verification={
                "method": "LIVE_GET",
                "basis": "REMOTE_GET",
                "confirmed": False,
                "checked_at": _now_iso(),
                "failed_stage": stage,
                "error": error.to_public(),
                "post_issued": stage == "post",
                "capture_id": pre.capture_id if pre else capture_id_of_case(case) or None,
                "matched_refund_id": None,
                "refund_status": None,
                "dispute_resolution": "NONE",
                "dispute_resolution_note": DISPUTE_RESOLUTION_NOTE,
            },
        )
