"""Autopilot triage vocabulary + decision policy (pure, deterministic).

TRIAGE_ONLY never executes anything: it analyses, plans, validates and then
classifies each case. The five classifications are the whole product surface of
this slice, so the policy that produces them lives here as a pure function —
no session, no network, no AI call — and is therefore directly testable.

Ordering matters and is deliberate:

1. a case that raised is FAILED (technical, never masked);
2. a validator rejection is BLOCKED (the deterministic gate is authoritative);
3. a ``wait`` candidate is WAIT (restraint, no write exists);
4. a money action is NEEDS_HUMAN (a refund is never auto-executed);
5. an analysis that records the required evidence as MISSING_EVIDENCE is
   BLOCKED (the merchant cannot substantiate the submission — no synthetic
   proof may be substituted);
6. everything else is READY_FOR_REVIEW.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import Enum


class AutopilotMode(str, Enum):
    """Only triage exists in MVP-0; execution modes are future work."""

    TRIAGE_ONLY = "TRIAGE_ONLY"


class TriageDecision(str, Enum):
    READY_FOR_REVIEW = "READY_FOR_REVIEW"
    NEEDS_HUMAN = "NEEDS_HUMAN"
    BLOCKED = "BLOCKED"
    WAIT = "WAIT"
    FAILED = "FAILED"


class RunStatus(str, Enum):
    """Honest aggregate: a partially failed run is never reported COMPLETED."""

    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class ReviewSubmissionStatus(str, Enum):
    """Outcome of one case inside a batch submit-for-review request.

    ``SUBMITTED_FOR_REVIEW`` means exactly one thing: an Approval row now
    exists with decision PENDING. It is never a synonym for approved,
    executed or replayed.
    """

    SUBMITTED_FOR_REVIEW = "SUBMITTED_FOR_REVIEW"
    ALREADY_SUBMITTED = "ALREADY_SUBMITTED"
    SKIPPED_NOT_ELIGIBLE = "SKIPPED_NOT_ELIGIBLE"
    BLOCKED_VALIDATION = "BLOCKED_VALIDATION"
    BLOCKED_STALE = "BLOCKED_STALE"
    FAILED = "FAILED"


class TriageReasonCode(str, Enum):
    """Machine-readable reason a case ended in its decision.

    Kept separate from the human sentences so a UI or a report never has to
    parse prose — and so "validator passed" and "policy blocked" can never be
    conflated (the two are independent facts).
    """

    VALIDATOR_PASSED = "VALIDATOR_PASSED"
    VALIDATOR_BLOCKED = "VALIDATOR_BLOCKED"
    VALIDATION_NOT_RUN = "VALIDATION_NOT_RUN"
    NO_CANDIDATE_ACTION = "NO_CANDIDATE_ACTION"
    WAIT_NO_LEGAL_ACTION = "WAIT_NO_LEGAL_ACTION"
    PAYMENT_REQUIRES_APPROVAL = "PAYMENT_REQUIRES_APPROVAL"
    # The validator passed on structure, but the evidence the action depends on
    # does not exist. A policy stop, never a validator failure.
    EVIDENCE_INSUFFICIENT = "EVIDENCE_INSUFFICIENT"
    TECHNICAL_ERROR = "TECHNICAL_ERROR"
    NO_EXECUTION_TRIAGE_ONLY = "NO_EXECUTION_TRIAGE_ONLY"


class SubmissionBatchStatus(str, Enum):
    """Aggregate outcome of one batch submit-for-review request.

    Four states, because "some succeeded" must never read as "all succeeded":

    - COMPLETED          every requested case ended in review (new or already
                         pending) — no skips, blocks or failures;
    - PARTIAL            at least one case ended in review and at least one did
                         not;
    - NOTHING_SUBMITTED  no case ended in review, and nothing failed technically
                         (all skipped/blocked, or everything already pending);
    - FAILED             a technical failure occurred and nothing was submitted.
    """

    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    NOTHING_SUBMITTED = "NOTHING_SUBMITTED"
    FAILED = "FAILED"


class SubmissionItemReason(str, Enum):
    """Why one case inside a submission batch ended where it did."""

    SUBMITTED_FOR_REVIEW = "SUBMITTED_FOR_REVIEW"
    ALREADY_PENDING_APPROVAL = "ALREADY_PENDING_APPROVAL"
    CASE_NOT_IN_RUN = "CASE_NOT_IN_RUN"
    RUN_DECISION_NOT_REVIEWABLE = "RUN_DECISION_NOT_REVIEWABLE"
    NO_CANDIDATE_PROPOSAL = "NO_CANDIDATE_PROPOSAL"
    PROPOSAL_MISSING = "PROPOSAL_MISSING"
    PAYLOAD_CHANGED = "PAYLOAD_CHANGED"
    PROPOSAL_STATE_INELIGIBLE = "PROPOSAL_STATE_INELIGIBLE"
    VALIDATOR_REJECTED = "VALIDATOR_REJECTED"
    TECHNICAL_ERROR = "TECHNICAL_ERROR"


class SubmissionOriginType(str, Enum):
    """Where an approval came from, derived from stored relations only.

    ``LEGACY_OR_UNKNOWN`` is reserved for a future backfill marker; today an
    approval without a batch item is reported as ``SINGLE_SUBMISSION`` because
    both single and pre-batch submissions go through the same service call.
    """

    AUTOPILOT_BATCH = "AUTOPILOT_BATCH"
    SINGLE_SUBMISSION = "SINGLE_SUBMISSION"
    LEGACY_OR_UNKNOWN = "LEGACY_OR_UNKNOWN"


@dataclass(frozen=True)
class TriageOutcome:
    """Decision + the three facts a reviewer must be able to separate."""

    decision: TriageDecision
    reasons: list[str]
    reason_codes: list[str]
    validator_passed: bool | None
    policy_blocked: bool = False
    policy_code: str | None = None


# Only a case the autopilot itself classified as reviewable may be submitted.
REVIEW_ELIGIBLE_DECISIONS: frozenset[str] = frozenset(
    {TriageDecision.READY_FOR_REVIEW.value}
)


HUMAN_DECISIONS: frozenset[TriageDecision] = frozenset(
    {TriageDecision.NEEDS_HUMAN, TriageDecision.BLOCKED}
)

# Reasons longer than this are truncated in the API payload; the full report
# stays on the validation record.
_MAX_REASON = 400


def _clip(text: str) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= _MAX_REASON else text[: _MAX_REASON - 3] + "..."


def submission_request_fingerprint(case_ids: list[str] | None) -> str:
    """Canonical identity of a submit-for-review request body.

    Only the request shape is hashed (order-insensitive, duplicates collapsed),
    never the run's current state: the same idempotency key with a different
    body must be detectable as a conflict even after the run has changed.
    """
    normalized = sorted({str(c).strip() for c in (case_ids or []) if str(c).strip()})
    payload = json.dumps({"case_ids": normalized or None}, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def decide(
    *,
    action_type: str | None,
    action_family: str | None,
    validator_passed: bool | None,
    blocked_reasons: list[str] | None = None,
    missing_evidence_facts: list[str] | None = None,
    gate_reason: str | None = None,
    no_action_reason: str | None = None,
) -> TriageOutcome:
    """Classify one triaged case: decision + sentences + machine codes.

    ``validator_passed`` and ``policy_blocked`` are reported independently: a
    case can pass every structural check and still be stopped because the
    evidence it depends on does not exist. Nothing here ever reports a policy
    stop as a validator failure.
    """
    reasons: list[str] = []

    if validator_passed is None and action_type is None:
        # No candidate action was produced at all (e.g. the payment planner
        # asked for a human reconciliation, or the state offers nothing).
        if no_action_reason:
            reasons.append(_clip(no_action_reason))
        reasons.append(
            "no candidate action was produced; a human must reconcile the case "
            "before any action can be planned"
        )
        return TriageOutcome(
            decision=TriageDecision.NEEDS_HUMAN,
            reasons=reasons,
            reason_codes=[TriageReasonCode.NO_CANDIDATE_ACTION.value],
            validator_passed=None,
        )

    if validator_passed is False:
        reasons.append("deterministic validator rejected the candidate action")
        for reason in blocked_reasons or []:
            reasons.append(_clip(reason))
        return TriageOutcome(
            decision=TriageDecision.BLOCKED,
            reasons=reasons,
            reason_codes=[TriageReasonCode.VALIDATOR_BLOCKED.value],
            validator_passed=False,
        )

    if validator_passed is None:
        # A candidate without a validation report can never be treated as
        # reviewable: TRIAGE_ONLY must not present an unvalidated action.
        reasons.append(
            "candidate action exists but no validation report was produced; a "
            "human must validate it before it can be reviewed"
        )
        return TriageOutcome(
            decision=TriageDecision.NEEDS_HUMAN,
            reasons=reasons,
            reason_codes=[TriageReasonCode.VALIDATION_NOT_RUN.value],
            validator_passed=None,
        )

    if action_type == "wait":
        reasons.append(
            "the effective action is wait: no legal, appropriate write is "
            "available in the observed state"
        )
        if gate_reason:
            reasons.append(_clip(f"planner gate: {gate_reason}"))
        return TriageOutcome(
            decision=TriageDecision.WAIT,
            reasons=reasons,
            reason_codes=[
                TriageReasonCode.VALIDATOR_PASSED.value,
                TriageReasonCode.WAIT_NO_LEGAL_ACTION.value,
            ],
            validator_passed=True,
        )

    if action_family == "PAYMENT":
        reasons.append(
            f"candidate {action_type!r} moves money; a refund always needs a "
            "manager decision and is never executed by TRIAGE_ONLY"
        )
        return TriageOutcome(
            decision=TriageDecision.NEEDS_HUMAN,
            reasons=reasons,
            reason_codes=[
                TriageReasonCode.VALIDATOR_PASSED.value,
                TriageReasonCode.PAYMENT_REQUIRES_APPROVAL.value,
            ],
            validator_passed=True,
        )

    if missing_evidence_facts:
        reasons.append(
            "the validator passed on structure and action legality, but the "
            "analysis records the evidence this action depends on as "
            "MISSING_EVIDENCE — the case cannot be substantiated"
        )
        for statement in missing_evidence_facts[:3]:
            reasons.append(_clip(statement))
        reasons.append(
            "policy block, not a validator failure: no synthetic or unverified "
            "proof may be substituted for the missing material"
        )
        return TriageOutcome(
            decision=TriageDecision.BLOCKED,
            reasons=reasons,
            reason_codes=[
                TriageReasonCode.VALIDATOR_PASSED.value,
                TriageReasonCode.EVIDENCE_INSUFFICIENT.value,
            ],
            validator_passed=True,
            policy_blocked=True,
            policy_code=TriageReasonCode.EVIDENCE_INSUFFICIENT.value,
        )

    reasons.append(
        f"validator passed; candidate {action_type!r} is ready for merchant review"
    )
    reasons.append("no external action was executed — TRIAGE_ONLY stops at a decision")
    return TriageOutcome(
        decision=TriageDecision.READY_FOR_REVIEW,
        reasons=reasons,
        reason_codes=[
            TriageReasonCode.VALIDATOR_PASSED.value,
            TriageReasonCode.NO_EXECUTION_TRIAGE_ONLY.value,
        ],
        validator_passed=True,
    )


def aggregate_status(*, total: int, failed: int) -> RunStatus:
    if total == 0:
        return RunStatus.FAILED
    if failed == 0:
        return RunStatus.COMPLETED
    if failed >= total:
        return RunStatus.FAILED
    return RunStatus.PARTIAL


__all__ = [
    "AutopilotMode",
    "HUMAN_DECISIONS",
    "REVIEW_ELIGIBLE_DECISIONS",
    "ReviewSubmissionStatus",
    "RunStatus",
    "SubmissionBatchStatus",
    "SubmissionItemReason",
    "TriageDecision",
    "TriageOutcome",
    "TriageReasonCode",
    "aggregate_status",
    "decide",
    "submission_request_fingerprint",
]
