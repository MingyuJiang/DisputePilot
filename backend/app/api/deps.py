"""API dependencies — session, service container, idempotency helper."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable, Generator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

if TYPE_CHECKING:  # annotation only — keeps the FastAPI factory import-free
    from ..services.autopilot_service import AutopilotService

from ..adapters.ai_provider import AIProvider, DeterministicStubProvider
from ..adapters.case_state import CaseStateStore
from ..adapters.frozen_ai import FrozenReplayProvider
from ..adapters.local_llm import LLMConfig, LocalLLMProvider
from ..adapters.replay_gateway import ReplayExecutionGateway
from ..infrastructure.database import get_session_factory
from ..infrastructure.settings import settings
from ..services.audit_service import AuditService
from ..services.analysis_service import AnalysisService
from ..services.approval_service import ApprovalService
from ..services.case_service import CaseService
from ..services.execution_service import ExecutionService
from ..services.evidence_service import EvidenceService
from ..services.planning_service import PlanningService
from ..services.payment_service import PaymentCaseService
from ..services.validation_service import ValidationService


@dataclass
class ServiceContainer:
    state_store: CaseStateStore
    ai_provider: AIProvider
    gateway: ReplayExecutionGateway
    # Tests/operators may inject a MockTransport-backed factory; None means the
    # service builds the real sandbox gateway lazily (sandbox mode only).
    sandbox_gateway_factory: Callable[[Any], Any] | None = None
    # Payments (capture/refund) client factory — same injection seam, separate
    # from the dispute gateway so neither can be used by accident.
    payment_client_factory: Callable[[Any], Any] | None = None
    refund_gateway_factory: Callable[[Any], Any] | None = None


def build_provider() -> AIProvider:
    """Provider factory — ``stub`` (default), ``ollama_local`` or ``frozen``.

    Read from the environment on every container build so tests and operators
    can switch modes without re-importing the settings singleton. There is no
    automatic fallback: an ``ollama_local`` failure surfaces as HTTP 503, and
    ``frozen`` never falls back to the stub.
    """
    config = LLMConfig.from_env()
    if config.is_local_llm:
        return LocalLLMProvider(config)
    if config.is_frozen:
        return FrozenReplayProvider()
    return DeterministicStubProvider()


def build_container() -> ServiceContainer:
    return ServiceContainer(
        state_store=CaseStateStore(settings.replay_states_path),
        ai_provider=build_provider(),
        gateway=ReplayExecutionGateway(),
    )


def get_session() -> Generator[Session, None, None]:
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()


def get_container(request: Request) -> ServiceContainer:
    return request.app.state.container


def case_service(
    session: Session = Depends(get_session),
    container: ServiceContainer = Depends(get_container),
) -> CaseService:
    return CaseService(session, container.state_store)


def evidence_service(cs: CaseService = Depends(case_service)) -> EvidenceService:
    return EvidenceService(cs)


def analysis_service(
    session: Session = Depends(get_session),
    container: ServiceContainer = Depends(get_container),
    cs: CaseService = Depends(case_service),
) -> AnalysisService:
    return AnalysisService(session, cs, container.ai_provider)


def planning_service(
    session: Session = Depends(get_session),
    container: ServiceContainer = Depends(get_container),
    cs: CaseService = Depends(case_service),
) -> PlanningService:
    return PlanningService(session, cs, container.ai_provider)


def validation_service(
    session: Session = Depends(get_session),
    container: ServiceContainer = Depends(get_container),
    cs: CaseService = Depends(case_service),
    plan: PlanningService = Depends(planning_service),
) -> ValidationService:
    # The observer performs the single capture read a refund proposal needs.
    # It is a bound method of a lazily-constructing service: no HTTP client is
    # built unless a PAYMENT proposal is actually validated.
    payments = PaymentCaseService(
        session, cs, plan, client_factory=container.payment_client_factory
    )
    return ValidationService(
        session,
        cs,
        container.state_store,
        capture_observer=payments.observe_capture,
    )


def payment_service(
    session: Session = Depends(get_session),
    container: ServiceContainer = Depends(get_container),
    cs: CaseService = Depends(case_service),
    plan: PlanningService = Depends(planning_service),
) -> PaymentCaseService:
    return PaymentCaseService(
        session, cs, plan, client_factory=container.payment_client_factory
    )


def approval_service(
    session: Session = Depends(get_session),
    container: ServiceContainer = Depends(get_container),
    cs: CaseService = Depends(case_service),
    plan: PlanningService = Depends(planning_service),
) -> ApprovalService:
    # Submission runs the validator, so a refund submission needs the same
    # single capture read a refund draft does.
    payments = PaymentCaseService(
        session, cs, plan, client_factory=container.payment_client_factory
    )
    return ApprovalService(
        session,
        cs,
        container.state_store,
        capture_observer=payments.observe_capture,
    )


def execution_service(
    session: Session = Depends(get_session),
    container: ServiceContainer = Depends(get_container),
    cs: CaseService = Depends(case_service),
) -> ExecutionService:
    return ExecutionService(
        session,
        cs,
        container.state_store,
        container.gateway,
        sandbox_gateway_factory=container.sandbox_gateway_factory,
        refund_gateway_factory=container.refund_gateway_factory,
    )


def autopilot_service(
    session: Session = Depends(get_session),
    container: ServiceContainer = Depends(get_container),
    cs: CaseService = Depends(case_service),
    analysis: AnalysisService = Depends(analysis_service),
    plan: PlanningService = Depends(planning_service),
) -> "AutopilotService":
    """Batch triage over the existing services — never over ExecutionService."""
    from ..adapters.paypal.config import PayPalConfig
    from ..services.approval_service import ApprovalService
    from ..services.autopilot_service import AutopilotService, offline_only_guard
    from ..services.payment_service import PaymentCaseService
    from ..services.validation_service import ValidationService

    # A refund candidate needs the same single capture read the single-case
    # path uses; the observer is a bound method, so no HTTP client exists
    # unless a payment proposal is actually validated.
    payments = PaymentCaseService(
        session, cs, plan, client_factory=container.payment_client_factory
    )
    validation = ValidationService(
        session,
        cs,
        container.state_store,
        capture_observer=payments.observe_capture,
    )
    approvals = ApprovalService(
        session,
        cs,
        container.state_store,
        capture_observer=payments.observe_capture,
    )
    config = PayPalConfig.from_env()
    return AutopilotService(
        session,
        cs,
        analysis,
        plan,
        validation,
        approval_service=approvals,
        state_store=container.state_store,
        mode_guard=offline_only_guard(
            settings.network_access,
            config.execution_mode,
            config.is_sandbox_mode,
        ),
    )


def paypal_source_provider() -> Any:
    """Sandbox-mode case source; ``None`` keeps the offline fixture path.

    A FastAPI dependency (overridable in tests) rather than a module global so
    no HTTP client is built until an import actually runs.
    """
    from ..adapters.paypal.config import PayPalConfig

    config = PayPalConfig.from_env()
    if not config.is_sandbox_mode:
        return None
    from ..adapters.paypal.source import PayPalCaseSource

    return PayPalCaseSource(config)


def audit_service(
    session: Session = Depends(get_session), cs: CaseService = Depends(case_service)
) -> AuditService:
    return AuditService(session, cs)


@dataclass
class IdempotencyHelper:
    """Repeat-request protection for state-changing POSTs."""

    session: Session

    def run(self, key: str | None, endpoint: str, work: Callable[[], Any]) -> Any:
        from ..infrastructure.repositories import IdempotencyRepository

        if not key:
            return work()
        repo = IdempotencyRepository(self.session)
        existing = repo.get(f"{endpoint}:{key}")
        if existing is not None:
            import json

            return json.loads(existing.response_json)
        result = work()
        import json

        repo.put(f"{endpoint}:{key}", endpoint, json.dumps(result, default=str))
        self.session.commit()
        return result


def idempotency(session: Session = Depends(get_session)) -> IdempotencyHelper:
    return IdempotencyHelper(session)
