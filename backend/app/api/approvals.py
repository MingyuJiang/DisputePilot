"""Approval + replay-execution endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header

from ..domain.models import Approval
from ..schemas.approval import (
    ApprovalDecisionIn,
    ApprovalOut,
    ApprovalSubmissionOriginOut,
    ProposalSubmitSummaryOut,
    SubmitProposalOut,
)
from ..schemas.errors import (
    RESPONSES_AUTH,
    RESPONSES_CONFLICT,
    RESPONSES_NOT_FOUND,
    RESPONSES_REQUEST_INVALID,
    RESPONSES_VALIDATION_FAILED,
    merge_responses,
)
from ..schemas.execution import ReplayExecutionOut, execution_warning
from ..security.authorization import (
    ACTOR_ID_HEADER_DESCRIPTION,
    ACTOR_ROLE_HEADER_DESCRIPTION,
    IDEMPOTENCY_KEY_HEADER_DESCRIPTION,
    require_role,
)
from ..domain.enums import ActorRole
from .deps import approval_service, execution_service, idempotency

router = APIRouter(prefix="/api/v1", tags=["approvals"])


def _approval_out(a: Approval, case_id: str) -> ApprovalOut:
    return ApprovalOut(
        approval_id=a.approval_id,
        proposal_id=a.proposal_id,
        case_id=case_id,
        action_payload_hash=a.action_payload_hash,
        case_snapshot_hash=a.case_snapshot_hash,
        policy_version=a.policy_version,
        decision=a.decision,
        reason=a.reason,
        actor_id=a.actor_id,
        actor_role=a.actor_role,
        decided_at=a.decided_at or a.created_at,
    )


@router.post(
    "/proposals/{proposal_id}/submit",
    response_model=SubmitProposalOut,
    responses=merge_responses(
        RESPONSES_AUTH,
        RESPONSES_NOT_FOUND,
        RESPONSES_CONFLICT,
        RESPONSES_VALIDATION_FAILED,
    ),
)
def submit_proposal(
    proposal_id: str,
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    x_actor_role: str | None = Header(default=None, description=ACTOR_ROLE_HEADER_DESCRIPTION),
    x_idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key", description=IDEMPOTENCY_KEY_HEADER_DESCRIPTION
    ),
    specialist=Depends(require_role(ActorRole.SPECIALIST)),
    svc=Depends(approval_service),
    idem=Depends(idempotency),
) -> SubmitProposalOut:
    """Specialist submits a validated proposal for manager approval.

    The deterministic V1–V12 validator runs here: blocked proposals never
    reach PENDING_APPROVAL.
    """

    def work() -> dict:
        proposal, approval = svc.submit(proposal_id, specialist.actor_id)
        return SubmitProposalOut(
            proposal=ProposalSubmitSummaryOut(
                proposal_id=proposal.proposal_id,
                state=proposal.state,
                validation_status=proposal.validation_status,
            ),
            approval=_approval_out(approval, proposal.case_id),
        ).model_dump(mode="json")

    return SubmitProposalOut(**idem.run(x_idempotency_key, f"submit:{proposal_id}", work))


@router.get("/approvals", response_model=list[ApprovalOut])
def list_approvals(svc=Depends(approval_service)) -> list[ApprovalOut]:
    out = []
    for a in svc.list_approvals():
        proposal = svc.proposals.get(a.proposal_id)
        case_id = proposal.case_id if proposal else "UNKNOWN"
        out.append(_approval_out(a, case_id))
    return out


@router.get(
    "/approvals/{approval_id}",
    response_model=ApprovalOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def get_approval(approval_id: str, svc=Depends(approval_service)) -> ApprovalOut:
    approval = svc.get_approval(approval_id)
    proposal = svc.proposals.get(approval.proposal_id)
    case_id = proposal.case_id if proposal else "UNKNOWN"
    return _approval_out(approval, case_id)


@router.post(
    "/approvals/{approval_id}/decision",
    response_model=ApprovalOut,
    responses=merge_responses(
        RESPONSES_AUTH,
        RESPONSES_NOT_FOUND,
        RESPONSES_CONFLICT,
        RESPONSES_REQUEST_INVALID,
    ),
)
def decide_approval(
    approval_id: str,
    body: ApprovalDecisionIn,
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    x_actor_role: str | None = Header(default=None, description=ACTOR_ROLE_HEADER_DESCRIPTION),
    x_idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key", description=IDEMPOTENCY_KEY_HEADER_DESCRIPTION
    ),
    manager=Depends(require_role(ActorRole.MANAGER)),
    svc=Depends(approval_service),
    idem=Depends(idempotency),
) -> ApprovalOut:
    """Manager approval or rejection — exactly once per approval."""

    def work() -> dict:
        _proposal, approval = svc.decide(
            approval_id, body.decision, body.reason, manager.actor_id
        )
        proposal = svc.proposals.get(approval.proposal_id)
        return _approval_out(approval, proposal.case_id).model_dump(mode="json")

    return ApprovalOut(**idem.run(x_idempotency_key, f"decision:{approval_id}", work))


@router.post(
    "/approvals/{approval_id}/replay",
    response_model=ReplayExecutionOut,
    responses=merge_responses(
        RESPONSES_AUTH,
        RESPONSES_NOT_FOUND,
        RESPONSES_CONFLICT,
        RESPONSES_REQUEST_INVALID,
    ),
)
def replay_execution(
    approval_id: str,
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    x_actor_role: str | None = Header(default=None, description=ACTOR_ROLE_HEADER_DESCRIPTION),
    x_idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key", description=IDEMPOTENCY_KEY_HEADER_DESCRIPTION
    ),
    manager=Depends(require_role(ActorRole.MANAGER)),
    svc=Depends(execution_service),
    approvals=Depends(approval_service),
    idem=Depends(idempotency),
) -> ReplayExecutionOut:
    """Offline replay of an approved proposal (MANAGER-authorized).

    Revalidates V1–V12 + approval binding at execution time; duplicates are
    refused by the DB unique constraint.
    """
    approval = approvals.get_approval(approval_id)

    def work() -> dict:
        record = svc.replay(approval.proposal_id, manager.actor_id)
        return ReplayExecutionOut(
            execution_id=record.execution_id,
            proposal_id=record.proposal_id,
            case_id=record.case_id,
            execution_mode=record.execution_mode,
            simulated=record.simulated,
            result=record.result,
            gateway=record.gateway,
            response_snapshot=record.response_snapshot,
            verification=record.verification,
            created_at=record.created_at,
            warning=execution_warning(record.execution_mode, record.result),
        ).model_dump(mode="json")

    return ReplayExecutionOut(**idem.run(x_idempotency_key, f"replay:{approval_id}", work))


@router.get(
    "/approvals/{approval_id}/submission-origin",
    response_model=ApprovalSubmissionOriginOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
    # Additive read-only traceability endpoint: hidden from the frozen v1.3
    # contract exactly like the other internal routers (payments/demo/llm).
    include_in_schema=False,
    summary="Where this approval came from (batch / run / submit-time validation)",
)
def get_submission_origin(
    approval_id: str, svc=Depends(approval_service)
) -> ApprovalSubmissionOriginOut:
    """Manager-facing provenance: approval → submission item → batch → run.

    Read-only. It never changes the approval decision and never executes.
    """
    return ApprovalSubmissionOriginOut(**svc.submission_origin(approval_id))
