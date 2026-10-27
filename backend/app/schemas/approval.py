"""Approval API schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..domain.enums import ActorRole, ApprovalDecision, ProposalState, ValidationStatus


class ApprovalDecisionIn(BaseModel):
    decision: ApprovalDecision
    reason: str = Field(..., min_length=1)


class ApprovalOut(BaseModel):
    approval_id: str
    proposal_id: str
    case_id: str
    action_payload_hash: str
    case_snapshot_hash: str
    policy_version: str
    decision: ApprovalDecision
    reason: str
    actor_id: str
    actor_role: ActorRole
    decided_at: str


class ProposalSubmitSummaryOut(BaseModel):
    """Proposal state echo inside the submit response."""

    proposal_id: str
    state: ProposalState
    validation_status: ValidationStatus


class SubmitProposalOut(BaseModel):
    """``POST /api/v1/proposals/{proposal_id}/submit`` response.

    The deterministic V1–V12 validator runs inside submit: only PASSED
    proposals reach PENDING_APPROVAL and create an approval.
    """

    proposal: ProposalSubmitSummaryOut
    approval: ApprovalOut


class ApprovalSubmissionOriginOut(BaseModel):
    """Where a stored approval came from — read-only traceability.

    Every field is read from persisted rows (approval + submission batch item).
    When no batch item references the approval, the batch/run/validation fields
    stay null: the response describes the absence instead of guessing.
    """

    approval_id: str
    source_type: str
    proposal_id: str
    case_id: str | None = None
    submission_batch_id: str | None = None
    run_id: str | None = None
    validation_report_id: str | None = None
    validation_passed: bool | None = None
    reason_code: str | None = None
    submission_status: str | None = None
    submitted_at: str | None = None
    # Persisted approval creation time (null when it could not be recovered).
    approval_created_at: str | None = None
    approval_created_at_source: str | None = None
    # Current approval/proposal state (context only — never changed by this read)
    approval_decision: ApprovalDecision
    approval_actor_id: str
    proposal_state: ProposalState | None = None
    notes: list[str] = Field(default_factory=list)
