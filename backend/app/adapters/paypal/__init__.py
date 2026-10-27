"""PayPal Sandbox adapter (read-only by default; writes gated twice).

Import surface is deliberately lazy — ``client`` is the only module that
imports an HTTP library, and it must not be pulled in by importing the
package. See ``docs/PAYPAL_ADAPTER.md``.
"""

from __future__ import annotations

from .config import (  # noqa: F401
    DATA_MODE_OFFLINE,
    DATA_MODE_SANDBOX,
    NETWORK_NONE,
    NETWORK_READ_ONLY,
    NETWORK_WRITE_ENABLED,
    PayPalConfig,
)
from .errors import PayPalError, PayPalErrorKind  # noqa: F401

__all__ = [
    "DATA_MODE_OFFLINE",
    "DATA_MODE_SANDBOX",
    "NETWORK_NONE",
    "NETWORK_READ_ONLY",
    "NETWORK_WRITE_ENABLED",
    "PayPalConfig",
    "PayPalError",
    "PayPalErrorKind",
]
