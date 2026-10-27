"""Analysis endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header

from ..security.authorization import (
    ACTOR_ID_HEADER_DESCRIPTION,
    IDEMPOTENCY_KEY_HEADER_DESCRIPTION,
)
from ..schemas.analysis import AnalysisCreate, AnalysisOut, GroundedFactOut
from ..schemas.errors import (
    RESPONSES_NOT_FOUND,
    RESPONSES_REQUEST_INVALID,
    merge_responses,
)
from .deps import analysis_service, case_service, idempotency

router = APIRouter(prefix="/api/v1", tags=["analyses"])


def _analysis_out(analysis, plan: dict) -> AnalysisOut:
    return AnalysisOut(
        analysis_id=analysis.analysis_id,
        case_id=analysis.case_id,
        case_snapshot_hash=analysis.case_snapshot_hash,
        factual_summary=analysis.factual_summary,
        grounded_facts=[
            GroundedFactOut(
                fact_id=f.fact_id,
                statement=f.statement,
                fact_type=f.fact_type,
                evidence_ids=f.evidence_ids,
                provenance=f.provenance,
            )
            for f in analysis.grounded_facts
        ],
        missing_evidence=analysis.missing_evidence,
        contradictions=analysis.contradictions,
        recommendation=analysis.recommendation,
        safety_flags=analysis.safety_flags,
        model_provider=analysis.model_provider,
        model_name=analysis.model_name,
        analysis_mode=analysis.analysis_mode,
        created_at=analysis.created_at,
        plan=plan,
    )


@router.post(
    "/cases/{case_id}/analyses",
    response_model=AnalysisOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def create_analysis(
    case_id: str,
    body: AnalysisCreate | None = None,
    x_idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key", description=IDEMPOTENCY_KEY_HEADER_DESCRIPTION
    ),
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    idem=Depends(idempotency),
    svc=Depends(analysis_service),
) -> AnalysisOut:
    def work() -> dict:
        analysis, plan = svc.create_analysis(case_id, actor_id=x_actor_id or "system")
        return _analysis_out(analysis, plan).model_dump(mode="json")

    return AnalysisOut(**idem.run(x_idempotency_key, f"analyses:{case_id}", work))


@router.get(
    "/cases/{case_id}/analyses",
    response_model=list[AnalysisOut],
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def list_analyses(case_id: str, svc=Depends(analysis_service)) -> list[AnalysisOut]:
    analyses = svc.list_analyses(case_id)
    # Each analysis carries its own persisted plan. Legacy rows without one are
    # filled from a guarded deterministic preview — never from an inference call
    # (LLM providers' plan_preview is structural only).
    preview: dict = {}
    preview_ready = False
    results: list[AnalysisOut] = []
    for analysis in analyses:
        plan = analysis.plan or {}
        if not plan:
            if not preview_ready:
                cs = svc.case_service
                builder = getattr(svc.provider, "plan_preview", None)
                preview = (
                    builder(cs.get_case(case_id), cs.get_state(case_id))
                    if callable(builder)
                    else {}
                )
                preview_ready = True
            plan = preview
        results.append(_analysis_out(analysis, plan))
    return results
