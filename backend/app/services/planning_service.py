"""Planning service — creates ActionProposal drafts.

Two paths:
- ``generate``: the AI provider (stub) proposes from the latest analysis;
- ``create_draft``: a client-supplied draft (Agent B demo / negative tests).

Payloads are schema-checked (V7) at submission time, not here: drafts are
allowed to be imperfect, but nothing unvalidated can ever be executed.
"""

from __future__ import annotations

from ..adapters.ai_provider import AIProvider
from ..domain.enums import AuditEventType, ActorType, CaseWorkflowStatus, ProposalState
from ..domain.errors import NotFoundError, ValidationFailedError
from ..domain.models import ActionProposal, AIAnalysis, AuditEvent
from ..domain.policies import decision_hash
from ..infrastructure.repositories import AuditRepository, ProposalRepository
from ..infrastructure.settings import settings
from .case_service import CaseService
from .payment_planning import build_payment_proposal, is_payment_case


class PlanningService:
    def __init__(self, session, case_service: CaseService, provider: AIProvider):
        self.session = session
        self.case_service = case_service
        self.provider = provider
        self.repo = ProposalRepository(session)
        self.audit = AuditRepository(session)

    # ------------------------------------------------------------- AI propose
    def generate(self, case_id: str, actor_id: str = "ai-stub") -> list[ActionProposal]:
        case = self.case_service.get_case(case_id)
        state = self.case_service.get_state(case_id)
        analysis = self._latest_analysis(case_id)
        # A payment case may only yield a capture refund or restraint — never a
        # dispute action (provide-evidence / send-message / accept-claim).
        if is_payment_case(case):
            return self._generate_payment(case, state, analysis, actor_id)
        proposals = self.provider.plan(case, state, analysis)
        created = []
        for proposal in proposals:
            existing = self.repo.get(proposal.proposal_id)
            if existing is not None:
                created.append(existing)
                continue
            self.repo.add(proposal)
            self._audit_created(proposal, actor_id, analysis)
            created.append(proposal)
        self.case_service.set_workflow_status(case_id, CaseWorkflowStatus.PROPOSED)
        self.session.commit()
        return created

    def _generate_payment(
        self, case, state, analysis, actor_id: str
    ) -> list[ActionProposal]:
        proposal = build_payment_proposal(case, state, analysis)
        created: list[ActionProposal] = []
        if proposal is not None:
            existing = self.repo.get(proposal.proposal_id)
            if existing is not None:
                created.append(existing)
            else:
                self.repo.add(proposal)
                self._audit_created(proposal, actor_id, analysis)
                created.append(proposal)
        if created:
            self.case_service.set_workflow_status(
                case.case_id, CaseWorkflowStatus.PROPOSED
            )
        self.session.commit()
        return created

    # ---------------------------------------------------------- client drafts
    def create_draft(
        self,
        case_id: str,
        analysis_id: str,
        action_type: str,
        action_payload: dict,
        rationale: list[str] | None = None,
        required_evidence: list[str] | None = None,
        expected_preconditions: list[str] | None = None,
        evidence_ids: list[str] | None = None,
        actor_id: str = "client",
    ) -> ActionProposal:
        case = self.case_service.get_case(case_id)
        analysis = self._require_analysis(case_id, analysis_id)
        # evidence ids must exist on the case (grounding discipline)
        known = {ev.evidence_id for ev in case.evidence}
        unknown = [e for e in (evidence_ids or []) if e not in known]
        if unknown:
            raise ValidationFailedError(
                f"evidence_ids not found on case {case_id}: {unknown}"
            )
        state = self.case_service.get_state(case_id)
        proposal = ActionProposal(
            proposal_id=self._draft_id(case_id, action_type, action_payload),
            case_id=case_id,
            analysis_id=analysis.analysis_id,
            action_type=action_type,
            action_payload=action_payload,
            expected_preconditions=expected_preconditions or [],
            required_evidence=required_evidence or [],
            rationale=rationale or [],
            evidence_ids=evidence_ids or [],
            risk_level=self._risk(action_type),
            validation_status="NOT_RUN",
            state=ProposalState.DRAFT,
            snapshot_hash=decision_hash(case, state),
            policy_version=settings.policy_version,
        )
        proposal.bind_hashes(settings.policy_version)
        existing = self.repo.get(proposal.proposal_id)
        if existing is not None:
            return existing
        self.repo.add(proposal)
        self._audit_created(proposal, actor_id, analysis)
        self.case_service.set_workflow_status(case_id, CaseWorkflowStatus.PROPOSED)
        self.session.commit()
        return proposal

    # ------------------------------------------------------------------ helpers
    def _latest_analysis(self, case_id: str) -> AIAnalysis:
        return self._require_analysis(case_id, None)

    def _require_analysis(self, case_id: str, analysis_id: str | None) -> AIAnalysis:
        from ..infrastructure.repositories import AnalysisRepository

        analyses = AnalysisRepository(self.session).list_for_case(case_id)
        if not analyses:
            raise NotFoundError(
                f"no analysis for case {case_id!r}; create one before proposing"
            )
        if analysis_id is None:
            return analyses[-1]
        for a in analyses:
            if a.analysis_id == analysis_id:
                return a
        raise NotFoundError(f"analysis {analysis_id!r} not found for case {case_id!r}")

    @staticmethod
    def _risk(action_type: str):
        from ..domain.models import default_risk_for

        return default_risk_for(action_type)

    @staticmethod
    def _draft_id(case_id: str, action_type: str, payload: dict) -> str:
        from ..domain.models import content_hash

        digest = content_hash(
            {"case": case_id, "action": action_type, "payload": payload}
        )[:12]
        return f"PRP-{case_id}-{action_type}-{digest}"

    def _audit_created(
        self, proposal: ActionProposal, actor_id: str, analysis: AIAnalysis | None = None
    ) -> None:
        self.audit.append(
            AuditEvent(
                event_id=f"AUD-{proposal.proposal_id}-CREATED",
                case_id=proposal.case_id,
                event_type=AuditEventType.PROPOSAL_CREATED.value,
                actor_type=ActorType.AI if actor_id.startswith("ai") else ActorType.HUMAN,
                actor_id=actor_id,
                payload={
                    "proposal_id": proposal.proposal_id,
                    "action_type": proposal.action_type,
                    "payload_hash": proposal.payload_hash,
                    "snapshot_hash": proposal.snapshot_hash,
                    "risk_level": proposal.risk_level.value,
                    "analysis_mode": (
                        analysis.analysis_mode.value
                        if analysis is not None
                        else "UNKNOWN"
                    ),
                    "model_provider": (
                        analysis.model_provider if analysis is not None else "unknown"
                    ),
                    "model_name": analysis.model_name if analysis is not None else "unknown",
                },
            )
        )
