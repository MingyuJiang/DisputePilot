"""Payment (capture) API schemas.

These models are NOT part of the frozen v1.2 contract yet: the payments import
path is registered with ``include_in_schema=False`` so the published OpenAPI
stays byte-identical to ``contracts/v1``. The shapes below are the runtime
payloads only.
"""

from __future__ import annotations

from pydantic import BaseModel

PAYMENT_IMPORT_WARNING = (
    "CAPTURE OBSERVATION ONLY — a refund is a separate, separately-approved "
    "payment action and never resolves or closes a dispute"
)


class PaymentMoneyOut(BaseModel):
    value: str
    currency_code: str


class PaymentCaptureImportOut(BaseModel):
    case_id: str
    capture_id: str
    capture_status: str
    amount: PaymentMoneyOut
    total_refunded: PaymentMoneyOut
    refundable_remaining: PaymentMoneyOut
    inserted: bool
    refreshed: bool
    read_at: str
    source: str = "PAYPAL_PAYMENTS_CAPTURE"
    provenance: str = "PAYPAL_API_OBSERVED"
    warning: str = PAYMENT_IMPORT_WARNING


class PaymentCaptureStatusOut(BaseModel):
    """Read-only capture balance. Amounts are exact decimal strings."""

    capture_id: str
    status: str
    original_amount: str
    total_refunded: str
    refundable_remaining: str
    currency_code: str
    source: str
