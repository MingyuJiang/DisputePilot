"""AI provider port + the DeterministicStubProvider (default, offline).

The stub is a deterministic re-implementation of two documented rule sets:

1. Evidence gap analysis — S6_1_AI_ACTION_PLAN.md D1 (gap table, severity,
   honesty strategy);
2. Action planning — SCENARIO_FACTORY_ARCHITECTURE.md §4 EvidencePlanner
   decision rules (verbatim decision tree).

It is explicitly NOT an LLM: every output carries
``analysis_mode=STUB_DETERMINISTIC`` and must never be reported as real model
performance (S7 benchmark discipline).

``FutureLLMProvider`` is a reserved port: same protocol, no implementation,
no network.
"""

from __future__ import annotations

from typing import Protocol

from ..domain.policies import ACTION_REL, decision_hash
from ..domain.enums import (
    ActionType,
    AnalysisMode,
    CapabilityBasis,
    DisputeStatus,
    GroundedFactType,
    LifecycleStage,
    ProposalState,
    ProvenanceLabel,
    RiskLevel,
    ValidationStatus,
)
from ..domain.models import (
    UNKNOWN,
    ActionProposal,
    AIAnalysis,
    CaseRecord,
    CaseStateSnapshot,
    GroundedFact,
    content_hash,
    default_risk_for,
    utc_now_iso,
)
from ..infrastructure.settings import settings
from .action_builder import action_preconditions, build_action_payload


class AIProvider(Protocol):
    """Unified AI provider interface (case understanding + action planning).

    ``plan_preview`` returns the S7 plan-schema mirror shown on the analysis
    response. Providers that need inference to build it must persist the plan
    on the analysis instead of calling the model from a read path (see
    ``LocalLLMProvider.plan_preview``).
    """

    def analyze(self, case: CaseRecord, state: CaseStateSnapshot) -> AIAnalysis: ...

    def plan(
        self, case: CaseRecord, state: CaseStateSnapshot, analysis: AIAnalysis
    ) -> list[ActionProposal]: ...

    def plan_preview(self, case: CaseRecord, state: CaseStateSnapshot) -> dict: ...


_POSTURES_WITH_MATERIAL = {
    "SIMULATED_FULFILLMENT",
    "SHIPPED_WITH_TRACKING",
    "REFUNDED",
}


class DeterministicStubProvider:
    """Offline deterministic planner (documentation-derived rules only)."""

    provider_name = "deterministic-stub"
    model_name = "evidence-planner-v1"

    # ------------------------------------------------------------------ analyze
    def analyze(self, case: CaseRecord, state: CaseStateSnapshot) -> AIAnalysis:
        buyer_ev = next(
            (e for e in case.evidence if e.evidence_type.value == "BUYER_STATEMENT"), None
        )
        req_evs = [e for e in case.evidence if e.source_type == "EXPECTED_EVIDENCE_REQUIREMENT"]
        order_evs = [e for e in case.evidence if e.evidence_type.value == "ORDER_RECORD"]
        open_reqs = [r for r in state.evidence_requirements if r.open]

        facts: list[GroundedFact] = []
        if buyer_ev is not None:
            facts.append(
                GroundedFact(
                    fact_id=f"GF-{case.case_id}-BUYER",
                    statement=(
                        f"Buyer filed a {case.family.value} dispute "
                        f"({case.reason.value}) for {case.amount.display()}."
                    ),
                    fact_type=GroundedFactType.OBSERVED_FACT,
                    evidence_ids=[buyer_ev.evidence_id],
                    provenance=buyer_ev.provenance,
                )
            )
        for order_ev in order_evs:
            facts.append(
                GroundedFact(
                    fact_id=f"GF-{case.case_id}-ORDER-{order_ev.evidence_id[-3:]}",
                    statement="Sandbox order/capture records exist for the disputed transaction.",
                    fact_type=GroundedFactType.OBSERVED_FACT,
                    evidence_ids=[order_ev.evidence_id],
                    provenance=order_ev.provenance,
                )
            )
        for idx, req in enumerate(open_reqs):
            ref = req_evs[idx] if idx < len(req_evs) else (req_evs[0] if req_evs else None)
            if ref is not None:
                facts.append(
                    GroundedFact(
                        fact_id=f"GF-{case.case_id}-REQ-{req.evidence_type.value}",
                        statement=(
                            f"Open evidence requirement: {req.evidence_type.value} "
                            f"requested from the seller."
                        ),
                        fact_type=GroundedFactType.OBSERVED_FACT,
                        evidence_ids=[ref.evidence_id],
                        provenance=ref.provenance,
                    )
                )
        posture = case.fulfillment_posture.value
        has_material = posture in _POSTURES_WITH_MATERIAL
        if open_reqs:
            material_refs = [e.evidence_id for e in req_evs] + [
                e.evidence_id for e in order_evs
            ]
            facts.append(
                GroundedFact(
                    fact_id=f"GF-{case.case_id}-POSTURE",
                    statement=(
                        f"Fulfillment posture {posture} "
                        + (
                            "supplies labeled/simulated material only."
                            if has_material
                            else "provides no truthful fulfillment material."
                        )
                    ),
                    fact_type=GroundedFactType.SUPPORTED_INFERENCE,
                    evidence_ids=material_refs,
                    provenance=ProvenanceLabel.AI_INFERRED,
                )
            )

        missing = [str(m) for m in self._missing_evidence(case)]
        gaps = self._gaps(case, state, open_reqs, has_material)
        recommendation, _ = self._recommend(case, state, open_reqs, has_material)
        safety_flags = self._safety_flags(case)

        analysis_id = f"ANL-{case.case_id}-{utc_now_iso().replace(':', '').replace('-', '')[-12:]}-{content_hash(case.case_id + recommendation)[:6]}"
        return AIAnalysis(
            analysis_id=analysis_id,
            case_id=case.case_id,
            case_snapshot_hash=case.snapshot_hash,
            factual_summary=(
                f"{case.family.value} dispute ({case.reason.value}), "
                f"{case.amount.display()}, fulfillment posture {posture}, "
                f"status {state.dispute_status.value}/{state.lifecycle_stage.value} "
                f"(fixture snapshot)."
            ),
            grounded_facts=facts,
            missing_evidence=missing,
            contradictions=[],
            recommendation=recommendation,
            safety_flags=safety_flags,
            model_provider=self.provider_name,
            model_name=self.model_name,
            analysis_mode=AnalysisMode.STUB_DETERMINISTIC,
        )

    # -------------------------------------------------------------------- plan
    def plan(
        self, case: CaseRecord, state: CaseStateSnapshot, analysis: AIAnalysis
    ) -> list[ActionProposal]:
        open_reqs = [r for r in state.evidence_requirements if r.open]
        posture = case.fulfillment_posture.value
        has_material = posture in _POSTURES_WITH_MATERIAL
        action, rationale = self._recommend(case, state, open_reqs, has_material)
        plan_dict = self._plan_dict(case, state, action, rationale, open_reqs, has_material)

        payload = self._build_payload(action, case, state, open_reqs)
        cited: list[str] = []
        for fact in analysis.grounded_facts:
            for eid in fact.evidence_ids:
                if eid not in cited:
                    cited.append(eid)
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
            expected_preconditions=self._preconditions(action, state),
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

    # ------------------------------------------------------- documented rules
    def plan_preview(self, case: CaseRecord, state: CaseStateSnapshot) -> dict:
        """Plan-schema preview without requiring an analysis (S7 structural gate)."""
        open_reqs = [r for r in state.evidence_requirements if r.open]
        has_material = case.fulfillment_posture.value in _POSTURES_WITH_MATERIAL
        action, rationale = self._recommend(case, state, open_reqs, has_material)
        return self._plan_dict(case, state, action, rationale, open_reqs, has_material)

    def _recommend(self, case, state, open_reqs, has_material):
        """SCENARIO_FACTORY_ARCHITECTURE §4 decision tree (verbatim logic).

        The tree assumes the full fixture vocabulary. A live HATEOAS state
        (PayPal Sandbox) may expose a smaller set of links, so an intended
        write is downgraded to WAIT when its rel is not actually offered —
        otherwise V3 would block the generated proposal and the chain could
        never be validated.
        """
        action, rationale = self._intended_action(
            case, state, open_reqs, has_material
        )
        if action != ActionType.WAIT.value:
            rel = ACTION_REL[ActionType(action)]
            if not state.has_post_link(rel):
                return ActionType.WAIT.value, [
                    f"intended action {action} has no POST rel '{rel}' in the "
                    "observed state — WAIT (restraint)"
                ]
        return action, rationale

    def _intended_action(self, case, state, open_reqs, has_material):
        if state.is_terminal():
            return ActionType.WAIT.value, [
                "dispute is terminal — archive; WAIT rule applies"
            ]
        live_links = [l for l in state.links if l.method.upper() == "POST"]
        if not live_links:
            return ActionType.WAIT.value, [
                "no live action link — monitor; WAIT rule applies"
            ]
        if open_reqs:
            if has_material:
                req_type = open_reqs[0].evidence_type.value
                return ActionType.PROVIDE_EVIDENCE.value, [
                    f"open requirement {req_type} with posture "
                    f"{case.fulfillment_posture.value}: labeled material exists",
                    "SIMULATED_FULFILLMENT maps to the notes branch ONLY — "
                    "structured tracking fields are forbidden for synthetic values",
                ]
            return ActionType.SEND_MESSAGE.value, [
                f"open requirement {open_reqs[0].evidence_type.value} but posture "
                f"{case.fulfillment_posture.value} has no truthful material",
                "fabricating business proof is banned — honest communication + evidence request",
            ]
        if not case.seller_contacted:
            return ActionType.SEND_MESSAGE.value, [
                "no open requirement and no documented seller-buyer contact — "
                "send-message creates the first documented contact"
            ]
        return ActionType.WAIT.value, ["no open requirement; contact already documented — WAIT"]

    def _build_payload(self, action, case, state, open_reqs) -> dict:
        return build_action_payload(action, case, state, open_reqs)

    def _preconditions(self, action, state) -> list[str]:
        return action_preconditions(action, state)

    def _gaps(self, case, state, open_reqs, has_material) -> list[dict]:
        gaps = []
        for req in open_reqs:
            if has_material:
                gaps.append(
                    {
                        "gap": f"open requirement {req.evidence_type.value} — only labeled "
                        f"simulated material available",
                        "severity": "MEDIUM",
                    }
                )
            else:
                gaps.append(
                    {
                        "gap": f"open requirement {req.evidence_type.value} — posture "
                        f"{case.fulfillment_posture.value} provides no truthful material",
                        "severity": "HIGH",
                    }
                )
        if not open_reqs and not case.seller_contacted:
            gaps.append(
                {"gap": "no documented seller-buyer communication record", "severity": "MEDIUM"}
            )
        return gaps

    def _missing_evidence(self, case: CaseRecord) -> list[str]:
        # Verbatim from the frozen snapshot (evidence.missing + seller-side
        # missing_evidence); never re-derived or fabricated.
        return list(case.missing_evidence)

    def _safety_flags(self, case: CaseRecord) -> list[str]:
        flags = []
        if case.verification_level.value == "SCENARIO_DEFINED_OFFLINE_CONTENT":
            flags.append(
                "SCENARIO_DEFINED content — not a real PayPal dispute record; "
                "do not claim real observations"
            )
        if case.verification_level.value == "FROZEN_SANDBOX_E1_VERIFIED":
            flags.append("frozen verified trajectory — no further writes on this case")
        if case.fulfillment_posture.value in ("NONE", "SHIPPED_NO_TRACKING"):
            flags.append("fabrication of fulfillment evidence is forbidden")
        flags.append("AI output is STUB_DETERMINISTIC — not a real LLM inference")
        return flags

    def _plan_dict(self, case, state, action, rationale, open_reqs, has_material) -> dict:
        """S7 Plan-schema mirror (benchmark structural gate)."""
        return {
            "recommended_action": action,
            "rationale": rationale,
            "gaps": self._gaps(case, state, open_reqs, has_material),
            "alternatives": self._alternatives(action, open_reqs, has_material),
            "wait_rule_applies": action == ActionType.WAIT.value,
        }

    def _alternatives(self, action, open_reqs, has_material) -> list[str]:
        alts = []
        if action == ActionType.SEND_MESSAGE.value:
            if open_reqs and has_material:
                alts.append("provide-evidence (notes branch)")
            alts.append("WAIT (restraint)")
        elif action == ActionType.PROVIDE_EVIDENCE.value:
            alts.append("send-message (complementary documented contact)")
            alts.append("WAIT (post-write restraint)")
        else:
            alts.append("send-message / provide-evidence when preconditions are met")
        return alts
