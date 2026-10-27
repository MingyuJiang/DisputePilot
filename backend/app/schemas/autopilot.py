"""Autopilot API schemas (MVP-0: batch triage only).

The response is deliberately verbose: a run that only returned ``success=true``
would hide exactly the information the merchant needs (what was analysed, what
was proposed, what the validator said, and why the decision came out that way).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..domain.autopilot import (
    AutopilotMode,
    RunStatus,
    SubmissionBatchStatus,
    TriageDecision,
)


class AutopilotRunCreate(BaseModel):
    case_ids: list[str] = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Cases to triage in one run; processed independently.",
    )
    mode: AutopilotMode = Field(
        default=AutopilotMode.TRIAGE_ONLY,
        description="Only TRIAGE_ONLY exists: analyse + decide, never execute.",
    )
    idempotency_key: str | None = Field(
        default=None,
        max_length=128,
        description=(
            "Optional repeat-request key. A second request with the same key "
            "returns the original run instead of processing the cases again."
        ),
    )


class AutopilotAnalysisOut(BaseModel):
    analysis_id: str
    analysis_mode: str
    model_provider: str
    model_name: str
    factual_summary: str
    recommendation: str
    raw_recommendation: str | None = None
    effective_action: str | None = None
    grounded_fact_count: int
    missing_evidence: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    safety_flags: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)


class AutopilotCandidateOut(BaseModel):
    proposal_id: str
    action_type: str
    action_family: str
    state: str
    risk_level: str
    validation_status: str
    required_evidence: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    execution_authorized: bool = False
    # Present from MVP-1 onwards; older stored runs simply have no value.
    payload_hash: str | None = None
    snapshot_hash: str | None = None


class AutopilotFindingOut(BaseModel):
    validator_id: str
    status: str
    detail: str


class AutopilotValidationOut(BaseModel):
    report_id: str
    passed: bool
    blocked_reasons: list[str] = Field(default_factory=list)
    checked: int
    failed: int
    findings: list[AutopilotFindingOut] = Field(default_factory=list)


class AutopilotCaseResultOut(BaseModel):
    case_id: str
    decision: TriageDecision
    decision_reasons: list[str]
    # Machine-readable complement of decision_reasons; a UI never parses prose.
    reason_codes: list[str] = Field(default_factory=list)
    requires_human: bool
    executed: bool
    analysis: AutopilotAnalysisOut | None = None
    candidate_actions: list[AutopilotCandidateOut] = Field(default_factory=list)
    validator: AutopilotValidationOut | None = None
    # Sufficiency of the evidence the candidate depends on (independent of
    # whether the validator passed the payload structure).
    evidence: dict | None = None
    # Policy stop, e.g. {"blocked": true, "code": "EVIDENCE_INSUFFICIENT"}. A
    # policy block is never reported as a validator failure.
    policy: dict = Field(default_factory=dict)
    business_refs: dict = Field(default_factory=dict)
    capture_facts: dict | None = None
    error: dict | None = None


class AutopilotRunOut(BaseModel):
    run_id: str
    mode: str
    status: RunStatus
    requested_case_ids: list[str]
    total_cases: int
    analyzed_cases: int
    ready_for_review_cases: int
    needs_human_cases: int
    blocked_cases: int
    wait_cases: int
    failed_cases: int
    executed_actions: int
    results: list[AutopilotCaseResultOut]
    started_at: str
    finished_at: str
    idempotent_replay: bool = False


# ------------------------------------------------------- submit for review
class AutopilotSubmitRequest(BaseModel):
    case_ids: list[str] | None = Field(
        default=None,
        max_length=50,
        description=(
            "Optional subset of the run. Empty/omitted selects every "
            "READY_FOR_REVIEW case in the run."
        ),
    )
    idempotency_key: str | None = Field(
        default=None,
        max_length=128,
        description=(
            "Optional repeat-request key; a second request with the same key "
            "returns the stored first result and creates no second approval."
        ),
    )


class AutopilotSubmitCaseOut(BaseModel):
    case_id: str
    run_decision: str | None = None
    status: str
    # Machine-readable reason for this case's outcome (see SubmissionItemReason).
    reason_code: str | None = None
    reasons: list[str] = Field(default_factory=list)
    proposal_id: str | None = None
    approval_id: str | None = None
    proposal_state: str | None = None
    approval_decision: str | None = None
    action_payload_hash: str | None = None
    case_snapshot_hash: str | None = None
    # Durable reference to the validator report used at submit time.
    validation_report_id: str | None = None
    validator: dict | None = None
    created_at: str | None = None
    error: dict | None = None


class AutopilotSubmitOut(BaseModel):
    run_id: str
    mode: str | None = None
    status: SubmissionBatchStatus
    requested_case_ids: list[str]
    total_cases: int
    run_case_count: int | None = None
    excluded_cases: int | None = None
    submitted_cases: int
    already_submitted_cases: int
    skipped_cases: int
    blocked_cases: int
    failed_cases: int
    executed_actions: int
    results: list[AutopilotSubmitCaseOut]
    submitted_at: str
    idempotent_replay: bool = False
    # Durable batch identity: the same values are readable later through
    # GET /autopilot/submission-batches/{id}.
    submission_batch_id: str | None = None
    idempotency_key: str | None = None
    request_fingerprint: str | None = None
    actor_id: str | None = None


class AutopilotSubmissionBatchOut(BaseModel):
    """A stored submission batch, read from the database (never from memory)."""

    submission_batch_id: str
    run_id: str
    idempotency_key: str | None = None
    request_fingerprint: str
    status: SubmissionBatchStatus
    requested_case_ids: list[str] = Field(default_factory=list)
    total_cases: int
    run_case_count: int | None = None
    excluded_cases: int | None = None
    submitted_cases: int
    already_submitted_cases: int
    skipped_cases: int
    blocked_cases: int
    failed_cases: int
    actor_id: str
    executed_actions: int = 0
    results: list[AutopilotSubmitCaseOut] = Field(default_factory=list)
    submitted_at: str

