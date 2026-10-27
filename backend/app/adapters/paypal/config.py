"""PayPal Sandbox configuration — environment only, never persisted.

Design rules (AGENT_A_TASK §1):
- ``DP_DATA_MODE`` selects ``offline_replay`` (default) or ``paypal_sandbox``.
- Credentials are read from the process environment only. They are excluded
  from ``repr()`` so an accidental log statement cannot leak them.
- A missing credential is NOT an exception: ``is_configured`` is False and
  the read path reports a clear 503. A malformed or non-sandbox base URL is
  stored as ``config_error`` (also non-fatal) so /health can explain itself.
- The base URL must be a PayPal *sandbox* host. Live endpoints are rejected
  before any socket is opened.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

DATA_MODE_OFFLINE = "offline_replay"
DATA_MODE_SANDBOX = "paypal_sandbox"
SUPPORTED_DATA_MODES = (DATA_MODE_OFFLINE, DATA_MODE_SANDBOX)

SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com"
ALLOWED_SANDBOX_HOSTS = frozenset({"api-m.sandbox.paypal.com", "api.sandbox.paypal.com"})
FORBIDDEN_LIVE_HOSTS = frozenset({"api-m.paypal.com", "api.paypal.com"})

EXECUTION_MODE_REPLAY = "REPLAY"
EXECUTION_MODE_LIVE = "LIVE"
NETWORK_NONE = "NONE"
NETWORK_READ_ONLY = "PAYPAL_SANDBOX_READ_ONLY"
NETWORK_WRITE_ENABLED = "PAYPAL_SANDBOX_WRITE_ENABLED"

# Synthetic captures used by the OFFLINE_REPLAY demo. Resolved locally in
# REPLAY mode so no PayPal request is ever issued for a capture that only
# exists in this file. ``DP_OFFLINE_CAPTURES`` overrides the location.
DEFAULT_OFFLINE_CAPTURES_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "fixtures" / "OFFLINE_DEMO_CAPTURES.json"
)

# Actions the live gateway is allowed to reason about. Each has an implemented
# request builder in this round; everything else blocks before any network call.
GATEWAY_ACTIONS = ("provide-evidence", "send-message")


def _env(name: str) -> str:
    value = os.environ.get(name)
    return value.strip() if value else ""


def _parse_bool(raw: str) -> bool:
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _parse_float(raw: str, default: float) -> tuple[float, str]:
    if not raw:
        return default, ""
    try:
        value = float(raw)
    except ValueError:
        return default, f"DP_PAYPAL_TIMEOUT_S is not a number ({raw!r})"
    if value <= 0:
        return default, "DP_PAYPAL_TIMEOUT_S must be > 0"
    return value, ""


def _parse_int(raw: str, default: int) -> tuple[int, str]:
    if not raw:
        return default, ""
    try:
        value = int(raw)
    except ValueError:
        return default, f"DP_PAYPAL_READS_RETRY is not an integer ({raw!r})"
    if value < 0:
        return default, "DP_PAYPAL_READS_RETRY must be >= 0"
    return value, ""


def parse_write_allow(raw: str) -> tuple[str, ...]:
    """Parse ``dispute_id:action, ...`` into a normalized tuple.

    Actions are lower-cased so ``provide-evidence`` and ``PROVIDE-EVIDENCE``
    match. Dispute IDs are case-sensitive and kept verbatim.
    """
    entries: list[str] = []
    for chunk in raw.split(","):
        item = chunk.strip()
        if not item or ":" not in item:
            continue
        dispute_id, action = item.rsplit(":", 1)
        dispute_id, action = dispute_id.strip(), action.strip().lower()
        if dispute_id and action:
            entries.append(f"{dispute_id}:{action}")
    return tuple(entries)


@dataclass(frozen=True)
class PayPalConfig:
    data_mode: str = DATA_MODE_OFFLINE
    base_url: str = SANDBOX_BASE_URL
    client_id: str = field(default="", repr=False)
    client_secret: str = field(default="", repr=False)
    timeout_s: float = 15.0
    reads_retry: int = 0
    writes_enabled: bool = False
    write_allow: tuple[str, ...] = ()
    # Optional merchant (payee) id used to decide capture ownership when a
    # PayPal response actually declares one. Empty = not configured, so
    # ownership rests on the authenticated capture read alone.
    merchant_id: str = ""
    # Synthetic capture fixture consulted in REPLAY mode only (env override).
    offline_captures_path: str = str(DEFAULT_OFFLINE_CAPTURES_PATH)
    config_error: str = ""

    # ------------------------------------------------------------------ factory
    @classmethod
    def from_env(cls) -> "PayPalConfig":
        errors: list[str] = []

        mode = _env("DP_DATA_MODE").lower() or DATA_MODE_OFFLINE
        if mode not in SUPPORTED_DATA_MODES:
            errors.append(
                f"DP_DATA_MODE must be one of {SUPPORTED_DATA_MODES}, got {mode!r}"
            )
            mode = DATA_MODE_OFFLINE

        base_url = (_env("DP_PAYPAL_BASE_URL") or SANDBOX_BASE_URL).rstrip("/")
        host = (urlparse(base_url).hostname or "").lower()
        scheme = (urlparse(base_url).scheme or "").lower()
        if scheme != "https":
            errors.append("DP_PAYPAL_BASE_URL must use https")
        if host in FORBIDDEN_LIVE_HOSTS:
            errors.append(
                "DP_PAYPAL_BASE_URL points at a LIVE PayPal host; only sandbox is allowed"
            )
        elif host not in ALLOWED_SANDBOX_HOSTS:
            errors.append(
                "DP_PAYPAL_BASE_URL must be a PayPal sandbox host "
                f"({', '.join(sorted(ALLOWED_SANDBOX_HOSTS))})"
            )

        timeout_s, timeout_error = _parse_float(_env("DP_PAYPAL_TIMEOUT_S"), 15.0)
        if timeout_error:
            errors.append(timeout_error)
        reads_retry, retry_error = _parse_int(_env("DP_PAYPAL_READS_RETRY"), 0)
        if retry_error:
            errors.append(retry_error)

        return cls(
            data_mode=mode,
            base_url=base_url,
            client_id=_env("DP_PAYPAL_CLIENT_ID"),
            client_secret=_env("DP_PAYPAL_CLIENT_SECRET"),
            timeout_s=timeout_s,
            reads_retry=reads_retry,
            writes_enabled=_parse_bool(_env("DP_PAYPAL_WRITES_ENABLED")),
            write_allow=parse_write_allow(_env("DP_PAYPAL_WRITE_ALLOW")),
            merchant_id=_env("DP_PAYPAL_MERCHANT_ID"),
            offline_captures_path=(
                _env("DP_OFFLINE_CAPTURES") or str(DEFAULT_OFFLINE_CAPTURES_PATH)
            ),
            config_error="; ".join(errors),
        )

    # ----------------------------------------------------------------- derived
    @property
    def is_sandbox_mode(self) -> bool:
        return self.data_mode == DATA_MODE_SANDBOX

    @property
    def is_configured(self) -> bool:
        """True only when sandbox mode has usable credentials and a safe URL."""
        return bool(
            self.is_sandbox_mode
            and not self.config_error
            and self.client_id
            and self.client_secret
        )

    @property
    def writes_allowed(self) -> bool:
        """Double gate: flag AND a non-empty allow-list AND valid config."""
        return bool(self.is_configured and self.writes_enabled and self.write_allow)

    @property
    def execution_mode(self) -> str:
        """LIVE only when sandbox writes are fully enabled; REPLAY otherwise."""
        if self.is_sandbox_mode and self.writes_allowed:
            return EXECUTION_MODE_LIVE
        return EXECUTION_MODE_REPLAY

    def is_write_allowed(self, dispute_id: str, action: str) -> bool:
        if not self.writes_allowed:
            return False
        entry = f"{dispute_id}:{str(action).lower()}"
        return entry in self.write_allow

    # -------------------------------------------------------------------- repr
    def __repr__(self) -> str:  # never print credential values
        return (
            "PayPalConfig("
            f"data_mode={self.data_mode!r}, base_url={self.base_url!r}, "
            f"client_id_set={bool(self.client_id)}, "
            f"client_secret_set={bool(self.client_secret)}, "
            f"timeout_s={self.timeout_s!r}, reads_retry={self.reads_retry!r}, "
            f"writes_enabled={self.writes_enabled!r}, "
            f"write_allow_count={len(self.write_allow)}, "
            f"merchant_id_set={bool(self.merchant_id)}, "
            f"config_error={self.config_error!r})"
        )

    __str__ = __repr__
