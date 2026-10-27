"""Domain models — the five core entities plus extensions.

Rules enforced here (from workspace discipline + contracts):
- Amounts are integer minor units + ISO 4217 currency (schema.sql).
- The three transaction IDs are never cross-filled; missing stays UNKNOWN.
- Every record carries a provenance label; labels are never upgraded.
- ``execution_authorized`` defaults to False and requires an approval binding.
- Entities are immutable value objects once persisted (proposals especially).
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field

from .enums import (
    ACTION_RISK_LEVEL,
    ActorType,
    AnalysisMode,
    ApprovalDecision,
    ActorRole,
    CapabilityBasis,
    CaseWorkflowStatus,
    DisputeFamily,
    DisputeReason,
    DisputeStatus,
    EvidenceSource,
    EvidenceType,
    ExecutionMode,
    ExecutionResult,
    FulfillmentPosture,
    GroundedFactType,
    LifecycleStage,
    ProvenanceLabel,
    ProposalState,
    RiskLevel,
    ValidationLevel,
    ValidationStatus,
)

UNKNOWN = "UNKNOWN"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json(obj: Any) -> str:
    """Deterministic serialization for hashing (sorted keys, no whitespace)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def content_hash(obj: Any) -> str:
    return sha256_hex(canonical_json(obj))


class Money(BaseModel):
    """Amount in minor units + ISO currency (never float money)."""

    value_minor: int = Field(..., ge=0)
    currency: str = Field(..., min_length=3, max_length=3)

    @classmethod
    def from_decimal_string(cls, value: str, currency: str) -> "Money":
        cents = round(float(value) * 100)
        return cls(value_minor=cents, currency=currency)

    def display(self) -> str:
        return f"{self.value_minor / 100:.2f} {self.currency}"


class TransactionReference(BaseModel):
    """Sanitized transaction references. Missing IDs remain UNKNOWN.

    Discipline: order_id != capture_id != buyer_transaction_id unless an API
    artifact proves equality (SCENARIO_FACTORY_ARCHITECTURE §2). The offline
    snapshot has all IDs removed, so all default to UNKNOWN.
    """

    order_id: str = UNKNOWN
    capture_id: str = UNKNOWN
    buyer_transaction_id: str = UNKNOWN
    dispute_id: str = UNKNOWN


class AvailableAction(BaseModel):
    """A HATEOAS-style action capability attached to a case state."""

    rel: str
    method: str = "POST"
    basis: CapabilityBasis = CapabilityBasis.FIXTURE_SNAPSHOT


class EvidenceRequirement(BaseModel):
    """An open evidence requirement as returned inside dispute evidences[]."""

    evidence_type: EvidenceType
    source: EvidenceSource = EvidenceSource.REQUESTED_FROM_SELLER
    open: bool = True


class CaseRecord(BaseModel):
    """Core entity 1 — a dispute case (offline workflow + observed state)."""

    case_id: str
    scenario_id: str = UNKNOWN
    dispute_id: str = UNKNOWN
    family: DisputeFamily
    reason: DisputeReason
    # Offline workflow status of this case in our system:
    status: CaseWorkflowStatus = CaseWorkflowStatus.IMPORTED
    # Observed PayPal-side state (from fixture snapshot; not a live claim):
    dispute_status: DisputeStatus = DisputeStatus.UNKNOWN
    lifecycle_stage: LifecycleStage = LifecycleStage.UNKNOWN
    amount: Money
    transaction_reference: TransactionReference = Field(default_factory=TransactionReference)
    fulfillment_posture: FulfillmentPosture = FulfillmentPosture.NONE
    seller_contacted: bool = False
    evidence: list["EvidenceRecord"] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    available_actions: list[AvailableAction] = Field(default_factory=list)
    evidence_requirements: list[EvidenceRequirement] = Field(default_factory=list)
    provenance: ProvenanceLabel
    verification_level: ValidationLevel = ValidationLevel.UNKNOWN
    case_version: int = 1
    snapshot_hash: str = ""
    live_status_note: str = ""
    # Structured capture status for payment (CAP-) cases. The payment planner
    # must read a field, not prose: an unparseable note previously made a
    # COMPLETED capture look UNKNOWN. Empty on dispute cases.
    capture_status: str = ""
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)

    def recompute_snapshot_hash(self) -> str:
        payload = self.model_dump(
            mode="json",
            exclude={"status", "created_at", "updated_at", "case_version", "snapshot_hash"},
        )
        return content_hash(payload)

    def bind_snapshot_hash(self) -> str:
        self.snapshot_hash = self.recompute_snapshot_hash()
        return self.snapshot_hash


class EvidenceRecord(BaseModel):
    """Core entity 1b — one piece of evidence with stable id + provenance."""

    evidence_id: str
    case_id: str
    evidence_type: EvidenceType = EvidenceType.CASE_NOTE
    content: str = ""
    source_type: str = "CASE_SNAPSHOT"
    provenance: ProvenanceLabel
    verification_level: ValidationLevel = ValidationLevel.UNKNOWN
    source_reference: str = UNKNOWN
    observed_at: Optional[str] = None
    integrity_hash: Optional[str] = None


class GroundedFact(BaseModel):
    """One grounded fact. Every fact MUST cite existing evidence ids."""

    fact_id: str
    statement: str
    fact_type: GroundedFactType
    evidence_ids: list[str] = Field(default_factory=list)
    provenance: ProvenanceLabel = ProvenanceLabel.AI_INFERRED


class AIAnalysis(BaseModel):
    """Core entity 2 — AI case understanding + evidence grounding."""

    analysis_id: str
    case_id: str
    case_snapshot_hash: str
    factual_summary: str
    grounded_facts: list[GroundedFact] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    recommendation: str = ""
    safety_flags: list[str] = Field(default_factory=list)
    model_provider: str = "deterministic-stub"
    model_name: str = "evidence-planner-v1"
    analysis_mode: AnalysisMode = AnalysisMode.STUB_DETERMINISTIC
    # Plan-schema mirror persisted WITH the analysis so that read paths never
    # need to re-run a provider (LLM preview must not trigger inference).
    plan: dict = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now_iso)


class CaseStateSnapshot(BaseModel):
    """Runtime dispute state used by validators and the replay gateway.

    In offline mode this is a FIXTURE capability snapshot (basis
    FIXTURE_SNAPSHOT); it is NOT a live PayPal observation. ``state_hash``
    binds approvals to the exact state they were made against.
    """

    case_id: str
    dispute_status: DisputeStatus = DisputeStatus.UNKNOWN
    lifecycle_stage: LifecycleStage = LifecycleStage.UNKNOWN
    links: list[AvailableAction] = Field(default_factory=list)
    evidence_requirements: list[EvidenceRequirement] = Field(default_factory=list)
    allowed_response_options: dict[str, list[str]] = Field(default_factory=dict)
    dispute_amount: Optional[Money] = None
    allowed_refund_amount: Optional[Money] = None
    seller_contacted: bool = False
    observed_at: str = ""
    basis: CapabilityBasis = CapabilityBasis.FIXTURE_SNAPSHOT
    provenance: ProvenanceLabel = ProvenanceLabel.SCENARIO_DEFINED
    note: str = ""
    state_version: int = 1

    def compute_state_hash(self) -> str:
        payload = self.model_dump(mode="json", exclude={"note", "state_version"})
        return content_hash(payload)

    def has_post_link(self, rel: str) -> bool:
        return any(link.rel == rel and link.method.upper() == "POST" for link in self.links)

    def open_requirement(self, evidence_type: EvidenceType) -> Optional[EvidenceRequirement]:
        for req in self.evidence_requirements:
            if req.evidence_type == evidence_type and req.open:
                return req
        return None

    def is_terminal(self) -> bool:
        return self.dispute_status == DisputeStatus.RESOLVED


class ActionProposal(BaseModel):
    """Core entity 3 — a structured, schema-checked action proposal.

    ``action_payload`` is NEVER raw AI free text; it is validated against a
    strict field whitelist (V7) at creation time.
    """

    proposal_id: str
    case_id: str
    analysis_id: str
    action_type: str  # ActionType value
    action_payload: dict[str, Any]
    expected_preconditions: list[str] = Field(default_factory=list)
    required_evidence: list[str] = Field(default_factory=list)
    rationale: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    risk_level: RiskLevel = RiskLevel.LOW
    validation_status: ValidationStatus = ValidationStatus.NOT_RUN
    state: ProposalState = ProposalState.DRAFT
    snapshot_hash: str = ""
    payload_hash: str = ""
    policy_version: str = ""
    execution_authorized: bool = False  # Master Prompt: default false
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)

    def bind_hashes(self, policy_version: str) -> None:
        self.payload_hash = content_hash(self.action_payload)
        self.policy_version = policy_version

    @property
    def action_family(self):
        """Derived family (DISPUTE | PAYMENT) — never stored, never trusted
        from client input."""
        from .enums import action_family_of

        return action_family_of(self.action_type)


class Approval(BaseModel):
    """Core entity 4 — human approval bound to an exact proposal+payload+snapshot.

    Lifecycle: PENDING (specialist submit) → APPROVED / REJECTED (manager
    decision, exactly once, guarded by a conditional DB update).
    """

    approval_id: str
    proposal_id: str
    action_payload_hash: str
    case_snapshot_hash: str
    policy_version: str
    decision: ApprovalDecision
    reason: str = ""
    actor_id: str
    actor_role: ActorRole
    # When the manager decision happened. Never a creation timestamp: the
    # repository overwrites it on decision.
    decided_at: str | None = None
    # Persisted creation time. None means "not recorded" (legacy row that could
    # not be matched to an authoritative audit event) — never re-generated on
    # read, never filled with "now".
    created_at: str | None = None
    # Provenance of created_at: "CREATED" or "AUDIT:<event_id>".
    created_at_source: str | None = None


class ExecutionRecord(BaseModel):
    """Core entity 4b — one controlled (replay) execution of a proposal."""

    execution_id: str
    proposal_id: str
    case_id: str
    execution_mode: ExecutionMode = ExecutionMode.REPLAY
    simulated: bool = True  # replay results are NEVER real PayPal responses
    result: ExecutionResult  # REPLAYED / BLOCKED / FAILED
    gateway: str = "ReplayExecutionGateway"
    request_snapshot: dict[str, Any] = Field(default_factory=dict)
    response_snapshot: dict[str, Any] = Field(default_factory=dict)
    verification: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now_iso)


class AuditEvent(BaseModel):
    """Core entity 5 — append-only audit event."""

    event_id: str
    case_id: str
    event_type: str
    actor_type: ActorType
    actor_id: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now_iso)


class ValidationFinding(BaseModel):
    """One V-check outcome."""

    validator_id: str  # V1..V12
    status: str  # PASS / FAIL / SKIPPED / NOT_APPLICABLE
    detail: str = ""
    basis: CapabilityBasis = CapabilityBasis.FIXTURE_SNAPSHOT
    doc_reference: str = "S6_1_AI_ACTION_PLAN.md D3"


class ValidationReport(BaseModel):
    """Deterministic validator output — a decision object, never an execution."""

    report_id: str
    proposal_id: str
    case_id: str
    action_type: str
    findings: list[ValidationFinding] = Field(default_factory=list)
    passed: bool = False
    blocked_reasons: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utc_now_iso)


def default_risk_for(action_type: str) -> RiskLevel:
    from .enums import ActionType

    try:
        return ACTION_RISK_LEVEL[ActionType(action_type)]
    except (KeyError, ValueError):  # unknown action → highest caution
        return RiskLevel.HIGH


CaseRecord.model_rebuild()
