"""T8 — unified error model (P0 A-3): envelope + codes + OpenAPI declarations.

Six runtime error classes are pinned here:

1. 401 UNAUTHORIZED — missing X-Actor-Id demo identity header;
2. 403 FORBIDDEN — role mismatch / unknown role;
3. 404 NOT_FOUND — unknown resource id;
4. 409 CONFLICT — duplicate execution / already decided / state conflict;
5. 422 REQUEST_INVALID — request FORMAT error (details list);
6. 422 VALIDATION_FAILED — BUSINESS policy block (validation_report).

Every response must use the single envelope
``{"error": {"code", "message", "details"?, "validation_report"?"}}``.
"""

from __future__ import annotations

import asyncio
import json

from starlette.requests import Request

from app.domain.policies import IllegalStateTransition
from tests.conftest import MANAGER, SPECIALIST, SYSTEM

ENVELOPE_KEYS = {"code", "message", "details", "validation_report"}


def _assert_envelope(body, code):
    assert set(body.keys()) == {"error"}, body
    err = body["error"]
    assert set(err.keys()) <= ENVELOPE_KEYS, err
    assert err["code"] == code, err
    assert isinstance(err["message"], str) and err["message"], err


# ------------------------------------------------------------------- 401
def test_missing_actor_id_is_401_unauthorized(ready):
    r = ready.post("/api/v1/cases/import")
    assert r.status_code == 401
    _assert_envelope(r.json(), "UNAUTHORIZED")
    assert "X-Actor-Id" in r.json()["error"]["message"]


# ------------------------------------------------------------------- 403
def test_role_mismatch_is_403_forbidden(ready):
    """SYSTEM-only endpoint called with SPECIALIST role."""
    r = ready.post("/api/v1/cases/import", headers=SPECIALIST)
    assert r.status_code == 403
    _assert_envelope(r.json(), "FORBIDDEN")


def test_unknown_role_is_403_forbidden(ready):
    r = ready.post(
        "/api/v1/cases/import",
        headers={"X-Actor-Id": "someone", "X-Actor-Role": "NINJA"},
    )
    assert r.status_code == 403
    _assert_envelope(r.json(), "FORBIDDEN")


def test_specialist_cannot_decide_403_envelope(ready):
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST).json()
    r = ready.post(
        f"/api/v1/approvals/{sub['approval']['approval_id']}/decision",
        headers=SPECIALIST,
        json={"decision": "APPROVED", "reason": "sneaky"},
    )
    assert r.status_code == 403
    _assert_envelope(r.json(), "FORBIDDEN")


# ------------------------------------------------------------------- 404
def test_unknown_case_is_404_not_found(ready):
    r = ready.get("/api/v1/cases/NOPE")
    assert r.status_code == 404
    _assert_envelope(r.json(), "NOT_FOUND")


def test_unknown_approval_is_404_not_found(ready):
    r = ready.get("/api/v1/approvals/APR-DOES-NOT-EXIST")
    assert r.status_code == 404
    _assert_envelope(r.json(), "NOT_FOUND")


# ------------------------------------------------------------------- 409
def test_duplicate_replay_is_409_conflict(ready):
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST).json()
    approval_id = sub["approval"]["approval_id"]
    ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "ok"},
    )
    first = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
    assert first.status_code == 200
    second = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
    assert second.status_code == 409
    _assert_envelope(second.json(), "CONFLICT")
    assert "already replayed" in second.json()["error"]["message"]


def test_double_decision_is_409_conflict(ready):
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST).json()
    approval_id = sub["approval"]["approval_id"]
    ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "REJECTED", "reason": "no"},
    )
    r = ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "changed mind"},
    )
    assert r.status_code == 409
    _assert_envelope(r.json(), "CONFLICT")


def test_illegal_state_transition_envelope(app):
    """ILLEGAL_STATE_TRANSITION keeps code + 409 (domain-enforced)."""
    handler = app.exception_handlers[IllegalStateTransition]
    scope = {"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""}
    exc = IllegalStateTransition("illegal proposal transition DRAFT -> REPLAY_EXECUTED")
    response = asyncio.run(handler(Request(scope), exc))
    assert response.status_code == 409
    payload = json.loads(response.body)
    _assert_envelope(payload, "ILLEGAL_STATE_TRANSITION")


# ------------------------------------------------------------------- 422 format
def test_malformed_decision_body_is_422_request_invalid(ready):
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST).json()
    r = ready.post(
        f"/api/v1/approvals/{sub['approval']['approval_id']}/decision",
        headers=MANAGER,
        json={"decision": "MAYBE", "reason": "x"},
    )
    assert r.status_code == 422
    body = r.json()
    _assert_envelope(body, "REQUEST_INVALID")
    assert isinstance(body["error"]["details"], list) and body["error"]["details"]
    assert "validation_report" not in body["error"]


def test_missing_body_is_422_request_invalid(ready):
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST).json()
    r = ready.post(f"/api/v1/approvals/{sub['approval']['approval_id']}/decision", headers=MANAGER)
    assert r.status_code == 422
    _assert_envelope(r.json(), "REQUEST_INVALID")


# ------------------------------------------------------------------- 422 business
def test_blocked_proposal_is_422_validation_failed(ready):
    """Business policy block (V2/V7/V11) — carries validation_report."""
    ready.post("/api/v1/cases/O4/analyses", headers=SPECIALIST)
    analysis_id = ready.get("/api/v1/cases/O4/analyses").json()[-1]["analysis_id"]
    draft = ready.post(
        "/api/v1/cases/O4/proposals",
        headers=SPECIALIST,
        json={
            "case_id": "O4",
            "analysis_id": analysis_id,
            "action_type": "refund",
            "action_payload": {"amount": {"value": "15.00", "currency": "USD"}},
        },
    ).json()
    r = ready.post(f"/api/v1/proposals/{draft['proposal_id']}/submit", headers=SPECIALIST)
    assert r.status_code == 422
    body = r.json()
    _assert_envelope(body, "VALIDATION_FAILED")
    report = body["error"]["validation_report"]
    assert report["passed"] is False
    assert report["blocked_reasons"]
    assert "details" not in body["error"]


def test_grounding_failure_is_422_validation_failed(ready):
    ready.post("/api/v1/cases/O4/analyses", headers=SPECIALIST)
    analysis_id = ready.get("/api/v1/cases/O4/analyses").json()[-1]["analysis_id"]
    r = ready.post(
        "/api/v1/cases/O4/proposals",
        headers=SPECIALIST,
        json={
            "case_id": "O4",
            "analysis_id": analysis_id,
            "action_type": "send-message",
            "action_payload": {"message": "hi", "idempotency_key": "DP-X"},
            "evidence_ids": ["EV-DOES-NOT-EXIST"],
        },
    )
    assert r.status_code == 422
    _assert_envelope(r.json(), "VALIDATION_FAILED")


# ------------------------------------------------------------------- OpenAPI
def test_openapi_declares_error_response_on_every_4xx(ready):
    schema = ready.get("/openapi.json").json()
    declarations = 0
    for path, methods in schema["paths"].items():
        for method, op in methods.items():
            for status, resp in op["responses"].items():
                if status.startswith("4"):
                    ref = resp["content"]["application/json"]["schema"].get("$ref")
                    assert ref == "#/components/schemas/ErrorResponse", (path, method, status)
                    declarations += 1
    # every route that can fail is covered
    assert declarations >= 20, declarations
    # no FastAPI default HTTPValidationError leaks into the contract
    assert "HTTPValidationError" not in schema["components"]["schemas"]


def test_openapi_demo_header_descriptions(ready):
    schema = ready.get("/openapi.json").json()
    required = "non-production; NOT authentication"
    future = "Production auth is a future port"
    seen = 0
    for path, methods in schema["paths"].items():
        for op in methods.values():
            for param in op.get("parameters", []):
                if param["name"] in ("x-actor-id", "x-actor-role"):
                    desc = param.get("description", "")
                    assert required in desc, (path, param["name"], desc)
                    assert future in desc, (path, param["name"], desc)
                    seen += 1
    assert seen >= 5, seen


def test_openapi_info_is_demo_only(ready):
    """The advertised API must keep saying it is a non-production demo.

    History (why this test changed): until commit 1d2d3d5 the description read
    "OFFLINE REPLAY MODE ONLY: no PayPal API calls, no network access, no
    credentials". That stopped being true when the read-only PayPal Sandbox
    adapter landed in v1.3, so the commit replaced the paragraph — but this
    test was left asserting the old wording, and the suite stayed red.

    The assertions below are the safety claims that still hold and that the
    contract v1.3 `info` block also carries: demo-only, non-production, and an
    explicit statement of the execution modes. The frozen contract's full
    `info.description` is itself pre-sandbox prose; aligning it (and the runtime
    title) is recorded as a v1.4 documentation-only proposal, not a silent edit
    to v1.3.
    """
    schema = ready.get("/openapi.json").json()
    description = schema["info"]["description"]

    assert "DEMO ONLY" in description
    assert "NOT FOR PRODUCTION USE" in description
    assert "NOT production authentication" in description
    # Both modes must be named: claiming "offline only" would now be false.
    assert "OFFLINE REPLAY" in description
    assert "PAYPAL SANDBOX" in description
    assert schema["info"]["version"] == "1.3.0"


# ------------------------------------------------------------------- $refs
def _iter_refs(node):
    """Yield every ``$ref`` string value found anywhere in a spec subtree."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                yield value
            else:
                yield from _iter_refs(value)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_refs(item)


def test_openapi_error_response_registered_and_no_dangling_refs(ready):
    """Regression guard: ErrorResponse must be registered in
    components/schemas (via FastAPI ``model`` declaration, not a hand-written
    $ref) and every local $ref in the spec must resolve."""
    schema = ready.get("/openapi.json").json()
    # 1. ErrorResponse actually registered
    assert "ErrorResponse" in schema["components"]["schemas"], sorted(
        schema["components"]["schemas"]
    )
    # 2. every local $ref resolves to an existing node
    dangling = []
    ref_count = 0
    for ref in _iter_refs(schema):
        if not ref.startswith("#/"):
            continue
        ref_count += 1
        node = schema
        for part in ref[2:].split("/"):
            part = part.replace("~1", "/").replace("~0", "~")
            if isinstance(node, dict) and part in node:
                node = node[part]
            elif isinstance(node, list) and part.isdigit() and int(part) < len(node):
                node = node[int(part)]
            else:
                dangling.append(ref)
                break
    assert not dangling, f"dangling refs: {sorted(set(dangling))}"
    assert ref_count >= 50, ref_count
    # 3. at least one ref actually points at ErrorResponse
    assert any(
        ref == "#/components/schemas/ErrorResponse" for ref in _iter_refs(schema)
    )
