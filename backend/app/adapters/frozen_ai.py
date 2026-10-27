"""Frozen AI provider — replay pre-recorded analyses, no model, no network.

``DP_AI_PROVIDER=frozen`` reads ``data/fixtures/OFFLINE_FROZEN_ANALYSES.json``
(one entry per ``case_id``) and returns an :class:`AIAnalysis` with
``analysis_mode=FROZEN_REPLAY``. There is no transport and no inference: the
only I/O is reading the JSON fixture from disk.

Honesty rules
-------------
- The recorded recommendation/grounded facts/missing evidence are preserved
  verbatim; this is history, not a new inference.
- The same deterministic HATEOAS gate used by the local provider is applied
  when building the plan: the *effective* action is what the observed state
  allows, while the recorded recommendation stays in
  ``plan.raw_recommendation`` for audit. A recorded action without a POST rel
  therefore never becomes a proposal.
- A missing case is an explicit 404 (never a fabricated analysis). A broken
  fixture is an explicit 503.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from ..domain.action_gate import ActionGateResult, gate_action, link_backed_actions
from ..domain.enums import ActionType, AnalysisMode, ProposalState, ValidationStatus
from ..domain.errors import DomainError, NotFoundError
from ..domain.models import (
    AIAnalysis,
    ActionProposal,
    CaseRecord,
    CaseStateSnapshot,
    GroundedFact,
    content_hash,
    default_risk_for,
    utc_now_iso,
)
from ..domain.policies import decision_hash
from ..infrastructure.settings import FIXTURES_DIR, settings
from .action_builder import action_preconditions, build_action_payload
from .local_llm.config import FROZEN_MODEL_NAME

DEFAULT_FROZEN_PATH = FIXTURES_DIR / "OFFLINE_FROZEN_ANALYSES.json"
FROZEN_SOURCE = "FROZEN_REPLAY"
FROZEN_BANNER = (
    "Frozen AI Output / Offline Replay — pre-recorded analysis replayed "
    "without a model; not live inference"
)


class FrozenFixtureUnavailable(DomainError):
    """The frozen fixture is missing or malformed (explicit 503)."""

    code = "DOMAIN_ERROR"
    http_status = 503


class FrozenAnalysisNotFound(NotFoundError):
    """No recorded analysis for this case (explicit 404)."""

    code = "NOT_FOUND"


class FrozenReplayProvider:
    """Replays recorded analyses; satisfies the AIProvider protocol."""

    provider_name = "frozen-replay"

    def __init__(self, path: str | Path | None = None):
        override = os.environ.get("DP_FROZEN_ANALYSES", "").strip()
        self.path = Path(path or override or DEFAULT_FROZEN_PATH)
        self._meta: dict[str, Any] = {}
        self._entries: dict[str, dict[str, Any]] = {}
        self._load()

    # -------------------------------------------------------------------- meta
    @property
    def model_name(self) -> str:
        return str(self._meta.get("model_name") or FROZEN_MODEL_NAME)

    def last_run_metrics(self) -> dict:
        return {
            "model_provider": self.provider_name,
            "model_name": self.model_name,
            "analysis_mode": AnalysisMode.FROZEN_REPLAY.value,
            "frozen_fixture": self.path.name,
        }

    def _load(self) -> None:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise FrozenFixtureUnavailable(
                f"frozen analysis fixture {self.path.as_posix()!r} is unreadable "
                f"({type(exc).__name__}); no model call was made"
            ) from None
        except ValueError:
            raise FrozenFixtureUnavailable(
                f"frozen analysis fixture {self.path.as_posix()!r} is not valid JSON"
            ) from None
        if not isinstance(raw, dict) or not isinstance(raw.get("analyses"), dict):
            raise FrozenFixtureUnavailable(
                f"frozen analysis fixture {self.path.as_posix()!r} has no analyses object"
            )
        self._meta = raw.get("_meta") if isinstance(raw.get("_meta"), dict) else {}
        self._entries = {
            str(case_id): entry
            for case_id, entry in raw["analyses"].items()
            if isinstance(entry, dict)
        }

    def entry_for(self, case_id: str) -> dict[str, Any]:
        entry = self._entries.get(str(case_id))
        if entry is None:
            raise FrozenAnalysisNotFound(
                f"no frozen analysis for case {case_id!r} in "
                f"{self.path.name!r}; no model call was made and no analysis "
                "was fabricated"
            )
        return entry

    # ----------------------------------------------------------------- analyze
    def analyze(self, case: CaseRecord, state: CaseStateSnapshot) -> AIAnalysis:
        entry = self.entry_for(case.case_id)
        gate = gate_action(state, str(entry.get("recommendation") or ""))
        flags = _dedupe(
            [str(f) for f in entry.get("safety_flags") or []]
            + [FROZEN_BANNER]
            + ([_gate_flag(gate)] if gate.downgraded else [])
        )
        analysis_id = (
            f"ANL-{case.case_id}-FROZEN-"
            f"{utc_now_iso().replace(':', '').replace('-', '')[-12:]}-"
            f"{content_hash(case.case_id + str(entry.get('analysis_id') or ''))[:6]}"
        )
        return AIAnalysis(
            analysis_id=analysis_id,
            case_id=case.case_id,
            case_snapshot_hash=str(entry.get("case_snapshot_hash") or case.snapshot_hash),
            factual_summary=str(entry.get("factual_summary") or "").strip(),
            grounded_facts=_facts(entry, self.path),
            missing_evidence=[str(m) for m in entry.get("missing_evidence") or []],
            contradictions=[str(c) for c in entry.get("contradictions") or []],
            recommendation=gate.effective_action,
            safety_flags=flags,
            model_provider=self.provider_name,
            model_name=self.model_name,
            analysis_mode=AnalysisMode.FROZEN_REPLAY,
            plan=self._derive_plan(entry, state, gate),
        )

    # -------------------------------------------------------------------- plan
    def plan(
        self, case: CaseRecord, state: CaseStateSnapshot, analysis: AIAnalysis
    ) -> list[ActionProposal]:
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
                f"{action!r} instead of {gate.raw_action!r}"
            )
        rationale.append(
            "FROZEN_REPLAY proposal — deterministic payload from a pre-recorded "
            "analysis; V1–V12 and manager approval still gate execution"
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
        """Structural mirror from the frozen fixture — never a model call."""
        entry = self._entries.get(str(case.case_id))
        if entry is None:
            return {
                "recommended_action": None,
                "rationale": [
                    "no frozen analysis for this case; no inference is performed "
                    "and no plan is fabricated"
                ],
                "gaps": [],
                "alternatives": [],
                "wait_rule_applies": False,
                "source": "NO_FROZEN_ENTRY",
                "preview_only": True,
            }
        gate = gate_action(state, str(entry.get("recommendation") or ""))
        return self._derive_plan(entry, state, gate)

    # --------------------------------------------------------------- helpers
    def _derive_plan(
        self, entry: dict[str, Any], state: CaseStateSnapshot, gate: ActionGateResult
    ) -> dict:
        recorded = dict(entry.get("plan") or {})
        effective = gate.effective_action
        rationale = [
            str(r) for r in recorded.get("rationale") or [] if str(r).strip()
        ]
        if gate.downgraded:
            rationale.append(
                f"ACTION GATE — {gate.reason}; effective action is "
                f"{effective!r} (recorded recommendation was {gate.raw_action!r})"
            )
        plan = dict(recorded)
        plan.update(
            {
                "recommended_action": effective,
                "raw_recommendation": gate.raw_action,
                "effective_action": effective,
                "action_gate_reason": gate.reason,
                "rationale": rationale,
                "gaps": list(recorded.get("gaps") or []),
                "alternatives": link_backed_actions(state, exclude=effective),
                "wait_rule_applies": effective == ActionType.WAIT.value,
                "source": FROZEN_SOURCE,
                "frozen_recorded_action": gate.raw_action,
                "frozen_analysis_id": entry.get("analysis_id"),
                "candidate_only": True,
            }
        )
        return plan


def _gate_flag(gate: ActionGateResult) -> str:
    return (
        f"PLANNER_ACTION_GATED — recorded analysis suggested {gate.raw_action!r} "
        f"but {gate.reason}; effective action is {gate.effective_action!r}"
    )


def _facts(entry: dict[str, Any], path: Path) -> list[GroundedFact]:
    facts: list[GroundedFact] = []
    for raw in entry.get("grounded_facts") or []:
        if not isinstance(raw, dict):
            continue
        try:
            facts.append(GroundedFact.model_validate(raw))
        except Exception:
            raise FrozenFixtureUnavailable(
                f"frozen analysis fixture {path.name!r} has a malformed "
                "grounded fact; refusing to serve a partial analysis"
            ) from None
    return facts


def _dedupe(values: list[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.append(value)
    return seen
