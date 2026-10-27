"""T24 — Partial / Full refund backend chain (all MockTransport, no network).

Covers the Payments v2 client shapes, the payment-case import, the
server-authoritative draft enrichment, validators V13–V18 and the refund
gateway's result mapping. There is no real POST anywhere in this file: every
client is built with ``httpx.MockTransport`` and the write gate is opened only
against the fake capture id.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters.paypal.client import PayPalApiClient
from app.adapters.paypal.errors import PayPalError, PayPalErrorKind
from app.adapters.paypal.refund import PayPalRefundGateway
from app.infrastructure.database import get_session_factory
from app.infrastructure.repositories import IdempotencyRepository
from tests.conftest import MANAGER, SPECIALIST, SYSTEM
from tests.paypal_helpers import (
    CAPTURE_ID,
    MERCHANT_ID,
    SENTINEL_CLIENT_ID,
    SENTINEL_SECRET,
    MockPayments,
    raw_capture,
    sandbox_config,
    token_json,
)

CAPTURE = CAPTURE_ID
CASE_ID = f"CAP-{CAPTURE}"
PARTIAL = "partial-refund"
FULL = "full-refund"
KEY = "DP-REFUND-KEY-1"

_PAYPAL_ENV = (
    "DP_DATA_MODE",
    "DP_PAYPAL_CLIENT_ID",
    "DP_PAYPAL_CLIENT_SECRET",
    "DP_PAYPAL_WRITES_ENABLED",
    "DP_PAYPAL_WRITE_ALLOW",
    "DP_PAYPAL_MERCHANT_ID",
    "DP_AUTO_IMPORT",
)


# --------------------------------------------------------------------- rig
def _env(monkeypatch, *, writes: bool = True, merchant: str | None = MERCHANT_ID) -> None:
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    monkeypatch.setenv("DP_AUTO_IMPORT", "0")
    monkeypatch.delenv("DP_PAYPAL_MERCHANT_ID", raising=False)
    if merchant:
        monkeypatch.setenv("DP_PAYPAL_MERCHANT_ID", merchant)
    if writes:
        monkeypatch.setenv("DP_PAYPAL_WRITES_ENABLED", "1")
        monkeypatch.setenv(
            "DP_PAYPAL_WRITE_ALLOW", f"{CAPTURE}:{PARTIAL},{CAPTURE}:{FULL}"
        )
    else:
        monkeypatch.delenv("DP_PAYPAL_WRITES_ENABLED", raising=False)
        monkeypatch.delenv("DP_PAYPAL_WRITE_ALLOW", raising=False)


class Rig:
    """One client + one Payments double, with the whole approve/execute flow."""

    def __init__(self, client: TestClient, mock: MockPayments) -> None:
        self.client = client
        self.mock = mock
        self._analysis_id: str | None = None
        client.app.state.container.payment_client_factory = (
            lambda config: PayPalApiClient(config, transport=mock.transport())
        )
        client.app.state.container.refund_gateway_factory = (
            lambda config: PayPalRefundGateway(
                config, PayPalApiClient(config, transport=mock.transport())
            )
        )

    # -- setup -------------------------------------------------------------
    def import_capture(self):
        return self.client.post(
            f"/api/v1/payments/captures/{CAPTURE}/import", headers=SYSTEM
        )

    def analysis_id(self) -> str:
        if self._analysis_id is None:
            response = self.client.post(
                f"/api/v1/cases/{CASE_ID}/analyses", headers=SPECIALIST
            )
            assert response.status_code == 200, response.text
            self._analysis_id = response.json()["analysis_id"]
        return self._analysis_id

    def draft(self, action: str = PARTIAL, payload: dict | None = None, **overrides):
        body = {
            "case_id": CASE_ID,
            "analysis_id": self.analysis_id(),
            "action_type": action,
            "action_payload": (
                {"amount": "4.00", "idempotency_key": KEY}
                if payload is None
                else payload
            ),
        }
        body.update(overrides)
        return self.client.post(
            f"/api/v1/cases/{CASE_ID}/proposals", headers=SPECIALIST, json=body
        )

    def submit(self, proposal_id: str):
        return self.client.post(
            f"/api/v1/proposals/{proposal_id}/submit", headers=SPECIALIST
        )

    def approve(self, proposal_id: str, decision: str = "APPROVED"):
        submitted = self.submit(proposal_id)
        assert submitted.status_code == 200, submitted.text
        approval_id = submitted.json()["approval"]["approval_id"]
        decided = self.client.post(
            f"/api/v1/approvals/{approval_id}/decision",
            headers=MANAGER,
            json={"decision": decision, "reason": "refund test"},
        )
        assert decided.status_code == 200, decided.text
        return approval_id

    def execute(self, approval_id: str):
        return self.client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )

    def ready(self, action: str = PARTIAL, payload: dict | None = None) -> str:
        """Import → present a capture as a case → draft → approve."""
        assert self.import_capture().status_code == 200
        draft = self.draft(action, payload)
        assert draft.status_code == 200, draft.text
        return self.approve(draft.json()["proposal_id"])

    def audit(self) -> list[dict]:
        return self.client.get(f"/api/v1/cases/{CASE_ID}/audit").json()["events"]


@pytest.fixture()
def rig(app, monkeypatch):
    _env(monkeypatch)
    mock = MockPayments()
    with TestClient(app) as client:
        yield Rig(client, mock)


def _validator_ids(response) -> list[str]:
    report = response.json()["error"]["validation_report"]
    return [
        f["validator_id"] for f in report["findings"] if f["status"] == "FAIL"
    ]


# =====================================================================  client
def _client(handler, **overrides) -> PayPalApiClient:
    return PayPalApiClient(
        sandbox_config(**overrides), transport=httpx.MockTransport(handler)
    )


def test_client_post_refund_partial_sends_the_exact_body():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        seen["path"] = request.url.path
        seen["raw"] = request.content
        seen["prefer"] = request.headers.get("prefer")
        seen["request_id"] = request.headers.get("paypal-request-id")
        seen["redirects"] = request.headers.get("content-type")
        return httpx.Response(
            201, json={"id": "REF-1", "status": "COMPLETED"}
        )

    client = _client(handler)
    try:
        response = client.post_refund(CAPTURE, "4.00", "usd", "KEY-1")
    finally:
        client.close()

    assert response.status_code == 201
    assert seen["path"] == f"/v2/payments/captures/{CAPTURE}/refund"
    assert json.loads(seen["raw"]) == {
        "amount": {"value": "4.00", "currency_code": "USD"}
    }
    assert seen["prefer"] == "return=representation"
    assert seen["request_id"] == "KEY-1"
    assert "json" in (seen["redirects"] or "")


def test_client_post_refund_full_sends_an_empty_json_object():
    seen: dict[str, bytes] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        seen["raw"] = request.content
        return httpx.Response(201, json={"id": "REF-2", "status": "COMPLETED"})

    client = _client(handler)
    try:
        client.post_refund(CAPTURE, None, "USD", "KEY-2")
    finally:
        client.close()

    assert seen["raw"] == b"{}"


def test_client_refund_reads_and_single_attempt_on_5xx():
    calls = {"post": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        if request.method == "POST":
            calls["post"] += 1
            return httpx.Response(503, json={"name": "INTERNAL_SERVER_ERROR"})
        return httpx.Response(200, json={"id": "REF-3", "status": "COMPLETED"})

    client = _client(handler)
    try:
        assert client.get_capture(CAPTURE)["id"] == "REF-3"
        assert client.get_refund("REF-3")["status"] == "COMPLETED"
        with pytest.raises(PayPalError) as raised:
            client.post_refund(CAPTURE, "1.00", "USD", "KEY-3")
    finally:
        client.close()

    assert raised.value.kind == PayPalErrorKind.UNAVAILABLE
    assert calls["post"] == 1  # writes are never retried


def test_client_never_follows_a_redirect():
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        paths.append(request.url.path)
        return httpx.Response(
            302, headers={"location": "/v2/payments/refunds/ELSEWHERE"}
        )

    client = _client(handler)
    try:
        response = client.post_refund(CAPTURE, "1.00", "USD", "KEY-4")
    finally:
        client.close()

    # The redirect target is never requested: exactly one POST left the client.
    assert paths == [f"/v2/payments/captures/{CAPTURE}/refund"]
    assert response.status_code == 302


# =====================================================================  import
def test_capture_import_creates_a_payment_case(rig):
    response = rig.import_capture()
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["case_id"] == CASE_ID
    assert body["capture_status"] == "COMPLETED"
    assert body["amount"] == {"value": "100.00", "currency_code": "USD"}
    assert body["total_refunded"]["value"] == "0.00"
    assert body["refundable_remaining"]["value"] == "100.00"
    assert body["inserted"] is True
    assert body["provenance"] == "PAYPAL_API_OBSERVED"
    assert "never resolves or closes a dispute" in body["warning"]

    case = rig.client.get(f"/api/v1/cases/{CASE_ID}").json()
    assert case["family"] == "BILLING"
    assert case["reason"] == "OTHER"
    assert case["status"] == "IMPORTED"
    assert case["provenance"] == "PAYPAL_API_OBSERVED"
    assert case["transaction_reference"]["capture_id"] == CAPTURE
    assert "capture status=COMPLETED" in case["live_status_note"]
    assert "total_refunded=0.00" in case["live_status_note"]
    assert "refundable_remaining=100.00" in case["live_status_note"]
    # a capture is not a dispute
    assert case["dispute_id"] == "UNKNOWN"

    events = rig.audit()
    imported = [e for e in events if e["event_type"] == "CASE_IMPORTED"]
    assert imported[-1]["payload"]["source"] == "PAYPAL_PAYMENTS_CAPTURE"
    assert imported[-1]["payload"]["refundable_remaining"] == "100.00"


def test_capture_import_is_idempotent_and_refreshes(rig):
    first = rig.import_capture().json()
    rig.mock.set_capture(raw_capture(total_refunded="40.00", status="PARTIALLY_REFUNDED"))
    second = rig.import_capture().json()

    assert (first["inserted"], first["refreshed"]) == (True, False)
    assert (second["inserted"], second["refreshed"]) == (False, True)
    assert second["capture_status"] == "PARTIALLY_REFUNDED"
    assert second["total_refunded"]["value"] == "40.00"
    assert second["refundable_remaining"]["value"] == "60.00"
    assert len(rig.client.get("/api/v1/cases").json()) == 1


def test_capture_import_requires_the_system_role(rig):
    response = rig.client.post(
        f"/api/v1/payments/captures/{CAPTURE}/import", headers=SPECIALIST
    )
    assert response.status_code == 403
    assert rig.mock.capture_get_calls == 0


def test_capture_import_maps_upstream_404(app, monkeypatch):
    _env(monkeypatch)
    mock = MockPayments(capture_get_status=404)
    with TestClient(app) as client:
        Rig(client, mock)
        response = client.post(
            f"/api/v1/payments/captures/{CAPTURE}/import", headers=SYSTEM
        )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DOMAIN_ERROR"
    assert response.json()["error"]["details"]["kind"] == "NOT_FOUND"
    assert mock.capture_get_calls == 1
    assert mock.refund_post_calls == 0


def test_capture_import_requires_sandbox_mode(app, monkeypatch):
    for name in _PAYPAL_ENV:
        monkeypatch.delenv(name, raising=False)
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/payments/captures/{CAPTURE}/import", headers=SYSTEM
        )
    assert response.status_code == 409
    assert "DP_DATA_MODE=paypal_sandbox" in response.json()["error"]["message"]


# ====================================================================  drafts
def test_partial_draft_writes_the_server_capture_snapshot(rig):
    rig.import_capture()
    response = rig.draft()
    assert response.status_code == 200, response.text
    proposal = response.json()

    assert proposal["action_family"] == "PAYMENT"
    assert proposal["risk_level"] == "HIGH"
    payload = proposal["action_payload"]
    assert payload["capture_snapshot"] == {
        "capture_id": CAPTURE,
        "status": "COMPLETED",
        "original_amount": "100.00",
        "total_refunded": "0.00",
        "refundable_remaining": "100.00",
        "currency_code": "USD",
    }
    assert payload["amount"] == "4.00"
    assert payload["currency_code"] == "USD"
    assert payload["idempotency_key"] == KEY
    assert proposal["payload_hash"]


def test_client_snapshot_mismatch_is_422(rig):
    rig.import_capture()
    response = rig.draft(
        payload={
            "amount": "4.00",
            "idempotency_key": KEY,
            "capture_snapshot": {
                "capture_id": CAPTURE,
                "status": "COMPLETED",
                "original_amount": "100.00",
                "total_refunded": "0.00",
                "refundable_remaining": "90.00",
                "currency_code": "USD",
            },
        }
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
    assert "does not match the server's capture read" in response.json()["error"][
        "message"
    ]


def test_client_snapshot_echo_is_accepted(rig):
    rig.import_capture()
    snapshot = {
        "capture_id": CAPTURE,
        "status": "COMPLETED",
        "original_amount": "100.00",
        "total_refunded": "0.00",
        "refundable_remaining": "100.00",
        "currency_code": "USD",
    }
    response = rig.draft(
        payload={"amount": "4.00", "idempotency_key": KEY, "capture_snapshot": snapshot}
    )
    assert response.status_code == 200, response.text
    assert response.json()["action_payload"]["capture_snapshot"] == snapshot


def test_partial_amount_is_canonicalised_without_rounding(rig):
    rig.import_capture()
    response = rig.draft(payload={"amount": "4", "idempotency_key": KEY})
    assert response.status_code == 200, response.text
    assert response.json()["action_payload"]["amount"] == "4.00"


@pytest.mark.parametrize(
    "amount, expected",
    [
        ("4.005", "2 decimal places"),
        ("0.00", "greater than 0.00"),
        ("-1.00", "negative"),
    ],
)
def test_malformed_or_non_positive_amount_is_rejected_at_draft(rig, amount, expected):
    rig.import_capture()
    response = rig.draft(payload={"amount": amount, "idempotency_key": KEY})
    assert response.status_code == 422
    assert expected in response.json()["error"]["message"]
    assert rig.mock.refund_post_calls == 0


def test_full_draft_carries_no_amount(rig):
    rig.import_capture()
    response = rig.draft(action=FULL, payload={"idempotency_key": KEY})
    assert response.status_code == 200, response.text
    payload = response.json()["action_payload"]
    assert "amount" not in payload
    assert payload["capture_snapshot"]["refundable_remaining"] == "100.00"
    assert payload["currency_code"] == "USD"
    assert response.json()["action_family"] == "PAYMENT"


def test_action_family_is_derived_for_dispute_proposals(ready):
    response = ready.post("/api/v1/cases/O4/analyses", headers=SPECIALIST)
    analysis_id = response.json()["analysis_id"]
    proposal = ready.post(
        f"/api/v1/cases/O4/proposals",
        headers=SPECIALIST,
        json={
            "case_id": "O4",
            "analysis_id": analysis_id,
            "action_type": "send-message",
            "action_payload": {"message": "hello", "idempotency_key": "K-1"},
        },
    ).json()
    assert proposal["action_family"] == "DISPUTE"


def test_client_action_family_cannot_relabel_an_action(rig):
    """``action_family`` is advisory: a refund stays PAYMENT, evidence DISPUTE."""
    rig.import_capture()
    response = rig.draft(
        payload={"amount": "4.00", "idempotency_key": KEY},
        action_family="DISPUTE",
    )
    assert response.status_code == 200, response.text
    assert response.json()["action_family"] == "PAYMENT"


# ================================================================  validators
def test_partial_refund_passes_v13_to_v18(rig):
    rig.import_capture()
    proposal = rig.draft().json()
    submitted = rig.submit(proposal["proposal_id"])
    assert submitted.status_code == 200, submitted.text

    report = rig.client.get(
        f"/api/v1/proposals/{proposal['proposal_id']}/validation"
    ).json()
    assert report["passed"] is True
    findings = {f["validator_id"]: f for f in report["findings"]}
    assert set(findings) == {"V13", "V14", "V15", "V16", "V17", "V18"}
    assert all(f["status"] == "PASS" for f in findings.values())
    assert findings["V15"]["basis"] == "LIVE_HATEOAS"
    assert "PAYPAL_PAYMENTS_V2_REFUND" in findings["V13"]["doc_reference"]


def test_amount_over_remaining_is_v15(rig):
    rig.import_capture()
    proposal = rig.draft(payload={"amount": "100.01", "idempotency_key": KEY}).json()
    response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    assert _validator_ids(response) == ["V15"]
    assert "exceeds the refundable remaining" in response.text
    assert rig.mock.refund_post_calls == 0


def test_currency_mismatch_is_v15(rig):
    rig.import_capture()
    proposal = rig.draft(
        payload={"amount": "4.00", "currency_code": "EUR", "idempotency_key": KEY}
    ).json()
    response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    assert _validator_ids(response) == ["V15"]
    assert "EUR" in response.text


def test_capture_that_cannot_be_resolved_is_v13(rig):
    rig.import_capture()
    proposal = rig.draft().json()
    rig.mock.capture_get_status = 404
    response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    assert "V13" in _validator_ids(response)
    assert "could not be resolved" in response.text


def test_capture_of_another_merchant_is_v13(app, monkeypatch):
    _env(monkeypatch, merchant=MERCHANT_ID)
    mock = MockPayments(capture=raw_capture(payee_merchant_id="OTHER-MERCHANT"))
    with TestClient(app) as client:
        rig = Rig(client, mock)
        rig.import_capture()
        proposal = rig.draft().json()
        response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    assert _validator_ids(response) == ["V13"]
    assert "OTHER-MERCHANT" in response.text


def test_capture_owned_by_this_merchant_passes_v13(app, monkeypatch):
    _env(monkeypatch, merchant=MERCHANT_ID)
    mock = MockPayments(capture=raw_capture(payee_merchant_id=MERCHANT_ID))
    with TestClient(app) as client:
        rig = Rig(client, mock)
        rig.import_capture()
        proposal = rig.draft().json()
        response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 200, response.text


def test_already_fully_refunded_capture_is_v14(app, monkeypatch):
    _env(monkeypatch)
    mock = MockPayments(
        capture=raw_capture(status="REFUNDED", total_refunded="100.00")
    )
    with TestClient(app) as client:
        rig = Rig(client, mock)
        rig.import_capture()
        proposal = rig.draft(payload={"amount": "1.00", "idempotency_key": KEY}).json()
        response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    assert "V14" in _validator_ids(response)
    assert "REFUNDED" in response.text


def test_pending_capture_is_v14(app, monkeypatch):
    _env(monkeypatch)
    mock = MockPayments(capture=raw_capture(status="PENDING"))
    with TestClient(app) as client:
        rig = Rig(client, mock)
        rig.import_capture()
        proposal = rig.draft().json()
        response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    assert "V14" in _validator_ids(response)


def test_full_refund_with_zero_remaining_is_refused(app, monkeypatch):
    _env(monkeypatch)
    mock = MockPayments(capture=raw_capture(status="REFUNDED", total_refunded="100.00"))
    with TestClient(app) as client:
        rig = Rig(client, mock)
        rig.import_capture()
        proposal = rig.draft(action=FULL, payload={"idempotency_key": KEY}).json()
        response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    ids = _validator_ids(response)
    assert "V14" in ids and "V16" in ids


def test_full_refund_with_an_amount_is_v15(rig):
    rig.import_capture()
    proposal = rig.draft(
        action=FULL, payload={"amount": "5.00", "idempotency_key": KEY}
    ).json()
    response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    assert _validator_ids(response) == ["V15"]
    assert "must not carry an amount" in response.text


def test_missing_idempotency_key_is_v17(rig):
    rig.import_capture()
    proposal = rig.draft(payload={"amount": "4.00"}).json()
    response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    assert _validator_ids(response) == ["V17"]


def test_accept_claim_field_is_v18(rig):
    rig.import_capture()
    proposal = rig.draft(
        payload={"amount": "4.00", "idempotency_key": KEY, "accept_claim": True}
    ).json()
    response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    assert _validator_ids(response) == ["V18"]
    assert "accept_claim" in response.text


def test_unknown_payload_field_is_v18(rig):
    rig.import_capture()
    proposal = rig.draft(
        payload={"amount": "4.00", "idempotency_key": KEY, "escalate": True}
    ).json()
    response = rig.submit(proposal["proposal_id"])
    assert response.status_code == 422
    assert _validator_ids(response) == ["V18"]


def test_pending_refund_blocks_a_second_refund_v16(rig):
    rig.mock.refund_status = "PENDING"
    first = rig.ready()
    assert rig.execute(first).json()["result"] == "PENDING"

    second = rig.draft(payload={"amount": "5.00", "idempotency_key": "KEY-2"}).json()
    response = rig.submit(second["proposal_id"])
    assert response.status_code == 422
    assert _validator_ids(response) == ["V16"]
    assert "PENDING/UNKNOWN" in response.text


# ===================================================================  gateway
def test_partial_refund_executes_and_is_confirmed(rig):
    approval_id = rig.ready()
    response = rig.execute(approval_id)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["result"] == "EXECUTED"
    assert body["execution_mode"] == "LIVE"
    assert body["simulated"] is False
    assert body["gateway"] == "PayPalRefundGateway"
    assert body["warning"].startswith("LIVE PayPal Sandbox result")

    verification = body["verification"]
    assert verification["method"] == "LIVE_GET"
    assert verification["basis"] == "REMOTE_GET"
    assert verification["confirmed"] is True
    assert verification["matched_refund_id"] == "REF-10A1B2C3D4"
    assert verification["refund_status"] == "COMPLETED"
    assert verification["amount"] == "4.00"
    assert verification["currency"] == "USD"
    assert verification["capture_id"] == CAPTURE
    assert verification["capture_status_before"] == "COMPLETED"
    assert verification["capture_status_after"] == "PARTIALLY_REFUNDED"
    assert verification["refundable_remaining_after"] == "96.00"
    assert verification["dispute_resolution"] == "NONE"
    assert "does not accept the claim" in verification["dispute_resolution_note"]

    # one POST, exact body, fixed idempotency key, never retried
    assert rig.mock.refund_post_calls == 1
    assert rig.mock.last_post_raw == (
        b'{"amount":{"value":"4.00","currency_code":"USD"}}'
    )
    assert rig.mock.last_post_request_id == KEY
    assert rig.mock.last_post_headers["prefer"] == "return=representation"
    assert rig.mock.refund_get_calls == 1

    types = [e["event_type"] for e in rig.audit()]
    assert types.index("EXECUTION_ATTEMPT") < types.index("EXECUTION_VERIFIED")
    attempt = next(e for e in rig.audit() if e["event_type"] == "EXECUTION_ATTEMPT")
    assert attempt["payload"]["action_family"] == "PAYMENT"
    assert attempt["payload"]["capture_id"] == CAPTURE
    assert attempt["payload"]["precheck"]["refundable_remaining"] == "100.00"

    stored = rig.client.get(
        f"/api/v1/proposals/{body['proposal_id']}/execution"
    ).json()
    assert stored["result"] == "EXECUTED"
    assert stored["verification"]["matched_refund_id"] == "REF-10A1B2C3D4"


def test_partial_refund_equal_to_remaining_leaves_the_capture_refunded(rig):
    approval_id = rig.ready(payload={"amount": "100.00", "idempotency_key": KEY})
    body = rig.execute(approval_id).json()
    assert body["result"] == "EXECUTED"
    assert body["verification"]["capture_status_after"] == "REFUNDED"
    assert body["verification"]["refundable_remaining_after"] == "0.00"


def test_full_refund_sends_an_empty_body(rig):
    approval_id = rig.ready(action=FULL, payload={"idempotency_key": KEY})
    body = rig.execute(approval_id).json()

    assert body["result"] == "EXECUTED"
    assert rig.mock.last_post_raw == b"{}"
    assert body["verification"]["amount"] == "100.00"
    assert body["verification"]["capture_status_after"] == "REFUNDED"


def test_full_refund_on_a_partially_refunded_capture_refunds_the_balance(rig):
    rig.mock.set_capture(raw_capture(total_refunded="40.00", status="PARTIALLY_REFUNDED"))
    approval_id = rig.ready(action=FULL, payload={"idempotency_key": KEY})
    draft_snapshot = rig.client.get(
        f"/api/v1/cases/{CASE_ID}/proposals"
    ).json()[0]["action_payload"]["capture_snapshot"]
    assert draft_snapshot["refundable_remaining"] == "60.00"

    body = rig.execute(approval_id).json()
    assert body["result"] == "EXECUTED"
    assert rig.mock.last_post_raw == b"{}"
    assert body["verification"]["amount"] == "60.00"
    assert body["verification"]["refundable_remaining_after"] == "0.00"


def test_capture_drift_between_approval_and_post_is_blocked(rig):
    approval_id = rig.ready()
    # A refund landed elsewhere after approval: the balance is no longer the
    # one the manager approved.
    rig.mock.set_capture(raw_capture(total_refunded="1.00"))

    body = rig.execute(approval_id).json()
    assert body["result"] == "BLOCKED"
    assert body["verification"]["blocked_stage"] == "precheck"
    assert "already-refunded amount changed" in body["verification"]["blocked_reason"]
    assert body["verification"]["post_issued"] is False
    assert rig.mock.refund_post_calls == 0


def test_capture_claim_blocks_a_concurrent_refund(rig):
    approval_id = rig.ready()
    session = get_session_factory()()
    try:
        IdempotencyRepository(session).put(
            f"refund-capture:{CAPTURE}",
            "refund-capture",
            '{"state": "CLAIMED"}',
        )
        session.commit()
    finally:
        session.close()

    response = rig.execute(approval_id)
    assert response.status_code == 409
    assert "already claimed" in response.json()["error"]["message"]
    assert rig.mock.refund_post_calls == 0


def test_duplicate_execution_is_refused_after_one_post(rig):
    approval_id = rig.ready()
    first = rig.execute(approval_id)
    second = rig.execute(approval_id)

    assert first.status_code == 200 and first.json()["result"] == "EXECUTED"
    assert second.status_code == 409
    assert "already executed" in second.json()["error"]["message"]
    assert rig.mock.refund_post_calls == 1


def test_timeout_without_a_refund_id_is_unverified(rig):
    rig.mock.post_status = "timeout"
    approval_id = rig.ready()

    body = rig.execute(approval_id).json()
    assert body["result"] == "UNVERIFIED"
    assert body["verification"]["confirmed"] is False
    assert body["verification"]["matched_refund_id"] is None
    assert "HUMAN_REVIEW" not in body["warning"]
    assert "no automatic retry" in body["warning"]
    assert rig.mock.refund_post_calls == 1
    assert rig.mock.refund_get_calls == 0

    unknown = next(e for e in rig.audit() if e["event_type"] == "EXECUTION_UNKNOWN")
    assert unknown["payload"]["confirmed"] is False
    assert unknown["payload"]["next_action"] == "HUMAN_REVIEW"


def test_timeout_resolved_by_the_capture_refunds_hint_is_executed(rig):
    rig.mock.post_status = "timeout"
    rig.mock.expose_refunds_after_post = True
    approval_id = rig.ready()

    body = rig.execute(approval_id).json()
    assert body["result"] == "EXECUTED"
    assert body["verification"]["matched_refund_id_source"] == "CAPTURE_REFUNDS_HINT"
    assert body["verification"]["confirmed"] is True
    assert rig.mock.refund_post_calls == 1


def test_unverified_is_never_retried(rig):
    rig.mock.post_status = "timeout"
    approval_id = rig.ready()
    first = rig.execute(approval_id)
    second = rig.execute(approval_id)

    assert first.json()["result"] == "UNVERIFIED"
    assert second.status_code == 409
    assert "never retried" in second.json()["error"]["message"]
    assert rig.mock.refund_post_calls == 1


def test_pending_refund_is_persisted_as_pending_not_success(rig):
    rig.mock.refund_status = "PENDING"
    approval_id = rig.ready()

    body = rig.execute(approval_id).json()
    assert body["result"] == "PENDING"
    assert body["execution_mode"] == "LIVE"
    assert body["verification"]["confirmed"] is False
    assert body["verification"]["refund_status"] == "PENDING"
    assert "NOT settled" in body["warning"]

    stored = rig.client.get(
        f"/api/v1/proposals/{body['proposal_id']}/execution"
    ).json()
    assert stored["result"] == "PENDING"
    assert stored["simulated"] is False

    proposal = rig.client.get(f"/api/v1/proposals/{body['proposal_id']}").json()
    assert proposal["state"] == "FAILED"  # never REPLAY_EXECUTED for PENDING
    assert proposal["state"] != "REPLAY_EXECUTED"

    unknown = next(e for e in rig.audit() if e["event_type"] == "EXECUTION_UNKNOWN")
    assert unknown["payload"]["next_action"] == "RECONCILE_PENDING_REFUND"
    assert unknown["payload"]["refund_status"] == "PENDING"


def test_failed_refund_is_failed(rig):
    rig.mock.refund_status = "FAILED"
    approval_id = rig.ready()

    body = rig.execute(approval_id).json()
    assert body["result"] == "FAILED"
    assert body["verification"]["confirmed"] is False
    assert body["verification"]["refund_status"] == "FAILED"
    assert "settled as FAILED" in body["verification"]["failure_reason"]
    assert rig.mock.refund_post_calls == 1


def test_refund_get_failure_is_unverified(rig):
    rig.mock.refund_get_status = 500
    approval_id = rig.ready()

    body = rig.execute(approval_id).json()
    assert body["result"] == "UNVERIFIED"
    assert body["verification"]["confirmed"] is False
    assert "read-back failed" in body["verification"]["uncertain_reason"]
    assert rig.mock.refund_post_calls == 1


def test_refund_amount_mismatch_is_unverified(rig):
    rig.mock.refund_amount_override = "5.00"
    approval_id = rig.ready()

    body = rig.execute(approval_id).json()
    assert body["result"] == "UNVERIFIED"
    assert body["verification"]["amount_matches_approval"] is False
    assert body["verification"]["refund_status"] == "COMPLETED"


def test_refund_capture_mismatch_is_unverified(rig):
    rig.mock.refund_capture_override = "ANOTHER-CAPTURE"
    approval_id = rig.ready()

    body = rig.execute(approval_id).json()
    assert body["result"] == "UNVERIFIED"
    assert body["verification"]["capture_matches_refund"] is False


def test_refund_rejected_with_4xx_is_failed(rig):
    rig.mock.post_status = 422
    approval_id = rig.ready()

    body = rig.execute(approval_id).json()
    assert body["result"] == "FAILED"
    assert body["verification"]["failed_stage"] == "post"
    assert body["verification"]["post_issued"] is True
    assert rig.mock.refund_post_calls == 1
    assert rig.mock.refund_get_calls == 0


def test_refund_write_gate_needs_the_capture_allow_entry(app, monkeypatch):
    _env(monkeypatch, writes=False)
    mock = MockPayments()
    with TestClient(app) as client:
        rig = Rig(client, mock)
        assert rig.import_capture().status_code == 200
        proposal = rig.draft().json()
        approval_id = rig.approve(proposal["proposal_id"])
        response = rig.execute(approval_id)

    assert response.status_code == 409
    assert "DP_PAYPAL_WRITES_ENABLED=1" in response.json()["error"]["message"]
    assert mock.refund_post_calls == 0


def test_no_double_authorisation_is_granted_by_a_refund(rig):
    """A refund never touches dispute acceptance: no accept-claim, no closure."""
    approval_id = rig.ready()
    body = rig.execute(approval_id).json()
    assert body["result"] == "EXECUTED"

    serialized = json.dumps(body, sort_keys=True)
    assert "accept_claim" not in serialized
    assert "accept-claim" not in serialized
    assert "RESOLVED" not in serialized
    assert "closed" not in serialized.lower().replace("closes the dispute", "")

    case = rig.client.get(f"/api/v1/cases/{CASE_ID}").json()
    assert case["dispute_status"] == "UNKNOWN"
