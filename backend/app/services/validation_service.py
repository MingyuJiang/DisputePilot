"""Validation service — deterministic V1–V12 (dispute) / V13–V18 (refund) gate.

A refund proposal needs one extra input a dispute proposal does not: the
capture balance. That single read is performed here, through an injected
observer, and handed to the validators as a :class:`RefundContext`. The
validators themselves stay pure decision objects and never touch the network.
"""

from __future__ import annotations

from typing import Any, Callable

from ..adapters.case_state import CaseStateStore
from ..domain.enums import (
    ActorType,
    AuditEventType,
    ExecutionResult,
    ProposalState,
    ValidationStatus,
    action_family_of,
    ActionFamily,
)
from ..domain.errors import DomainError, NotFoundError
from ..domain.models import ActionProposal, AuditEvent, ValidationReport
from ..domain.policies import ValidationContext, validate_proposal
from ..domain.refund_policies import RefundContext
from ..infrastructure.repositories import (
    AnalysisRepository,
    AuditRepository,
    ExecutionRepository,
    ProposalRepository,
)
from .case_service import CaseService


def _new_report_id(proposal_id: str) -> str:
    """Unique per validation run (timestamp + random suffix) so repeated
    validations never collide on the append-only audit event id."""
    import secrets
    from datetime import datetime, timezone

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    return f"VR-{proposal_id}-{stamp}-{secrets.token_hex(3)}"


class ValidationService:
    def __init__(
        self,
        session,
        case_service: CaseService,
        state_store: CaseStateStore,
        *,
        capture_observer: Callable[[str], Any] | None = None,
    ):
        self.session = session
        self.case_service = case_service
        self.state_store = state_store
        self.capture_observer = capture_observer
        self.repo = ProposalRepository(session)
        self.analysis_repo = AnalysisRepository(session)
        self.audit = AuditRepository(session)

    def validate(self, proposal_id: str, actor_id: str = "validator") -> tuple[ActionProposal, ValidationReport]:
        proposal = self.repo.get(proposal_id)
        if proposal is None:
            raise NotFoundError(f"proposal {proposal_id!r} not found")
        case = self.case_service.get_case(proposal.case_id)
        state = self.case_service.get_state(proposal.case_id)
        ctx = ValidationContext(
            case=case,
            state=state,
            policy_version=proposal.policy_version,
            mode="offline_fixture",
            bound_snapshot_hash=proposal.snapshot_hash,
            decision_at=proposal.created_at,
            extra={"retry_audit": {"clean": True, "files": 0}},
        )
        if action_family_of(proposal.action_type) is ActionFamily.PAYMENT:
            ctx.extra["refund_context"] = self._refund_context(proposal, case)
            # Payment validation may have performed a Sandbox GET even though
            # the dispute validator context remains offline. Preserve that
            # observation basis without claiming a live read for fixture mode.
            from ..adapters.paypal.config import PayPalConfig
            ctx.extra["refund_observation_live"] = PayPalConfig.from_env().is_sandbox_mode
        # RC-1: the evidence-material rule needs the analysis the proposal was
        # built from. Supplying it here means the single-case path, the batch
        # path and every resubmission all see the same facts.
        ctx.extra["evidence_facts"] = self._grounded_facts(proposal)
        report = validate_proposal(proposal, ctx, report_id=_new_report_id(proposal_id))
        target = ProposalState.VALIDATED if report.passed else ProposalState.BLOCKED
        if proposal.state in (ProposalState.DRAFT, ProposalState.VALIDATED):
            # Re-validating an already-VALIDATED proposal (e.g. batch review
            # submission after the autopilot validated it) must not attempt
            # VALIDATED -> VALIDATED: the state is already the target, and the
            # fresh report is audited below either way.
            if proposal.state is not target:
                proposal = self.repo.transition(
                    proposal_id,
                    target,
                    validation_status=(
                        ValidationStatus.PASSED if report.passed else ValidationStatus.FAILED
                    ),
                )
        self.audit.append(
            AuditEvent(
                event_id=f"AUD-{report.report_id}",
                case_id=proposal.case_id,
                event_type=AuditEventType.VALIDATION_RECORDED.value,
                actor_type=ActorType.SYSTEM,
                actor_id=actor_id,
                payload=report.model_dump(mode="json"),
            )
        )
        self.session.commit()
        return proposal, report

    def _grounded_facts(self, proposal: ActionProposal) -> list:
        """Grounded facts of the analysis this proposal came from.

        Falls back to the newest analysis for the case when the proposal does
        not carry an analysis id (older rows). Returns ``[]`` rather than
        raising: a missing analysis must not turn into a spurious pass or a
        500 — V5 simply has no material claim to check.
        """
        try:
            analyses = self.analysis_repo.list_for_case(proposal.case_id)
        except Exception:  # repository fault must not break validation
            return []
        if not analyses:
            return []
        chosen = None
        for analysis in analyses:
            if getattr(analysis, "analysis_id", None) == proposal.analysis_id:
                chosen = analysis
                break
        if chosen is None:
            chosen = analyses[-1]
        return list(getattr(chosen, "grounded_facts", []) or [])

    # ------------------------------------------------------------------ refunds
    def _refund_context(self, proposal: ActionProposal, case) -> RefundContext:
        """Observe the capture + any locally-known un-settled refund.

        A failure is NOT an exception: it becomes a V13 failure with the reason,
        so the report says exactly why the refund could not be authorised.
        """
        from ..adapters.paypal.config import PayPalConfig
        from ..adapters.paypal.errors import PayPalError
        from ..adapters.paypal.payments import (
            CaptureParseError,
            capture_id_of_case,
        )

        pending = self._pending_refunds(case.case_id)
        merchant_id = PayPalConfig.from_env().merchant_id
        capture_id = capture_id_of_case(case)
        if not capture_id:
            return RefundContext(
                capture_error="case has no capture reference",
                pending_refund_ids=pending,
                expected_merchant_id=merchant_id,
            )
        if self.capture_observer is None:
            return RefundContext(
                capture_error="no PayPal Payments observer is configured",
                pending_refund_ids=pending,
                expected_merchant_id=merchant_id,
            )
        try:
            snapshot = self.capture_observer(capture_id)
        except PayPalError as exc:
            return RefundContext(
                capture_error=f"{exc.kind.value}: {exc.message}",
                pending_refund_ids=pending,
                expected_merchant_id=merchant_id,
            )
        except (DomainError, CaptureParseError) as exc:
            return RefundContext(
                capture_error=str(exc),
                pending_refund_ids=pending,
                expected_merchant_id=merchant_id,
            )
        return RefundContext(
            capture=snapshot,
            pending_refund_ids=pending,
            expected_merchant_id=merchant_id,
        )

    def _pending_refunds(self, case_id: str) -> list[str]:
        unsettled = (ExecutionResult.PENDING, ExecutionResult.UNVERIFIED)
        return [
            record.execution_id
            for record in ExecutionRepository(self.session).list_for_case(case_id)
            if record.result in unsettled
        ]

    def latest_report(self, proposal_id: str) -> ValidationReport | None:
        proposal = self.repo.get(proposal_id)
        if proposal is None:
            raise NotFoundError(f"proposal {proposal_id!r} not found")
        for event in reversed(self.audit.timeline(proposal.case_id)):
            if event.event_type == AuditEventType.VALIDATION_RECORDED.value:
                payload = event.payload
                if payload.get("proposal_id") == proposal_id:
                    return ValidationReport.model_validate(payload)
        return None
