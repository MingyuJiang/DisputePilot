"""PayPal Payments v2 — capture / refund normalization (pure, no HTTP).

Everything here is derived from one observed response object. Nothing is
inferred and no amount is rounded: capture money is kept in integer minor
units and rendered back to an exact ``"0.00"`` string.

Frozen vocabulary (observed in the sandbox and documented by PayPal):

- capture status: ``COMPLETED`` / ``PARTIALLY_REFUNDED`` are refundable;
  ``REFUNDED`` / ``PENDING`` / ``DECLINED`` / ``FAILED`` are not.
- refund status: ``COMPLETED`` (settled), ``PENDING`` (accepted, not settled),
  ``FAILED`` / ``CANCELLED`` (will not settle).
- a refund is a PAYMENT event. It never accepts a claim, closes a dispute or
  implies that the buyer accepted anything.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

CAPTURE_ID_PREFIX = "CAP-"

# Offline demo namespace: the synthetic capture ``DEMO-CAP-<n>`` is presented
# to the demo as payment case ``CAP-DEMO-<n>`` (the pair named in the demo
# script). Real capture ids keep the plain ``CAP-<capture_id>`` rule.
DEMO_CAPTURE_ID_PREFIX = "DEMO-CAP-"
DEMO_CASE_ID_PREFIX = "CAP-DEMO-"

REFUNDABLE_CAPTURE_STATUSES = frozenset({"COMPLETED", "PARTIALLY_REFUNDED"})
FULLY_REFUNDED_CAPTURE_STATUS = "REFUNDED"
REFUND_STATUS_COMPLETED = "COMPLETED"
REFUND_STATUS_PENDING = "PENDING"
REFUND_STATUS_FAILED = "FAILED"
REFUND_STATUS_CANCELLED = "CANCELLED"

# ``refunds[]`` is not part of the documented capture object, so any array a
# response happens to expose is treated as an unverified hint only.
CAPTURE_REFUNDS_KEY = "refunds"


class CaptureParseError(ValueError):
    """The response cannot support a refund decision (missing/invalid fields)."""


# --------------------------------------------------------------------------- money
def to_minor(value: Any) -> int:
    """Exact decimal string → integer minor units.

    Raises :class:`CaptureParseError` for anything that is not a finite,
    non-negative value with at most two fraction digits. No rounding happens:
    ``"4.005"`` is an error, not ``4.01``.
    """
    text = str(value).strip()
    if not text:
        raise CaptureParseError("amount value is empty")
    try:
        parsed = Decimal(text)
    except InvalidOperation:
        raise CaptureParseError(f"amount value {text!r} is not a decimal") from None
    if not parsed.is_finite():
        raise CaptureParseError(f"amount value {text!r} is not finite")
    if parsed < 0:
        raise CaptureParseError(f"amount value {text!r} is negative")
    exponent = parsed.as_tuple().exponent
    if isinstance(exponent, int) and exponent < -2:
        raise CaptureParseError(
            f"amount value {text!r} has more than 2 decimal places"
        )
    return int(parsed * 100)


def from_minor(minor: int) -> str:
    """Integer minor units → exact ``"12.34"`` (no float arithmetic)."""
    sign = "-" if minor < 0 else ""
    minor = abs(int(minor))
    return f"{sign}{minor // 100}.{minor % 100:02d}"


def _amount_block(raw: Any, what: str) -> tuple[int, str]:
    if not isinstance(raw, dict):
        raise CaptureParseError(f"{what} is missing")
    if raw.get("value") in (None, ""):
        raise CaptureParseError(f"{what}.value is missing")
    currency = str(raw.get("currency_code") or "").strip().upper()
    if len(currency) != 3:
        raise CaptureParseError(f"{what}.currency_code is missing or invalid")
    return to_minor(raw.get("value")), currency


# ----------------------------------------------------------------------- capture
@dataclass(frozen=True)
class CaptureSnapshot:
    """One observed capture balance. Frozen: it is also the approval anchor."""

    capture_id: str
    status: str
    currency: str
    original_minor: int
    refunded_minor: int
    merchant_id: str | None = None
    raw_sha256: str = ""
    warnings: tuple[str, ...] = field(default_factory=tuple)

    @property
    def remaining_minor(self) -> int:
        return self.original_minor - self.refunded_minor

    @property
    def original_amount(self) -> str:
        return from_minor(self.original_minor)

    @property
    def total_refunded(self) -> str:
        return from_minor(self.refunded_minor)

    @property
    def refundable_remaining(self) -> str:
        return from_minor(self.remaining_minor)

    @property
    def is_refundable_status(self) -> bool:
        return self.status in REFUNDABLE_CAPTURE_STATUSES

    def to_payload(self) -> dict[str, Any]:
        """The server-authoritative block written into ``action_payload``."""
        return {
            "capture_id": self.capture_id,
            "status": self.status,
            "original_amount": self.original_amount,
            "total_refunded": self.total_refunded,
            "refundable_remaining": self.refundable_remaining,
            "currency_code": self.currency,
        }

    @classmethod
    def from_payload(cls, raw: Any) -> "CaptureSnapshot | None":
        """Rebuild a snapshot from a proposal payload (None when absent/bad)."""
        if not isinstance(raw, dict):
            return None
        try:
            return cls(
                capture_id=str(raw.get("capture_id") or ""),
                status=str(raw.get("status") or "").upper(),
                currency=str(raw.get("currency_code") or "").upper(),
                original_minor=to_minor(raw.get("original_amount")),
                refunded_minor=to_minor(raw.get("total_refunded")),
            )
        except (CaptureParseError, TypeError, ValueError):
            return None


def _merchant_id(raw: dict[str, Any]) -> str | None:
    """Only an explicitly declared seller/payee identity counts."""
    for block_name in ("payee", "seller"):
        block = raw.get(block_name)
        if isinstance(block, dict):
            value = str(block.get("merchant_id") or "").strip()
            if value:
                return value
    value = str(raw.get("merchant_id") or "").strip()
    return value or None


def capture_snapshot(raw: Any) -> CaptureSnapshot:
    """Map one ``GET /v2/payments/captures`` response.

    Raises :class:`CaptureParseError` when the payload cannot support a refund
    decision (no id, no amount, no currency).
    """
    if not isinstance(raw, dict):
        raise CaptureParseError("capture payload is not an object")
    capture_id = str(raw.get("id") or "").strip()
    if not capture_id:
        raise CaptureParseError("capture payload has no id")

    original_minor, currency = _amount_block(raw.get("amount"), "capture.amount")
    status = str(raw.get("status") or "").strip().upper() or "UNKNOWN"

    warnings: list[str] = []
    refunded_minor = 0
    breakdown = raw.get("seller_receivable_breakdown")
    refunded_block = (
        breakdown.get("total_refunded_amount") if isinstance(breakdown, dict) else None
    )
    if isinstance(refunded_block, dict) and refunded_block.get("value") not in (None, ""):
        refunded_minor, refunded_currency = _amount_block(
            refunded_block, "seller_receivable_breakdown.total_refunded_amount"
        )
        if refunded_currency != currency:
            raise CaptureParseError(
                "total_refunded_amount currency "
                f"{refunded_currency} != capture currency {currency}"
            )
    elif status == FULLY_REFUNDED_CAPTURE_STATUS:
        # A capture reported REFUNDED with no breakdown: PayPal says the whole
        # amount is gone, so the observed refundable balance is zero.
        refunded_minor = original_minor
        warnings.append(
            "status=REFUNDED without total_refunded_amount → treated as fully refunded"
        )
    else:
        warnings.append("seller_receivable_breakdown.total_refunded_amount missing → 0.00")

    if refunded_minor > original_minor and status != FULLY_REFUNDED_CAPTURE_STATUS:
        warnings.append("total_refunded_amount exceeds capture amount")

    raw_sha256 = hashlib.sha256(
        json.dumps(raw, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()

    return CaptureSnapshot(
        capture_id=capture_id,
        status=status,
        currency=currency,
        original_minor=original_minor,
        refunded_minor=refunded_minor,
        merchant_id=_merchant_id(raw),
        raw_sha256=raw_sha256,
        warnings=tuple(warnings),
    )


def capture_id_of_case(case: Any) -> str:
    """Capture id of a payment case (CAP-<capture_id>), or ``""``.

    The transaction reference is authoritative; the case-id prefix is the
    documented fallback and never yields an id for a dispute case.
    """
    reference = getattr(case, "transaction_reference", None)
    value = str(getattr(reference, "capture_id", "") or "").strip()
    if value and value != "UNKNOWN":
        return value
    case_id = str(getattr(case, "case_id", "") or "")
    if case_id.startswith(DEMO_CASE_ID_PREFIX):
        suffix = case_id[len(DEMO_CASE_ID_PREFIX):]
        if suffix:
            return f"{DEMO_CAPTURE_ID_PREFIX}{suffix}"
    if case_id.startswith(CAPTURE_ID_PREFIX):
        return case_id[len(CAPTURE_ID_PREFIX) :]
    return ""


def payment_case_id(capture_id: str) -> str:
    text = str(capture_id)
    if text.startswith(DEMO_CAPTURE_ID_PREFIX) and text[len(DEMO_CAPTURE_ID_PREFIX):]:
        return f"{DEMO_CASE_ID_PREFIX}{text[len(DEMO_CAPTURE_ID_PREFIX):]}"
    return f"{CAPTURE_ID_PREFIX}{text}"


# ------------------------------------------------------------------------ refund
def refund_amount_minor(raw: Any) -> int | None:
    block = raw.get("amount") if isinstance(raw, dict) else None
    if not isinstance(block, dict):
        return None
    try:
        value, _currency = _amount_block(block, "refund.amount")
    except CaptureParseError:
        return None
    return value


def refund_currency(raw: Any) -> str:
    block = raw.get("amount") if isinstance(raw, dict) else None
    if not isinstance(block, dict):
        return ""
    return str(block.get("currency_code") or "").strip().upper()


def refund_status(raw: Any) -> str:
    if not isinstance(raw, dict):
        return ""
    return str(raw.get("status") or "").strip().upper()


def refund_capture_id(raw: Any) -> str | None:
    """Capture id a refund points at, when the response declares it."""
    if not isinstance(raw, dict):
        return None
    direct = str(raw.get("capture_id") or "").strip()
    if direct:
        return direct
    supplementary = raw.get("supplementary_data")
    related = (
        supplementary.get("related_ids") if isinstance(supplementary, dict) else None
    )
    if isinstance(related, dict):
        value = str(related.get("capture_id") or "").strip()
        if value:
            return value
    return None


def capture_refunds(raw: Any) -> list[dict[str, Any]]:
    """Any ``refunds[]`` array a capture response exposes (hint, never proof)."""
    if not isinstance(raw, dict):
        return []
    entries = raw.get(CAPTURE_REFUNDS_KEY)
    if not isinstance(entries, list):
        return []
    return [dict(entry) for entry in entries if isinstance(entry, dict)]


def match_refund_entry(
    entries: list[dict[str, Any]], *, amount_minor: int | None, currency: str
) -> dict[str, Any] | None:
    """Find the entry that could be OUR refund (amount + currency match).

    Used only to recover a refund id after an ambiguous POST. The returned
    entry is a lead, not a confirmation — the caller still GETs the refund.
    """
    for entry in entries:
        if amount_minor is not None and refund_amount_minor(entry) != amount_minor:
            continue
        if currency and refund_currency(entry) != currency:
            continue
        if str(entry.get("id") or "").strip():
            return entry
    return None
