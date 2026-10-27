"""T20 — contract v1.1 enums, real provide-evidence multipart, no auto-execution.

Every transport is ``httpx.MockTransport``: zero real network, zero real POST.
"""

from __future__ import annotations

import json

import httpx
from fastapi.testclient import TestClient

from app.adapters.paypal.client import PayPalApiClient
from app.adapters.paypal.gateway import (
    RESULT_BLOCKED,
    RESULT_EXECUTED,
    RESULT_UNVERIFIED,
    PayPalSandboxGateway,
)
from app.adapters.paypal.normalize import normalize_dispute
from app.domain.enums import ExecutionMode, ExecutionResult
from app.schemas.execution import ExecutionOut, ExecutionSummaryOut
from tests.conftest import MANAGER, SPECIALIST, SYSTEM
from tests.paypal_helpers import (
    MockPayPal,
    make_approval,
    make_proposal,
    multipart_input_json,
    sandbox_config,
    token_json,
)

# v1.2 adds PENDING (additive). The v1.1 values keep their meaning and order.
_EXPECTED_ENUM = ["REPLAYED", "BLOCKED", "FAILED", "EXECUTED", "UNVERIFIED", "PENDING"]


def _setup(mock: MockPayPal, **config_overrides):
    config = sandbox_config(**config_overrides)
    api = PayPalApiClient(config, transport=mock.transport())
    normalized = normalize_dispute(mock.pre)
    proposal = make_proposal(normalized.case)
    approval = make_approval(proposal)
    gateway = PayPalSandboxGateway(config, api)
    return gateway, normalized, proposal, approval, api


# --------------------------------------------------------------------- enums
def test_v1_1_results_serialize_in_execution_dtos():
    assert [value.value for value in ExecutionResult] == _EXPECTED_ENUM

    for result in (ExecutionResult.EXECUTED, ExecutionResult.UNVERIFIED):
        out = ExecutionOut(
            execution_id="EX-1",
            proposal_id="PROP-1",
            case_id="PP-D-1",
            execution_mode=ExecutionMode.LIVE,
            simulated=False,
            result=result,
            gateway="PayPalSandboxGateway",
            created_at="2026-10-19T00:00:00+00:00",
        )
        payload = out.model_dump(mode="json")
        assert payload["result"] == result.value
        assert json.loads(json.dumps(payload))["result"] == result.value

        summary = ExecutionSummaryOut(
            execution_id="EX-1",
            proposal_id="PROP-1",
            execution_mode=ExecutionMode.LIVE,
            simulated=False,
            result=result,
            gateway="PayPalSandboxGateway",
            created_at="2026-10-19T00:00:00+00:00",
        )
        assert summary.model_dump(mode="json")["result"] == result.value


# ------------------------------------------------------------------ multipart
def test_post_provide_evidence_sends_multipart_input_json():
    seen: dict[str, object] = {"calls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        seen["calls"] = int(seen["calls"]) + 1
        seen["content_type"] = request.headers.get("content-type", "")
        seen["body"] = request.content
        return httpx.Response(204)

    client = PayPalApiClient(sandbox_config(), transport=httpx.MockTransport(handler))
    try:
        response = client.post_provide_evidence(
            "PP-D-100",
            [{"evidence_type": "OTHER", "notes": "中文说明"}],
            request_id="req-multipart-1",
        )
    finally:
        client.close()

    assert response.status_code == 204
    assert seen["calls"] == 1
    content_type = str(seen["content_type"])
    raw = bytes(seen["body"])
    assert content_type.startswith("multipart/form-data; boundary=")
    assert b'name="input"' in raw
    assert b'filename="input.json"' in raw
    assert b'"evidences"' in raw
    assert multipart_input_json(raw, content_type) == {
        "evidences": [{"evidence_type": "OTHER", "notes": "中文说明"}]
    }


def test_post_provide_evidence_does_not_follow_redirects():
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        paths.append(request.url.path)
        if len(paths) == 1:
            return httpx.Response(
                302,
                headers={"location": "https://api-m.sandbox.paypal.com/v1/redirected"},
                content=b"",
            )
        return httpx.Response(200, json={"followed": True})

    client = PayPalApiClient(sandbox_config(), transport=httpx.MockTransport(handler))
    try:
        response = client.post_provide_evidence(
            "PP-D-100", [{"evidence_type": "OTHER"}], request_id="req-redirect"
        )
    finally:
        client.close()

    assert response.status_code == 302
    assert paths == ["/v1/customer/disputes/PP-D-100/provide-evidence"]


# -------------------------------------------------------------------- gateway
def test_gateway_sends_one_multipart_evidences_post_and_executes():
    mock = MockPayPal(post_status="ok", apply_change_on_post=True)
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    assert outcome.result == RESULT_EXECUTED
    assert mock.post_calls == 1
    assert mock.get_calls == 2
    assert "multipart/form-data" in (mock.last_post_content_type or "")
    assert mock.last_post_body == {
        "evidences": [
            {"evidence_type": "PROOF_OF_FULFILLMENT", "notes": "Sandbox adapter test"}
        ]
    }
    # No invented attachment/document keys.
    assert "evidence_documents" not in mock.last_post_body["evidences"][0]
    assert b'name="input"' in (mock.last_post_raw or b"")


def test_gateway_blocks_missing_evidence_type_without_any_network():
    mock = MockPayPal()
    gateway, normalized, _proposal, approval, api = _setup(mock)
    proposal = make_proposal(normalized.case, payload={"notes": "no type here"})
    approval = make_approval(proposal)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    assert outcome.result == RESULT_BLOCKED
    assert outcome.verification["blocked_stage"] == "payload"
    assert mock.token_calls == 0
    assert mock.get_calls == 0
    assert mock.post_calls == 0


def test_gateway_post_timeout_with_readback_confirmation_is_executed():
    mock = MockPayPal(post_status="timeout", apply_change_on_post=True)
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    assert outcome.result == RESULT_EXECUTED
    assert mock.post_calls == 1  # never retried
    assert outcome.verification["post_outcome_unknown"] is True
    assert outcome.verification["post_error"]["kind"] == "UNAVAILABLE"
    assert mock.last_post_body["evidences"][0]["evidence_type"] == (
        "PROOF_OF_FULFILLMENT"
    )


def test_gateway_post_timeout_without_change_is_unverified():
    mock = MockPayPal(post_status="timeout", apply_change_on_post=False)
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    assert outcome.result == RESULT_UNVERIFIED
    assert mock.post_calls == 1
    assert outcome.verification["confirmed"] is False
    assert outcome.verification["method"] == "LIVE_GET"


def test_gateway_unconfirmable_readback_is_unverified():
    mock = MockPayPal(
        post_status="ok", apply_change_on_post=False, get_after_post_status=500
    )
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    assert outcome.result == RESULT_UNVERIFIED
    assert mock.post_calls == 1
    assert "verification GET failed" in outcome.verification["uncertain_reason"]


# ------------------------------------------------------- no automatic execution
def _approved_proposal(client: TestClient, case_id: str = "O4") -> tuple[str, str]:
    r = client.post(f"/api/v1/cases/{case_id}/analyses", headers=SPECIALIST)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/v1/cases/{case_id}/proposals/generate", headers=SPECIALIST)
    assert r.status_code == 200, r.text
    proposal = r.json()[0]
    r = client.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    )
    assert r.status_code == 200, r.text
    approval_id = r.json()["approval"]["approval_id"]
    r = client.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "restart regression"},
    )
    assert r.status_code == 200, r.text
    return proposal["proposal_id"], approval_id


def test_approved_proposal_survives_restart_and_import_without_execution(app):
    with TestClient(app) as first:
        assert first.get("/api/v1/cases").status_code == 200
        proposal_id, approval_id = _approved_proposal(first)
        assert first.get(f"/api/v1/proposals/{proposal_id}").json()["state"] == (
            "APPROVED"
        )
        assert first.get(f"/api/v1/proposals/{proposal_id}/execution").status_code == 404

    # Restart the app (new lifespan, same SQLite file) and refresh imports.
    with TestClient(app) as second:
        assert second.get("/api/v1/cases").status_code == 200
        assert second.post("/api/v1/cases/import", headers=SYSTEM).status_code == 200

        proposal = second.get(f"/api/v1/proposals/{proposal_id}").json()
        assert proposal["state"] == "APPROVED"
        assert proposal["state"] != "REPLAY_EXECUTED"
        assert second.get(f"/api/v1/approvals/{approval_id}").json()["decision"] == (
            "APPROVED"
        )
        assert second.get(f"/api/v1/proposals/{proposal_id}/execution").status_code == 404

        audit = second.get("/api/v1/cases/O4/audit").json()["events"]
        event_types = {event["event_type"] for event in audit}
        assert "EXECUTION_REPLAYED" not in event_types
        assert "EXECUTION_ATTEMPT" not in event_types
