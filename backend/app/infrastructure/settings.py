"""Runtime settings (env-overridable). No credentials are ever written out."""

from __future__ import annotations

import os
from pathlib import Path

from ..adapters.paypal.config import (
    DATA_MODE_SANDBOX,
    DEFAULT_OFFLINE_CAPTURES_PATH,
    NETWORK_NONE,
    NETWORK_READ_ONLY,
    NETWORK_WRITE_ENABLED,
    PayPalConfig,
)

APP_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = APP_ROOT / "data"
FIXTURES_DIR = DATA_DIR / "fixtures"
OUT_DIR = Path(os.environ.get("DP_OUT_DIR", str(APP_ROOT / "out")))

POLICY_VERSION = os.environ.get("DP_POLICY_VERSION", "policy-v1.0")

OFFLINE_NOTE = "offline replay backend; no PayPal API calls of any kind"


class Settings:
    def __init__(self) -> None:
        self.app_name = "DisputePilot Agent A Backend"
        self.database_url = os.environ.get(
            "DP_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'disputepilot_dev.sqlite3').as_posix()}"
        )
        self.case_snapshot_path = Path(
            os.environ.get(
                "DP_CASE_SNAPSHOT", str(FIXTURES_DIR / "CANONICAL_CASES_OFFLINE_SNAPSHOT.json")
            )
        )
        self.replay_states_path = Path(
            os.environ.get(
                "DP_REPLAY_STATES", str(FIXTURES_DIR / "replay_case_states.json")
            )
        )
        # Synthetic captures resolved locally in REPLAY mode (no PayPal call).
        self.offline_captures_path = Path(
            os.environ.get("DP_OFFLINE_CAPTURES", str(DEFAULT_OFFLINE_CAPTURES_PATH))
        )
        self.policy_version = POLICY_VERSION
        # Runtime status for /health (never credentials).
        self.paypal_last_read_at = ""
        self.paypal_last_error = ""

    @property
    def auto_import_on_startup(self) -> bool:
        """Fixture auto-import switch — read per call so tests/operators can
        point a process at an existing demo database without a restart."""
        return os.environ.get("DP_AUTO_IMPORT", "1") == "1"

    # ------------------------------------------------------------ PayPal status
    def paypal_config(self) -> PayPalConfig:
        """Read env on every call so tests/operators can switch without restart."""
        return PayPalConfig.from_env()

    @property
    def data_mode(self) -> str:
        """``offline_replay`` (default) or ``paypal_sandbox`` — env, per call."""
        return self.paypal_config().data_mode

    @property
    def execution_mode(self) -> str:
        return self.paypal_config().execution_mode

    @property
    def network_access(self) -> str:
        config = self.paypal_config()
        if not config.is_sandbox_mode:
            return NETWORK_NONE
        return NETWORK_WRITE_ENABLED if config.writes_allowed else NETWORK_READ_ONLY

    def health_note(self) -> str:
        config = self.paypal_config()
        if not config.is_sandbox_mode:
            return OFFLINE_NOTE

        parts: list[str] = []
        if config.writes_allowed:
            parts.append(
                "PayPal Sandbox WRITE-ENABLED mode; live writes are gated by "
                "DP_PAYPAL_WRITE_ALLOW and by per-proposal Manager approval"
            )
        else:
            parts.append(
                "PayPal Sandbox READ-ONLY mode; live writes disabled "
                "(DP_PAYPAL_WRITES_ENABLED=0 or empty DP_PAYPAL_WRITE_ALLOW)"
            )
        if not config.is_configured and not config.config_error:
            parts.append("credentials not configured")
        if config.config_error:
            parts.append(f"config_error={config.config_error}")
        if self.paypal_last_read_at:
            parts.append(f"last_successful_read={self.paypal_last_read_at}")
        if self.paypal_last_error:
            parts.append(f"last_error={self.paypal_last_error}")
        if config.data_mode == DATA_MODE_SANDBOX and not config.is_configured:
            parts.append("source unavailable until credentials are provided")
        return "; ".join(parts)


settings = Settings()
