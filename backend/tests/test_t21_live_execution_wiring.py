"""T21 — LIVE execution wiring (execution endpoint → PayPalSandboxGateway).

Every transport is ``httpx.MockTransport``; no socket is opened and no real
POST exists anywhere in this file. The default (no env, or writes disabled)
is still a hard 409 with zero network.
"""

from __future__ import annotations

import httpx
from fastapi.testclient import TestClient

from app.adapters.paypal.client import PayPalApiClient
from app.adapters.paypal.gateway import PayPalSandboxGateway
from app.adapters.paypal.normalize import normalize_dispute
from app.infrastructure.database import get_session_factory
from app.infrastructure.repositories import (
    CaseRepository,
    CaseStateRepository,
    IdempotencyRepository,
)
from tests.conftest import MANAGER, SPECIALIST, run_full_chain
from tests.paypal_helpers import (
    SENTINEL_CLIENT_ID,
    SENTINEL_SECRET,
    MockPayPal,
    raw_dispute,
)

DISPUTE_ID = "PP-D-123456789"
CASE_ID = DISPUTE_ID  # case_id_for() keeps short dispute ids verbatim
ALLOW = f"{DISPUTE_ID}:provide-evidence"


def _mock(**overrides) -> MockPayPal:
    overrides.setdefault("pre", raw_dispute(dispute_id=DISPUTE_ID))
    return MockPayPal(**overrides)


def _sandbox_env(monkeypatch, *, writes: bool = True) -> None:
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    if writes:
        monkeypatch.setenv("DP_PAYPAL_WRITES_ENABLED", "1")
        monkeypatch.setenv("DP_PAYPAL_WRITE_ALLOW", ALLOW)
    else:
        monkeypatch.delenv("DP_PAYPAL_WRITES_ENABLED", raising=False)
        monkeypatch.delenv("DP_PAYPAL_WRITE_ALLOW", raising=False)


def _seed_case(mock: MockPayPal) -> object:
    """Persist a sandbox-imported case + state directly (no import network)."""
    normalized = normalize_dispute(mock.pre)
    session = get_session_factory()()
    try:
        CaseRepository(session).upsert_from_import(normalized.case)
        CaseStateRepository(session).upsert(
            normalized.case.case_id,
            normalized.state.model_dump_json(),
            normalized.state.compute_state_hash(),
            normalized.state.state_version,
        )
        session.commit()
    finally:
        session.close()
    return normalized


def _install_mock(client: TestClient, mock: MockPayPal) -> None:
    client.app.state.container.sandbox_gateway_factory = (
        lambda config: PayPalSandboxGateway(
            config, PayPalApiClient(config, transport=mock.transport())
        )
    )


def _forbidden_gateway(config):  # pragma: no cover - asserted not to run
    raise AssertionError("the write gate must refuse before the gateway is built")


def _approved_proposal(client: TestClient) -> tuple[dict, str]:
    r = client.post(f"/api/v1/cases/{CASE_ID}/analyses", headers=SPECIALIST)
    assert r.status_code == 200, r.text
    analysis_id = r.json()["analysis_id"]

    r = client.post(
        f"/api/v1/cases/{CASE_ID}/proposals",
        headers=SPECIALIST,
        json={
            "case_id": CASE_ID,
            "analysis_id": analysis_id,
            "action_type": "provide-evidence",
            "action_payload": {
                "evidence_type": "PROOF_OF_FULFILLMENT",
                "notes": "SCENARIO_DEFINED: sandbox wiring test evidence",
                "idempotency_key": "DP-LIVE-T21",
            },
        },
    )
    assert r.status_code == 200, r.text
    proposal = r.json()

    r = client.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    )
    assert r.status_code == 200, r.text
    approval_id = r.json()["approval"]["approval_id"]

    r = client.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "sandbox wiring test"},
    )
    assert r.status_code == 200, r.text
    return proposal, approval_id


# --------------------------------------------------------------- default closed
def test_writes_disabled_returns_409_and_zero_network(app, monkeypatch):
    mock = _mock()
    _sandbox_env(monkeypatch, writes=False)

    with TestClient(app) as client:
        _seed_case(mock)
        client.app.state.container.sandbox_gateway_factory = _forbidden_gateway
        proposal, approval_id = _approved_proposal(client)

        response = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )
        stored = client.get(
            f"/api/v1/proposals/{proposal['proposal_id']}/execution"
        )

    assert response.status_code == 409
    message = response.json()["error"]["message"]
    assert "DP_PAYPAL_WRITES_ENABLED=1" in message
    assert "DP_PAYPAL_WRITE_ALLOW" in message
    assert stored.status_code == 404
    assert mock.token_calls == 0
    assert mock.get_calls == 0
    assert mock.post_calls == 0


def test_offline_mode_never_uses_the_sandbox_gateway(ready):
    """data_mode=offline_replay keeps the REPLAY gateway, even with a factory."""
    ready.app.state.container.sandbox_gateway_factory = _forbidden_gateway
    _analysis, _proposal, approval_id = run_full_chain(ready, case_id="O4")
    response = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)

    assert response.status_code == 200
    assert response.json()["execution_mode"] == "REPLAY"
    assert response.json()["simulated"] is True
    assert response.json()["result"] == "REPLAYED"


# ------------------------------------------------------------------ executed
def test_live_execution_maps_executed_and_audits(app, monkeypatch):
    mock = _mock(post_status="ok", apply_change_on_post=True)
    _sandbox_env(monkeypatch)

    with TestClient(app) as client:
        _seed_case(mock)
        _install_mock(client, mock)
        proposal, approval_id = _approved_proposal(client)

        response = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )
        assert response.status_code == 200, response.text
        body = response.json()

        audit = client.get(f"/api/v1/cases/{CASE_ID}/audit").json()["events"]
        stored = client.get(
            f"/api/v1/proposals/{proposal['proposal_id']}/execution"
        ).json()

    assert body["result"] == "EXECUTED"
    assert body["execution_mode"] == "LIVE"
    assert body["simulated"] is False
    assert body["gateway"] == "PayPalSandboxGateway"
    assert body["warning"].startswith("LIVE PayPal Sandbox result")
    assert body["response_snapshot"]["http_status"] == 204
    assert body["response_snapshot"]["simulated"] is False
    assert body["verification"]["method"] == "LIVE_GET"
    assert body["verification"]["confirmed"] is True
    assert body["verification"]["remote_status"] == "UNDER_REVIEW"

    assert stored["result"] == "EXECUTED"
    assert stored["execution_mode"] == "LIVE"
    assert stored["simulated"] is False

    # exactly one multipart POST; one pre-GET + one verification GET
    assert mock.post_calls == 1
    assert mock.get_calls == 2
    assert "multipart/form-data" in (mock.last_post_content_type or "")
    assert mock.last_post_body == {
        "evidences": [
            {
                "evidence_type": "PROOF_OF_FULFILLMENT",
                "notes": "SCENARIO_DEFINED: sandbox wiring test evidence",
            }
        ]
    }

    types = [event["event_type"] for event in audit]
    assert "EXECUTION_ATTEMPT" in types
    assert "EXECUTION_VERIFIED" in types
    assert types.index("EXECUTION_ATTEMPT") < types.index("EXECUTION_VERIFIED")

    attempt = next(e for e in audit if e["event_type"] == "EXECUTION_ATTEMPT")
    assert attempt["payload"]["proposal_id"] == proposal["proposal_id"]
    assert attempt["payload"]["execution_mode"] == "LIVE"
    assert attempt["payload"]["simulated"] is False
    assert attempt["payload"]["precheck"]["status"] == "WAITING_FOR_SELLER_RESPONSE"

    verified = next(e for e in audit if e["event_type"] == "EXECUTION_VERIFIED")
    assert verified["payload"]["confirmed"] is True
    assert verified["payload"]["remote_status"] == "UNDER_REVIEW"
    assert verified["payload"]["checked_at"]

    # PII-free: no credential/token ever reaches the audit trail
    assert SENTINEL_CLIENT_ID not in str(audit)
    assert SENTINEL_SECRET not in str(audit)


def test_completed_live_execution_refuses_a_second_call(app, monkeypatch):
    mock = _mock(post_status="ok", apply_change_on_post=True)
    _sandbox_env(monkeypatch)

    with TestClient(app) as client:
        _seed_case(mock)
        _install_mock(client, mock)
        _proposal, approval_id = _approved_proposal(client)
        first = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )
        assert first.status_code == 200, first.text
        second = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )

    assert second.status_code == 409
    assert "already executed" in second.json()["error"]["message"]
    assert mock.post_calls == 1
    assert mock.get_calls == 2


# ----------------------------------------------------------------- unverified
def test_live_unverified_maps_and_audits_human_review(app, monkeypatch):
    mock = _mock(post_status="timeout", apply_change_on_post=False)
    _sandbox_env(monkeypatch)

    with TestClient(app) as client:
        _seed_case(mock)
        _install_mock(client, mock)
        proposal, approval_id = _approved_proposal(client)

        response = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )
        assert response.status_code == 200, response.text
        body = response.json()

        audit = client.get(f"/api/v1/cases/{CASE_ID}/audit").json()["events"]
        proposal_state = client.get(
            f"/api/v1/proposals/{proposal['proposal_id']}"
        ).json()["state"]

    assert body["result"] == "UNVERIFIED"
    assert body["execution_mode"] == "LIVE"
    assert body["simulated"] is False
    assert body["warning"].startswith("LIVE result UNVERIFIED")
    assert body["verification"]["confirmed"] is False
    assert "no automatic retry" in body["warning"]
    assert proposal_state == "FAILED"
    assert mock.post_calls == 1  # never retried

    unknown = next(e for e in audit if e["event_type"] == "EXECUTION_UNKNOWN")
    assert unknown["payload"]["next_action"] == "HUMAN_REVIEW"
    assert unknown["payload"]["reason"]
    assert unknown["payload"]["checked_at"]
    assert unknown["payload"]["confirmed"] is False


def test_unverified_is_never_retried(app, monkeypatch):
    mock = _mock(post_status="timeout", apply_change_on_post=False)
    _sandbox_env(monkeypatch)

    with TestClient(app) as client:
        _seed_case(mock)
        _install_mock(client, mock)
        _proposal, approval_id = _approved_proposal(client)
        first = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )
        assert first.status_code == 200, first.text
        second = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )

    assert second.status_code == 409
    assert "never retried" in second.json()["error"]["message"]
    assert mock.post_calls == 1


# ---------------------------------------------------------------- idempotency
def test_same_idempotency_key_returns_the_same_execution(app, monkeypatch):
    mock = _mock(post_status="ok", apply_change_on_post=True)
    _sandbox_env(monkeypatch)

    with TestClient(app) as client:
        _seed_case(mock)
        _install_mock(client, mock)
        _proposal, approval_id = _approved_proposal(client)
        headers = {**MANAGER, "Idempotency-Key": "live-fixed-key-1"}
        first = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=headers
        )
        second = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=headers
        )

    assert first.status_code == second.status_code == 200
    assert first.json()["execution_id"] == second.json()["execution_id"]
    assert mock.post_calls == 1


def test_live_claim_blocks_before_any_network(app, monkeypatch):
    """A crashed/ambiguous prior attempt (claim row) must not POST again."""
    mock = _mock(post_status="ok", apply_change_on_post=True)
    _sandbox_env(monkeypatch)

    with TestClient(app) as client:
        _seed_case(mock)
        _install_mock(client, mock)
        proposal, approval_id = _approved_proposal(client)

        session = get_session_factory()()
        try:
            IdempotencyRepository(session).put(
                f"live-execution:{proposal['proposal_id']}",
                "live-execution",
                '{"state": "CLAIMED"}',
            )
            session.commit()
        finally:
            session.close()

        response = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )

    assert response.status_code == 409
    assert "already claimed" in response.json()["error"]["message"]
    assert mock.token_calls == 0
    assert mock.get_calls == 0
    assert mock.post_calls == 0


# -------------------------------------------------------------------- blocked
def test_remote_drift_blocks_without_a_post(app, monkeypatch):
    mock = MockPayPal(
        pre=raw_dispute(dispute_id=DISPUTE_ID, status="UNDER_REVIEW"), post_status="ok"
    )
    # The persisted state says WAITING_FOR_SELLER_RESPONSE (normalize default);
    # the mock now reports UNDER_REVIEW → the pre-GET detects drift.
    pre = raw_dispute(dispute_id=DISPUTE_ID)
    _sandbox_env(monkeypatch)

    with TestClient(app) as client:
        _seed_case(MockPayPal(pre=pre))
        _install_mock(client, mock)
        proposal, approval_id = _approved_proposal(client)

        response = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )
        audit = client.get(f"/api/v1/cases/{CASE_ID}/audit").json()["events"]

    assert response.status_code == 200
    body = response.json()
    assert body["result"] == "BLOCKED"
    assert body["execution_mode"] == "LIVE"
    assert body["simulated"] is False
    assert body["verification"]["blocked_stage"] == "precheck"
    assert mock.post_calls == 0
    assert mock.get_calls == 1

    blocked = [e for e in audit if e["event_type"] == "EXECUTION_BLOCKED"]
    assert blocked and blocked[-1]["payload"]["post_issued"] is False


def test_no_transport_is_ever_a_real_socket():
    """Sanity: the mock transport used above cannot dial out by construction."""
    mock = _mock()
    transport = mock.transport()
    assert isinstance(transport, httpx.MockTransport)
