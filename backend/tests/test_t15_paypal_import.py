"""T15 — /cases/import in sandbox mode: success, idempotency, no fallback."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters.paypal.client import PayPalApiClient
from app.adapters.paypal.source import PayPalCaseSource
from app.api.deps import paypal_source_provider
from app.infrastructure.settings import settings
from tests.conftest import SYSTEM
from tests.paypal_helpers import (
    SENTINEL_CLIENT_ID,
    SENTINEL_SECRET,
    SENTINEL_TOKEN,
    MockPayPal,
    raw_dispute,
    sandbox_config,
)

_ENV = (
    "DP_DATA_MODE",
    "DP_PAYPAL_BASE_URL",
    "DP_PAYPAL_CLIENT_ID",
    "DP_PAYPAL_CLIENT_SECRET",
    "DP_PAYPAL_WRITES_ENABLED",
    "DP_PAYPAL_WRITE_ALLOW",
    "DP_AUTO_IMPORT",
)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in _ENV:
        monkeypatch.delenv(name, raising=False)
    settings.paypal_last_read_at = ""
    settings.paypal_last_error = ""


def _enable_sandbox(monkeypatch, *, writes: bool = False):
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    monkeypatch.setenv("DP_AUTO_IMPORT", "0")
    if writes:
        monkeypatch.setenv("DP_PAYPAL_WRITES_ENABLED", "1")
        monkeypatch.setenv("DP_PAYPAL_WRITE_ALLOW", "PP-D-100:provide-evidence")


def _override(app, mock: MockPayPal) -> PayPalCaseSource:
    client = PayPalApiClient(sandbox_config(), transport=mock.transport())
    source = PayPalCaseSource(sandbox_config(), client=client)
    app.dependency_overrides[paypal_source_provider] = lambda: source
    return source


def test_sandbox_import_reads_paypal_and_never_fixtures(app, monkeypatch):
    _enable_sandbox(monkeypatch)
    mock = MockPayPal(pre=raw_dispute())
    _override(app, mock)
    with TestClient(app) as client:
        assert client.get("/api/v1/cases").json() == []  # no fixture fallback

        response = client.post("/api/v1/cases/import", headers=SYSTEM)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["imported"] == 1
        assert body["skipped_duplicates"] == 0
        assert body["negative_samples_recognized"] == 0
        assert len(body["source_sha256"]) == 64
        assert any("source=PAYPAL_SANDBOX" in d for d in body["details"])

        cases = client.get("/api/v1/cases").json()
        assert len(cases) == 1
        case = client.get("/api/v1/cases/PP-D-100").json()
        assert case["dispute_id"] == "PP-D-100"
        assert case["provenance"] == "PAYPAL_API_OBSERVED"
        assert case["verification_level"] == "UNKNOWN"
        assert case["available_actions"][0]["basis"] == "LIVE_HATEOAS"
        assert case["live_status_note"].startswith("PayPal Sandbox read at")

        evidence = client.get("/api/v1/cases/PP-D-100/evidence").json()
        assert len(evidence) == 1
        assert evidence[0]["provenance"] == "PAYPAL_API_OBSERVED"
    assert settings.paypal_last_read_at
    assert settings.paypal_last_error == ""


def test_second_import_is_idempotent(app, monkeypatch):
    _enable_sandbox(monkeypatch)
    mock = MockPayPal(pre=raw_dispute())
    _override(app, mock)
    with TestClient(app) as client:
        first = client.post("/api/v1/cases/import", headers=SYSTEM).json()
        second = client.post("/api/v1/cases/import", headers=SYSTEM).json()

        assert (first["imported"], first["skipped_duplicates"]) == (1, 0)
        assert (second["imported"], second["skipped_duplicates"]) == (0, 1)
        assert len(client.get("/api/v1/cases").json()) == 1

        audit = client.get("/api/v1/cases/PP-D-100/audit").json()
        imported = [e for e in audit["events"] if e["event_type"] == "CASE_IMPORTED"]
        assert len(imported) == 2
        assert imported[-1]["payload"]["inserted"] is False
        assert imported[-1]["payload"]["dispute_count"] == 1


def test_read_failure_returns_503_and_does_not_fall_back(app, monkeypatch):
    _enable_sandbox(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json={"access_token": SENTINEL_TOKEN, "expires_in": 3600})
        return httpx.Response(503, json={"name": "SERVICE_UNAVAILABLE"})

    client_api = PayPalApiClient(sandbox_config(), transport=httpx.MockTransport(handler))
    source = PayPalCaseSource(sandbox_config(), client=client_api)
    app.dependency_overrides[paypal_source_provider] = lambda: source

    with TestClient(app) as client:
        response = client.post("/api/v1/cases/import", headers=SYSTEM)
        assert response.status_code == 503
        error = response.json()["error"]
        assert error["code"] == "DOMAIN_ERROR"
        assert error["details"]["kind"] == "UNAVAILABLE"
        assert "PayPal Sandbox import failed" in error["message"]
        # Absolutely no fixture cases were inserted as a "success" fallback.
        assert client.get("/api/v1/cases").json() == []

        health = client.get("/api/v1/health").json()
        assert "last_error=UNAVAILABLE" in health["note"]


def test_protocol_error_maps_to_502(app, monkeypatch):
    _enable_sandbox(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json={"access_token": SENTINEL_TOKEN, "expires_in": 3600})
        return httpx.Response(200, content=b"not-json")

    client_api = PayPalApiClient(sandbox_config(), transport=httpx.MockTransport(handler))
    source = PayPalCaseSource(sandbox_config(), client=client_api)
    app.dependency_overrides[paypal_source_provider] = lambda: source

    with TestClient(app) as client:
        response = client.post("/api/v1/cases/import", headers=SYSTEM)
        assert response.status_code == 502
        assert response.json()["error"]["details"]["kind"] == "PROTOCOL"


def test_missing_credentials_returns_503_without_network(app, monkeypatch):
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_AUTO_IMPORT", "0")
    # No source override: the real provider builds an unconfigured source.
    with TestClient(app) as client:
        response = client.post("/api/v1/cases/import", headers=SYSTEM)
        assert response.status_code == 503
        details = response.json()["error"]["details"]
        assert details["kind"] == "AUTH"
        assert "credentials are not configured" in response.json()["error"]["message"]
        assert client.get("/api/v1/cases").json() == []

        health = client.get("/api/v1/health").json()
        assert health["execution_mode"] == "REPLAY"
        assert health["network_access"] == "PAYPAL_SANDBOX_READ_ONLY"
        assert "credentials not configured" in health["note"]


def test_audit_payloads_never_contain_credentials_or_tokens(app, monkeypatch):
    _enable_sandbox(monkeypatch)
    mock = MockPayPal(pre=raw_dispute())
    _override(app, mock)
    with TestClient(app) as client:
        assert client.post("/api/v1/cases/import", headers=SYSTEM).status_code == 200
        audit = client.get("/api/v1/cases/PP-D-100/audit").json()
        serialized = json.dumps(audit, sort_keys=True)
        assert SENTINEL_CLIENT_ID not in serialized
        assert SENTINEL_SECRET not in serialized
        assert SENTINEL_TOKEN not in serialized
        assert "Authorization" not in serialized
        imported = [
            event for event in audit["events"] if event["event_type"] == "CASE_IMPORTED"
        ]
        assert imported[0]["payload"]["source"] == "PAYPAL_SANDBOX"
        assert imported[0]["payload"]["read_at"]
        assert imported[0]["payload"]["snapshot_hash"]


def test_health_reports_write_enabled_only_with_flag_and_allow_list(app, monkeypatch):
    _enable_sandbox(monkeypatch, writes=True)
    with TestClient(app) as client:
        health = client.get("/api/v1/health").json()
        assert health["execution_mode"] == "LIVE"
        assert health["network_access"] == "PAYPAL_SANDBOX_WRITE_ENABLED"
        assert "WRITE-ENABLED" in health["note"]
        assert "DP_PAYPAL_WRITE_ALLOW" in health["note"]
    assert SENTINEL_CLIENT_ID not in json.dumps(health)
    assert SENTINEL_SECRET not in json.dumps(health)


def test_offline_health_is_unchanged(app, monkeypatch):
    with TestClient(app) as client:
        health = client.get("/api/v1/health").json()
    assert health["execution_mode"] == "REPLAY"
    assert health["network_access"] == "NONE"
    assert health["note"] == "offline replay backend; no PayPal API calls of any kind"
