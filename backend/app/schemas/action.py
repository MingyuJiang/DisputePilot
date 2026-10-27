"""Action Proposal API schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from ..domain.enums import ProposalState, RiskLevel, ValidationStatus

# Frozen contract v1.2 wording — must stay byte-identical to
# contracts/v1/openapi.v1.yaml (test_t17 compares the generated schema).
ACTION_FAMILY_DESCRIPTION = (
    "v1.2 additive: DISPUTE covers dispute-side actions "
    "(provide-evidence, send-message, …); PAYMENT covers capture-level "
    "money actions (partial-refund, full-refund). A refund never resolves "
    "or closes the dispute by itself."
)

# ``Literal`` (not an Enum) keeps the frozen contract's inline
# ``enum`` + ``default`` shape and adds no extra component schema.
ActionFamilyLiteral = Literal["DISPUTE", "PAYMENT"]


class ProposalCreate(BaseModel):
    """Client-supplied proposal draft. Payload is schema-checked (V7)."""

    # NOTE: ``action_family`` is ADVISORY — the server always derives the
    # family from ``action_type`` so a client can never relabel a dispute
    # action as a payment action.
    case_id: str
    analysis_id: str
    action_type: str
    action_family: ActionFamilyLiteral = Field(
        default="DISPUTE", description=ACTION_FAMILY_DESCRIPTION
    )
    action_payload: dict[str, Any]
    rationale: list[str] = Field(default_factory=list)
    required_evidence: list[str] = Field(default_factory=list)
    expected_preconditions: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)


class ProposalOut(BaseModel):
    proposal_id: str
    case_id: str
    analysis_id: str
    action_type: str
    action_family: ActionFamilyLiteral = Field(
        default="DISPUTE", description=ACTION_FAMILY_DESCRIPTION
    )
    action_payload: dict[str, Any]
    expected_preconditions: list[str]
    required_evidence: list[str]
    rationale: list[str]
    evidence_ids: list[str]
    risk_level: RiskLevel
    validation_status: ValidationStatus
    state: ProposalState
    snapshot_hash: str
    payload_hash: str
    policy_version: str
    execution_authorized: bool = False
    created_at: str
    updated_at: str


class ValidationFindingOut(BaseModel):
    validator_id: str
    status: str
    detail: str
    basis: str
    doc_reference: str


class ValidationReportOut(BaseModel):
    report_id: str
    proposal_id: str
    case_id: str
    action_type: str
    passed: bool
    blocked_reasons: list[str]
    findings: list[ValidationFindingOut]
    created_at: str
