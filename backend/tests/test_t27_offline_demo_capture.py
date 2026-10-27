"""T27 — OFFLINE_REPLAY refund demo: synthetic capture fixture, zero network.

``PaymentService.observe_capture`` used to always issue
``GET /v2/payments/captures/{id}``. The offline demo's synthetic case
``CAP-DEMO-9001`` (capture ``DEMO-CAP-9001``) does not exist at PayPal, so in
REPLAY mode it must resolve from ``data/fixtures/OFFLINE_DEMO_CAPTURES.json``
without constructing an HTTP client.

Every test installs a client factory that raises on construction: if any code
path touches the sandbox client, the test fails instead of reaching a socket.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import MANAGER, SPECIALIST, SYSTEM

CAPTURE = "DEMO-CAP-9001"
CASE_ID = "CAP-DEMO-9001"
PARTIAL = "partial-refund"
FULL = "full-refund"
FIXTURE = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "OFFLINE_DEMO_CAPTURES.json"

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
    """Any attempt to build the PayPal client in REPLAY mode is a failure."""

    def __init__(self, *_args, **_kwargs) -> None:
        raise AssertionError("HTTP client constructed in REPLAY mode")


@pytest.fixture()
def replay(app, monkeypatch):
    _offline(monkeypatch)
    with TestClient(app) as client:
        client.app.state.container.payment_client_factory = _NetworkForbidden
        yield client


# --------------------------------------------------------------------- helpers
def _import(client, capture: str = CAPTURE):
    return client.post(f"/api/v1/payments/captures/{capture}/import", headers=SYSTEM)


def _analysis(client) -> str:
    response = client.post(f"/api/v1/cases/{CASE_ID}/analyses", headers=SPECIALIST)
    assert response.status_code == 200, response.text
    return response.json()["analysis_id"]


def _draft(client, action: str, payload: dict):
    body = {
        "case_id": CASE_ID,
        "analysis_id": _analysis(client),
        "action_type": action,
        "action_payload": payload,
    }
    return client.post(
        f"/api/v1/cases/{CASE_ID}/proposals", headers=SPECIALIST, json=body
    )


def _approve_and_replay(client, proposal_id: str):
    submitted = client.post(
        f"/api/v1/proposals/{proposal_id}/submit", headers=SPECIALIST
    )
    assert submitted.status_code == 200, submitted.text
    approval_id = submitted.json()["approval"]["approval_id"]
    decided = client.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "offline demo"},
    )
    assert decided.status_code == 200, decided.text
    replayed = client.post(
        f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
    )
    assert replayed.status_code == 200, replayed.text
    return replayed.json()


# ===============================================================  fixture shape
def test_fixture_is_explicitly_marked_synthetic():
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    meta = raw["_meta"]
    assert meta["source"] == "SYNTHETIC_OFFLINE_FIXTURE"
    assert "Not a PayPal capture" in meta["note"]
    assert raw["captures"]["DEMO-CAP-9001"]["id"] == "DEMO-CAP-9001"


# =============================================================  observe (no HTTP)
def test_replay_observe_capture_reads_fixture_without_http(app, monkeypatch):
    _offline(monkeypatch)

    from app.adapters.case_state import CaseStateStore
    from app.infrastructure.database import get_session_factory
    from app.infrastructure.settings import settings
    from app.services.case_service import CaseService
    from app.services.payment_service import PaymentCaseService

    session = get_session_factory()()
    try:
        service = PaymentCaseService(
            session,
            CaseService(session, CaseStateStore(settings.replay_states_path)),
            client_factory=_NetworkForbidden,
        )
        snapshot = service.observe_capture(CAPTURE)
    finally:
        session.close()

    assert snapshot.capture_id == CAPTURE
    assert snapshot.status == "COMPLETED"
    assert snapshot.original_amount == "42.00"
    assert snapshot.total_refunded == "12.00"
    assert snapshot.refundable_remaining == "30.00"
    assert snapshot.currency == "USD"


# ==============================================================  import (replay)
def test_replay_import_builds_the_demo_capture_case(replay):
    response = _import(replay)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["case_id"] == CASE_ID
    assert body["capture_id"] == CAPTURE
    assert body["capture_status"] == "COMPLETED"
    assert body["amount"] == {"value": "42.00", "currency_code": "USD"}
    assert body["total_refunded"] == {"value": "12.00", "currency_code": "USD"}
    assert body["refundable_remaining"] == {"value": "30.00", "currency_code": "USD"}
    assert body["inserted"] is True
    assert body["refreshed"] is False


def test_replay_import_is_idempotent(replay):
    first = _import(replay)
    second = _import(replay)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert (first.json()["inserted"], first.json()["refreshed"]) == (True, False)
    assert (second.json()["inserted"], second.json()["refreshed"]) == (False, True)
    assert second.json()["refundable_remaining"]["value"] == "30.00"

    cases = replay.get("/api/v1/cases").json()
    demo_cases = [c["case_id"] for c in cases if c["case_id"] == CASE_ID]
    assert demo_cases == [CASE_ID]


# ===============================================================  partial draft
def test_replay_partial_draft_uses_the_fixture_snapshot(replay):
    assert _import(replay).status_code == 200

    response = _draft(
        replay,
        PARTIAL,
        {
            "amount": "10.00",
            "capture_id": CAPTURE,
            "mode": "partial",
            "reason": "offline demo goodwill",
            "idempotency_key": "DP-DEMO-PARTIAL-1",
        },
    )
    assert response.status_code == 200, response.text
    proposal = response.json()

    assert proposal["action_family"] == "PAYMENT"
    assert proposal["action_payload"]["amount"] == "10.00"
    assert proposal["action_payload"]["capture_snapshot"] == {
        "capture_id": CAPTURE,
        "status": "COMPLETED",
        "original_amount": "42.00",
        "total_refunded": "12.00",
        "refundable_remaining": "30.00",
        "currency_code": "USD",
    }

    report = replay.get(
        f"/api/v1/proposals/{proposal['proposal_id']}/validation"
    ).json()
    assert report is None  # nothing validated until submit

    submitted = replay.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    )
    assert submitted.status_code == 200, submitted.text

    report = replay.get(
        f"/api/v1/proposals/{proposal['proposal_id']}/validation"
    ).json()
    assert report["passed"] is True
    assert {f["validator_id"] for f in report["findings"]} == {
        "V13",
        "V14",
        "V15",
        "V16",
        "V17",
        "V18",
    }


# ==================================================================  full draft
def test_replay_full_draft_refunds_the_remaining_balance(replay):
    assert _import(replay).status_code == 200

    response = _draft(
        replay,
        FULL,
        {
            "capture_id": CAPTURE,
            "mode": "full",
            "reason": "offline demo full refund",
            "idempotency_key": "DP-DEMO-FULL-1",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()["action_payload"]

    assert "amount" not in payload
    assert payload["capture_snapshot"]["refundable_remaining"] == "30.00"

    execution = _approve_and_replay(replay, response.json()["proposal_id"])
    assert execution["result"] == "REPLAYED"
    assert execution["execution_mode"] == "REPLAY"
    assert execution["response_snapshot"]["mode"] == "FULL"
    assert execution["response_snapshot"]["amount"] == "30.00"
    assert execution["response_snapshot"]["simulated"] is True


# ==============================================================  LIVE unchanged
def test_live_mode_ignores_the_fixture(app, monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", "sandbox-client")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", "sandbox-secret")
    monkeypatch.setenv("DP_PAYPAL_WRITES_ENABLED", "1")
    monkeypatch.setenv("DP_PAYPAL_WRITE_ALLOW", f"{CAPTURE}:{PARTIAL}")
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
                    "total_refunded_amount": {"value": "0.00", "currency_code": "USD"}
                },
            }

        def close(self) -> None:
            pass

    with TestClient(app) as client:
        client.app.state.container.payment_client_factory = lambda _config: _LiveClient()
        response = _import(client)

    assert response.status_code == 200, response.text
    assert response.json()["amount"]["value"] == "99.00"
    assert response.json()["refundable_remaining"]["value"] == "99.00"
    assert calls == [CAPTURE]


# ============================================================  explicit failures
def test_unknown_demo_capture_is_an_explicit_404(replay):
    response = _import(replay, "DEMO-CAP-0000")

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "DOMAIN_ERROR"
    assert error["details"]["kind"] == "NOT_FOUND"
    assert "offline demo capture" in error["message"]
    assert "no PayPal request was issued" in error["message"]


def test_missing_fixture_file_is_an_explicit_503(app, monkeypatch, tmp_path):
    _offline(monkeypatch, fixture=tmp_path / "missing.json")
    with TestClient(app) as client:
        client.app.state.container.payment_client_factory = _NetworkForbidden
        response = _import(client)

    assert response.status_code == 503
    error = response.json()["error"]
    assert error["details"]["kind"] == "UNAVAILABLE"
    assert "unreadable" in error["message"]


def test_env_override_points_at_another_fixture(app, monkeypatch, tmp_path):
    custom = tmp_path / "captures.json"
    custom.write_text(
        json.dumps(
            {
                "_meta": {
                    "source": "SYNTHETIC_OFFLINE_FIXTURE",
                    "note": "Not a PayPal capture; offline demo only.",
                    "created_at": "2026-10-21",
                },
                "captures": {
                    CAPTURE: {
                        "id": CAPTURE,
                        "status": "COMPLETED",
                        "amount": {"value": "7.00", "currency_code": "USD"},
                        "seller_receivable_breakdown": {
                            "total_refunded_amount": {
                                "value": "1.00",
                                "currency_code": "USD",
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
        response = _import(client)

    assert response.status_code == 200, response.text
    assert response.json()["amount"]["value"] == "7.00"
    assert response.json()["refundable_remaining"]["value"] == "6.00"
