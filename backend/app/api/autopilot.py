"""Autopilot endpoints — batch triage over existing dispute cases."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header

from ..domain.enums import ActorRole
from ..schemas.autopilot import (
    AutopilotRunCreate,
    AutopilotRunOut,
    AutopilotSubmissionBatchOut,
    AutopilotSubmitOut,
    AutopilotSubmitRequest,
)
from ..schemas.errors import (
    RESPONSES_AUTH,
    RESPONSES_CONFLICT,
    RESPONSES_422_BOTH,
    RESPONSES_NOT_FOUND,
    RESPONSES_VALIDATION_FAILED,
    merge_responses,
)
from ..security.authorization import (
    ACTOR_ID_HEADER_DESCRIPTION,
    ACTOR_ROLE_HEADER_DESCRIPTION,
    IDEMPOTENCY_KEY_HEADER_DESCRIPTION,
    require_role,
)
from .deps import autopilot_service

router = APIRouter(
    prefix="/api/v1/autopilot",
    tags=["autopilot"],
    # MVP-0 endpoints are additive and live outside the frozen v1.3 contract
    # surface (contracts/v1/openapi.v1.yaml): include_in_schema=False keeps the
    # published OpenAPI 0-diff, exactly like the payments/demo/llm routers.
    include_in_schema=False,
)


@router.post(
    "/runs",
    response_model=AutopilotRunOut,
    responses=merge_responses(RESPONSES_422_BOTH, RESPONSES_CONFLICT),
    summary="Run one batch TRIAGE_ONLY pass and record the decision per case",
)
def create_run(
    body: AutopilotRunCreate,
    x_idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key",
        description=IDEMPOTENCY_KEY_HEADER_DESCRIPTION,
    ),
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    svc=Depends(autopilot_service),
) -> AutopilotRunOut:
    run = svc.run(
        body.case_ids,
        mode=body.mode,
        request_key=x_idempotency_key or body.idempotency_key,
        actor_id=x_actor_id or "autopilot",
    )
    return AutopilotRunOut(**run)


@router.get(
    "/runs/{run_id}",
    response_model=AutopilotRunOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_422_BOTH),
    summary="Read a stored autopilot run (survives a process restart)",
)
def get_run(run_id: str, svc=Depends(autopilot_service)) -> AutopilotRunOut:
    return AutopilotRunOut(**svc.get_run(run_id))


@router.post(
    "/runs/{run_id}/submit-for-review",
    response_model=AutopilotSubmitOut,
    responses=merge_responses(
        RESPONSES_AUTH,
        RESPONSES_NOT_FOUND,
        RESPONSES_CONFLICT,
        RESPONSES_VALIDATION_FAILED,
        RESPONSES_422_BOTH,
    ),
    summary="Submit every eligible proposal of a run for manager review",
)
def submit_run_for_review(
    run_id: str,
    body: AutopilotSubmitRequest | None = None,
    x_idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key",
        description=IDEMPOTENCY_KEY_HEADER_DESCRIPTION,
    ),
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    x_actor_role: str | None = Header(
        default=None, description=ACTOR_ROLE_HEADER_DESCRIPTION
    ),
    specialist=Depends(require_role(ActorRole.SPECIALIST)),
    svc=Depends(autopilot_service),
) -> AutopilotSubmitOut:
    """Batch specialist submission — never an approval and never an execution.

    Each case is revalidated by the existing ApprovalService.submit before an
    approval row is created; a rejected case does not stop the others.
    """
    payload = body or AutopilotSubmitRequest()
    submission = svc.submit_for_review(
        run_id,
        case_ids=payload.case_ids,
        request_key=x_idempotency_key or payload.idempotency_key,
        actor_id=specialist.actor_id,
    )
    return AutopilotSubmitOut(**submission)


@router.get(
    "/submission-batches/{submission_batch_id}",
    response_model=AutopilotSubmissionBatchOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_422_BOTH),
    summary="Read one stored submission batch with its per-case results",
)
def get_submission_batch(
    submission_batch_id: str, svc=Depends(autopilot_service)
) -> AutopilotSubmissionBatchOut:
    return AutopilotSubmissionBatchOut(**svc.get_submission_batch(submission_batch_id))


@router.get(
    "/runs/{run_id}/submission-batches",
    response_model=list[AutopilotSubmissionBatchOut],
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_422_BOTH),
    summary="List the submission batches recorded for one run, oldest first",
)
def list_submission_batches(
    run_id: str, svc=Depends(autopilot_service)
) -> list[AutopilotSubmissionBatchOut]:
    return [
        AutopilotSubmissionBatchOut(**batch)
        for batch in svc.list_submission_batches(run_id)
    ]
