"""Payment (capture) endpoints — Payments v2, SYSTEM role, no contract surface.

``POST /api/v1/payments/captures/{capture_id}/import`` reads one capture and
upserts its payment case (``CAP-<capture_id>``). It is idempotent by
construction: a second import refreshes the observed money facts and never
duplicates the case.

The router is registered with ``include_in_schema=False``: contract v1.2 froze
without a payments path, so exposing it in the generated OpenAPI would create a
contract diff. The endpoint still exists and is exercised by the refund tests.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header

from ..adapters.paypal.errors import PayPalError
from ..domain.enums import ActorRole
from ..domain.errors import DomainError
from ..schemas.payment import (
    PaymentCaptureImportOut,
    PaymentCaptureStatusOut,
    PaymentMoneyOut,
)
from ..security.authorization import (
    ACTOR_ID_HEADER_DESCRIPTION,
    ACTOR_ROLE_HEADER_DESCRIPTION,
    get_actor,
    require_role,
)
from .deps import payment_service

router = APIRouter(prefix="/api/v1", tags=["payments"], include_in_schema=False)


class _CaptureImportFailure(DomainError):
    """Upstream read failure — explicit status, never a fabricated capture."""

    code = "DOMAIN_ERROR"
    http_status = 503

    def __init__(self, error: PayPalError) -> None:
        super().__init__(f"PayPal capture import failed: {error}")
        self.http_status = error.api_status
        self.details = error.to_public()


@router.post(
    "/payments/captures/{capture_id}/import",
    response_model=PaymentCaptureImportOut,
)
def import_capture(
    capture_id: str,
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    x_actor_role: str | None = Header(default=None, description=ACTOR_ROLE_HEADER_DESCRIPTION),
    actor=Depends(require_role(ActorRole.SYSTEM)),
    svc=Depends(payment_service),
) -> PaymentCaptureImportOut:
    """Import (or refresh) a capture as a payment case. SYSTEM only."""
    try:
        result = svc.import_capture(capture_id, actor_id=actor.actor_id)
    except PayPalError as exc:
        raise _CaptureImportFailure(exc) from None

    snapshot = result.snapshot
    currency = snapshot.currency
    return PaymentCaptureImportOut(
        case_id=result.case_id,
        capture_id=result.capture_id,
        capture_status=result.capture_status,
        amount=PaymentMoneyOut(value=snapshot.original_amount, currency_code=currency),
        total_refunded=PaymentMoneyOut(
            value=snapshot.total_refunded, currency_code=currency
        ),
        refundable_remaining=PaymentMoneyOut(
            value=snapshot.refundable_remaining, currency_code=currency
        ),
        inserted=result.inserted,
        refreshed=not result.inserted,
        read_at=result.read_at,
    )


@router.get(
    "/payments/captures/{capture_id}",
    response_model=PaymentCaptureStatusOut,
)
def get_capture_status(
    capture_id: str,
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    x_actor_role: str | None = Header(default=None, description=ACTOR_ROLE_HEADER_DESCRIPTION),
    actor=Depends(get_actor),
    svc=Depends(payment_service),
) -> PaymentCaptureStatusOut:
    """Read-only capture balance. REPLAY reads the synthetic fixture only."""
    snapshot, source = svc.capture_status(capture_id)
    return PaymentCaptureStatusOut(
        capture_id=snapshot.capture_id,
        status=snapshot.status,
        original_amount=snapshot.original_amount,
        total_refunded=snapshot.total_refunded,
        refundable_remaining=snapshot.refundable_remaining,
        currency_code=snapshot.currency,
        source=source,
    )
