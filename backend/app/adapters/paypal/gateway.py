"""PayPal Sandbox execution gateway — designed, tested, and gated off.

Flow (one attempt, never retried):
1. Double write gate: ``DP_PAYPAL_WRITES_ENABLED=1`` AND the exact
   ``<dispute_id>:<action>`` pair is on ``DP_PAYPAL_WRITE_ALLOW``.
2. Pre-GET: remote status and HATEOAS POST link are re-checked; drift blocks.
3. One POST — multipart ``provide-evidence`` (with ``PayPal-Request-Id``) or
   JSON ``send-message`` (``{"message": "<text>"}``).
4. Verification GET: the submitted content itself must be found in the
   read-back (evidence_type + verbatim notes + source, or a seller message
   whose body equals the submitted text byte for byte). A change in status,
   evidence count or ``merchant_contacted`` is an observation only — never
   confirmation, and never a claim that the buyer received or read anything.
   A timeout/5xx/bad-response POST is *ambiguous*, resolved only by this GET.
5. Still ambiguous → UNVERIFIED (human review), never a retry.

Contract v1.1 (approved) adds ``ExecutionResult.EXECUTED/UNVERIFIED`` and
these are the values this gateway maps to. It is wired to
``POST /api/v1/approvals/{approval_id}/replay`` through
``services/execution_service.py`` when ``DP_DATA_MODE=paypal_sandbox``; the
two environment switches above remain the operational gate and are checked
again (in order) before this gateway is even constructed.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from ...domain.enums import ActionType, ExecutionResult, LifecycleStage
from ...domain.models import ActionProposal, Approval, CaseRecord, CaseStateSnapshot
from ...domain.policies import MAX_SEND_MESSAGE_CHARS
from .client import HttpResponse, PayPalApiClient
from .config import PayPalConfig
from .errors import PayPalError, PayPalErrorKind, PayPalWriteBlocked
from .normalize import NormalizedDispute, normalize_dispute

RESULT_EXECUTED = ExecutionResult.EXECUTED.value
RESULT_UNVERIFIED = ExecutionResult.UNVERIFIED.value
RESULT_BLOCKED = ExecutionResult.BLOCKED.value
RESULT_FAILED = ExecutionResult.FAILED.value

AUDIT_ATTEMPT = "EXECUTION_ATTEMPT"
AUDIT_VERIFIED = "EXECUTION_VERIFIED"
AUDIT_UNKNOWN = "EXECUTION_UNKNOWN"
AUDIT_BLOCKED = "EXECUTION_BLOCKED"

# Body fields accepted by the provide-evidence request. Anything else in the
# proposal payload is NOT forwarded (no silent payload expansion).
_ALLOWED_BODY_FIELDS = ("evidence_type", "evidence_documents", "notes", "item_ids")

# ``messages[].from`` values that identify the seller/merchant side. Anything
# else (BUYER, missing, unknown) is never treated as the seller's own message.
_SELLER_MESSAGE_FROM = frozenset({"SELLER", "MERCHANT"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class LiveExecutionOutcome:
    result: str
    gateway: str = "PayPalSandboxGateway"
    execution_mode: str = "LIVE"
    simulated: bool = False
    request_snapshot: dict[str, Any] = field(default_factory=dict)
    response_snapshot: dict[str, Any] = field(default_factory=dict)
    verification: dict[str, Any] = field(default_factory=dict)

    def to_public(self) -> dict[str, Any]:
        return {
            "result": self.result,
            "gateway": self.gateway,
            "execution_mode": self.execution_mode,
            "simulated": self.simulated,
            "request_snapshot": self.request_snapshot,
            "response_snapshot": self.response_snapshot,
            "verification": self.verification,
        }


class PayPalSandboxGateway:
    name = "PayPalSandboxGateway"

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
    ) -> LiveExecutionOutcome:
        action = str(proposal.action_type)
        dispute_id = case.dispute_id

        # 1. double gate — fail closed, before any network call
        if not self.config.writes_enabled:
            raise PayPalWriteBlocked(
                "live writes are disabled (DP_PAYPAL_WRITES_ENABLED=0)"
            )
        if not self.config.is_write_allowed(dispute_id, action):
            raise PayPalWriteBlocked(
                f"write not on allow-list for {dispute_id}:{action}"
            )
        if action == ActionType.SEND_MESSAGE.value:
            return self._execute_send_message(
                proposal, case, state, approval, action, audit
            )
        if action != ActionType.PROVIDE_EVIDENCE.value:
            return self._blocked(
                proposal,
                case,
                approval,
                reason=(
                    f"unsupported live action {action!r}; only provide-evidence "
                    "and send-message are implemented"
                ),
                stage="action_support",
            )
        return self._execute_provide_evidence(
            proposal, case, state, approval, action, audit
        )

    # ---------------------------------------------------- provide-evidence path
    def _execute_provide_evidence(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        state: CaseStateSnapshot,
        approval: Approval,
        action: str,
        audit: Callable[[str, dict[str, Any]], None] | None,
    ) -> LiveExecutionOutcome:
        dispute_id = case.dispute_id
        if not dispute_id or dispute_id == "UNKNOWN":
            return self._blocked(
                proposal,
                case,
                approval,
                reason="case has no real dispute_id",
                stage="precheck",
            )

        evidence = {
            key: proposal.action_payload[key]
            for key in _ALLOWED_BODY_FIELDS
            if key in proposal.action_payload
        }
        if not evidence.get("evidence_type"):
            return self._blocked(
                proposal,
                case,
                approval,
                reason="proposal payload has no evidence_type",
                stage="payload",
            )
        # PayPal expects {"evidences": [...]}; never invent documents or
        # fields the proposal did not contain.
        evidences = [evidence]

        # 2. pre-GET
        pre, failure = self._read_dispute(dispute_id)
        if failure is not None:
            return self._failed(proposal, case, approval, failure, stage="precheck")
        if pre is None:  # pragma: no cover - _read_dispute always sets one side
            return self._failed(
                proposal,
                case,
                approval,
                PayPalError(PayPalErrorKind.PROTOCOL, "empty pre-check"),
                stage="precheck",
            )

        drift = self._drift_reason(pre, state)
        if drift:
            return self._blocked(
                proposal,
                case,
                approval,
                reason=drift,
                stage="precheck",
                pre=pre,
            )
        if not self._has_post_link(pre, action):
            return self._blocked(
                proposal,
                case,
                approval,
                reason=f"remote HATEOAS has no POST link for {action!r}",
                stage="hateoas",
                pre=pre,
            )

        request_id = secrets.token_hex(16)
        idempotency_key = str(
            proposal.action_payload.get("idempotency_key") or request_id
        )
        before_count = pre.evidence_count
        checked_at = _now_iso()

        if audit is not None:
            audit(
                AUDIT_ATTEMPT,
                {
                    "approval_id": approval.approval_id,
                    "action_type": action,
                    "request_id": request_id,
                    "precheck": {
                        "status": pre.remote_status,
                        "links": [
                            f"{link['rel']}:{link['method']}" for link in pre.links
                        ],
                        "checked_at": checked_at,
                    },
                },
            )

        # 3. exactly one multipart POST, no retry
        try:
            response = self.client.post_provide_evidence(
                dispute_id, evidences, request_id=request_id
            )
        except PayPalError as exc:
            if exc.kind in (PayPalErrorKind.UNAVAILABLE, PayPalErrorKind.PROTOCOL):
                # Ambiguous: the write may have landed. Resolve by GET only.
                return self._verify(
                    proposal,
                    case,
                    approval,
                    request_id=request_id,
                    idempotency_key=idempotency_key,
                    before=pre,
                    before_count=before_count,
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
                        "request_id": request_id,
                    },
                )
            return outcome

        # 4. verification GET (also for 2xx — acceptance is not evidence)
        return self._verify(
            proposal,
            case,
            approval,
            request_id=request_id,
            idempotency_key=idempotency_key,
            before=pre,
            before_count=before_count,
            state_version=state.state_version,
            response=response,
            post_error=None,
            audit=audit,
        )

    # ------------------------------------------------------- send-message path
    def _execute_send_message(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        state: CaseStateSnapshot,
        approval: Approval,
        action: str,
        audit: Callable[[str, dict[str, Any]], None] | None,
    ) -> LiveExecutionOutcome:
        dispute_id = case.dispute_id
        if not dispute_id or dispute_id == "UNKNOWN":
            return self._blocked(
                proposal,
                case,
                approval,
                reason="case has no real dispute_id",
                stage="precheck",
            )

        payload = (
            proposal.action_payload
            if isinstance(proposal.action_payload, dict)
            else {}
        )
        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            return self._blocked(
                proposal,
                case,
                approval,
                reason="proposal payload has no non-empty string 'message'",
                stage="payload",
            )
        if len(message) > MAX_SEND_MESSAGE_CHARS:
            return self._blocked(
                proposal,
                case,
                approval,
                reason=(
                    f"message is {len(message)} characters; PayPal send-message "
                    f"limit is {MAX_SEND_MESSAGE_CHARS}"
                ),
                stage="payload",
            )

        # 2. pre-GET — remote stage and HATEOAS are the only runtime permission
        pre, failure = self._read_dispute(dispute_id)
        if failure is not None:
            return self._failed(proposal, case, approval, failure, stage="precheck")
        if pre is None:  # pragma: no cover - _read_dispute always sets one side
            return self._failed(
                proposal,
                case,
                approval,
                PayPalError(PayPalErrorKind.PROTOCOL, "empty pre-check"),
                stage="precheck",
            )

        drift = self._drift_reason(pre, state)
        if drift:
            return self._blocked(
                proposal,
                case,
                approval,
                reason=drift,
                stage="precheck",
                pre=pre,
            )
        if pre.state.lifecycle_stage != LifecycleStage.INQUIRY:
            return self._blocked(
                proposal,
                case,
                approval,
                reason=(
                    "send-message requires dispute_life_cycle_stage INQUIRY; "
                    f"remote stage={pre.remote_lifecycle or 'UNKNOWN'}"
                ),
                stage="lifecycle",
                pre=pre,
            )
        if not self._has_post_link(pre, action):
            return self._blocked(
                proposal,
                case,
                approval,
                reason=f"remote HATEOAS has no POST link for {action!r}",
                stage="hateoas",
                pre=pre,
            )

        request_id = secrets.token_hex(16)
        idempotency_key = str(payload.get("idempotency_key") or request_id)
        checked_at = _now_iso()

        if audit is not None:
            audit(
                AUDIT_ATTEMPT,
                {
                    "approval_id": approval.approval_id,
                    "action_type": action,
                    "request_id": request_id,
                    "message_len": len(message),
                    "precheck": {
                        "status": pre.remote_status,
                        "lifecycle": pre.remote_lifecycle,
                        "links": [
                            f"{link['rel']}:{link['method']}" for link in pre.links
                        ],
                        "checked_at": checked_at,
                    },
                },
            )

        # 3. exactly one JSON POST, no redirect, no retry
        try:
            response = self.client.post_send_message(dispute_id, message, request_id)
        except PayPalError as exc:
            if self._post_outcome_unknown(exc):
                # Ambiguous: resolve by GET only.
                return self._verify_send_message(
                    proposal,
                    case,
                    approval,
                    request_id=request_id,
                    idempotency_key=idempotency_key,
                    message=message,
                    before=pre,
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
                        "request_id": request_id,
                    },
                )
            return outcome

        # 4. verification GET (2xx acceptance is not delivery)
        return self._verify_send_message(
            proposal,
            case,
            approval,
            request_id=request_id,
            idempotency_key=idempotency_key,
            message=message,
            before=pre,
            state_version=state.state_version,
            response=response,
            post_error=None,
            audit=audit,
        )

    def _verify_send_message(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        approval: Approval,
        *,
        request_id: str,
        idempotency_key: str,
        message: str,
        before: NormalizedDispute,
        state_version: int,
        response: HttpResponse | None,
        post_error: PayPalError | None,
        audit: Callable[[str, dict[str, Any]], None] | None,
    ) -> LiveExecutionOutcome:
        checked_at = _now_iso()
        matched: dict[str, Any] | None = None
        messages_observable = False
        after_count = before.message_count
        after_status = before.remote_status
        merchant_contacted_after = before.case.seller_contacted
        read_error = ""
        try:
            after_raw = self.client.get_dispute(case.dispute_id)
            after = normalize_dispute(after_raw)
            messages_observable = after.messages_observable
            after_count = after.message_count
            after_status = after.remote_status
            merchant_contacted_after = after.case.seller_contacted
            if messages_observable:
                matched = self._match_seller_message(after.messages, message)
        except (PayPalError, ValueError) as exc:
            read_error = (
                exc.kind.value
                if isinstance(exc, PayPalError)
                else PayPalErrorKind.PROTOCOL.value
            )

        # Presence of the exact seller text is the only proof. Status changes,
        # message counts and merchant_contacted are observations only.
        confirmed = matched is not None
        uncertain = ""
        failed_reason = ""
        if confirmed:
            result = RESULT_EXECUTED
        elif read_error:
            result = RESULT_UNVERIFIED
            uncertain = (
                "post outcome could not be verified: verification GET failed "
                f"({read_error})"
            )
        elif post_error is None:
            result = RESULT_UNVERIFIED
            uncertain = (
                "post returned 2xx but no seller message with the submitted body "
                "was found on read-back"
                if messages_observable
                else "post returned 2xx but the read-back exposes no messages field "
                "— the message history is not observable, so delivery is unproven"
            )
        elif post_error.http_status is not None and post_error.http_status >= 500:
            # Explicit 5xx: PayPal reported an error for this request and the
            # text is absent after one confirming GET → definite failure.
            result = RESULT_FAILED
            failed_reason = (
                "post was rejected by PayPal "
                f"(http_status={post_error.http_status}) and no matching seller "
                "message was found on read-back"
            )
        else:
            result = RESULT_UNVERIFIED
            uncertain = (
                "post outcome unknown after a transport/protocol failure and no "
                "seller message matching the submitted text was found on read-back"
            )

        message_delta = (
            after_count - before.message_count
            if messages_observable
            and before.message_count is not None
            and after_count is not None
            else None
        )
        observations = {
            "status_before": before.remote_status,
            "status_after": after_status,
            "message_count_before": before.message_count,
            "message_count_after": after_count,
            "message_delta": message_delta,
            "merchant_contacted_before": before.case.seller_contacted,
            "merchant_contacted_after": merchant_contacted_after,
            "merchant_contacted_is_delivery_evidence": False,
        }
        verification: dict[str, Any] = {
            "method": "LIVE_GET",
            "basis": "REMOTE_GET",
            "confirmed": confirmed,
            "checked_at": checked_at,
            "remote_status": after_status,
            "messages_observable": messages_observable,
            "matched_message_id": (
                str(matched.get("id")) if matched and matched.get("id") else None
            ),
            "matched_message_len": (
                len(str(matched.get("body"))) if matched else None
            ),
            "match_basis": "BYTE_EXACT_SELLER_BODY" if confirmed else None,
            "delivery_claim": "NONE",
            "delivery_note": (
                "a matching seller message in messages[] proves the text is "
                "recorded on the dispute; it does not prove the buyer received, "
                "was notified of, or read it"
            ),
            "observations": observations,
        }
        if uncertain:
            verification["uncertain_reason"] = uncertain
        if post_error is not None:
            # No usable 2xx was received: acceptance was not observable from the
            # response, only from the read-back above.
            verification["post_outcome_unknown"] = True
            verification["post_error"] = post_error.to_public()
        if failed_reason:
            verification["failed_stage"] = "post"
            verification["failure_reason"] = failed_reason

        response_snapshot: dict[str, Any] = {
            "simulated": False,
            "execution_mode": "LIVE",
            "http_status": response.status_code if response else None,
            "request_id": (response.request_id if response else None) or request_id,
            "remote_summary": {
                "status": after_status,
                "message_count": after_count,
                "message_delta": message_delta,
                "messages_observable": messages_observable,
            },
            "raw_sha256": response.raw_sha256 if response else "",
        }

        outcome = LiveExecutionOutcome(
            result=result,
            request_snapshot={
                "action_type": proposal.action_type,
                "action_payload": proposal.action_payload,
                "idempotency_key": idempotency_key,
                "message_len": len(message),
                "case_snapshot_hash": case.snapshot_hash,
                "approval_id": approval.approval_id,
                "state_version": state_version,
                "remote_precheck": {
                    "status": before.remote_status,
                    "lifecycle": before.remote_lifecycle,
                    "links": [
                        f"{link['rel']}:{link['method']}" for link in before.links
                    ],
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
                        "remote_status": after_status,
                        "confirmed": True,
                        "checked_at": checked_at,
                        "matched_message_id": verification["matched_message_id"],
                        "matched_message_len": verification["matched_message_len"],
                        "observations": observations,
                        "request_id": request_id,
                    },
                )
            elif result == RESULT_UNVERIFIED:
                audit(
                    AUDIT_UNKNOWN,
                    {
                        "approval_id": approval.approval_id,
                        "reason": uncertain,
                        "http_status": response_snapshot["http_status"],
                        "remote_status": after_status,
                        "confirmed": False,
                        "checked_at": checked_at,
                        "next_action": "HUMAN_REVIEW",
                        "request_id": request_id,
                    },
                )
            else:
                audit(
                    AUDIT_BLOCKED,
                    {
                        "approval_id": approval.approval_id,
                        "reason": failed_reason,
                        "http_status": response_snapshot["http_status"],
                        "confirmed": False,
                        "request_id": request_id,
                    },
                )
        return outcome

    # ------------------------------------------------------------------ helpers
    def _read_dispute(
        self, dispute_id: str
    ) -> tuple[NormalizedDispute | None, PayPalError | None]:
        try:
            raw = self.client.get_dispute(dispute_id)
        except PayPalError as exc:
            return None, exc
        try:
            return normalize_dispute(raw), None
        except ValueError as exc:
            return None, PayPalError(
                PayPalErrorKind.PROTOCOL, f"remote dispute unparsable: {exc}"
            )

    @staticmethod
    def _drift_reason(pre: NormalizedDispute, state: CaseStateSnapshot) -> str:
        if state.dispute_status.value == "UNKNOWN":
            return "pre-state dispute_status is UNKNOWN; cannot verify freshness"
        if pre.state.dispute_status != state.dispute_status:
            return (
                "remote state changed since import: "
                f"{state.dispute_status.value} → {pre.state.dispute_status.value}"
            )
        return ""

    @staticmethod
    def _has_post_link(pre: NormalizedDispute, action: str) -> bool:
        wanted = action.replace("-", "_")
        return any(
            link.rel == wanted and link.method.upper() == "POST"
            for link in pre.case.available_actions
        )

    @staticmethod
    def _post_outcome_unknown(exc: PayPalError) -> bool:
        """True when the POST may have landed (timeout, 5xx, unusable 2xx).

        An explicit 4xx is a definite rejection of this request, so no read-back
        is needed to conclude FAILED.
        """
        if exc.http_status is None:
            return True
        return exc.http_status >= 500 or 200 <= exc.http_status < 300

    @staticmethod
    def _match_seller_message(
        messages: list[dict[str, Any]], message: str
    ) -> dict[str, Any] | None:
        """The seller-side entry whose ``body`` equals the submission byte for byte.

        ``from`` must identify the seller; a buyer entry that repeats the same
        text is not proof that our write landed.
        """
        for entry in messages:
            if not isinstance(entry, dict):
                continue
            origin = str(entry.get("from") or "").strip().upper()
            if origin not in _SELLER_MESSAGE_FROM:
                continue
            body = entry.get("body")
            if isinstance(body, str) and body == message:
                return entry
        return None

    @staticmethod
    def _documents_match(payload_docs: Any, remote_docs: Any) -> bool:
        """Compare declared documents by count and any identifying fields.

        PayPal returns server-side ``document_id``/``type``; the proposal may
        carry those or a client-side ``name``. Only fields the payload actually
        declares are compared — absence is never treated as a match.
        """
        if not isinstance(payload_docs, list) or not payload_docs:
            return False
        if not isinstance(remote_docs, list) or len(remote_docs) != len(payload_docs):
            return False
        for wanted, observed in zip(payload_docs, remote_docs):
            if not isinstance(wanted, dict) or not isinstance(observed, dict):
                return False
            for key in ("document_id", "type", "name"):
                if wanted.get(key) and str(wanted[key]) != str(observed.get(key) or ""):
                    return False
        return True

    @classmethod
    def _entry_matches(cls, entry: Any, payload: dict[str, Any]) -> bool:
        """True only when ``entry`` is the exact evidence this write submitted."""
        if not isinstance(entry, dict):
            return False

        wanted_type = str(payload.get("evidence_type") or "").strip().upper()
        observed_type = str(entry.get("evidence_type") or "").strip().upper()
        if not wanted_type or observed_type != wanted_type:
            return False

        if str(entry.get("source") or "").strip().upper() != "SUBMITTED_BY_SELLER":
            return False

        # Notes must be byte-for-byte equal — no stripping, no normalisation.
        wanted_notes = payload.get("notes")
        if wanted_notes is not None and str(wanted_notes) != "":
            if str(entry.get("notes") or "") != str(wanted_notes):
                return False

        wanted_docs = payload.get("evidence_documents")
        if wanted_docs:
            if not cls._documents_match(wanted_docs, entry.get("evidence_documents")):
                return False

        return True

    @classmethod
    def _match_submitted_evidence(
        cls, evidences: list[dict[str, Any]], payload: dict[str, Any]
    ) -> dict[str, Any] | None:
        for entry in evidences:
            if cls._entry_matches(entry, payload):
                return entry
        return None

    def _verify(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        approval: Approval,
        *,
        request_id: str,
        idempotency_key: str,
        before: NormalizedDispute,
        before_count: int,
        state_version: int,
        response: HttpResponse | None,
        post_error: PayPalError | None,
        audit: Callable[[str, dict[str, Any]], None] | None,
    ) -> LiveExecutionOutcome:
        checked_at = _now_iso()
        matched: dict[str, Any] | None = None
        try:
            after_raw = self.client.get_dispute(case.dispute_id)
            after = normalize_dispute(after_raw)
            after_count = after.evidence_count
            after_status = after.remote_status
            matched = self._match_submitted_evidence(
                after.evidences, proposal.action_payload
            )
            read_error = ""
        except (PayPalError, ValueError) as exc:
            after_count = before_count
            after_status = before.remote_status
            read_error = (
                exc.kind.value
                if isinstance(exc, PayPalError)
                else PayPalErrorKind.PROTOCOL.value
            )

        # Content match is the only proof; count/status deltas may be caused by
        # anyone else touching the case, so they are observations only.
        confirmed = matched is not None

        post_unknown = response is None
        if confirmed:
            result = RESULT_EXECUTED
            uncertain = ""
        else:
            result = RESULT_UNVERIFIED
            if read_error:
                uncertain = (
                    "post outcome could not be verified: verification GET failed "
                    f"({read_error})"
                )
            elif post_unknown:
                uncertain = (
                    "post outcome unknown after a transport/protocol failure and "
                    "no evidence matching the submitted payload was found on read-back"
                )
            else:
                uncertain = (
                    "post returned 2xx but the read-back has no evidence matching "
                    "the submitted payload"
                )

        observations = {
            "status_before": before.remote_status,
            "status_after": after_status,
            "evidence_count_before": before_count,
            "evidence_count_after": after_count,
            "evidence_delta": after_count - before_count,
            "matched_evidence_type": (
                str(matched.get("evidence_type") or "") if matched else None
            ),
            "matched_source": str(matched.get("source") or "") if matched else None,
            "matched_notes_len": (
                len(str(matched.get("notes") or "")) if matched else None
            ),
        }
        verification: dict[str, Any] = {
            "method": "LIVE_GET",
            "basis": "REMOTE_GET",
            "confirmed": confirmed,
            "checked_at": checked_at,
            "remote_status": after_status,
            "observations": observations,
        }
        if uncertain:
            verification["uncertain_reason"] = uncertain
        if post_unknown:
            verification["post_outcome_unknown"] = True
        if post_error is not None:
            verification["post_error"] = post_error.to_public()

        response_snapshot: dict[str, Any] = {
            "simulated": False,
            "execution_mode": "LIVE",
            "http_status": response.status_code if response else None,
            "request_id": (response.request_id if response else None) or request_id,
            "remote_summary": {
                "status": after_status,
                "evidence_count": after_count,
                "evidence_delta": after_count - before_count,
            },
            "raw_sha256": response.raw_sha256 if response else "",
        }

        outcome = LiveExecutionOutcome(
            result=result,
            request_snapshot={
                "action_type": proposal.action_type,
                "action_payload": proposal.action_payload,
                "idempotency_key": idempotency_key,
                "case_snapshot_hash": case.snapshot_hash,
                "approval_id": approval.approval_id,
                "state_version": state_version,
                "remote_precheck": {
                    "status": before.remote_status,
                    "links": [
                        f"{link['rel']}:{link['method']}" for link in before.links
                    ],
                    "checked_at": checked_at,
                },
            },
            response_snapshot=response_snapshot,
            verification=verification,
        )
        if audit is not None:
            if confirmed:
                audit(
                    AUDIT_VERIFIED,
                    {
                        "approval_id": approval.approval_id,
                        "http_status": response_snapshot["http_status"],
                        "remote_status": after_status,
                        "confirmed": True,
                        "remote_status": after_status,
                        "checked_at": checked_at,
                        "observations": observations,
                        "request_id": request_id,
                    },
                )
            else:
                audit(
                    AUDIT_UNKNOWN,
                    {
                        "approval_id": approval.approval_id,
                        "reason": uncertain,
                        "http_status": response_snapshot["http_status"],
                        "remote_status": after_status,
                        "confirmed": False,
                        "checked_at": checked_at,
                        "next_action": "HUMAN_REVIEW",
                        "request_id": request_id,
                    },
                )
        return outcome

    def _blocked(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        approval: Approval,
        *,
        reason: str,
        stage: str,
        pre: NormalizedDispute | None = None,
    ) -> LiveExecutionOutcome:
        return LiveExecutionOutcome(
            result=RESULT_BLOCKED,
            request_snapshot={
                "action_type": proposal.action_type,
                "action_payload": proposal.action_payload,
                "case_snapshot_hash": case.snapshot_hash,
                "approval_id": approval.approval_id,
                "remote_precheck": {
                    "status": pre.remote_status if pre else "UNKNOWN",
                    "links": (
                        [f"{link['rel']}:{link['method']}" for link in pre.links]
                        if pre
                        else []
                    ),
                    "checked_at": _now_iso(),
                },
            },
            response_snapshot={
                "simulated": False,
                "execution_mode": "LIVE",
                "http_status": None,
                "request_id": None,
                "remote_summary": {"status": pre.remote_status if pre else "UNKNOWN"},
                "raw_sha256": "",
            },
            verification={
                "basis": "LIVE_GET",
                "confirmed": False,
                "checked_at": _now_iso(),
                "blocked_stage": stage,
                "blocked_reason": reason,
                "post_issued": False,
            },
        )

    def _failed(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        approval: Approval,
        error: PayPalError,
        *,
        stage: str,
        request_id: str | None = None,
        idempotency_key: str | None = None,
        pre: NormalizedDispute | None = None,
    ) -> LiveExecutionOutcome:
        return LiveExecutionOutcome(
            result=RESULT_FAILED,
            request_snapshot={
                "action_type": proposal.action_type,
                "action_payload": proposal.action_payload,
                "idempotency_key": idempotency_key,
                "case_snapshot_hash": case.snapshot_hash,
                "approval_id": approval.approval_id,
                "remote_precheck": {
                    "status": pre.remote_status if pre else "UNKNOWN",
                    "links": (
                        [f"{link['rel']}:{link['method']}" for link in pre.links]
                        if pre
                        else []
                    ),
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
                "basis": "LIVE_GET",
                "confirmed": False,
                "checked_at": _now_iso(),
                "failed_stage": stage,
                "error": error.to_public(),
            },
        )
