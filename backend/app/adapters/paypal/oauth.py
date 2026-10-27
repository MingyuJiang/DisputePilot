"""PayPal OAuth 2.0 client_credentials with a thread-safe token cache.

- One token is shared per client process; it is refreshed 60 s before the
  advertised expiry.
- The token value is never logged, never part of an exception and never
  appears in ``repr``.
- Exactly one token request per cache miss; there is no automatic retry.
"""

from __future__ import annotations

import base64
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from .config import PayPalConfig
from .errors import (
    PayPalError,
    PayPalErrorKind,
    error_from_response,
    request_id_from,
)

TOKEN_PATH = "/v1/oauth2/token"
REFRESH_SKEW_S = 60.0
DEFAULT_EXPIRES_IN_S = 0.0  # unknown expiry -> treat as immediately stale


@dataclass(frozen=True)
class OAuthToken:
    access_token: str = field(repr=False)
    expires_at: float = 0.0
    scope: str = ""
    token_type: str = "Bearer"


def _status_error(
    status: int, headers: Any, body: dict[str, Any] | None, *, what: str
) -> PayPalError:
    return error_from_response(
        status, headers, body, what=what, bad_request_is_auth=True
    )


class PayPalOAuth:
    def __init__(
        self,
        config: PayPalConfig,
        http_client: Any,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._config = config
        self._http = http_client
        self._clock = clock
        self._lock = threading.Lock()
        self._token: OAuthToken | None = None
        self.last_scope = ""

    def access_token(self) -> str:
        """Return a cached token or fetch exactly one new one."""
        with self._lock:
            token = self._token
            if token is not None and self._clock() < token.expires_at - REFRESH_SKEW_S:
                return token.access_token
            fetched = self._fetch()
            self._token = fetched
            self.last_scope = fetched.scope
            return fetched.access_token

    def invalidate(self) -> None:
        with self._lock:
            self._token = None

    # ------------------------------------------------------------------ private
    def _basic_auth(self) -> str:
        raw = f"{self._config.client_id}:{self._config.client_secret}".encode("utf-8")
        return base64.b64encode(raw).decode("ascii")

    def _fetch(self) -> OAuthToken:
        headers = {
            # Never logged anywhere; only sent on the wire.
            "Authorization": f"Basic {self._basic_auth()}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }
        try:
            response = self._http.post(
                TOKEN_PATH,
                content=b"grant_type=client_credentials",
                headers=headers,
            )
        except Exception as exc:  # transport layer exceptions only
            timed_out = "timeout" in type(exc).__name__.lower()
            raise PayPalError(
                PayPalErrorKind.UNAVAILABLE,
                "PayPal OAuth endpoint unreachable",
                timed_out=timed_out,
            ) from None

        body: dict[str, Any] | None = None
        try:
            parsed = response.json()
            body = parsed if isinstance(parsed, dict) else None
        except Exception:
            body = None

        if response.status_code >= 400:
            raise _status_error(
                response.status_code, response.headers, body, what="PayPal OAuth"
            )

        if not body or not isinstance(body.get("access_token"), str) or not body["access_token"]:
            raise PayPalError(
                PayPalErrorKind.PROTOCOL,
                "PayPal OAuth response did not contain an access token",
                http_status=response.status_code,
                request_id=request_id_from(response.headers, body),
            )

        try:
            expires_in = float(body.get("expires_in", DEFAULT_EXPIRES_IN_S))
        except (TypeError, ValueError):
            expires_in = DEFAULT_EXPIRES_IN_S

        return OAuthToken(
            access_token=body["access_token"],
            expires_at=self._clock() + max(expires_in, 0.0),
            scope=str(body.get("scope", "") or ""),
            token_type=str(body.get("token_type", "Bearer") or "Bearer"),
        )
