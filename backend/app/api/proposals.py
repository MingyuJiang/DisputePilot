"""Proposal endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header

from ..domain.enums import ActionFamily, action_family_of
from ..domain.errors import NotFoundError
from ..domain.models import ActionProposal
from ..security.authorization import (
    ACTOR_ID_HEADER_DESCRIPTION,
    IDEMPOTENCY_KEY_HEADER_DESCRIPTION,
)
from ..schemas.action import (
    ProposalCreate,
    ProposalOut,
    ValidationFindingOut,
    ValidationReportOut,
)
from ..schemas.errors import (
    RESPONSES_422_BOTH,
    RESPONSES_NOT_FOUND,
    RESPONSES_REQUEST_INVALID,
    merge_responses,
)
from .deps import idempotency, payment_service, planning_service, validation_service

router = APIRouter(prefix="/api/v1", tags=["proposals"])


def _proposal_out(p: ActionProposal) -> ProposalOut:
    return ProposalOut(
        proposal_id=p.proposal_id,
        case_id=p.case_id,
        analysis_id=p.analysis_id,
        action_type=p.action_type,
        action_family=p.action_family.value,
        action_payload=p.action_payload,
        expected_preconditions=p.expected_preconditions,
        required_evidence=p.required_evidence,
        rationale=p.rationale,
        evidence_ids=p.evidence_ids,
        risk_level=p.risk_level,
        validation_status=p.validation_status,
        state=p.state,
        snapshot_hash=p.snapshot_hash,
        payload_hash=p.payload_hash,
        policy_version=p.policy_version,
        execution_authorized=p.execution_authorized,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _report_out(report) -> ValidationReportOut:
    return ValidationReportOut(
        report_id=report.report_id,
        proposal_id=report.proposal_id,
        case_id=report.case_id,
        action_type=report.action_type,
        passed=report.passed,
        blocked_reasons=report.blocked_reasons,
        findings=[
            ValidationFindingOut(
                validator_id=f.validator_id,
                status=f.status,
                detail=f.detail,
                basis=f.basis.value,
                doc_reference=f.doc_reference,
            )
            for f in report.findings
        ],
        created_at=report.created_at,
    )


@router.post(
    "/cases/{case_id}/proposals",
    response_model=ProposalOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_422_BOTH),
)
def create_proposal(
    case_id: str,
    body: ProposalCreate,
    x_idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key", description=IDEMPOTENCY_KEY_HEADER_DESCRIPTION
    ),
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    idem=Depends(idempotency),
    svc=Depends(planning_service),
    payments=Depends(payment_service),
) -> ProposalOut:
    # The family is DERIVED from the action type (body.action_family is
    # advisory only): a refund draft is enriched with the server-observed
    # capture balance before it is hashed, a dispute draft is created as sent.
    family = action_family_of(body.action_type)

    def work() -> dict:
        if family is ActionFamily.PAYMENT:
            proposal = payments.create_refund_draft(
                case_id=case_id,
                analysis_id=body.analysis_id,
                action_type=body.action_type,
                action_payload=body.action_payload,
                rationale=body.rationale,
                required_evidence=body.required_evidence,
                expected_preconditions=body.expected_preconditions,
                evidence_ids=body.evidence_ids,
                actor_id=x_actor_id or "client",
            )
        else:
            proposal = svc.create_draft(
                case_id=case_id,
                analysis_id=body.analysis_id,
                action_type=body.action_type,
                action_payload=body.action_payload,
                rationale=body.rationale,
                required_evidence=body.required_evidence,
                expected_preconditions=body.expected_preconditions,
                evidence_ids=body.evidence_ids,
                actor_id=x_actor_id or "client",
            )
        return _proposal_out(proposal).model_dump(mode="json")

    return ProposalOut(**idem.run(x_idempotency_key, f"proposals:{case_id}", work))


@router.post(
    "/cases/{case_id}/proposals/generate",
    response_model=list[ProposalOut],
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def generate_proposals(
    case_id: str,
    x_idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key", description=IDEMPOTENCY_KEY_HEADER_DESCRIPTION
    ),
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    idem=Depends(idempotency),
    svc=Depends(planning_service),
) -> list[ProposalOut]:
    def work() -> list[dict]:
        proposals = svc.generate(case_id, actor_id=x_actor_id or "ai-stub")
        return [_proposal_out(p).model_dump(mode="json") for p in proposals]

    return [ProposalOut(**d) for d in idem.run(x_idempotency_key, f"proposals-gen:{case_id}", work)]


@router.get(
    "/cases/{case_id}/proposals",
    response_model=list[ProposalOut],
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def list_proposals(case_id: str, svc=Depends(planning_service)) -> list[ProposalOut]:
    proposals = svc.repo.list_for_case(case_id)
    if not proposals:
        svc.case_service.get_case(case_id)  # 404 if unknown case
    return [_proposal_out(p) for p in proposals]


@router.get(
    "/proposals/{proposal_id}",
    response_model=ProposalOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def get_proposal(proposal_id: str, svc=Depends(planning_service)) -> ProposalOut:
    proposal = svc.repo.get(proposal_id)
    if proposal is None:
        raise NotFoundError(f"proposal {proposal_id!r} not found")
    return _proposal_out(proposal)


@router.get(
    "/proposals/{proposal_id}/validation",
    response_model=ValidationReportOut | None,
    responses=RESPONSES_REQUEST_INVALID,
)
def get_validation(proposal_id: str, svc=Depends(validation_service)):
    report = svc.latest_report(proposal_id)
    return _report_out(report) if report else None
