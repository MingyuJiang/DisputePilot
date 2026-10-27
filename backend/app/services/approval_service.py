"""Approval service — specialist submit + manager decision (state machine)."""

from __future__ import annotations

from ..adapters.case_state import CaseStateStore
from ..domain.enums import (
    ActorRole,
    ActorType,
    ApprovalDecision,
    AuditEventType,
    CaseWorkflowStatus,
    ProposalState,
    ValidationStatus,
)
from ..domain.errors import ConflictError, ForbiddenError, NotFoundError, ValidationFailedError
from ..domain.models import ActionProposal, Approval, AuditEvent
from ..domain.autopilot import SubmissionOriginType
from ..domain.models import utc_now_iso
from ..infrastructure.repositories import (
    ApprovalRepository,
    AuditRepository,
    AutopilotSubmissionRepository,
    ProposalRepository,
)
from ..infrastructure.settings import settings
from .case_service import CaseService


class ApprovalService:
    def __init__(
        self,
        session,
        case_service: CaseService,
        state_store: CaseStateStore,
        *,
        capture_observer=None,
    ):
        self.session = session
        self.case_service = case_service
        self.state_store = state_store
        # Refund proposals (PAYMENT family) need one capture read at submit
        # time; dispute proposals never use this.
        self.capture_observer = capture_observer
        self.proposals = ProposalRepository(session)
        self.approvals = ApprovalRepository(session)
        self.audit = AuditRepository(session)
        # Reverse traceability: approval -> batch item -> batch/run.
        self.submissions = AutopilotSubmissionRepository(session)

    # ---------------------------------------------------------------- submit
    def submit(self, proposal_id: str, actor_id: str) -> tuple[ActionProposal, Approval]:
        """Specialist submits a validated proposal for manager approval.

        Runs the deterministic validator first: a proposal that fails V1–V12
        can never reach PENDING_APPROVAL.
        """
        from .validation_service import ValidationService

        current = self.proposals.get(proposal_id)
        if current is None:
            raise NotFoundError(f"proposal {proposal_id!r} not found")
        if current.state == ProposalState.REPLAY_EXECUTED:
            raise ConflictError("proposal already replayed; resubmission is not permitted")
        if current.state not in (ProposalState.DRAFT, ProposalState.VALIDATED,
                                 ProposalState.PENDING_APPROVAL):
            raise ConflictError(
                f"cannot submit proposal in state {current.state.value}"
            )
        proposal, report = ValidationService(
            self.session,
            self.case_service,
            self.state_store,
            capture_observer=self.capture_observer,
        ).validate(proposal_id, actor_id=actor_id)
        if not report.passed:
            raise ValidationFailedError(
                f"proposal blocked by deterministic validator: {report.blocked_reasons}",
                report=report.model_dump(mode="json"),
            )
        if proposal.state == ProposalState.REPLAY_EXECUTED:
            raise ConflictError("proposal already replayed; resubmission is not permitted")
        if proposal.state not in (ProposalState.VALIDATED, ProposalState.PENDING_APPROVAL):
            raise ConflictError(
                f"cannot submit proposal in state {proposal.state.value}"
            )
        approval = self.approvals.get_for_proposal(proposal_id)
        if approval is not None and approval.decision == ApprovalDecision.PENDING:
            return proposal, approval  # idempotent resubmission
        if proposal.state != ProposalState.PENDING_APPROVAL:
            proposal = self.proposals.transition(
                proposal_id, ProposalState.PENDING_APPROVAL
            )
        approval = Approval(
            approval_id=f"APR-{proposal_id}",
            proposal_id=proposal_id,
            # Creation time is stamped once, here, and persisted; reads never
            # regenerate it (see infrastructure/migrations.py).
            created_at=utc_now_iso(),
            created_at_source="CREATED",
            action_payload_hash=proposal.payload_hash,
            case_snapshot_hash=proposal.snapshot_hash,
            policy_version=proposal.policy_version,
            decision=ApprovalDecision.PENDING,
            reason="",
            actor_id=actor_id,
            actor_role=ActorRole.SPECIALIST,
        )
        self.approvals.add(approval)
        self.case_service.set_workflow_status(
            proposal.case_id, CaseWorkflowStatus.PENDING_APPROVAL
        )
        self.audit.append(
            AuditEvent(
                event_id=f"AUD-{approval.approval_id}-SUBMITTED",
                case_id=proposal.case_id,
                event_type=AuditEventType.PROPOSAL_SUBMITTED.value,
                actor_type=ActorType.HUMAN,
                actor_id=actor_id,
                payload={
                    "proposal_id": proposal_id,
                    "approval_id": approval.approval_id,
                    "validation_report_id": report.report_id,
                },
            )
        )
        self.session.commit()
        return proposal, approval

    # ------------------------------------------------------------- evidence
    def _assert_evidence_available(self, approval: Approval) -> None:
        """Raise VALIDATION_FAILED (422) when the evidence material is absent."""
        from ..domain.evidence_policy import EVIDENCE_MATERIAL_MISSING, evaluate_evidence
        from ..infrastructure.repositories import AnalysisRepository

        proposal = self.proposals.get(approval.proposal_id)
        if proposal is None:
            raise NotFoundError(f"proposal {approval.proposal_id!r} not found")
        try:
            analyses = AnalysisRepository(self.session).list_for_case(proposal.case_id)
        except Exception:
            analyses = []
        facts = []
        for analysis in analyses:
            if getattr(analysis, "analysis_id", None) == proposal.analysis_id:
                facts = list(getattr(analysis, "grounded_facts", []) or [])
                break
        else:
            if analyses:
                facts = list(getattr(analyses[-1], "grounded_facts", []) or [])

        verdict = evaluate_evidence(
            action_type=proposal.action_type,
            action_payload=proposal.action_payload,
            grounded_facts=facts,
        )
        if not verdict.blocked:
            return
        raise ValidationFailedError(
            f"proposal blocked by {EVIDENCE_MATERIAL_MISSING}: {'; '.join(verdict.missing)}",
            report={
                "passed": False,
                "blocked_reasons": [f"{EVIDENCE_MATERIAL_MISSING}: {m}" for m in verdict.missing],
                "reason_code": EVIDENCE_MATERIAL_MISSING,
                "merchant_message": verdict.merchant_message,
                "evidence": verdict.as_dict(),
            },
        )

    # ---------------------------------------------------------------- decide
    def decide(
        self, approval_id: str, decision: ApprovalDecision, reason: str, actor_id: str
    ) -> tuple[ActionProposal, Approval]:
        """Manager decision (exactly once, role-checked by the API layer)."""
        approval = self.approvals.get(approval_id)
        if approval is None:
            raise NotFoundError(f"approval {approval_id!r} not found")
        if approval.decision != ApprovalDecision.PENDING:
            raise ConflictError(
                f"approval already decided: {approval.decision.value}"
            )
        # RC-1: approving is the last human gate before execution, so the same
        # evidence rule runs here too. A proposal created before the rule existed
        # (or through an older client) cannot be approved into an executable
        # state. Only APPROVED is gated: rejecting never needs evidence.
        if decision == ApprovalDecision.APPROVED:
            self._assert_evidence_available(approval)

        decided = self.approvals.decide(
            approval_id, decision, reason, actor_id, ActorRole.MANAGER
        )
        if decided is None:
            raise ConflictError("approval already decided (concurrent decision)")
        proposal = self.proposals.get(approval.proposal_id)
        if proposal is None:
            raise NotFoundError(f"proposal {approval.proposal_id!r} not found")
        target = (
            ProposalState.APPROVED
            if decision == ApprovalDecision.APPROVED
            else ProposalState.REJECTED
        )
        proposal = self.proposals.transition(
            proposal.proposal_id,
            target,
            execution_authorized=(decision == ApprovalDecision.APPROVED),
        )
        self.case_service.set_workflow_status(
            proposal.case_id,
            CaseWorkflowStatus.APPROVED
            if decision == ApprovalDecision.APPROVED
            else CaseWorkflowStatus.REJECTED,
        )
        self.audit.append(
            AuditEvent(
                event_id=f"AUD-{approval_id}-DECIDED",
                case_id=proposal.case_id,
                event_type=AuditEventType.APPROVAL_DECIDED.value,
                actor_type=ActorType.HUMAN,
                actor_id=actor_id,
                payload={
                    "approval_id": approval_id,
                    "proposal_id": proposal.proposal_id,
                    "decision": decision.value,
                    "reason": reason,
                    "action_payload_hash": approval.action_payload_hash,
                    "case_snapshot_hash": approval.case_snapshot_hash,
                    "policy_version": approval.policy_version,
                },
            )
        )
        self.session.commit()
        return proposal, decided

    # ------------------------------------------------------------------- read
    def list_approvals(self) -> list[Approval]:
        return self.approvals.list()

    def get_approval(self, approval_id: str) -> Approval:
        approval = self.approvals.get(approval_id)
        if approval is None:
            raise NotFoundError(f"approval {approval_id!r} not found")
        return approval

    def approval_for_proposal(self, proposal_id: str) -> Approval | None:
        return self.approvals.get_for_proposal(proposal_id)

    # -------------------------------------------------------------- provenance
    def submission_origin(self, approval_id: str) -> dict:
        """Read-only provenance of one approval.

        The link is resolved through ``autopilot_submission_items.approval_id``
        (a stored column), never from the approval id's string shape. An
        approval with no batch item is reported as SINGLE_SUBMISSION with null
        batch fields — the absence is described, not filled in.
        """
        approval = self.get_approval(approval_id)
        proposal = self.proposals.get(approval.proposal_id)
        origin = {
            "approval_id": approval.approval_id,
            "proposal_id": approval.proposal_id,
            "case_id": proposal.case_id if proposal else None,
            "approval_decision": approval.decision,
            "approval_actor_id": approval.actor_id,
            "proposal_state": proposal.state if proposal else None,
        }

        found = self.submissions.find_origin_for_approval(approval.approval_id)
        if found is None:
            origin.update(
                {
                    "source_type": SubmissionOriginType.SINGLE_SUBMISSION.value,
                    "approval_created_at": approval.created_at,
                    "approval_created_at_source": approval.created_at_source,
                    "notes": [
                        "no submission batch records this approval; it was "
                        "submitted through the single-case path or predates "
                        "batch recording"
                    ],
                }
            )
            return origin

        item, batch = found
        origin.update(
            {
                "source_type": SubmissionOriginType.AUTOPILOT_BATCH.value,
                "case_id": item["case_id"],
                "submission_batch_id": batch["submission_batch_id"],
                "run_id": batch["run_id"],
                "validation_report_id": item["validation_report_id"],
                "validation_passed": item["validation_passed"],
                "reason_code": item["reason_code"],
                "submission_status": item["status"],
                "submitted_at": item["created_at"],
                "approval_created_at": approval.created_at,
                "approval_created_at_source": approval.created_at_source,
                "notes": list(item["reasons"][:2]),
            }
        )
        return origin
