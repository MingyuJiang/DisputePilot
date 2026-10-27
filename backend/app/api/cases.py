"""Case & evidence endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query

from ..adapters.paypal import PayPalConfig
from ..adapters.paypal.errors import PayPalError, PayPalErrorKind
from ..domain.enums import ActorRole, CaseWorkflowStatus
from ..domain.errors import DomainError
from ..domain.models import CaseRecord
from ..infrastructure.settings import settings
from ..security.authorization import (
    ACTOR_ID_HEADER_DESCRIPTION,
    ACTOR_ROLE_HEADER_DESCRIPTION,
    IDEMPOTENCY_KEY_HEADER_DESCRIPTION,
    require_role,
)
from ..schemas.case import (
    CaseImportOut,
    CaseOut,
    CaseStateUpdateOut,
    CaseSummaryOut,
    EvidenceOut,
    HealthOut,
    MoneyOut,
    NegativeSamplesOut,
)
from ..schemas.errors import (
    RESPONSES_AUTH,
    RESPONSES_NOT_FOUND,
    RESPONSES_REQUEST_INVALID,
    merge_responses,
)
from .deps import (
    case_service,
    evidence_service,
    idempotency,
    paypal_source_provider,
)

router = APIRouter(prefix="/api/v1", tags=["cases"])


class _PayPalImportFailure(DomainError):
    """Upstream read failure — explicit 503/502, never a fixture fallback."""

    code = "DOMAIN_ERROR"
    http_status = 503

    def __init__(self, error: PayPalError) -> None:
        super().__init__(f"PayPal Sandbox import failed: {error}")
        self.http_status = error.api_status
        self.details = error.to_public()


def _money_out(money) -> MoneyOut:
    return MoneyOut(value_minor=money.value_minor, currency=money.currency, display=money.display())


def _case_out(case: CaseRecord) -> CaseOut:
    from ..schemas.case import (
        AvailableActionOut,
        EvidenceRequirementOut,
        TransactionReferenceOut,
    )

    return CaseOut(
        case_id=case.case_id,
        scenario_id=case.scenario_id,
        dispute_id=case.dispute_id,
        family=case.family,
        reason=case.reason,
        status=case.status,
        dispute_status=case.dispute_status,
        lifecycle_stage=case.lifecycle_stage,
        amount=_money_out(case.amount),
        transaction_reference=TransactionReferenceOut(**case.transaction_reference.model_dump()),
        fulfillment_posture=case.fulfillment_posture,
        seller_contacted=case.seller_contacted,
        evidence_count=len(case.evidence),
        available_actions=[
            AvailableActionOut(rel=a.rel, method=a.method, basis=a.basis)
            for a in case.available_actions
        ],
        evidence_requirements=[
            EvidenceRequirementOut(
                evidence_type=r.evidence_type, source=r.source, open=r.open
            )
            for r in case.evidence_requirements
        ],
        missing_evidence=list(case.missing_evidence),
        provenance=case.provenance,
        verification_level=case.verification_level,
        case_version=case.case_version,
        snapshot_hash=case.snapshot_hash,
        live_status_note=case.live_status_note,
        created_at=case.created_at,
        updated_at=case.updated_at,
    )


def _evidence_out(ev) -> EvidenceOut:
    return EvidenceOut(
        evidence_id=ev.evidence_id,
        case_id=ev.case_id,
        evidence_type=ev.evidence_type,
        content=ev.content,
        source_type=ev.source_type,
        provenance=ev.provenance,
        verification_level=ev.verification_level,
        source_reference=ev.source_reference,
        observed_at=ev.observed_at,
        integrity_hash=ev.integrity_hash,
    )


@router.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    # execution_mode / network_access are free strings in the frozen contract;
    # the value vocabulary is defined by PAYPAL_INTERFACE_CONTRACT §1.
    return HealthOut(
        status="ok",
        service="disputepilot-agent-a",
        execution_mode=settings.execution_mode,
        network_access=settings.network_access,
        policy_version=settings.policy_version,
        note=settings.health_note(),
    )


@router.post(
    "/cases/import",
    response_model=CaseImportOut,
    responses=merge_responses(RESPONSES_AUTH, RESPONSES_REQUEST_INVALID),
)
def import_cases(
    idem: dict = Depends(idempotency),
    x_idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key", description=IDEMPOTENCY_KEY_HEADER_DESCRIPTION
    ),
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    x_actor_role: str | None = Header(default=None, description=ACTOR_ROLE_HEADER_DESCRIPTION),
    actor=Depends(require_role(ActorRole.SYSTEM)),
    cs=Depends(case_service),
    paypal_source=Depends(paypal_source_provider),
) -> CaseImportOut:
    # offline_replay keeps the frozen fixture import. paypal_sandbox reads
    # PayPal and NEVER falls back to fixtures: a read failure returns 503/502
    # with a typed error, so a success response always means "read from PayPal".

    def work() -> dict:
        config = PayPalConfig.from_env()
        if config.is_sandbox_mode:
            if paypal_source is None:
                raise _PayPalImportFailure(
                    PayPalError(
                        PayPalErrorKind.AUTH,
                        "PayPal Sandbox source is not available",
                        network_attempted=False,
                    )
                )
            try:
                report = paypal_source.sync(cs.session, cs.state_store)
            except PayPalError as exc:
                settings.paypal_last_error = (
                    f"{exc.kind.value}: {exc.message}"
                    + (f" (http_status={exc.http_status})" if exc.http_status else "")
                )
                raise _PayPalImportFailure(exc) from None
            settings.paypal_last_read_at = report.read_at
            settings.paypal_last_error = ""
            return CaseImportOut(
                imported=report.imported,
                skipped_duplicates=report.skipped,
                negative_samples_recognized=0,
                source_sha256=report.source_sha256,
                details=report.details,
            ).model_dump(mode="json")

        report = cs.import_fixtures(settings.case_snapshot_path)
        return CaseImportOut(
            imported=len(report.cases) - report.skipped_duplicates,
            skipped_duplicates=report.skipped_duplicates,
            negative_samples_recognized=len(report.negative_samples),
            source_sha256=report.source_sha256,
            details=report.warnings,
        ).model_dump(mode="json")

    return CaseImportOut(**idem.run(x_idempotency_key, "cases/import", work))


@router.get(
    "/cases",
    response_model=list[CaseSummaryOut],
    responses=RESPONSES_REQUEST_INVALID,
)
def list_cases(
    family: str | None = Query(default=None),
    cs=Depends(case_service),
) -> list[CaseSummaryOut]:
    cases = cs.list_cases()
    if family:
        cases = [c for c in cases if c.family.value == family.upper()]
    return [
        CaseSummaryOut(
            case_id=c.case_id,
            family=c.family,
            reason=c.reason,
            status=c.status,
            amount=_money_out(c.amount),
            fulfillment_posture=c.fulfillment_posture,
            provenance=c.provenance,
            verification_level=c.verification_level,
        )
        for c in cases
    ]


@router.get(
    "/cases/{case_id}",
    response_model=CaseOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def get_case(case_id: str, cs=Depends(case_service)) -> CaseOut:
    return _case_out(cs.get_case(case_id))


@router.get(
    "/cases/{case_id}/evidence",
    response_model=list[EvidenceOut],
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def list_evidence(case_id: str, es=Depends(evidence_service)) -> list[EvidenceOut]:
    return [_evidence_out(ev) for ev in es.list_evidence(case_id)]


@router.get(
    "/cases/{case_id}/evidence/{evidence_id}",
    response_model=EvidenceOut,
    responses=merge_responses(RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def get_evidence(case_id: str, evidence_id: str, es=Depends(evidence_service)) -> EvidenceOut:
    return _evidence_out(es.get_evidence(case_id, evidence_id))


@router.get("/negative-samples", response_model=NegativeSamplesOut)
def list_negative_samples(cs=Depends(case_service)) -> NegativeSamplesOut:
    samples = cs.negative_samples()
    return NegativeSamplesOut(
        count=len(samples),
        purpose="rejection/upgrade evaluation only — never executed",
        samples=samples,
    )


@router.post(
    "/cases/{case_id}/state",
    response_model=CaseStateUpdateOut,
    responses=merge_responses(RESPONSES_AUTH, RESPONSES_NOT_FOUND, RESPONSES_REQUEST_INVALID),
)
def update_case_state(
    case_id: str,
    changes: dict,
    note: str = "",
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    x_actor_role: str | None = Header(default=None, description=ACTOR_ROLE_HEADER_DESCRIPTION),
    actor=Depends(require_role(ActorRole.SYSTEM)),
    cs=Depends(case_service),
) -> CaseStateUpdateOut:
    """TEST/DEMO HOOK (SYSTEM role): simulate a PayPal-side state change so
    stale-approval behaviour can be exercised offline. Not a PayPal call."""
    state = cs.apply_state_update(case_id, changes, note)
    return CaseStateUpdateOut(
        case_id=case_id,
        state_version=state.state_version,
        state_hash=state.compute_state_hash(),
        warning="fixture state mutated for testing; approvals bound to the "
        "previous decision hash are now stale",
    )
