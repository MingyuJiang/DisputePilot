"""Loopback-only HTTP transport for the local Ollama runtime.

This is the ONLY application module permitted to import a network client
(``http.client``). ``tests/test_t6_network_guard.py`` grants this exact file a
single, narrowly-scoped exception; every other module stays under the
zero-network AST scan.

Guarantees enforced here (not in callers):
- scheme must be ``http`` and host must be a loopback literal/alias;
- no redirect is followed: any 3xx is refused (a loopback endpoint that
  answers with a redirect cannot bounce the request to a remote host);
- no proxy support, no DNS for arbitrary hosts, no TLS, no credentials;
- a single attempt per call unless the caller explicitly configured retries.
"""

from __future__ import annotations

import http.client
import json
from urllib.parse import urlsplit

from .errors import (
    LLM_CONNECTION_ERROR,
    LLM_INVALID_JSON,
    LLM_MODEL_UNAVAILABLE,
    LLM_TIMEOUT,
    LLMServiceError,
)

# Only these host spellings may be dialed. ``localhost`` is accepted because it
# resolves to a loopback address on every supported platform.
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


def parse_loopback_url(base_url: str) -> tuple[str, int, str]:
    """Validate ``base_url`` and return ``(host, port, path_prefix)``.

    Raises ``LLMServiceError(LLM_CONNECTION_ERROR)`` for anything that is not a
    plain loopback http URL — including userinfo tricks such as
    ``http://127.0.0.1@evil.example`` (``hostname`` is ``evil.example``).
    """
    raw = (base_url or "").strip()
    if not raw:
        raise LLMServiceError(
            LLM_CONNECTION_ERROR, "LLM base URL is empty; loopback URL required"
        )
    parts = urlsplit(raw)
    if parts.scheme not in ("http",):
        raise LLMServiceError(
            LLM_CONNECTION_ERROR,
            f"LLM base URL scheme {parts.scheme!r} refused; only http loopback is allowed",
        )
    if parts.username or parts.password:
        raise LLMServiceError(
            LLM_CONNECTION_ERROR,
            "LLM base URL must not embed credentials",
        )
    host = (parts.hostname or "").lower()
    if host not in LOOPBACK_HOSTS:
        raise LLMServiceError(
            LLM_CONNECTION_ERROR,
            f"LLM base URL host {host!r} refused; only 127.0.0.1 / localhost / ::1 "
            "are permitted (no external network access)",
        )
    try:
        port = parts.port or 11434
    except ValueError as exc:  # malformed port
        raise LLMServiceError(
            LLM_CONNECTION_ERROR, f"LLM base URL port invalid: {exc}"
        ) from exc
    prefix = parts.path.rstrip("/")
    return host, port, prefix


def assert_loopback_url(base_url: str) -> str:
    """Validate without network I/O; returns the normalized base URL."""
    host, port, prefix = parse_loopback_url(base_url)
    return f"http://{host}:{port}{prefix}"


def check_ollama(base_url: str, timeout_s: float = 1.0) -> dict:
    """One short loopback ping (``GET /api/tags``) for the status endpoint.

    Never retries, never falls back to another provider, never contacts a
    non-loopback host. Raises :class:`LLMServiceError` with an explicit
    internal code when the runtime is unreachable or answers unexpectedly.
    """
    normalized = assert_loopback_url(base_url)
    host, port, prefix = parse_loopback_url(normalized)
    timeout = float(timeout_s)
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        try:
            connection.request(
                "GET",
                f"{prefix}/api/tags",
                headers={"Accept": "application/json"},
            )
            response = connection.getresponse()
            status = response.status
            raw = response.read()
        except TimeoutError as exc:
            raise LLMServiceError(
                LLM_TIMEOUT,
                f"local LLM status ping timed out after {timeout:.1f}s",
                timeout_s=timeout,
            ) from exc
        except OSError as exc:
            raise LLMServiceError(
                LLM_CONNECTION_ERROR,
                f"cannot reach local LLM at {normalized}: {exc.__class__.__name__}",
                base_url=normalized,
            ) from exc
    finally:
        connection.close()

    if status in REDIRECT_STATUSES:
        raise LLMServiceError(
            LLM_CONNECTION_ERROR,
            f"local LLM status ping was redirected ({status}); redirects are refused",
            upstream_status=status,
        )
    if status != 200:
        raise LLMServiceError(
            LLM_MODEL_UNAVAILABLE,
            f"local LLM status ping failed with HTTP {status}",
            upstream_status=status,
        )
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LLMServiceError(
            LLM_INVALID_JSON, "local LLM status response is not valid JSON"
        ) from exc
    if not isinstance(decoded, dict):
        raise LLMServiceError(
            LLM_INVALID_JSON, "local LLM status response is not a JSON object"
        )
    return decoded


class OllamaChatTransport:
    """Minimal blocking client for ``POST {base_url}/api/chat``."""

    def __init__(self, base_url: str, timeout_s: float = 180.0):
        self.base_url = assert_loopback_url(base_url)
        self.timeout_s = float(timeout_s)

    def chat(self, payload: dict, timeout_s: float | None = None) -> dict:
        host, port, prefix = parse_loopback_url(self.base_url)
        timeout = float(timeout_s if timeout_s is not None else self.timeout_s)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        connection = http.client.HTTPConnection(host, port, timeout=timeout)
        try:
            try:
                connection.request(
                    "POST",
                    f"{prefix}/api/chat",
                    body=body,
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                )
                response = connection.getresponse()
                status = response.status
                raw = response.read()
            except TimeoutError as exc:
                raise LLMServiceError(
                    LLM_TIMEOUT,
                    f"local LLM request timed out after {timeout:.0f}s",
                    timeout_s=timeout,
                ) from exc
            except ConnectionError as exc:
                raise LLMServiceError(
                    LLM_CONNECTION_ERROR,
                    f"cannot reach local LLM at {self.base_url}: {exc.__class__.__name__}",
                    base_url=self.base_url,
                ) from exc
            except OSError as exc:
                raise LLMServiceError(
                    LLM_CONNECTION_ERROR,
                    f"cannot reach local LLM at {self.base_url}: {exc.__class__.__name__}",
                    base_url=self.base_url,
                ) from exc
        finally:
            connection.close()

        if status in REDIRECT_STATUSES:
            raise LLMServiceError(
                LLM_CONNECTION_ERROR,
                f"local LLM responded with redirect {status}; redirects are refused",
                upstream_status=status,
            )
        if status == 404:
            raise LLMServiceError(
                LLM_MODEL_UNAVAILABLE,
                "local LLM endpoint/model not found (404); check the model tag",
                upstream_status=status,
            )
        if status >= 500:
            raise LLMServiceError(
                LLM_MODEL_UNAVAILABLE,
                f"local LLM runtime error (HTTP {status})",
                upstream_status=status,
            )
        if status != 200:
            raise LLMServiceError(
                LLM_CONNECTION_ERROR,
                f"local LLM request rejected (HTTP {status})",
                upstream_status=status,
            )
        try:
            decoded = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LLMServiceError(
                LLM_INVALID_JSON, "local LLM response body is not valid JSON"
            ) from exc
        if not isinstance(decoded, dict):
            raise LLMServiceError(
                LLM_INVALID_JSON, "local LLM response body is not a JSON object"
            )
        return decoded
