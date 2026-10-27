"""T33 — Autopilot batch submit-for-review (MVP-1).

Covers the boundary that matters: a batch submission creates PENDING approvals
through the existing ApprovalService (with submit-time revalidation) and never
approves, executes or calls PayPal.
"""

from __future__ import annotations

import sqlite3

import pytest

from tests.conftest import MANAGER, SPECIALIST, SYSTEM
from tests.demo_support import demo_client

CASES = [
    "DEMO-INR-O7",
    "DEMO-SNAD-O13",
    "DEMO-BILL-O16",
    "DEMO-BLOCK-O9",
    "CAP-DEMO-9001",
]
RUNS = "/api/v1/autopilot/runs"


def _run(client, case_ids=CASES, *, key=None):
    headers = dict(SPECIALIST)
    if key:
        headers["Idempotency-Key"] = key
    response = client.post(
        RUNS, json={"case_ids": list(case_ids), "mode": "TRIAGE_ONLY"}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def _submit(client, run_id, *, body=None, key=None, headers=None):
    request_headers = dict(headers or SPECIALIST)
    if key:
        request_headers["Idempotency-Key"] = key
    return client.post(
        f"{RUNS}/{run_id}/submit-for-review",
        json=body if body is not None else {},
        headers=request_headers,
    )


def _by_case(body: dict) -> dict[str, dict]:
    return {item["case_id"]: item for item in body["results"]}


def _count(db_path, table: str, where: str = "") -> int:
    conn = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)
    try:
        sql = f"SELECT COUNT(*) FROM {table}"
        if where:
            sql += f" WHERE {where}"
        return int(conn.execute(sql).fetchone()[0])
    finally:
        conn.close()


@pytest.fixture()
def demo(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch, ai_provider="frozen") as (client, db_path):
        yield client, db_path


# ------------------------------------------------------------------ happy path
def test_all_eligible_proposals_are_submitted_in_one_request(demo):
    client, db_path = demo
    run = _run(client)

    response = _submit(client, run["run_id"], key="submit-001")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["status"] == "PARTIAL"
    assert body["run_case_count"] == 5
    assert body["excluded_cases"] == 3
    stored = client.get(f"/api/v1/autopilot/submission-batches/{body['submission_batch_id']}").json()
    assert stored["run_case_count"] == 5 and stored["excluded_cases"] == 3
    assert stored["status"] == "PARTIAL"
    assert body["total_cases"] == 2  # only READY_FOR_REVIEW cases are selected
    assert body["submitted_cases"] == 2
    assert body["skipped_cases"] == 0
    assert body["failed_cases"] == 0
    assert body["executed_actions"] == 0
    assert set(body["requested_case_ids"]) == {"DEMO-INR-O7", "DEMO-SNAD-O13"}

    for item in body["results"]:
        assert item["status"] == "SUBMITTED_FOR_REVIEW"
        assert item["approval_id"]
        assert item["approval_decision"] == "PENDING"
        assert item["proposal_state"] == "PENDING_APPROVAL"
        assert item["validator"]["passed"] is True
        assert item["action_payload_hash"] and item["case_snapshot_hash"]

    # an approval exists, a decision does not, and nothing executed
    assert _count(db_path, "approvals") == 2
    assert _count(db_path, "approvals", "decision = 'PENDING'") == 2
    assert _count(db_path, "executions") == 0

    approvals = client.get("/api/v1/approvals").json()
    assert {a["decision"] for a in approvals} == {"PENDING"}
    assert {a["case_id"] for a in approvals} == {"DEMO-INR-O7", "DEMO-SNAD-O13"}


def test_ineligible_decisions_are_never_submitted(demo):
    client, db_path = demo
    run = _run(client)

    response = _submit(
        client, run["run_id"], body={"case_ids": ["DEMO-BILL-O16", "DEMO-BLOCK-O9", "CAP-DEMO-9001"]}
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["submitted_cases"] == 0
    assert body["skipped_cases"] == 3
    assert _count(db_path, "approvals") == 0

    reasons = {item["case_id"]: " ".join(item["reasons"]) for item in body["results"]}
    assert "WAIT" in reasons["DEMO-BILL-O16"]
    assert "BLOCKED" in reasons["DEMO-BLOCK-O9"]
    assert "NEEDS_HUMAN" in reasons["CAP-DEMO-9001"]


# ------------------------------------------------------------------- idempotency
def test_same_idempotency_key_creates_no_second_approval(demo):
    client, db_path = demo
    run = _run(client)

    first = _submit(client, run["run_id"], key="submit-same").json()
    second = _submit(client, run["run_id"], key="submit-same").json()

    assert second["idempotent_replay"] is True
    assert second["submitted_cases"] == first["submitted_cases"] == 2
    assert _count(db_path, "approvals") == 2


def test_repeat_submit_without_key_reports_already_submitted(demo):
    client, db_path = demo
    run = _run(client)

    _submit(client, run["run_id"], key="first")
    second = _submit(client, run["run_id"], key="second").json()

    assert second["submitted_cases"] == 0
    assert second["already_submitted_cases"] == 2
    assert _count(db_path, "approvals") == 2
    for item in second["results"]:
        assert item["status"] == "ALREADY_SUBMITTED"
        assert item["approval_id"]
        assert item["run_decision"] == "READY_FOR_REVIEW"


# ------------------------------------------------------- submit-time revalidation
def test_state_drift_blocks_submission_and_creates_no_approval(demo):
    """The run's historical pass is not trusted: V9 re-checks the hash."""
    client, db_path = demo
    run = _run(client)

    drift = client.post(
        "/api/v1/cases/DEMO-INR-O7/state",
        json={"dispute_status": "UNDER_REVIEW"},
        headers=SYSTEM,
    )
    assert drift.status_code == 200, drift.text

    body = _submit(client, run["run_id"]).json()
    assert body["status"] == "PARTIAL"
    assert body["blocked_cases"] == 1
    assert body["submitted_cases"] == 1  # O13 is unaffected

    item = _by_case(body)["DEMO-INR-O7"]
    assert item["status"] == "BLOCKED_VALIDATION"
    assert item["approval_id"] is None
    assert any("V9" in reason for reason in item["reasons"]), item["reasons"]
    assert _count(db_path, "approvals", "decision = 'PENDING'") == 1


def test_changed_payload_is_rejected_as_stale(demo):
    """A proposal whose payload no longer matches the run record is stale."""
    client, db_path = demo
    run = _run(client)

    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute(
            "SELECT record_json FROM proposals WHERE proposal_id = ?",
            ("PRP-DEMO-INR-O7-send-message-97230e6a5e",),
        ).fetchone()
        import json

        record = json.loads(row[0])
        record["action_payload"]["message"] = "tampered after the run"
        conn.execute(
            "UPDATE proposals SET record_json = ? WHERE proposal_id = ?",
            (json.dumps(record), "PRP-DEMO-INR-O7-send-message-97230e6a5e"),
        )
        conn.commit()
    finally:
        conn.close()

    body = _submit(client, run["run_id"]).json()
    item = _by_case(body)["DEMO-INR-O7"]
    assert item["status"] == "BLOCKED_STALE"
    assert item["approval_id"] is None
    assert "changed after the run" in " ".join(item["reasons"])
    assert _count(db_path, "approvals", "decision = 'PENDING'") == 1  # only O13


# ------------------------------------------------------------- partial / errors
def test_unknown_case_in_request_does_not_abort_the_batch(demo):
    client, _ = demo
    run = _run(client)

    body = _submit(client, run["run_id"], body={"case_ids": ["DEMO-INR-O7", "NOT-IN-RUN"]}).json()
    assert body["total_cases"] == 2
    assert body["submitted_cases"] == 1
    assert body["skipped_cases"] == 1
    assert _by_case(body)["NOT-IN-RUN"]["status"] == "SKIPPED_NOT_ELIGIBLE"


def test_unknown_run_is_404(demo):
    client, _ = demo
    response = _submit(client, "APR-missing")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_submission_requires_the_specialist_role(demo):
    client, db_path = demo
    run = _run(client)

    response = _submit(client, run["run_id"], headers=MANAGER)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
    assert _count(db_path, "approvals") == 0


# ------------------------------------------------------------------ safety proof
def test_submission_never_executes_or_calls_paypal(demo, monkeypatch):
    from app.adapters.paypal import client as paypal_client
    from app.services import execution_service

    def _forbidden(*_args, **_kwargs):
        raise AssertionError("batch submission must not build a PayPal client")

    def _no_execution(*_args, **_kwargs):
        raise AssertionError("batch submission must not call ExecutionService")

    monkeypatch.setattr(paypal_client.PayPalApiClient, "__init__", _forbidden)
    monkeypatch.setattr(execution_service.ExecutionService, "replay", _no_execution)

    client, db_path = demo
    run = _run(client)
    body = _submit(client, run["run_id"]).json()

    assert body["submitted_cases"] == 2
    assert body["executed_actions"] == 0
    assert _count(db_path, "executions") == 0
    assert all(a["decision"] == "PENDING" for a in client.get("/api/v1/approvals").json())


def test_submitted_approval_stays_pending_after_manager_lists_it(demo):
    """A batch submission is not an approval: the manager still has to decide."""
    client, db_path = demo
    run = _run(client)
    _submit(client, run["run_id"])

    approvals = client.get("/api/v1/approvals").json()
    for approval in approvals:
        assert approval["decision"] == "PENDING"
        assert approval["reason"] == ""
        assert approval["actor_role"] == "SPECIALIST"

    assert _count(db_path, "proposals", "state = 'APPROVED'") == 0
    assert _count(db_path, "proposals", "execution_authorized = 1") == 0
