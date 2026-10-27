"""Deterministic payment-case planning (no model, no network, no writes).

A payment case (``CAP-<capture_id>``) is a capture, not a claim. The only
legal write on it is a capture refund, and restraint is the default. This
module owns the four recommendations such a case may carry:

    partial-refund / full-refund / WAIT / HUMAN_REVIEW

Inputs are the facts the import already persisted — the capture amount, the
refundable remaining balance and the capture status line written into
``live_status_note`` at import time. Nothing here calls the AI provider, reads
the network or emits an execution path: it only produces a plan / analysis /
proposal draft that V13–V18 and manager approval still have to pass.

Why a separate planner: the dispute decision tree (evidence gap → provide
evidence / send message) is meaningless on a capture. Running it there would
recommend a dispute action on a case that has no dispute, which is exactly the
failure this module prevents.
"""

from __future__ import annotations

import re
from typing import Any

from ..adapters.paypal.payments import (
    CAPTURE_ID_PREFIX,
    REFUNDABLE_CAPTURE_STATUSES,
    CaptureParseError,
    capture_id_of_case,
    from_minor,
    to_minor,
)
from ..domain.enums import ActionType, AnalysisMode, ProposalState, ValidationStatus
from ..domain.models import (
    AIAnalysis,
    ActionProposal,
    CaseRecord,
    CaseStateSnapshot,
    content_hash,
    default_risk_for,
    utc_now_iso,
)
from ..domain.policies import decision_hash
from ..infrastructure.settings import settings

PAYMENT_CASE_PREFIX = CAPTURE_ID_PREFIX

PARTIAL_REFUND = ActionType.PARTIAL_REFUND.value
FULL_REFUND = ActionType.FULL_REFUND.value
WAIT = "WAIT"
HUMAN_REVIEW = "HUMAN_REVIEW"

# The ONLY recommendations a payment case may carry.
PAYMENT_RECOMMENDATIONS: tuple[str, ...] = (
    PARTIAL_REFUND,
    FULL_REFUND,
    WAIT,
    HUMAN_REVIEW,
)

PLANNER_SOURCE = "PAYMENT_CAPTURE_PLANNER"
ANALYSIS_BANNER = (
    "Payment case — capture-level money action only; a refund never accepts a "
    "claim, closes a case or implies buyer acceptance"
)
STUB_BANNER = "AI output is STUB_DETERMINISTIC — not a real LLM inference"

_CAPTURE_STATUS_RE = re.compile(r"(?:capture\s+)?status=([A-Z_]+)")


def is_payment_case(case: Any) -> bool:
    """A payment case is ``CAP-`` prefixed or carries a real capture reference.

    ``action_family`` is derived from the action, so it is used where an action
    exists (planning/validation); a *case* is identified by its id prefix or by
    the capture id in its transaction reference.
    """
    case_id = str(getattr(case, "case_id", "") or "")
    if case_id.startswith(PAYMENT_CASE_PREFIX):
        return True
    return bool(capture_id_of_case(case))


def _capture_status(case: CaseRecord) -> str:
    """Capture status: the structured field first, the note only as fallback.

    ``CaseRecord.capture_status`` is written by the capture importer. Records
    created before that field existed carry the status only inside
    ``live_status_note`` — in two historical spellings (``capture status=`` and
    ``status=``) — so the fallback accepts both rather than reporting UNKNOWN
    and silently refusing to plan a refund. An unreadable record still stays
    UNKNOWN: the status is never guessed from the balance.
    """
    structured = str(getattr(case, "capture_status", "") or "").strip().upper()
    if structured:
        return structured
    match = _CAPTURE_STATUS_RE.search(str(getattr(case, "live_status_note", "") or ""))
    return match.group(1).upper() if match else "UNKNOWN"


def capture_snapshot_block(case: CaseRecord, state: CaseStateSnapshot) -> dict[str, Any] | None:
    """The capture facts as the payload block (same shape as the server write).

    Derived from the observed case state: ``dispute_amount`` is the capture
    amount and ``allowed_refund_amount`` the refundable remaining. Returns
    ``None`` when either the capture reference or the observed balance is
    missing — an unobserved balance is never assumed to be the full amount.
    """
    capture_id = capture_id_of_case(case)
    if not capture_id:
        return None
    original = state.dispute_amount or case.amount
    remaining = state.allowed_refund_amount
    if original is None or remaining is None:
        return None
    remaining_minor = remaining.value_minor
    return {
        "capture_id": capture_id,
        "status": _capture_status(case),
        "original_amount": from_minor(original.value_minor),
        "total_refunded": from_minor(original.value_minor - remaining_minor),
        "refundable_remaining": from_minor(remaining_minor),
        "currency_code": original.currency,
    }


def payment_plan(
    case: CaseRecord,
    state: CaseStateSnapshot,
    *,
    requested_amount_minor: int | None = None,
) -> dict[str, Any]:
    """Derive the four-way payment recommendation from the capture facts.

    Order matters: unobservable facts are escalated to a human, a non-refundable
    status or an exhausted balance ends in WAIT, and only a genuinely refundable
    balance produces a refund recommendation.
    """
    block = capture_snapshot_block(case, state)
    if block is None:
        return _plan(
            HUMAN_REVIEW,
            [
                "persisted capture facts are incomplete (capture reference or "
                "refundable balance missing) — no refund can be planned",
                "a human must reconcile the payment record before any action",
            ],
            gaps=["capture facts incomplete"],
        )

    status = str(block["status"])
    remaining_minor = _minor(block["refundable_remaining"])
    original_minor = _minor(block["original_amount"])
    currency = block["currency_code"]

    if status == "UNKNOWN":
        return _plan(
            HUMAN_REVIEW,
            [
                "capture status was not observable in the persisted payment record",
                "no refund is planned without an observed capture status",
            ],
            block,
            gaps=["capture status unobservable"],
        )
    if remaining_minor > original_minor:
        return _plan(
            HUMAN_REVIEW,
            [
                f"refundable remaining {block['refundable_remaining']} exceeds the "
                f"capture amount {block['original_amount']} — observation inconsistent",
                "a human must reconcile the capture balance",
            ],
            block,
            gaps=["capture balance inconsistent"],
        )
    if status not in REFUNDABLE_CAPTURE_STATUSES:
        if remaining_minor <= 0:
            reason = (
                f"refundable remaining is {block['refundable_remaining']} {currency} "
                "— nothing left to refund"
            )
        else:
            reason = (
                f"capture status {status} does not allow a refund "
                "(only COMPLETED / PARTIALLY_REFUNDED do)"
            )
        return _plan(
            WAIT,
            [reason, "no refund is planned — WAIT (restraint)"],
            block,
            gaps=[reason],
        )
    if remaining_minor <= 0:
        reason = (
            f"refundable remaining is {block['refundable_remaining']} {currency} "
            "— nothing left to refund"
        )
        return _plan(
            WAIT,
            [reason, "no refund is planned — WAIT (restraint)"],
            block,
            gaps=[reason],
        )

    if requested_amount_minor is not None and 0 < requested_amount_minor < remaining_minor:
        amount = from_minor(requested_amount_minor)
        return _plan(
            PARTIAL_REFUND,
            [
                f"explicit refund amount {amount} {currency} is below the "
                f"refundable remaining {block['refundable_remaining']}",
                "a refund moves money only — it never accepts a claim or closes a case",
            ],
            block,
            requested_amount=amount,
        )

    return _plan(
        FULL_REFUND,
        [
            "no explicit partial amount was recorded; the remaining refundable "
            f"balance {block['refundable_remaining']} {currency} is the refundable "
            "amount",
            "a refund moves money only — it never accepts a claim or closes a case",
        ],
        block,
    )


def build_payment_analysis(
    case: CaseRecord,
    state: CaseStateSnapshot,
    *,
    requested_amount_minor: int | None = None,
) -> AIAnalysis:
    """Deterministic payment-case analysis (no provider call, no inference)."""
    plan = payment_plan(case, state, requested_amount_minor=requested_amount_minor)
    block = plan.get("capture_snapshot") or {}
    summary = _summary(case, block)
    return AIAnalysis(
        analysis_id=(
            f"ANL-{case.case_id}-"
            f"{utc_now_iso().replace(':', '').replace('-', '')[-12:]}-"
            f"{content_hash(case.case_id + plan['recommended_action'])[:6]}"
        ),
        case_id=case.case_id,
        case_snapshot_hash=case.snapshot_hash,
        factual_summary=summary,
        grounded_facts=[],
        missing_evidence=[],
        contradictions=[],
        recommendation=plan["recommended_action"],
        safety_flags=[ANALYSIS_BANNER, STUB_BANNER],
        model_provider="payment-capture-planner",
        model_name="refund-planner-v1",
        analysis_mode=AnalysisMode.STUB_DETERMINISTIC,
        plan=plan,
    )


def build_payment_proposal(
    case: CaseRecord, state: CaseStateSnapshot, analysis: AIAnalysis
) -> ActionProposal | None:
    """Turn a payment plan into at most one draft proposal.

    A refund plan becomes a PAYMENT-family draft (validated by V13–V18). WAIT
    becomes a no-write ``wait`` draft. HUMAN_REVIEW produces no proposal: a
    human must reconcile the capture first.
    """
    plan = dict(analysis.plan or {}) or payment_plan(case, state)
    recommendation = str(plan.get("recommended_action") or "")

    if recommendation == HUMAN_REVIEW:
        return None
    if recommendation == WAIT:
        action = ActionType.WAIT.value
        payload: dict[str, Any] = {}
    elif recommendation in (PARTIAL_REFUND, FULL_REFUND):
        block = plan.get("capture_snapshot") or capture_snapshot_block(case, state)
        if not isinstance(block, dict):
            return None
        action = recommendation
        payload = {
            "capture_snapshot": block,
            "currency_code": block.get("currency_code"),
            "idempotency_key": _idempotency_key(case.case_id, action),
        }
        amount = plan.get("requested_amount")
        if action == PARTIAL_REFUND:
            if not amount:
                return None
            payload["amount"] = amount
    else:  # any other value is not a payment recommendation
        return None

    rationale = [str(item) for item in plan.get("rationale", []) if str(item).strip()]
    rationale.append(
        "draft derived by the deterministic payment planner; V13–V18 and manager "
        "approval still gate any write"
    )
    proposal = ActionProposal(
        proposal_id=(
            f"PRP-{case.case_id}-{action}-"
            f"{content_hash(case.snapshot_hash + action + str(sorted(payload.items())))[:10]}"
        ),
        case_id=case.case_id,
        analysis_id=analysis.analysis_id,
        action_type=action,
        action_payload=payload,
        expected_preconditions=_preconditions(recommendation),
        required_evidence=[],
        rationale=rationale,
        evidence_ids=[],
        risk_level=default_risk_for(action),
        validation_status=ValidationStatus.NOT_RUN,
        state=ProposalState.DRAFT,
        snapshot_hash=decision_hash(case, state),
        policy_version=settings.policy_version,
    )
    proposal.bind_hashes(settings.policy_version)
    return proposal


# --------------------------------------------------------------------- helpers
def _plan(
    recommendation: str,
    rationale: list[str],
    capture_snapshot: dict[str, Any] | None = None,
    *,
    gaps: list[str] | None = None,
    requested_amount: str | None = None,
) -> dict[str, Any]:
    plan: dict[str, Any] = {
        "recommended_action": recommendation,
        "rationale": rationale,
        "gaps": [
            {"gap": gap, "severity": "INFO", "source": PLANNER_SOURCE}
            for gap in (gaps or [])
        ],
        "alternatives": _alternatives(recommendation),
        "wait_rule_applies": recommendation == WAIT,
        "action_family": "PAYMENT",
        "source": PLANNER_SOURCE,
    }
    if capture_snapshot is not None:
        plan["capture_snapshot"] = capture_snapshot
    if requested_amount is not None:
        plan["requested_amount"] = requested_amount
    return plan


def _alternatives(recommendation: str) -> list[str]:
    if recommendation == PARTIAL_REFUND:
        return [FULL_REFUND, WAIT]
    if recommendation == FULL_REFUND:
        return [PARTIAL_REFUND, WAIT]
    if recommendation == HUMAN_REVIEW:
        return [WAIT]
    return []


def _summary(case: CaseRecord, block: dict[str, Any]) -> str:
    if not block:
        return (
            f"Payment capture case {case.case_id}: the persisted capture facts are "
            "incomplete, so no refund can be characterised. No action was taken and "
            "no refund has been executed."
        )
    return (
        f"Payment capture case {case.case_id}: capture status={block['status']}, "
        f"original {block['original_amount']} {block['currency_code']}, "
        f"total_refunded {block['total_refunded']}, "
        f"refundable_remaining {block['refundable_remaining']} "
        f"(PayPal Payments v2 observation, provenance {case.provenance.value}). "
        "A capture is a payment record, not a claim: a refund moves money only and "
        "never accepts a claim, closes a case or implies buyer acceptance. "
        "No refund has been executed."
    )


def _preconditions(recommendation: str) -> list[str]:
    if recommendation == WAIT:
        return ["no write: the capture does not allow a refund right now"]
    return [
        "capture status COMPLETED / PARTIALLY_REFUNDED at validation time",
        "refundable remaining covers the requested amount",
        "manager approval bound to this payload and capture snapshot",
    ]


def _idempotency_key(case_id: str, action: str) -> str:
    return f"DP-PAYMENT-{case_id}-{action.upper().replace('-', '_')}-001"


def _minor(value: Any) -> int:
    try:
        return to_minor(value)
    except (CaptureParseError, TypeError, ValueError):
        return 0


__all__ = [
    "ANALYSIS_BANNER",
    "FULL_REFUND",
    "HUMAN_REVIEW",
    "PARTIAL_REFUND",
    "PAYMENT_RECOMMENDATIONS",
    "WAIT",
    "build_payment_analysis",
    "build_payment_proposal",
    "capture_snapshot_block",
    "is_payment_case",
    "payment_plan",
]
