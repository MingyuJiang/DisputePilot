"""``LocalLLMProvider`` — real inference behind the same AIProvider seam.

Flow (one attempt, no silent fallback):

    prompt -> Ollama /api/chat (loopback only) -> done_reason -> JSON
    -> ModelAnalysisDraft (Pydantic) -> evidence-id whitelist
    -> two-level grounding -> AIAnalysis (backend-owned safety fields)
    -> V1–V12 remain untouched and run later, at proposal validation time.

The model never writes ``safety_flags`` / ``execution_permission`` /
``approval_*`` / ``policy_validation_result`` / ``verified_execution_result``;
those are assembled here from the case, the grounding result and the
truncation state. ``plan()`` re-uses the already validated draft — it does not
call the model a second time, and ``plan_preview()`` never calls it at all.
"""

from __future__ import annotations

import json
import time

from pydantic import ValidationError

from ...domain.action_gate import (
    ActionGateResult,
    gate_action,
    link_backed_actions,
)
from ...domain.enums import (
    ActionType,
    AnalysisMode,
    ProposalState,
    ValidationStatus,
)
from ...domain.models import (
    ActionProposal,
    AIAnalysis,
    CaseRecord,
    CaseStateSnapshot,
    content_hash,
    default_risk_for,
    utc_now_iso,
)
from ...domain.policies import decision_hash
from ...infrastructure.settings import settings
from ..action_builder import action_preconditions, build_action_payload
from .config import LLMConfig
from .errors import (
    LLM_INVALID_JSON,
    LLM_MODEL_UNAVAILABLE,
    LLM_OUTPUT_TRUNCATED,
    LLM_SCHEMA_INVALID,
    LLM_TIMEOUT,
    LLM_CONNECTION_ERROR,
    LLM_UNSUPPORTED_EVIDENCE,
    LLMServiceError,
)
from .grounding import GroundingChecker, GroundingOutcome
from .prompt import build_chat_request
from .schema import ModelAnalysisDraft
from .transport import OllamaChatTransport

_RETRYABLE = (LLM_TIMEOUT, LLM_CONNECTION_ERROR, LLM_MODEL_UNAVAILABLE)

_LLM_BANNER = (
    "AI output is LLM inference from a local model — candidate analysis, not a decision; "
    "deterministic validation and manager approval still apply"
)


class LocalLLMProvider:
    """Ollama-backed provider (``DP_AI_PROVIDER=ollama_local``)."""

    provider_name = "ollama-local"

    def __init__(self, config: LLMConfig | None = None, transport=None):
        self.config = (config or LLMConfig.from_env()).validate()
        if not self.config.is_local_llm:
            raise ValueError(
                "LocalLLMProvider requires DP_AI_PROVIDER=ollama_local "
                f"(got {self.config.provider!r})"
            )
        self.transport = transport or OllamaChatTransport(
            self.config.base_url, timeout_s=self.config.timeout_s
        )
        self._last_metrics: dict = {}

    # ------------------------------------------------------------------ meta
    @property
    def model_name(self) -> str:
        return self.config.model

    def last_run_metrics(self) -> dict:
        return dict(self._last_metrics)

    # --------------------------------------------------------------- analyze
    def analyze(self, case: CaseRecord, state: CaseStateSnapshot) -> AIAnalysis:
        started = time.perf_counter()
        request = build_chat_request(self.config, case, state)
        response = self._call(request)
        draft = self._parse_response(response)

        checker = GroundingChecker(case)
        unknown = checker.unknown_ids(draft.cited_evidence_ids)
        if unknown:
            raise LLMServiceError(
                LLM_UNSUPPORTED_EVIDENCE,
                "model cited evidence ids that do not exist on this case",
                unknown_count=len(unknown),
                unknown_sample=unknown[:3],
            )

        grounding = checker.check(draft)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        self._last_metrics = self._metrics(response, elapsed_ms)

        return self._assemble(case, state, draft, grounding)

    # ------------------------------------------------------------------ plan
    def plan(
        self, case: CaseRecord, state: CaseStateSnapshot, analysis: AIAnalysis
    ) -> list[ActionProposal]:
        """Derive proposals from the validated draft — no second model call.

        The plan stores the *effective* action (the one HATEOAS allows). A
        proposal is re-gated here as well: the state may have changed since
        the analysis, and no proposal may ever carry an action whose POST rel
        is absent.
        """
        plan = dict(analysis.plan or {})
        requested = str(
            plan.get("effective_action") or plan.get("recommended_action") or ""
        )
        gate = gate_action(state, requested)
        action = gate.effective_action

        open_reqs = [r for r in state.evidence_requirements if r.open]
        payload = build_action_payload(action, case, state, open_reqs)
        rationale = [str(item) for item in plan.get("rationale", []) if str(item).strip()]
        if gate.downgraded:
            rationale.append(
                f"ACTION GATE at plan time — {gate.reason}; proposal uses "
                f"{action!r} instead of the recorded {gate.raw_action!r}"
            )
        rationale.append(
            "candidate proposal derived deterministically from the validated model draft; "
            "V1–V12 and manager approval still gate execution"
        )

        cited: list[str] = []
        for fact in analysis.grounded_facts:
            for evidence_id in fact.evidence_ids:
                if evidence_id not in cited:
                    cited.append(evidence_id)
        known = {e.evidence_id for e in case.evidence}
        cited = [e for e in cited if e in known]

        proposal_id = (
            f"PRP-{case.case_id}-{action}-"
            f"{content_hash(case.snapshot_hash + action + str(sorted(payload.items())))[:10]}"
        )
        proposal = ActionProposal(
            proposal_id=proposal_id,
            case_id=case.case_id,
            analysis_id=analysis.analysis_id,
            action_type=action,
            action_payload=payload,
            expected_preconditions=action_preconditions(action, state),
            required_evidence=[r.evidence_type.value for r in open_reqs],
            rationale=rationale,
            evidence_ids=cited,
            risk_level=default_risk_for(action),
            validation_status=ValidationStatus.NOT_RUN,
            state=ProposalState.DRAFT,
            snapshot_hash=decision_hash(case, state),
            policy_version=settings.policy_version,
        )
        proposal.bind_hashes(settings.policy_version)
        return [proposal]

    def plan_preview(self, case: CaseRecord, state: CaseStateSnapshot) -> dict:
        """Structural preview only — NEVER triggers inference.

        The authoritative plan is persisted on the analysis record; the POST
        response returns it. This method exists so the provider satisfies the
        full Protocol without making a model call from a read path.
        """
        return {
            "recommended_action": None,
            "rationale": [
                "plan preview requires a completed analysis; the persisted "
                "analysis.plan is authoritative and no inference is performed here"
            ],
            "gaps": [],
            "alternatives": [],
            "wait_rule_applies": False,
            "source": "NO_INFERENCE_PREVIEW",
            "preview_only": True,
        }

    # --------------------------------------------------------------- helpers
    def _call(self, request: dict) -> dict:
        attempts = 1 + max(0, int(self.config.retries))
        last_error: LLMServiceError | None = None
        for attempt in range(attempts):
            try:
                return self.transport.chat(request, timeout_s=self.config.timeout_s)
            except LLMServiceError as exc:
                last_error = exc
                if exc.internal_code in _RETRYABLE and attempt + 1 < attempts:
                    continue
                raise
        raise last_error or LLMServiceError(
            LLM_CONNECTION_ERROR, "local LLM call failed without a response"
        )

    def _parse_response(self, response: dict) -> ModelAnalysisDraft:
        done_reason = str(response.get("done_reason") or "").lower()
        if done_reason == "length":
            raise LLMServiceError(
                LLM_OUTPUT_TRUNCATED,
                "model output hit the token cap (done_reason=length); analysis refused",
                done_reason=done_reason,
                max_output_tokens=self.config.max_output_tokens,
            )
        if response.get("done") is False:
            raise LLMServiceError(
                LLM_OUTPUT_TRUNCATED,
                "model response is incomplete (done=false); analysis refused",
                done_reason=done_reason or None,
            )

        message = response.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or not content.strip():
            raise LLMServiceError(
                LLM_INVALID_JSON,
                "model returned no message content",
                done_reason=done_reason or None,
            )
        try:
            payload = json.loads(content)
        except json.JSONDecodeError as exc:
            raise LLMServiceError(
                LLM_INVALID_JSON,
                "model output is not valid JSON",
                parse_error=f"{exc.msg} at line {exc.lineno} column {exc.colno}",
            ) from exc
        if not isinstance(payload, dict):
            raise LLMServiceError(
                LLM_INVALID_JSON, "model output JSON is not an object"
            )
        try:
            return ModelAnalysisDraft.model_validate(payload)
        except ValidationError as exc:
            first = exc.errors()[:4]
            raise LLMServiceError(
                LLM_SCHEMA_INVALID,
                "model output does not match the draft schema",
                error_count=len(exc.errors()),
                errors=[
                    {
                        "loc": ".".join(str(part) for part in item.get("loc", ())),
                        "type": item.get("type", ""),
                    }
                    for item in first
                ],
            ) from exc

    def _metrics(self, response: dict, elapsed_ms: float) -> dict:
        prompt_tokens = _as_int(response.get("prompt_eval_count"))
        cached_tokens = _as_int(response.get("prompt_eval_cached_count"))
        output_tokens = _as_int(response.get("eval_count"))
        total_ns = _as_int(response.get("total_duration"))
        load_ns = _as_int(response.get("load_duration"))
        prompt_ns = _as_int(response.get("prompt_eval_duration"))
        eval_ns = _as_int(response.get("eval_duration"))
        # Ollama caches the prompt prefix; only uncached tokens were actually
        # prefilled. Reporting prompt_eval_count / duration would overstate
        # prefill throughput, so the rate uses the uncached delta.
        new_prompt_tokens = max(prompt_tokens - cached_tokens, 0)
        metrics = {
            "model_provider": self.provider_name,
            "model_name": self.config.model,
            "model_digest": self.config.model_digest,
            "prompt_version": self.config.prompt_version,
            "schema_version": self.config.schema_version,
            "analysis_mode": AnalysisMode.LLM.value,
            "latency_ms": elapsed_ms,
            "inference_ms": (
                round((prompt_ns + eval_ns) / 1_000_000, 1)
                if (prompt_ns or eval_ns)
                else None
            ),
            "done_reason": str(response.get("done_reason") or ""),
            "prompt_eval_count": prompt_tokens,
            "prompt_eval_cached_count": cached_tokens,
            "eval_count": output_tokens,
            "total_duration_ms": round(total_ns / 1_000_000, 1) if total_ns else None,
            "load_duration_ms": round(load_ns / 1_000_000, 1) if load_ns else None,
            "prefill_tokens_per_s": (
                round(new_prompt_tokens / (prompt_ns / 1e9), 1)
                if new_prompt_tokens and prompt_ns
                else None
            ),
            "decode_tokens_per_s": (
                round(output_tokens / (eval_ns / 1e9), 1)
                if output_tokens and eval_ns
                else None
            ),
        }
        return {k: v for k, v in metrics.items() if v is not None}

    def _assemble(
        self,
        case: CaseRecord,
        state: CaseStateSnapshot,
        draft: ModelAnalysisDraft,
        grounding: GroundingOutcome,
    ) -> AIAnalysis:
        gate = gate_action(state, draft.suggested_action)
        flags = _dedupe(
            _case_safety_flags(case) + list(grounding.safety_flags) + [_LLM_BANNER]
        )
        if gate.downgraded:
            flags.append(
                f"PLANNER_ACTION_GATED — model suggested {gate.raw_action!r} but "
                f"{gate.reason}; effective action is {gate.effective_action!r}"
            )
        analysis_id = (
            f"ANL-{case.case_id}-{utc_now_iso().replace(':', '').replace('-', '')[-12:]}-"
            f"{content_hash(case.case_id + draft.suggested_action)[:6]}"
        )
        return AIAnalysis(
            analysis_id=analysis_id,
            case_id=case.case_id,
            case_snapshot_hash=case.snapshot_hash,
            factual_summary=draft.factual_summary.strip(),
            grounded_facts=grounding.facts,
            missing_evidence=list(case.missing_evidence),
            contradictions=[],
            recommendation=gate.effective_action,
            safety_flags=flags,
            model_provider=self.provider_name,
            model_name=self.config.model,
            analysis_mode=AnalysisMode.LLM,
            plan=self._derive_plan(case, state, draft, gate),
        )

    def _derive_plan(
        self,
        case: CaseRecord,
        state: CaseStateSnapshot,
        draft: ModelAnalysisDraft,
        gate: ActionGateResult,
    ) -> dict:
        alternatives = link_backed_actions(state, exclude=gate.effective_action)
        gaps = [
            {"gap": gap.strip(), "severity": "CANDIDATE", "source": "MODEL_DRAFT"}
            for gap in draft.missing_evidence_candidates
            if gap and gap.strip()
        ]
        rationale = [r for r in draft.rationale if r.strip()]
        if gate.downgraded:
            rationale.append(
                f"ACTION GATE — {gate.reason}; effective action is "
                f"{gate.effective_action!r} (model suggested {gate.raw_action!r})"
            )
        return {
            "recommended_action": gate.effective_action,
            "raw_recommendation": gate.raw_action,
            "effective_action": gate.effective_action,
            "action_gate_reason": gate.reason,
            "rationale": rationale,
            "gaps": gaps,
            "alternatives": alternatives,
            "wait_rule_applies": gate.effective_action == ActionType.WAIT.value,
            "source": "MODEL_DRAFT_VALIDATED",
            "draft_schema_version": self.config.schema_version,
            "prompt_version": self.config.prompt_version,
            "candidate_only": True,
            "uncertainty": draft.uncertainty,
        }


def _case_safety_flags(case: CaseRecord) -> list[str]:
    """Case-derived flags — same producers the stub uses, never model input."""
    flags: list[str] = []
    if case.verification_level.value == "SCENARIO_DEFINED_OFFLINE_CONTENT":
        flags.append(
            "SCENARIO_DEFINED content — not a real PayPal dispute record; "
            "do not claim real observations"
        )
    if case.verification_level.value == "FROZEN_SANDBOX_E1_VERIFIED":
        flags.append("frozen verified trajectory — no further writes on this case")
    if case.fulfillment_posture.value in ("NONE", "SHIPPED_NO_TRACKING"):
        flags.append("fabrication of fulfillment evidence is forbidden")
    return flags


def _as_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _dedupe(values: list[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.append(value)
    return seen
