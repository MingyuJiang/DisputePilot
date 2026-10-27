"""Deterministic refund validators — V13–V18 (independent of V1–V12).

A refund proposal is a PAYMENT-family action: the dispute-side checks (V1–V12)
describe a dispute whose HATEOAS links and evidence window do not apply to a
capture. The two rule sets are therefore disjoint, not additive — a proposal
runs EITHER V1–V12 (DISPUTE) OR V13–V18 (PAYMENT), and both emit the same
``ValidationReport`` shape, so the existing submit/approval/audit planes are
reused unchanged.

| id | rule |
|----|------|
| V13 | the capture resolves and belongs to this merchant |
| V14 | the capture status allows a refund (COMPLETED / PARTIALLY_REFUNDED) |
| V15 | the amount is > 0, ≤ remaining, same currency, exact 2 decimals; a full refund carries no amount |
| V16 | no COMPLETED full refund and no PENDING/UNKNOWN refund already exists |
| V17 | the payload carries the fixed idempotency key the approval is bound to |
| V18 | it is declared a payment action and carries no accept-claim / resolve field |

Everything is a decision object: nothing here can POST.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .enums import ActionFamily, ActionType, CapabilityBasis, action_family_of
from .models import ActionProposal, ValidationFinding, ValidationReport
from .policies import ValidationContext

DOC_REFUND = "PAYPAL_PAYMENTS_V2_REFUND (capture refund) + contract v1.2 PAYMENT family"

# The server writes ``capture_snapshot`` itself (authoritative balance) and the
# client may never add anything else to a refund payload. ``capture_id`` and
# ``mode`` are the client's refund-intent hints; ``reason`` is the merchant's
# human-readable note. None of them can express a dispute outcome — that is
# what REFUND_FORBIDDEN_FIELDS is for.
PAYMENT_PAYLOAD_ALLOWED_FIELDS: tuple[str, ...] = (
    "capture_id",
    "mode",
    "amount",
    "currency_code",
    "reason",
    "idempotency_key",
    "capture_snapshot",
)
PAYMENT_PAYLOAD_REQUIRED_FIELDS: tuple[str, ...] = (
    "idempotency_key",
    "capture_snapshot",
)

# Fields that would turn a refund into a dispute resolution. A refund moves
# money; it never accepts the claim, closes the dispute or records buyer
# acceptance.
REFUND_FORBIDDEN_FIELDS: tuple[str, ...] = (
    "accept_claim",
    "accept_claim_types",
    "resolve",
    "resolved",
    "resolution",
    "resolve_dispute",
    "close_dispute",
    "dispute_outcome",
    "mark_resolved",
    "escalate",
    "make_offer",
    "offer_types",
    "buyer_accepted",
    "resolves_dispute",
)

_EXACT_2DP_RE = re.compile(r"^(?:0|[1-9]\d{0,9})\.\d{2}$")


@dataclass
class RefundContext:
    """One capture observation handed to the validators by the caller.

    ``deferred_to_gateway`` is used at execution-time revalidation: the
    RefundGateway performs the single authoritative pre-GET and re-runs these
    checks against it, so the pre-flight copy must not read the network again.
    """

    capture: Any | None = None            # adapters.paypal.payments.CaptureSnapshot
    capture_error: str = ""
    expected_merchant_id: str = ""
    pending_refund_ids: list[str] = field(default_factory=list)
    deferred_to_gateway: bool = False
    deferred_reason: str = ""

    def to_public(self) -> dict[str, Any]:
        return {
            "capture_id": getattr(self.capture, "capture_id", None),
            "capture_status": getattr(self.capture, "status", None),
            "original_amount": getattr(self.capture, "original_amount", None),
            "total_refunded": getattr(self.capture, "total_refunded", None),
            "refundable_remaining": getattr(self.capture, "refundable_remaining", None),
            "currency_code": getattr(self.capture, "currency", None),
            "pending_refund_ids": list(self.pending_refund_ids),
            "deferred_to_gateway": self.deferred_to_gateway,
            "capture_error": self.capture_error,
        }


def _refund_finding(
    vid: str,
    ok: bool,
    detail: str,
    *,
    skipped: bool = False,
    basis: CapabilityBasis = CapabilityBasis.LIVE_HATEOAS,
) -> ValidationFinding:
    status = "PASS" if ok else ("SKIPPED" if skipped else "FAIL")
    return ValidationFinding(
        validator_id=vid,
        status=status,
        detail=detail,
        basis=basis,
        doc_reference=DOC_REFUND,
    )


def _context(ctx: ValidationContext) -> RefundContext:
    value = ctx.extra.get("refund_context")
    if isinstance(value, RefundContext):
        return value
    return RefundContext(
        capture_error="no capture observation was supplied to the validator"
    )


def _deferred(rc: RefundContext) -> bool:
    return bool(rc.deferred_to_gateway)


def _deferred_finding(vid: str, rc: RefundContext) -> ValidationFinding:
    return _refund_finding(
        vid,
        True,
        "deferred to the RefundGateway pre-GET, which replays V13–V18 against "
        "the single authoritative capture read"
        + (f" ({rc.deferred_reason})" if rc.deferred_reason else ""),
        skipped=True,
    )


# --------------------------------------------------------------------------- V13
def check_v13_capture(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    rc = _context(ctx)
    if _deferred(rc):
        return _deferred_finding("V13", rc)
    capture = rc.capture
    if capture is None:
        return _refund_finding(
            "V13",
            False,
            "capture could not be resolved: "
            + (rc.capture_error or "no observation supplied"),
        )

    declared = (proposal.action_payload or {}).get("capture_snapshot")
    declared_id = (
        str(declared.get("capture_id") or "") if isinstance(declared, dict) else ""
    )
    if declared_id and declared_id != capture.capture_id:
        return _refund_finding(
            "V13",
            False,
            f"payload capture_snapshot.capture_id {declared_id!r} != observed "
            f"{capture.capture_id!r}",
        )

    if capture.merchant_id and rc.expected_merchant_id:
        if capture.merchant_id != rc.expected_merchant_id:
            return _refund_finding(
                "V13",
                False,
                "capture belongs to merchant "
                f"{capture.merchant_id!r}, not this merchant "
                f"({rc.expected_merchant_id!r})",
            )
        ownership = f"response payee merchant_id={capture.merchant_id} matches this merchant"
    elif capture.merchant_id:
        ownership = (
            f"response declares payee merchant_id={capture.merchant_id}; "
            "no expected merchant id is configured"
        )
    else:
        ownership = (
            "response declares no payee/seller id; ownership rests on the "
            "authenticated capture read (payments/refund scope)"
        )
    return _refund_finding(
        "V13",
        True,
        f"capture {capture.capture_id} resolved (status={capture.status}); {ownership}",
    )


# --------------------------------------------------------------------------- V14
def check_v14_capture_status(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    from ..adapters.paypal.payments import (
        FULLY_REFUNDED_CAPTURE_STATUS,
        REFUNDABLE_CAPTURE_STATUSES,
    )

    rc = _context(ctx)
    if _deferred(rc):
        return _deferred_finding("V14", rc)
    capture = rc.capture
    if capture is None:
        return _refund_finding(
            "V14", False, "capture status unobservable — cannot authorise a refund"
        )
    if capture.status in REFUNDABLE_CAPTURE_STATUSES:
        return _refund_finding(
            "V14",
            True,
            f"capture status {capture.status} allows a refund",
        )
    if capture.status == FULLY_REFUNDED_CAPTURE_STATUS:
        return _refund_finding(
            "V14",
            False,
            "capture status REFUNDED — it has already been fully refunded",
        )
    return _refund_finding(
        "V14",
        False,
        f"capture status {capture.status or 'UNKNOWN'} does not allow a refund "
        "(only COMPLETED / PARTIALLY_REFUNDED do)",
    )


# --------------------------------------------------------------------------- V15
def check_v15_amount(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    from ..adapters.paypal.payments import CaptureParseError, to_minor

    payload = proposal.action_payload or {}
    rc = _context(ctx)
    capture = rc.capture
    deferred = _deferred(rc)
    action = str(proposal.action_type)

    if action == ActionType.FULL_REFUND.value:
        if payload.get("amount") not in (None, ""):
            return _refund_finding(
                "V15",
                False,
                "full-refund must not carry an amount — PayPal refunds the "
                "remaining refundable balance and the request body is {}",
            )
        if capture is not None and not deferred and capture.remaining_minor <= 0:
            return _refund_finding(
                "V15",
                False,
                "full-refund requested but the refundable remaining balance is 0.00",
            )
        currency = str(payload.get("currency_code") or "").upper()
        if capture is not None and not deferred and currency and currency != capture.currency:
            return _refund_finding(
                "V15",
                False,
                f"payload currency {currency} != capture currency {capture.currency}",
            )
        detail = (
            "full-refund carries no amount (body {}) and refunds the remaining "
            f"balance {capture.refundable_remaining if capture else 'UNKNOWN'}"
        )
        if deferred:
            detail += "; the balance is re-read by the gateway pre-GET"
        return _refund_finding("V15", True, detail)

    if action != ActionType.PARTIAL_REFUND.value:
        return _refund_finding(
            "V15", True, f"not a refund action ({action})", skipped=True
        )

    amount = payload.get("amount")
    if amount in (None, ""):
        return _refund_finding(
            "V15", False, "partial-refund requires an explicit amount"
        )
    text = str(amount).strip()
    if not _EXACT_2DP_RE.match(text):
        return _refund_finding(
            "V15",
            False,
            f"amount {text!r} must be an exact 2-decimal string (e.g. \"4.00\")",
        )
    try:
        minor = to_minor(text)
    except CaptureParseError as exc:  # pragma: no cover - regex already checks
        return _refund_finding("V15", False, f"amount unusable: {exc}")
    if minor <= 0:
        return _refund_finding(
            "V15", False, f"amount {text} must be greater than 0.00"
        )

    currency = str(payload.get("currency_code") or "").upper()
    if capture is not None and not deferred:
        if currency and currency != capture.currency:
            return _refund_finding(
                "V15",
                False,
                f"amount currency {currency} != capture currency {capture.currency}",
            )
        if minor > capture.remaining_minor:
            return _refund_finding(
                "V15",
                False,
                f"amount {text} exceeds the refundable remaining "
                f"{capture.refundable_remaining} {capture.currency}",
            )
        return _refund_finding(
            "V15",
            True,
            f"amount {text} {capture.currency} is > 0 and <= remaining "
            f"{capture.refundable_remaining}; currency matches; 2 decimals",
        )
    if currency and len(currency) != 3:
        return _refund_finding("V15", False, f"currency {currency!r} is not ISO-4217")
    return _refund_finding(
        "V15",
        True,
        f"amount {text} is > 0, 2 decimals, currency {currency or 'UNKNOWN'}; "
        "the remaining balance is re-checked by the gateway pre-GET",
    )


# --------------------------------------------------------------------------- V16
def check_v16_no_duplicate(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    from ..adapters.paypal.payments import FULLY_REFUNDED_CAPTURE_STATUS

    rc = _context(ctx)
    if _deferred(rc):
        return _deferred_finding("V16", rc)
    if rc.pending_refund_ids:
        return _refund_finding(
            "V16",
            False,
            "a refund for this capture is already PENDING/UNKNOWN "
            f"({', '.join(rc.pending_refund_ids)}); it must be reconciled before "
            "another refund is proposed",
        )
    capture = rc.capture
    if capture is None:
        return _refund_finding(
            "V16", True, "capture unobservable — duplicate check deferred to V13", skipped=True
        )
    if capture.status == FULLY_REFUNDED_CAPTURE_STATUS:
        return _refund_finding(
            "V16",
            False,
            "a COMPLETED full refund already exists (capture status REFUNDED)",
        )
    if capture.remaining_minor <= 0:
        return _refund_finding(
            "V16",
            False,
            "refundable remaining is 0.00 — a completed full refund already exists",
        )
    return _refund_finding(
        "V16",
        True,
        f"no completed full refund and no pending refund; remaining "
        f"{capture.refundable_remaining} {capture.currency}",
    )


# --------------------------------------------------------------------------- V17
def check_v17_idempotency(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    key = (proposal.action_payload or {}).get("idempotency_key")
    if not isinstance(key, str) or not key.strip():
        return _refund_finding(
            "V17",
            False,
            "no fixed idempotency_key in the payload — the refund cannot be "
            "bound to this approval for a single attempt",
            basis=CapabilityBasis.FIXTURE_SNAPSHOT,
        )
    return _refund_finding(
        "V17",
        True,
        f"fixed idempotency_key {key!r} is part of the approved payload hash and "
        "becomes PayPal-Request-Id (one attempt, never a retry reason)",
        basis=CapabilityBasis.FIXTURE_SNAPSHOT,
    )


# --------------------------------------------------------------------------- V18
def check_v18_not_dispute_resolution(
    proposal: ActionProposal, ctx: ValidationContext
) -> ValidationFinding:
    payload = proposal.action_payload or {}
    if action_family_of(proposal.action_type) is not ActionFamily.PAYMENT:
        return _refund_finding(
            "V18",
            False,
            f"action {proposal.action_type!r} is not a PAYMENT-family action",
            basis=CapabilityBasis.FIXTURE_SNAPSHOT,
        )
    present = sorted(field for field in REFUND_FORBIDDEN_FIELDS if field in payload)
    if present:
        return _refund_finding(
            "V18",
            False,
            f"a refund must not carry dispute-resolution fields: {present}",
            basis=CapabilityBasis.FIXTURE_SNAPSHOT,
        )
    unknown = sorted(set(payload) - set(PAYMENT_PAYLOAD_ALLOWED_FIELDS))
    if unknown:
        return _refund_finding(
            "V18",
            False,
            f"fields outside the payment payload schema: {unknown}",
            basis=CapabilityBasis.FIXTURE_SNAPSHOT,
        )
    return _refund_finding(
        "V18",
        True,
        "PAYMENT family declared; no accept-claim/resolve/close field — a "
        "completed refund neither resolves the dispute nor implies buyer acceptance",
        basis=CapabilityBasis.FIXTURE_SNAPSHOT,
    )


REFUND_CHECKS = (
    check_v13_capture,
    check_v14_capture_status,
    check_v15_amount,
    check_v16_no_duplicate,
    check_v17_idempotency,
    check_v18_not_dispute_resolution,
)


def validate_refund_proposal(
    proposal: ActionProposal,
    ctx: ValidationContext,
    *,
    report_id: str,
) -> ValidationReport:
    """Run V13–V18 deterministically. Emits a decision object; never executes."""
    findings: list[ValidationFinding] = [check(proposal, ctx) for check in REFUND_CHECKS]
    # QA-RC-04: V13–V16 inherit `LIVE_HATEOAS` from a future live adapter. In
    # the offline demo the capture observation always comes from the fixture,
    # so the finding must say so — a validator verdict claiming a live read-back
    # that never happened is exactly the claim this project forbids.
    if ctx.mode != "live" and not ctx.extra.get("refund_observation_live", False):
        for finding in findings:
            if finding.basis is CapabilityBasis.LIVE_HATEOAS:
                finding.basis = CapabilityBasis.FIXTURE_SNAPSHOT
    blocked = [
        f"{finding.validator_id}: {finding.detail}"
        for finding in findings
        if finding.status == "FAIL"
    ]
    return ValidationReport(
        report_id=report_id,
        proposal_id=proposal.proposal_id,
        case_id=proposal.case_id,
        action_type=proposal.action_type,
        findings=findings,
        passed=not blocked,
        blocked_reasons=blocked,
    )


__all__ = [
    "PAYMENT_PAYLOAD_ALLOWED_FIELDS",
    "PAYMENT_PAYLOAD_REQUIRED_FIELDS",
    "REFUND_CHECKS",
    "REFUND_FORBIDDEN_FIELDS",
    "RefundContext",
    "validate_refund_proposal",
]
