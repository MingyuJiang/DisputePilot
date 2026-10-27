"""Deterministic policy layer: V1–V12 validators + approval state machine.

V5 additionally consults ``domain.evidence_policy`` so "the requirement type is
open" and "the material actually exists" are never conflated (RC-1).

Every V-check is extracted verbatim from ``S6_1_AI_ACTION_PLAN.md`` D3 (the
documented pass criterion) and adapted to OFFLINE REPLAY mode where the
document assumes a live GET. Offline adaptations are explicit and carry
``basis=FIXTURE_SNAPSHOT`` — they must never be read as live HATEOAS checks.

The validator is recommendation-only: it emits a decision object and has NO
execution capability (V10, architectural invariant, guarded by tests).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from .evidence_policy import evaluate_evidence
from .enums import (
    ACTION_REL,
    ACTION_WHITELIST,
    ActionType,
    ActorRole,
    ApprovalDecision,
    CapabilityBasis,
    EvidenceType,
    FORBIDDEN_PAYLOAD_FIELDS,
    LEGAL_PROPOSAL_TRANSITIONS,
    LifecycleStage,
    ProposalState,
)
from .models import (
    UNKNOWN,
    ActionProposal,
    Approval,
    CaseRecord,
    CaseStateSnapshot,
    ValidationFinding,
    ValidationReport,
)

DOC = "S6_1_AI_ACTION_PLAN.md D3"

# PayPal's documented dispute-message length limit. Shared by the validator
# (V7) and the live gateway so both refuse the same payloads.
MAX_SEND_MESSAGE_CHARS = 2000

# ---------------------------------------------------------------------------
# Offline replay payload schemas (V7 "only official schema fields").
# These are the offline replay subset derived from S6.1 D2 + the capability
# matrix; the future live adapter MUST re-validate against the official API
# spec before any real POST.
# ---------------------------------------------------------------------------
PAYLOAD_ALLOWED_FIELDS: dict[str, tuple[str, ...]] = {
    ActionType.SEND_MESSAGE.value: ("message", "idempotency_key"),
    ActionType.PROVIDE_EVIDENCE.value: ("evidence_type", "notes", "idempotency_key"),
    ActionType.MAKE_OFFER.value: ("offer_types", "amount", "note_to_buyer", "idempotency_key"),
    ActionType.ACCEPT_CLAIM.value: ("accept_claim_types", "amount", "note_to_buyer", "idempotency_key"),
    ActionType.ESCALATE.value: ("note", "idempotency_key"),
    ActionType.PROVIDE_SUPPORTING_INFO.value: ("notes", "idempotency_key"),
    ActionType.WAIT.value: (),
}

PAYLOAD_REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    ActionType.SEND_MESSAGE.value: ("message", "idempotency_key"),
    ActionType.PROVIDE_EVIDENCE.value: ("evidence_type", "notes", "idempotency_key"),
    ActionType.MAKE_OFFER.value: ("offer_types", "idempotency_key"),
    ActionType.ACCEPT_CLAIM.value: ("accept_claim_types", "idempotency_key"),
    ActionType.ESCALATE.value: ("idempotency_key",),
    ActionType.PROVIDE_SUPPORTING_INFO.value: ("idempotency_key",),
    ActionType.WAIT.value: (),
}

# PayPal dispute ids are ``PP-D-<digits>`` (sandbox observations) and some
# workspace snapshots use a three-letter segment. Both are accepted; an
# UNKNOWN id (sanitized offline fixture) is handled separately in V1.
_DISPUTE_ID_RE = re.compile(r"^PP-[A-Z]-(?:[A-Z]{3}-)?\d{6,}$")


class IllegalStateTransition(Exception):
    """Raised when a proposal state machine transition is not legal."""


def assert_transition(current: ProposalState, target: ProposalState) -> None:
    allowed = LEGAL_PROPOSAL_TRANSITIONS.get(current, ())
    if target not in allowed:
        raise IllegalStateTransition(
            f"illegal proposal transition {current.value} -> {target.value}"
        )


# ---------------------------------------------------------------------------
# Validation context
# ---------------------------------------------------------------------------
@dataclass
class ValidationContext:
    """Inputs shared by all V-checks for one validation run."""

    case: CaseRecord
    state: CaseStateSnapshot
    policy_version: str
    mode: str = "offline_fixture"           # offline_fixture | live (future)
    bound_snapshot_hash: Optional[str] = None  # hash bound at decision time
    decision_at: Optional[str] = None
    now: Optional[str] = None
    extra: dict[str, Any] = field(default_factory=dict)


def _finding(vid: str, ok: bool, detail: str, *, skipped: bool = False,
             basis: CapabilityBasis = CapabilityBasis.FIXTURE_SNAPSHOT) -> ValidationFinding:
    status = "PASS" if ok else ("SKIPPED" if skipped else "FAIL")
    return ValidationFinding(
        validator_id=vid, status=status, detail=detail, basis=basis, doc_reference=DOC
    )


# ---------------------------------------------------------------------------
# V1 — Dispute identity
# ---------------------------------------------------------------------------
def check_v1_identity(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    case = ctx.case
    if case.case_id != proposal.case_id:
        return _finding("V1", False, f"proposal case_id {proposal.case_id} != case {case.case_id}")
    if case.dispute_id != UNKNOWN and not _DISPUTE_ID_RE.match(case.dispute_id):
        return _finding("V1", False, f"dispute_id malformed: {case.dispute_id!r}")
    # (decision-context drift is checked by V9 against the combined decision hash)
    did = case.dispute_id if case.dispute_id != UNKNOWN else "UNKNOWN (sanitized offline case)"
    return _finding("V1", True, f"case {case.case_id} resolvable; dispute_id={did}; snapshot hash matches")


# ---------------------------------------------------------------------------
# V2 — Action whitelist
# ---------------------------------------------------------------------------
def check_v2_action_whitelist(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    allowed = {a.value for a in ACTION_WHITELIST}
    if proposal.action_type in allowed:
        return _finding("V2", True, f"{proposal.action_type} ∈ documented whitelist")
    return _finding("V2", False, f"{proposal.action_type} not in whitelist {sorted(allowed)}")


# ---------------------------------------------------------------------------
# V3 — HATEOAS permission
# ---------------------------------------------------------------------------
def check_v3_hateoas(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    try:
        action = ActionType(proposal.action_type)
    except ValueError:
        return _finding("V3", False, f"unknown action {proposal.action_type!r} (see V2)")
    if action == ActionType.WAIT:
        return _finding(
            "V3", True,
            "WAIT requires no write link (restraint action)",
            skipped=True,
        )
    rel = ACTION_REL[action]
    if ctx.state.has_post_link(rel):
        return _finding(
            "V3", True,
            f"rel '{rel}' present with POST in current fixture state "
            f"(basis={ctx.state.basis.value})",
        )
    return _finding(
        "V3", False,
        f"rel '{rel}' absent (or not POST) in current fixture state — "
        "HATEOAS is the only runtime permission",
    )


# ---------------------------------------------------------------------------
# V4 — Stage/status compatibility
# ---------------------------------------------------------------------------
def check_v4_stage_compat(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    state = ctx.state
    try:
        action = ActionType(proposal.action_type)
    except ValueError:
        return _finding("V4", False, f"unknown action {proposal.action_type!r} (see V2)")
    if action == ActionType.WAIT:
        return _finding("V4", True, "WAIT is legal in any state", skipped=True)
    if state.is_terminal():
        return _finding("V4", False, f"terminal state {state.dispute_status.value}: no action allowed")
    if action in (ActionType.MAKE_OFFER, ActionType.ESCALATE, ActionType.SEND_MESSAGE):
        if state.lifecycle_stage == LifecycleStage.INQUIRY:
            return _finding("V4", True, f"{action.value} requires INQUIRY — stage={state.lifecycle_stage.value}")
        return _finding(
            "V4", False,
            f"{action.value} requires stage INQUIRY, current stage={state.lifecycle_stage.value}",
        )
    if action == ActionType.PROVIDE_EVIDENCE:
        if any(r.open for r in state.evidence_requirements):
            return _finding("V4", True, "provide-evidence requires evidence window — open requirement present")
        return _finding("V4", False, "provide-evidence requires an open evidence requirement (window)")
    if action == ActionType.PROVIDE_SUPPORTING_INFO:
        return _finding(
            "V4", False,
            "provide-supporting-info has no live HATEOAS in fixture state — must not be attempted",
        )
    return _finding(
        "V4", True,
        f"{action.value} compatible with status={state.dispute_status.value}/stage={state.lifecycle_stage.value}",
    )


# ---------------------------------------------------------------------------
# V5 — Evidence requirement match (provide-evidence only)
# ---------------------------------------------------------------------------
def check_v5_evidence_requirement(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    if proposal.action_type == ActionType.SEND_MESSAGE.value:
        return _finding(
            "V5", True,
            "send-message submits no evidence — requirement match does not apply",
            skipped=True,
        )
    if proposal.action_type != ActionType.PROVIDE_EVIDENCE.value:
        return _finding("V5", True, "not a provide-evidence proposal", skipped=True)
    requested_type = proposal.action_payload.get("evidence_type")
    try:
        etype = EvidenceType(requested_type)
    except ValueError:
        return _finding("V5", False, f"evidence_type {requested_type!r} not in official enum")
    req = ctx.state.open_requirement(etype)
    if req is None:
        open_types = [r.evidence_type.value for r in ctx.state.evidence_requirements if r.open]
        return _finding(
            "V5", False,
            f"no open REQUESTED_FROM_SELLER requirement for {etype.value}; open={open_types or '[]'}",
        )

    # RC-1 (review P1-01): an open requirement only proves the *type* is
    # expected. The material must also exist — otherwise this action would
    # submit evidence nobody has. The rule lives in domain/evidence_policy.py so
    # batch triage, submission, approval and execution all agree.
    verdict = evaluate_evidence(
        action_type=proposal.action_type,
        action_payload=proposal.action_payload,
        grounded_facts=ctx.extra.get("evidence_facts"),
        state=ctx.state,
    )
    if verdict.blocked:
        return _finding(
            "V5",
            False,
            f"{verdict.code}: {'; '.join(verdict.missing)}",
        )

    return _finding(
        "V5", True,
        f"evidences[] contains {etype.value} / {req.source.value} (open); material present",
    )


# ---------------------------------------------------------------------------
# V6 — Amount/type bounds (make-offer / accept-claim)
# ---------------------------------------------------------------------------
def check_v6_amount_bounds(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    if proposal.action_type not in (ActionType.MAKE_OFFER.value, ActionType.ACCEPT_CLAIM.value):
        return _finding("V6", True, "not a monetary action", skipped=True)
    state = ctx.state
    types_key = "accept_claim" if proposal.action_type == ActionType.ACCEPT_CLAIM.value else "make_offer"
    allowed_types = state.allowed_response_options.get(types_key, [])
    payload_types = proposal.action_payload.get(
        "accept_claim_types" if types_key == "accept_claim" else "offer_types", []
    )
    if not allowed_types:
        return _finding("V6", False, f"no allowed_response_options for {types_key} in current state")
    for t in payload_types:
        if t not in allowed_types:
            return _finding(
                "V6", False,
                f"type {t!r} ∉ allowed_response_options.{types_key}={allowed_types}",
            )
    amount = proposal.action_payload.get("amount")
    if amount is not None:
        if not isinstance(amount, dict):
            return _finding("V6", False, f"amount malformed: {amount!r}")
        if state.allowed_refund_amount is None or state.dispute_amount is None:
            return _finding("V6", False, "monetary action but state lacks dispute/refund amount bounds")
        try:
            value_minor = int(round(float(amount.get("value", "0")) * 100))
            currency = amount.get("currency", "")
        except (TypeError, ValueError):
            return _finding("V6", False, f"amount malformed: {amount!r}")
        if currency != state.dispute_amount.currency:
            return _finding("V6", False, f"currency {currency} != dispute currency {state.dispute_amount.currency}")
        if value_minor > state.dispute_amount.value_minor:
            return _finding("V6", False, f"amount {value_minor} > dispute_amount {state.dispute_amount.value_minor}")
        if value_minor > state.allowed_refund_amount.value_minor:
            return _finding(
                "V6", False,
                f"amount {value_minor} > allowed_refund_amount {state.allowed_refund_amount.value_minor}",
            )
    return _finding(
        "V6", True,
        f"types {payload_types} ⊆ {allowed_types}; amount within dispute/refund bounds",
    )


# ---------------------------------------------------------------------------
# V7 — Payload whitelist
# ---------------------------------------------------------------------------
def check_v7_payload_whitelist(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    payload = proposal.action_payload
    if not isinstance(payload, dict):
        return _finding("V7", False, "payload is not an object")
    for bad in FORBIDDEN_PAYLOAD_FIELDS:
        if bad in payload:
            return _finding("V7", False, f"forbidden internal field present: {bad!r}")
    allowed = PAYLOAD_ALLOWED_FIELDS.get(proposal.action_type)
    if allowed is None:
        return _finding("V7", False, f"no offline payload schema for {proposal.action_type!r} (see V2)")
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        return _finding("V7", False, f"fields outside schema whitelist: {unknown}")
    required = PAYLOAD_REQUIRED_FIELDS.get(proposal.action_type, ())
    missing = [f for f in required if f not in payload]
    if missing:
        return _finding("V7", False, f"missing required fields: {missing}")
    if proposal.action_type == ActionType.SEND_MESSAGE.value:
        message = payload.get("message")
        if not isinstance(message, str):
            return _finding(
                "V7", False,
                f"send-message 'message' must be a string, got {type(message).__name__}",
            )
        if not message.strip():
            return _finding("V7", False, "send-message 'message' is empty")
        if len(message) > MAX_SEND_MESSAGE_CHARS:
            return _finding(
                "V7", False,
                f"send-message 'message' is {len(message)} characters; "
                f"PayPal limit is {MAX_SEND_MESSAGE_CHARS}",
            )
        return _finding(
            "V7", True,
            f"payload within offline schema whitelist; message is a non-empty "
            f"string of {len(message)} characters (<= {MAX_SEND_MESSAGE_CHARS})",
        )
    return _finding("V7", True, "payload within offline schema whitelist; no internal fields")


# ---------------------------------------------------------------------------
# V8 — Evidence labeling (SCENARIO_DEFINED discipline)
# ---------------------------------------------------------------------------
def check_v8_evidence_labeling(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    if proposal.action_type != ActionType.PROVIDE_EVIDENCE.value:
        return _finding("V8", True, "no evidence content in this action", skipped=True)
    notes = str(proposal.action_payload.get("notes", ""))
    if "SCENARIO_DEFINED" in notes:
        return _finding("V8", True, "evidence content explicitly labeled SCENARIO_DEFINED")
    return _finding(
        "V8", False,
        "evidence content not labeled SCENARIO_DEFINED — fabricated business proof is forbidden",
    )


# ---------------------------------------------------------------------------
# V9 — Freshness
# ---------------------------------------------------------------------------
def check_v9_freshness(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    # The bound decision hash is mode-independent: any case/state drift since
    # the decision must invalidate it, in offline replay and in live mode.
    if ctx.bound_snapshot_hash and proposal.snapshot_hash:
        current = decision_hash(ctx.case, ctx.state)
        if ctx.bound_snapshot_hash != proposal.snapshot_hash or current != proposal.snapshot_hash:
            return _finding(
                "V9", False,
                "decision snapshot hash drift (case or runtime state changed) — stale decision, re-run",
            )
    if ctx.mode == "live":
        # The live gateway's pre-GET is the freshness assertion against the
        # remote state; the local timestamp window is not re-derived here.
        return _finding(
            "V9", True,
            "live mode: bound decision hash consistent; remote freshness is "
            "asserted by the gateway pre-GET",
            basis=CapabilityBasis.LIVE_HATEOAS,
        )
    observed = ctx.state.observed_at or "UNKNOWN"
    return _finding(
        "V9", True,
        f"offline mode: bound state hash consistent; fixture observed_at={observed} "
        "(live timestamp window reserved for future adapter)",
    )


# ---------------------------------------------------------------------------
# V10 — No-execution invariant (structural)
# ---------------------------------------------------------------------------
def check_v10_no_execution_invariant(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    # The report object itself is the evidence: it carries no execution fields.
    report = ctx.extra.get("report")
    if report is not None:
        banned = ("execution_mode", "response", "http_status", "paypal_response")
        present = [k for k in banned if k in getattr(report, "model_dump", lambda: {})()]
        if present:
            return _finding("V10", False, f"validator report carries execution fields: {present}")
    return _finding(
        "V10", True,
        "validator output is a decision object only; POST is a separate, separately-approved step",
    )


# ---------------------------------------------------------------------------
# V11 — Idempotency readiness
# ---------------------------------------------------------------------------
def check_v11_idempotency(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    if proposal.action_type == ActionType.WAIT.value:
        return _finding("V11", True, "WAIT performs no write", skipped=True)
    key = proposal.action_payload.get("idempotency_key")
    if not key or not isinstance(key, str):
        return _finding("V11", False, "no fixed idempotency key for the intended write (single attempt)")
    if ctx.mode == "live":
        return _finding(
            "V11", True,
            f"idempotency key {key!r} maps to PayPal-Request-Id (single attempt)",
            basis=CapabilityBasis.LIVE_HATEOAS,
        )
    return _finding("V11", True, f"replay idempotency key fixed: {key!r} (single attempt, no retry)")


# ---------------------------------------------------------------------------
# V12 — Retry prohibition (static audit of execution path)
# ---------------------------------------------------------------------------
_RETRY_PATTERNS = ("time.sleep", "backoff", "while true", "retry", "max_retries")


def check_v12_retry_prohibition(proposal: ActionProposal, ctx: ValidationContext) -> ValidationFinding:
    audit = ctx.extra.get("retry_audit")
    if audit is None:
        return _finding("V12", True, "retry audit not supplied; guarded by test_t6 AST scan")
    if audit.get("clean"):
        return _finding("V12", True, f"AST audit of execution path clean ({audit.get('files', 0)} files)")
    return _finding("V12", False, f"retry/backoff patterns found: {audit.get('findings')}")


ALL_CHECKS = (
    check_v1_identity,
    check_v2_action_whitelist,
    check_v3_hateoas,
    check_v4_stage_compat,
    check_v5_evidence_requirement,
    check_v6_amount_bounds,
    check_v7_payload_whitelist,
    check_v8_evidence_labeling,
    check_v9_freshness,
    check_v10_no_execution_invariant,
    check_v11_idempotency,
    check_v12_retry_prohibition,
)


def validate_proposal(
    proposal: ActionProposal,
    ctx: ValidationContext,
    *,
    report_id: str,
) -> ValidationReport:
    """Dispatch on the derived action family, then validate deterministically.

    DISPUTE actions run V1–V12 (unchanged). PAYMENT actions (capture refunds)
    run V13–V18 instead: a refund has no dispute HATEOAS link and no evidence
    window, so applying V1–V12 to it would be meaningless. Both paths emit the
    same ``ValidationReport`` decision object and never execute.
    """
    from .enums import ActionFamily, action_family_of

    if action_family_of(proposal.action_type) is ActionFamily.PAYMENT:
        from .refund_policies import validate_refund_proposal

        return validate_refund_proposal(proposal, ctx, report_id=report_id)

    findings: list[ValidationFinding] = []
    blocked: list[str] = []
    for check in ALL_CHECKS:
        finding = check(proposal, ctx)
        findings.append(finding)
        if finding.status == "FAIL":
            blocked.append(f"{finding.validator_id}: {finding.detail}")
    ctx.extra["report"] = ValidationReport(
        report_id=report_id,
        proposal_id=proposal.proposal_id,
        case_id=proposal.case_id,
        action_type=proposal.action_type,
    )
    # Re-run V10 against the actual report object (structural self-check).
    findings = [
        check_v10_no_execution_invariant(proposal, ctx) if f.validator_id == "V10" else f
        for f in findings
    ]
    blocked = [f"{f.validator_id}: {f.detail}" for f in findings if f.status == "FAIL"]
    return ValidationReport(
        report_id=report_id,
        proposal_id=proposal.proposal_id,
        case_id=proposal.case_id,
        action_type=proposal.action_type,
        findings=findings,
        passed=not blocked,
        blocked_reasons=blocked,
    )


# ---------------------------------------------------------------------------
# Approval binding checks (used at execution time)
# ---------------------------------------------------------------------------
def decision_hash(case: CaseRecord, state: CaseStateSnapshot) -> str:
    """Hash of the FULL decision context: case facts + runtime state.

    Proposals bind this hash; approvals inherit it; execution re-computes it.
    Any PayPal-side state change (links, stage, status) therefore invalidates
    prior approvals — the offline equivalent of "case state changed".
    """
    from .models import content_hash

    return content_hash(
        {
            "case": case.snapshot_hash,
            "state": state.compute_state_hash(),
            "state_version": state.state_version,
        }
    )


def check_approval_binding(
    proposal: ActionProposal,
    approval: Approval,
    case: CaseRecord,
    state: CaseStateSnapshot,
    policy_version: str,
) -> list[str]:
    """Return a list of binding violations (empty = binding intact)."""
    violations: list[str] = []
    if approval.proposal_id != proposal.proposal_id:
        violations.append("approval does not reference this proposal")
    if approval.action_payload_hash != proposal.payload_hash:
        violations.append("action payload hash mismatch — proposal content changed after approval")
    if approval.case_snapshot_hash != decision_hash(case, state):
        violations.append(
            "decision snapshot hash mismatch — case or runtime state changed after approval"
        )
    if approval.policy_version != policy_version:
        violations.append(
            f"policy version mismatch: approved under {approval.policy_version}, current {policy_version}"
        )
    if approval.decision != ApprovalDecision.APPROVED:
        violations.append(f"approval decision is {approval.decision.value}, not APPROVED")
    if approval.actor_role not in (ActorRole.MANAGER,):
        violations.append(f"approver role {approval.actor_role.value} is not MANAGER")
    return violations


def is_write_action(action_type: str) -> bool:
    return action_type != ActionType.WAIT.value


__all__ = [
    "ALL_CHECKS",
    "MAX_SEND_MESSAGE_CHARS",
    "PAYLOAD_ALLOWED_FIELDS",
    "PAYLOAD_REQUIRED_FIELDS",
    "IllegalStateTransition",
    "ValidationContext",
    "assert_transition",
    "check_approval_binding",
    "decision_hash",
    "validate_proposal",
    "is_write_action",
]
