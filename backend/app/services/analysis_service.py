"""Analysis service — runs the AI provider (stub by default) over a case."""

from __future__ import annotations

from ..adapters.ai_provider import AIProvider
from ..domain.enums import AuditEventType, ActorType, CaseWorkflowStatus
from ..domain.models import AIAnalysis, AuditEvent
from ..domain.policies import decision_hash
from ..infrastructure.repositories import AnalysisRepository, AuditRepository
from .case_service import CaseService
from .payment_planning import build_payment_analysis, is_payment_case


class AnalysisService:
    def __init__(self, session, case_service: CaseService, provider: AIProvider):
        self.session = session
        self.case_service = case_service
        self.provider = provider
        self.repo = AnalysisRepository(session)
        self.audit = AuditRepository(session)

    def create_analysis(self, case_id: str, actor_id: str = "system") -> tuple[AIAnalysis, dict]:
        case = self.case_service.get_case(case_id)
        state = self.case_service.get_state(case_id)
        # A payment case (CAP-<capture_id>) has no claim, no evidence window and
        # no dispute lifecycle: running the dispute provider over it would
        # recommend a dispute action on a case that has no dispute. It gets a
        # deterministic capture-level plan instead (never an inference call).
        if is_payment_case(case):
            analysis = build_payment_analysis(case, state)
            plan = dict(analysis.plan or {})
            run_metrics: dict = {}
        else:
            analysis = self.provider.analyze(case, state)
            # The provider may already have produced the plan from a validated
            # draft (LLM). Only providers without a stored plan fall back to
            # plan_preview, and the call is guarded so a provider without it
            # cannot 500.
            plan = dict(analysis.plan or {})
            if not plan:
                preview = getattr(self.provider, "plan_preview", None)
                plan = preview(case, state) if callable(preview) else {}
            metrics_fn = getattr(self.provider, "last_run_metrics", None)
            run_metrics = metrics_fn() if callable(metrics_fn) else {}
        # bind the full decision context (case facts + runtime state)
        analysis.case_snapshot_hash = decision_hash(case, state)
        analysis.plan = plan
        self.repo.add(analysis)
        self.case_service.set_workflow_status(case_id, CaseWorkflowStatus.ANALYZED)
        payload = {
            "analysis_id": analysis.analysis_id,
            "analysis_mode": analysis.analysis_mode.value,
            "model_provider": analysis.model_provider,
            "model_name": analysis.model_name,
            "grounded_fact_count": len(analysis.grounded_facts),
            "case_snapshot_hash": analysis.case_snapshot_hash,
            "plan": plan,
        }
        if isinstance(run_metrics, dict):
            for key in (
                "model_digest",
                "prompt_version",
                "schema_version",
                "latency_ms",
                "inference_ms",
                "prompt_eval_count",
                "prompt_eval_cached_count",
                "eval_count",
                "prefill_tokens_per_s",
                "decode_tokens_per_s",
                "done_reason",
                "total_duration_ms",
                "load_duration_ms",
            ):
                if key in run_metrics:
                    payload[key] = run_metrics[key]
        self.audit.append(
            AuditEvent(
                event_id=f"AUD-{analysis.analysis_id}",
                case_id=case_id,
                event_type=AuditEventType.ANALYSIS_CREATED.value,
                actor_type=ActorType.AI,
                actor_id=actor_id,
                payload=payload,
            )
        )
        self.session.commit()
        return analysis, plan

    def list_analyses(self, case_id: str) -> list[AIAnalysis]:
        self.case_service.get_case(case_id)
        return self.repo.list_for_case(case_id)
