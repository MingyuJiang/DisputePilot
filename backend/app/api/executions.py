"""Execution + audit endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..schemas.audit import AuditEventOut, AuditTimelineOut
from ..schemas.errors import RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID, merge_responses
from ..schemas.execution import ExecutionOut, ExecutionSummaryOut, execution_warning
from .deps import audit_service, execution_service

router = APIRouter(prefix="/api/v1", tags=["executions", "audit"])


@router.get(
    "/proposals/{proposal_id}/execution",
    response_model=ExecutionOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def get_execution(proposal_id: str, svc=Depends(execution_service)) -> ExecutionOut:
    record = svc.get_execution(proposal_id)
    return ExecutionOut(
        execution_id=record.execution_id,
        proposal_id=record.proposal_id,
        case_id=record.case_id,
        execution_mode=record.execution_mode,
        simulated=record.simulated,
        result=record.result,
        gateway=record.gateway,
        request_snapshot=record.request_snapshot,
        response_snapshot=record.response_snapshot,
        verification=record.verification,
        created_at=record.created_at,
        warning=execution_warning(record.execution_mode, record.result),
    )


@router.get(
    "/cases/{case_id}/executions",
    response_model=list[ExecutionSummaryOut],
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def list_executions(case_id: str, svc=Depends(execution_service)) -> list[ExecutionSummaryOut]:
    return [
        ExecutionSummaryOut(
            execution_id=r.execution_id,
            proposal_id=r.proposal_id,
            execution_mode=r.execution_mode,
            simulated=r.simulated,
            result=r.result,
            gateway=r.gateway,
            created_at=r.created_at,
        )
        for r in svc.list_executions(case_id)
    ]


@router.get(
    "/cases/{case_id}/audit",
    response_model=AuditTimelineOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def case_audit(case_id: str, svc=Depends(audit_service)) -> AuditTimelineOut:
    events = svc.timeline(case_id)
    return AuditTimelineOut(
        case_id=case_id,
        events=[
            AuditEventOut(
                event_id=e.event_id,
                case_id=e.case_id,
                event_type=e.event_type,
                actor_type=e.actor_type,
                actor_id=e.actor_id,
                payload=e.payload,
                created_at=e.created_at,
            )
            for e in events
        ],
        append_only=True,
    )
