"""Case & Evidence API schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..domain.enums import (
    CapabilityBasis,
    CaseWorkflowStatus,
    DisputeFamily,
    DisputeReason,
    DisputeStatus,
    EvidenceSource,
    EvidenceType,
    FulfillmentPosture,
    LifecycleStage,
    ProvenanceLabel,
    ValidationLevel,
)


class MoneyOut(BaseModel):
    value_minor: int
    currency: str
    display: str = ""


class TransactionReferenceOut(BaseModel):
    order_id: str
    capture_id: str
    buyer_transaction_id: str
    dispute_id: str


class AvailableActionOut(BaseModel):
    rel: str
    method: str
    basis: CapabilityBasis


class EvidenceRequirementOut(BaseModel):
    evidence_type: EvidenceType
    source: EvidenceSource
    open: bool


class EvidenceOut(BaseModel):
    evidence_id: str
    case_id: str
    evidence_type: EvidenceType
    content: str
    source_type: str
    provenance: ProvenanceLabel
    verification_level: ValidationLevel
    source_reference: str
    observed_at: str | None = None
    integrity_hash: str | None = None


class CaseOut(BaseModel):
    case_id: str
    scenario_id: str
    dispute_id: str
    family: DisputeFamily
    reason: DisputeReason
    status: CaseWorkflowStatus
    dispute_status: DisputeStatus
    lifecycle_stage: LifecycleStage
    amount: MoneyOut
    transaction_reference: TransactionReferenceOut
    fulfillment_posture: FulfillmentPosture
    seller_contacted: bool
    evidence_count: int
    available_actions: list[AvailableActionOut]
    evidence_requirements: list[EvidenceRequirementOut]
    # D-17: verbatim snapshot gap descriptions (list[str]; a snapshot string
    # is ONE item, never split — see fixture_loader.normalize_missing_evidence)
    missing_evidence: list[str] = Field(default_factory=list)
    provenance: ProvenanceLabel
    verification_level: ValidationLevel
    case_version: int
    snapshot_hash: str
    live_status_note: str = ""
    created_at: str
    updated_at: str


class CaseSummaryOut(BaseModel):
    case_id: str
    family: DisputeFamily
    reason: DisputeReason
    status: CaseWorkflowStatus
    amount: MoneyOut
    fulfillment_posture: FulfillmentPosture
    provenance: ProvenanceLabel
    verification_level: ValidationLevel


class CaseImportOut(BaseModel):
    imported: int
    skipped_duplicates: int
    negative_samples_recognized: int
    source_sha256: str
    details: list[str] = Field(default_factory=list)


class HealthOut(BaseModel):
    """``GET /api/v1/health`` — liveness + offline-mode proof."""

    status: str
    service: str
    execution_mode: str
    network_access: str
    policy_version: str
    note: str


class CaseStateUpdateOut(BaseModel):
    """``POST /api/v1/cases/{case_id}/state`` — SYSTEM test-hook result.

    Mutating the fixture state bumps ``state_version`` and changes
    ``state_hash``; approvals bound to the previous decision hash become
    stale (replay is then blocked).
    """

    case_id: str
    state_version: int
    state_hash: str
    warning: str


class NegativeSamplesOut(BaseModel):
    """``GET /api/v1/negative-samples`` — recognition-only samples.

    ``samples`` keeps the raw snapshot dictionaries (heterogeneous by
    design: each negative sample has its own scenario fields plus
    ``expected_rejection`` / ``source_review_status``).
    """

    count: int
    purpose: str
    samples: list[dict] = Field(default_factory=list)
