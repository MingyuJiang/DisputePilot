"""PayPal Sandbox REST client (read paths + two controlled write paths).

This is the ONLY module in the application allowed to import an HTTP client
(the narrow T6 exemption, mirroring ``local_llm/transport.py``). It still
cannot reach the network unless someone constructs a real transport — tests
always inject ``httpx.MockTransport``.

Reads: single attempt by default (``DP_PAYPAL_READS_RETRY=0``). Writes: exactly
one attempt, ever; ambiguity is resolved by a separate GET, never by a retry.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import quote

import httpx

from .config import PayPalConfig
from .errors import (
    PayPalError,
    PayPalErrorKind,
    error_from_response,
    request_id_from,
)
from .oauth import PayPalOAuth

DISPUTES_PATH = "/v1/customer/disputes"
CAPTURES_PATH = "/v2/payments/captures"
REFUNDS_PATH = "/v2/payments/refunds"
USER_AGENT = "DisputePilot-AgentA/0.1 (+sandbox-adapter)"

# A refund amount must reach PayPal exactly as approved: a plain decimal
# string with at most two fraction digits, no exponent, no sign, no spaces.
_EXACT_DECIMAL_RE = re.compile(r"^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$")


def _exact_decimal_string(amount: str | Decimal) -> str:
    """Validate, never round: a value that cannot be sent verbatim is refused."""
    text = str(amount).strip()
    if not _EXACT_DECIMAL_RE.match(text):
        raise ValueError(
            f"refund amount {text!r} is not an exact <=2-decimal string"
        )
    try:
        Decimal(text)
    except InvalidOperation:  # pragma: no cover - regex already constrains it
        raise ValueError(f"refund amount {text!r} is not a decimal") from None
    return text


@dataclass(frozen=True)
class HttpResponse:
    """Minimal, token-free view of one upstream response."""

    status_code: int
    json_body: dict[str, Any] = field(default_factory=dict)
    request_id: str | None = None
    raw_sha256: str = ""
    headers: dict[str, str] = field(default_factory=dict, repr=False)


class PayPalApiClient:
    """Thin PayPal REST wrapper with typed error mapping."""

    name = "PayPalSandboxClient"

    def __init__(
        self,
        config: PayPalConfig,
        *,
        transport: httpx.BaseTransport | None = None,
        oauth: PayPalOAuth | None = None,
    ) -> None:
        self.config = config
        self._http = httpx.Client(
            base_url=config.base_url,
            timeout=httpx.Timeout(config.timeout_s),
            transport=transport,
            follow_redirects=False,
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )
        self._oauth = oauth or PayPalOAuth(config, self._http)
        self.request_count = 0  # test/observability counter (no secrets)

    # ------------------------------------------------------------------ lifecycle
    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "PayPalApiClient":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    # ----------------------------------------------------------------------- read
    def list_disputes(
        self,
        page_size: int = 50,
        next_page_token: str | None = None,
        dispute_state: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page_size": page_size}
        if next_page_token:
            params["next_page_token"] = next_page_token
        if dispute_state:
            params["dispute_state"] = dispute_state
        body = self._read_json("GET", DISPUTES_PATH, params=params)
        if not isinstance(body.get("items"), list):
            raise PayPalError(
                PayPalErrorKind.PROTOCOL,
                "PayPal dispute list response is missing the items array",
            )
        return body

    def get_dispute(self, dispute_id: str) -> dict[str, Any]:
        path = f"{DISPUTES_PATH}/{quote(str(dispute_id), safe='')}"
        return self._read_json("GET", path)

    # ---------------------------------------------------------- payments reads
    def get_capture(self, capture_id: str) -> dict[str, Any]:
        """``GET /v2/payments/captures/{capture_id}``.

        The only source of truth for a capture's balance (original amount,
        amount already refunded, remaining refundable). Read-only, one attempt
        by default, redirects are never followed.
        """
        path = f"{CAPTURES_PATH}/{quote(str(capture_id), safe='')}"
        return self._read_json("GET", path, what="PayPal capture read")

    def get_refund(self, refund_id: str) -> dict[str, Any]:
        """``GET /v2/payments/refunds/{refund_id}`` — the refund confirmation."""
        path = f"{REFUNDS_PATH}/{quote(str(refund_id), safe='')}"
        return self._read_json("GET", path, what="PayPal refund read")

    # --------------------------------------------------------- payments writes
    def post_refund(
        self,
        capture_id: str,
        amount: str | None,
        currency: str,
        request_id: str,
    ) -> HttpResponse:
        """Single ``POST /v2/payments/captures/{capture_id}/refund``.

        Observed contract (sandbox, HTTP 201):

        - partial: ``{"amount": {"value": "4.00", "currency_code": "USD"}}``
        - full: exactly ``{}`` — PayPal refunds the remaining refundable
          amount. No amount is ever invented for a full refund.

        ``Prefer: return=representation`` asks for the full refund object.
        ``PayPal-Request-Id`` is an idempotency key for PayPal only — it is
        NEVER a reason to retry: there is exactly one attempt, no redirects.
        """
        path = f"{CAPTURES_PATH}/{quote(str(capture_id), safe='')}/refund"
        body: dict[str, Any] = {}
        if amount is not None:
            body["amount"] = {
                "value": _exact_decimal_string(amount),
                "currency_code": str(currency).upper(),
            }
        headers = {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
            "PayPal-Request-Id": request_id,
        }
        return self._send(
            "POST",
            path,
            headers=headers,
            json_body=body,
            what="PayPal refund",
        )

    # ---------------------------------------------------------------------- write
    def post_provide_evidence(
        self,
        dispute_id: str,
        evidences: list[dict[str, Any]],
        request_id: str,
    ) -> HttpResponse:
        """Single ``provide-evidence`` POST using PayPal's real multipart shape.

        Observed contract (O12/O17 success cases): ``multipart/form-data`` with
        one field named ``input`` whose value is a JSON string
        ``{"evidences": [...]}``. There are no attachments, one attempt only,
        and redirects are never followed.
        """
        path = f"{DISPUTES_PATH}/{quote(str(dispute_id), safe='')}/provide-evidence"
        payload = json.dumps({"evidences": list(evidences)}, ensure_ascii=False)
        return self._send(
            "POST",
            path,
            headers={"PayPal-Request-Id": request_id},
            files={"input": ("input.json", payload, "application/json")},
            what="PayPal provide-evidence",
        )

    def post_send_message(
        self, dispute_id: str, message: str, request_id: str
    ) -> HttpResponse:
        """Single JSON ``send-message`` POST, no retry, no redirects.

        Observed contract (O4 ``PP-R-ACU-10191513``, HTTP 200): the body is
        exactly ``{"message": "<text>"}`` and the text lands verbatim in the
        detail's ``messages[]``. ``PayPal-Request-Id`` is sent for correlation
        only — that historical request did not carry one and the message text
        is NOT an idempotency key, so the caller must never retry.
        """
        path = f"{DISPUTES_PATH}/{quote(str(dispute_id), safe='')}/send-message"
        headers = {"Content-Type": "application/json"}
        if request_id:
            headers["PayPal-Request-Id"] = request_id
        return self._send(
            "POST",
            path,
            headers=headers,
            json_body={"message": message},
            what="PayPal send-message",
        )

    def post_dispute_action(
        self,
        dispute_id: str,
        action: str,
        body: dict[str, Any],
        *,
        request_id: str,
    ) -> HttpResponse:
        """Single JSON POST, no retry. Not used for ``provide-evidence``.

        ``provide-evidence`` must go through :meth:`post_provide_evidence`
        (multipart); this JSON helper is kept for other action shapes.
        """
        action_slug = str(action).strip().strip("/")
        path = f"{DISPUTES_PATH}/{quote(str(dispute_id), safe='')}/{action_slug}"
        headers = {"Content-Type": "application/json", "PayPal-Request-Id": request_id}
        return self._send(
            "POST", path, headers=headers, json_body=body, what="PayPal write"
        )

    # -------------------------------------------------------------------- private
    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._oauth.access_token()}"}

    def _read_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        what: str = "PayPal read",
    ) -> dict[str, Any]:
        attempts = max(1, 1 + int(self.config.reads_retry))
        last_error: PayPalError | None = None
        for index in range(attempts):
            try:
                result = self._send(
                    method, path, params=params, what=what
                )
                return result.json_body
            except PayPalError as exc:
                last_error = exc
                retryable = exc.kind in (
                    PayPalErrorKind.RATE_LIMITED,
                    PayPalErrorKind.UNAVAILABLE,
                )
                if not retryable or index + 1 >= attempts:
                    raise
                if exc.retry_after:
                    # Reads may back off a little; writes never do.
                    time.sleep(min(float(exc.retry_after), 2.0))
        raise last_error or PayPalError(
            PayPalErrorKind.UNAVAILABLE, "PayPal read failed"
        )

    def _send(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
        files: dict[str, tuple[str, str, str]] | None = None,
        what: str,
    ) -> HttpResponse:
        request_headers = dict(headers or {})
        request_headers.update(self._auth_headers())
        self.request_count += 1
        body_kwargs: dict[str, Any] = {}
        if files is not None:
            # httpx owns the multipart Content-Type (including the boundary).
            body_kwargs["files"] = files
        elif json_body is not None:
            body_kwargs["json"] = json_body
        try:
            response = self._http.request(
                method,
                path,
                params=params,
                headers=request_headers,
                follow_redirects=False,
                **body_kwargs,
            )
        except httpx.TimeoutException:
            raise PayPalError(
                PayPalErrorKind.UNAVAILABLE,
                f"{what} timed out",
                timed_out=True,
            ) from None
        except (httpx.HTTPError, OSError):
            raise PayPalError(
                PayPalErrorKind.UNAVAILABLE,
                f"{what} connection failed",
            ) from None

        raw = response.content or b""
        raw_sha256 = hashlib.sha256(raw).hexdigest()
        body: dict[str, Any] | None
        if not raw:
            body = {}
        else:
            try:
                parsed = response.json()
                body = parsed if isinstance(parsed, dict) else None
            except ValueError:
                body = None

        if response.status_code >= 400:
            raise error_from_response(
                response.status_code, response.headers, body, what=what
            )
        if body is None:
            raise PayPalError(
                PayPalErrorKind.PROTOCOL,
                f"{what} returned a non-JSON object",
                http_status=response.status_code,
                request_id=request_id_from(response.headers, None),
            )

        return HttpResponse(
            status_code=response.status_code,
            json_body=body,
            request_id=request_id_from(response.headers, body),
            raw_sha256=raw_sha256,
            headers={k.lower(): v for k, v in response.headers.items()},
        )
