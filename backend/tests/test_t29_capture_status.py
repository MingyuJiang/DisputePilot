"""T29 — Read-only capture status endpoint (hidden, outside contract v1.3).

REPLAY mode must answer from ``data/fixtures/OFFLINE_DEMO_CAPTURES.json`` with
zero network; only sandbox mode may issue one PayPal GET. Amounts are exact
decimal strings, never floats.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import SYSTEM

CAPTURE = "DEMO-CAP-9001"
FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "fixtures"
    / "OFFLINE_DEMO_CAPTURES.json"
)
URL = f"/api/v1/payments/captures/{CAPTURE}"

_PAYPAL_ENV = (
    "DP_DATA_MODE",
    "DP_PAYPAL_BASE_URL",
    "DP_PAYPAL_CLIENT_ID",
    "DP_PAYPAL_CLIENT_SECRET",
    "DP_PAYPAL_TIMEOUT_S",
    "DP_PAYPAL_READS_RETRY",
    "DP_PAYPAL_WRITES_ENABLED",
    "DP_PAYPAL_WRITE_ALLOW",
    "DP_PAYPAL_MERCHANT_ID",
    "DP_OFFLINE_CAPTURES",
    "DP_AUTO_IMPORT",
)


def _clear(monkeypatch) -> None:
    for name in _PAYPAL_ENV:
        monkeypatch.delenv(name, raising=False)


def _offline(monkeypatch, *, fixture: Path | None = None) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv("DP_DATA_MODE", "offline_replay")
    monkeypatch.setenv("DP_AUTO_IMPORT", "0")
    if fixture is not None:
        monkeypatch.setenv("DP_OFFLINE_CAPTURES", str(fixture))


class _NetworkForbidden:
    def __init__(self, *_args, **_kwargs) -> None:
        raise AssertionError("HTTP client constructed in REPLAY mode")


@pytest.fixture()
def replay(app, monkeypatch):
    _offline(monkeypatch)
    with TestClient(app) as client:
        client.app.state.container.payment_client_factory = _NetworkForbidden
        yield client


# ------------------------------------------------------------------- replay
def test_replay_status_reads_the_synthetic_fixture(replay):
    response = replay.get(URL, headers=SYSTEM)
    assert response.status_code == 200, response.text
    body = response.json()

    assert set(body) == {
        "capture_id",
        "status",
        "original_amount",
        "total_refunded",
        "refundable_remaining",
        "currency_code",
        "source",
    }
    assert body["capture_id"] == CAPTURE
    assert body["status"] == "COMPLETED"
    assert body["original_amount"] == "42.00"
    assert body["total_refunded"] == "12.00"
    assert body["refundable_remaining"] == "30.00"
    assert body["currency_code"] == "USD"
    assert body["source"] == "SYNTHETIC_OFFLINE_FIXTURE"
    # Exact decimal strings — a JSON float would lose the 2-dp guarantee.
    for key in ("original_amount", "total_refunded", "refundable_remaining"):
        assert isinstance(body[key], str)


def test_replay_status_never_constructs_an_http_client(replay):
    """The injected factory raises on construction; a 200 proves no HTTP."""
    assert replay.get(URL, headers=SYSTEM).status_code == 200


def test_replay_unknown_capture_is_404_without_network(replay):
    response = replay.get("/api/v1/payments/captures/DEMO-CAP-0000", headers=SYSTEM)
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "NOT_FOUND"
    assert "no PayPal request was issued" in error["message"]


def test_missing_fixture_is_an_explicit_503(app, monkeypatch, tmp_path):
    _offline(monkeypatch, fixture=tmp_path / "missing.json")
    with TestClient(app) as client:
        client.app.state.container.payment_client_factory = _NetworkForbidden
        response = client.get(URL, headers=SYSTEM)

    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "DOMAIN_ERROR"
    assert "unreadable" in error["message"]


def test_fixture_override_is_honoured(app, monkeypatch, tmp_path):
    custom = tmp_path / "captures.json"
    custom.write_text(
        json.dumps(
            {
                "_meta": {"source": "SYNTHETIC_OFFLINE_FIXTURE"},
                "captures": {
                    CAPTURE: {
                        "id": CAPTURE,
                        "status": "PARTIALLY_REFUNDED",
                        "amount": {"value": "10.00", "currency_code": "EUR"},
                        "seller_receivable_breakdown": {
                            "total_refunded_amount": {
                                "value": "2.50",
                                "currency_code": "EUR",
                            }
                        },
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    _offline(monkeypatch, fixture=custom)
    with TestClient(app) as client:
        client.app.state.container.payment_client_factory = _NetworkForbidden
        body = client.get(URL, headers=SYSTEM).json()

    assert body["original_amount"] == "10.00"
    assert body["total_refunded"] == "2.50"
    assert body["refundable_remaining"] == "7.50"
    assert body["currency_code"] == "EUR"


# --------------------------------------------------------------------- live
def test_sandbox_mode_reads_paypal_and_reports_paypal_source(app, monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", "sandbox-client")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", "sandbox-secret")
    monkeypatch.setenv("DP_AUTO_IMPORT", "0")

    calls: list[str] = []

    class _LiveClient:
        def get_capture(self, capture_id: str) -> dict:
            calls.append(capture_id)
            return {
                "id": capture_id,
                "status": "COMPLETED",
                "amount": {"value": "99.00", "currency_code": "USD"},
                "seller_receivable_breakdown": {
                    "total_refunded_amount": {
                        "value": "0.00",
                        "currency_code": "USD",
                    }
                },
            }

        def close(self) -> None:
            pass

    with TestClient(app) as client:
        client.app.state.container.payment_client_factory = lambda _config: _LiveClient()
        response = client.get(URL, headers=SYSTEM)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "PAYPAL_API"
    assert body["original_amount"] == "99.00"
    assert body["refundable_remaining"] == "99.00"
    assert calls == [CAPTURE]  # exactly one GET, no writes
