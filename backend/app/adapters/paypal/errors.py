"""PayPal adapter errors — safe to serialize, never carry credentials.

``to_public()`` is the ONLY form allowed in logs, audit payloads, API
responses and exception text. It deliberately contains no headers, no token,
no Basic auth value and no raw upstream body (a body can echo a request id or
an OAuth error description; only the sha256/length would be safe, so we drop
it entirely).
"""

from __future__ import annotations

from enum import Enum
from typing import Any


class PayPalErrorKind(str, Enum):
    AUTH = "AUTH"                  # credentials invalid/expired
    PERMISSION = "PERMISSION"      # app lacks the scope / account permission
    NOT_FOUND = "NOT_FOUND"        # remote dispute does not exist
    RATE_LIMITED = "RATE_LIMITED"  # 429, Retry-After surfaced
    UNAVAILABLE = "UNAVAILABLE"    # 5xx / timeout / connection failure
    PROTOCOL = "PROTOCOL"          # unexpected status or unparseable JSON


_KIND_STATUS = {
    PayPalErrorKind.AUTH: 503,
    PayPalErrorKind.PERMISSION: 503,
    PayPalErrorKind.NOT_FOUND: 404,
    PayPalErrorKind.RATE_LIMITED: 503,
    PayPalErrorKind.UNAVAILABLE: 503,
    PayPalErrorKind.PROTOCOL: 502,
}


class PayPalError(Exception):
    def __init__(
        self,
        kind: PayPalErrorKind,
        message: str,
        *,
        http_status: int | None = None,
        retry_after: float | None = None,
        request_id: str | None = None,
        timed_out: bool = False,
        network_attempted: bool = True,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.http_status = http_status
        self.retry_after = retry_after
        self.request_id = request_id
        self.timed_out = timed_out
        self.network_attempted = network_attempted

    @property
    def api_status(self) -> int:
        """HTTP status this adapter failure maps to (503/502/404)."""
        return _KIND_STATUS.get(self.kind, 502)

    def to_public(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "kind": self.kind.value,
            "message": self.message,
            "http_status": self.http_status,
        }
        if self.retry_after is not None:
            payload["retry_after"] = self.retry_after
        if self.request_id:
            payload["request_id"] = self.request_id
        if self.timed_out:
            payload["timed_out"] = True
        return payload

    def __str__(self) -> str:  # exception text is also public
        bits = [self.kind.value, self.message]
        if self.http_status is not None:
            bits.append(f"http_status={self.http_status}")
        if self.request_id:
            bits.append(f"request_id={self.request_id}")
        return ": ".join(bits[:2]) + (" (" + ", ".join(bits[2:]) + ")" if bits[2:] else "")


def request_id_from(headers: Any, body: dict[str, Any] | None) -> str | None:
    """PayPal exposes a safe correlation id as ``debug_id`` / PayPal-Debug-Id."""
    if body:
        value = body.get("debug_id")
        if isinstance(value, str) and value:
            return value
    header_value = headers.get("paypal-debug-id") if headers is not None else None
    return str(header_value) if header_value else None


def error_from_response(
    status: int,
    headers: Any,
    body: dict[str, Any] | None,
    *,
    what: str,
    bad_request_is_auth: bool = False,
) -> PayPalError:
    """Map an upstream HTTP status to a typed, credential-free adapter error."""
    retry_after: float | None = None
    raw_retry = headers.get("retry-after") if headers is not None else None
    if raw_retry:
        try:
            retry_after = float(raw_retry)
        except (TypeError, ValueError):
            retry_after = None
    request_id = request_id_from(headers, body)

    if status == 401 or (status == 400 and bad_request_is_auth):
        kind, message = PayPalErrorKind.AUTH, f"{what} credentials rejected by PayPal"
    elif status == 403:
        kind, message = PayPalErrorKind.PERMISSION, f"{what} permission denied by PayPal"
    elif status == 404:
        kind, message = PayPalErrorKind.NOT_FOUND, f"{what} resource not found"
    elif status == 429:
        kind, message = PayPalErrorKind.RATE_LIMITED, f"{what} rate limited by PayPal"
    elif status >= 500:
        kind, message = PayPalErrorKind.UNAVAILABLE, f"{what} upstream unavailable"
    else:
        kind, message = PayPalErrorKind.PROTOCOL, f"{what} rejected with status {status}"
    return PayPalError(
        kind,
        message,
        http_status=status,
        retry_after=retry_after,
        request_id=request_id,
    )


class PayPalWriteBlocked(Exception):
    """Raised when the live write gate (flag + allow-list) refuses a call."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason
