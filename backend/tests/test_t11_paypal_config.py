"""T11 — PayPal config: env parsing, double write gate, secret-safe repr."""

from __future__ import annotations

from app.adapters.paypal.config import (
    DATA_MODE_OFFLINE,
    DATA_MODE_SANDBOX,
    NETWORK_READ_ONLY,
    PayPalConfig,
)
from tests.paypal_helpers import SENTINEL_CLIENT_ID, SENTINEL_SECRET, sandbox_config


def _clear(monkeypatch):
    for name in (
        "DP_DATA_MODE",
        "DP_PAYPAL_BASE_URL",
        "DP_PAYPAL_CLIENT_ID",
        "DP_PAYPAL_CLIENT_SECRET",
        "DP_PAYPAL_TIMEOUT_S",
        "DP_PAYPAL_READS_RETRY",
        "DP_PAYPAL_WRITES_ENABLED",
        "DP_PAYPAL_WRITE_ALLOW",
    ):
        monkeypatch.delenv(name, raising=False)


def test_defaults_are_offline_and_unconfigured(monkeypatch):
    _clear(monkeypatch)
    config = PayPalConfig.from_env()
    assert config.data_mode == DATA_MODE_OFFLINE
    assert config.is_sandbox_mode is False
    assert config.is_configured is False
    assert config.writes_allowed is False
    assert config.reads_retry == 0
    assert config.timeout_s == 15.0


def test_sandbox_requires_both_credentials(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    assert PayPalConfig.from_env().is_configured is False

    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    config = PayPalConfig.from_env()
    assert config.is_configured is True
    assert config.data_mode == DATA_MODE_SANDBOX


def test_repr_and_str_redact_credentials():
    config = sandbox_config()
    rendered = f"{config!r} {config}"
    assert SENTINEL_CLIENT_ID not in rendered
    assert SENTINEL_SECRET not in rendered
    assert "client_id_set=True" in rendered
    assert "client_secret_set=True" in rendered


def test_live_paypal_host_is_rejected(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    monkeypatch.setenv("DP_PAYPAL_BASE_URL", "https://api-m.paypal.com")
    config = PayPalConfig.from_env()
    assert "LIVE PayPal host" in config.config_error
    assert config.is_configured is False
    assert config.writes_allowed is False


def test_unknown_base_url_is_rejected(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    monkeypatch.setenv("DP_PAYPAL_BASE_URL", "https://example.com")
    config = PayPalConfig.from_env()
    assert "sandbox host" in config.config_error
    assert config.is_configured is False


def test_write_allow_list_and_double_gate():
    config = sandbox_config(
        writes_enabled=True,
        write_allow=("PP-D-100:provide-evidence", "PP-D-200:escalate"),
    )
    assert config.writes_allowed is True
    assert config.is_write_allowed("PP-D-100", "provide-evidence") is True
    assert config.is_write_allowed("PP-D-100", "PROVIDE-EVIDENCE") is True
    assert config.is_write_allowed("PP-D-100", "escalate") is False
    assert config.is_write_allowed("PP-D-999", "provide-evidence") is False

    disabled = sandbox_config(writes_enabled=False)
    assert disabled.writes_allowed is False
    assert disabled.is_write_allowed("PP-D-100", "provide-evidence") is False

    empty_allow = sandbox_config(writes_enabled=True, write_allow=())
    assert empty_allow.writes_allowed is False


def test_network_read_only_label_is_defined():
    """The health vocabulary is contract-defined; keep the exact spelling."""
    assert NETWORK_READ_ONLY == "PAYPAL_SANDBOX_READ_ONLY"


def test_numeric_env_errors_do_not_raise(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("DP_PAYPAL_TIMEOUT_S", "not-a-number")
    monkeypatch.setenv("DP_PAYPAL_READS_RETRY", "-3")
    config = PayPalConfig.from_env()
    assert "DP_PAYPAL_TIMEOUT_S" in config.config_error
    assert "DP_PAYPAL_READS_RETRY" in config.config_error
    assert config.timeout_s == 15.0
    assert config.reads_retry == 0
