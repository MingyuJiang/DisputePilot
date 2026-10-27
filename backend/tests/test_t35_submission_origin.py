"""T35 — approval ← submission batch reverse traceability (MVP-1.2).

The origin must be resolved from stored relations, report an honest "no batch"
state, and never change the approval it describes.
"""

from __future__ import annotations

import sqlite3

import pytest

from tests.conftest import MANAGER, SPECIALIST
from tests.demo_support import demo_client

CASES = [
    "DEMO-INR-O7",
    "DEMO-SNAD-O13",
    "DEMO-BILL-O16",
    "DEMO-BLOCK-O9",
    "CAP-DEMO-9001",
]
RUNS = "/api/v1/autopilot/runs"
ORIGIN = "/api/v1/approvals/{approval_id}/submission-origin"


def _run(client, key="origin-run-1"):
    response = client.post(
        RUNS,
        json={"case_ids": CASES, "mode": "TRIAGE_ONLY"},
        headers={**SPECIALIST, "Idempotency-Key": key},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _submit(client, run_id, key):
    response = client.post(
        f"{RUNS}/{run_id}/submit-for-review",
        json={},
        headers={**SPECIALIST, "Idempotency-Key": key},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _origin(client, approval_id):
    return client.get(ORIGIN.format(approval_id=approval_id))


def _exec(db_path, sql, params=()):
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _count(db_path, table: str, where: str = "") -> int:
    conn = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)
    try:
        query = f"SELECT COUNT(*) FROM {table}"
        if where:
            query += f" WHERE {where}"
        return int(conn.execute(query).fetchone()[0])
    finally:
        conn.close()


@pytest.fixture()
def demo(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch, ai_provider="frozen") as (client, db_path):
        yield client, db_path


# ----------------------------------------------------------------- happy path
def test_batch_approval_reports_its_origin(demo):
    client, _ = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], "origin-batch-1")

    item = next(i for i in batch["results"] if i["case_id"] == "DEMO-INR-O7")
    response = _origin(client, item["approval_id"])
    assert response.status_code == 200, response.text
    origin = response.json()

    assert origin["source_type"] == "AUTOPILOT_BATCH"
    assert origin["approval_id"] == item["approval_id"]
    assert origin["submission_batch_id"] == batch["submission_batch_id"]
    assert origin["run_id"] == run["run_id"]
    assert origin["case_id"] == "DEMO-INR-O7"
    assert origin["proposal_id"] == item["proposal_id"]
    assert origin["submission_status"] == "SUBMITTED_FOR_REVIEW"
    assert origin["reason_code"] == "SUBMITTED_FOR_REVIEW"
    assert origin["approval_decision"] == "PENDING"
    assert origin["submitted_at"]


def test_origin_validation_matches_the_submit_time_snapshot(demo):
    client, _ = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], "origin-batch-2")
    item = next(i for i in batch["results"] if i["case_id"] == "DEMO-SNAD-O13")

    stored = client.get(
        f"/api/v1/autopilot/submission-batches/{batch['submission_batch_id']}"
    ).json()
    stored_item = next(i for i in stored["results"] if i["case_id"] == "DEMO-SNAD-O13")

    origin = _origin(client, item["approval_id"]).json()
    assert origin["validation_report_id"] == stored_item["validation_report_id"]
    assert origin["validation_passed"] is True
    assert origin["validation_report_id"] == stored_item["validator"]["report_id"]


def test_a_later_batch_referencing_the_same_approval_is_not_the_origin(demo):
    client, _ = demo
    run = _run(client)
    first = _submit(client, run["run_id"], "origin-batch-3a")
    second = _submit(client, run["run_id"], "origin-batch-3b")
    assert second["already_submitted_cases"] == 2

    item = next(i for i in first["results"] if i["case_id"] == "DEMO-INR-O7")
    origin = _origin(client, item["approval_id"]).json()

    # the submitting batch wins over the later already-submitted reference
    assert origin["submission_batch_id"] == first["submission_batch_id"]
    assert origin["submission_status"] == "SUBMITTED_FOR_REVIEW"


# ------------------------------------------------------------- no batch source
def test_single_submission_has_no_batch_origin(demo):
    client, _ = demo
    run = _run(client)
    proposal_id = next(
        i["candidate_actions"][0]["proposal_id"]
        for i in run["results"]
        if i["case_id"] == "DEMO-INR-O7"
    )

    r = client.post(f"/api/v1/proposals/{proposal_id}/submit", headers=SPECIALIST)
    assert r.status_code == 200, r.text
    approval_id = r.json()["approval"]["approval_id"]

    origin = _origin(client, approval_id)
    assert origin.status_code == 200, origin.text
    body = origin.json()
    assert body["source_type"] == "SINGLE_SUBMISSION"
    assert body["submission_batch_id"] is None
    assert body["run_id"] is None
    assert body["validation_report_id"] is None
    assert body["reason_code"] is None
    assert body["submitted_at"] is None
    assert body["notes"], "absence must be explained, not silent"


def test_dangling_batch_reference_is_not_reported_as_origin(demo):
    client, db_path = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], "origin-dangling")
    item = next(i for i in batch["results"] if i["case_id"] == "DEMO-INR-O7")

    _exec(
        db_path,
        "DELETE FROM autopilot_submission_batches WHERE submission_batch_id = ?",
        (batch["submission_batch_id"],),
    )

    origin = _origin(client, item["approval_id"]).json()
    assert origin["source_type"] == "SINGLE_SUBMISSION"
    assert origin["submission_batch_id"] is None
    assert origin["run_id"] is None


def test_unknown_approval_is_404(demo):
    client, _ = demo
    response = _origin(client, "APR-does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


# ----------------------------------------------------------------- read-only
def test_origin_read_never_changes_approval_or_proposal_state(demo):
    client, db_path = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], "origin-readonly")
    item = next(i for i in batch["results"] if i["case_id"] == "DEMO-INR-O7")

    before = client.get(f"/api/v1/approvals/{item['approval_id']}").json()
    for _ in range(3):
        assert _origin(client, item["approval_id"]).status_code == 200
    after = client.get(f"/api/v1/approvals/{item['approval_id']}").json()

    assert after == before
    assert after["decision"] == "PENDING"
    assert _count(db_path, "executions") == 0


def test_origin_still_reports_submit_time_validation_after_a_decision(demo):
    """A manager decision changes the approval, not the recorded origin."""
    client, _ = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], "origin-decided")
    item = next(i for i in batch["results"] if i["case_id"] == "DEMO-INR-O7")

    before = _origin(client, item["approval_id"]).json()

    decision = client.post(
        f"/api/v1/approvals/{item['approval_id']}/decision",
        json={"decision": "APPROVED", "reason": "traceability check"},
        headers=MANAGER,
    )
    assert decision.status_code == 200, decision.text

    after = _origin(client, item["approval_id"]).json()
    assert after["approval_decision"] == "APPROVED"
    assert after["proposal_state"] == "APPROVED"
    # the submission-time facts are untouched
    assert after["submission_batch_id"] == before["submission_batch_id"]
    assert after["validation_report_id"] == before["validation_report_id"]
    assert after["validation_passed"] == before["validation_passed"]
    assert after["submitted_at"] == before["submitted_at"]
    assert _count(demo[1], "executions") == 0


# ---------------------------------------------------------------------- safety
def test_origin_read_never_calls_paypal_or_execution(demo, monkeypatch):
    from app.adapters.paypal import client as paypal_client
    from app.services import execution_service

    def _forbidden(*_args, **_kwargs):
        raise AssertionError("origin lookup must not build a PayPal client")

    def _no_execution(*_args, **_kwargs):
        raise AssertionError("origin lookup must not call ExecutionService")

    monkeypatch.setattr(paypal_client.PayPalApiClient, "__init__", _forbidden)
    monkeypatch.setattr(execution_service.ExecutionService, "replay", _no_execution)

    client, _ = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], "origin-safety")
    item = batch["results"][0]

    assert _origin(client, item["approval_id"]).status_code == 200


def test_origin_endpoint_stays_out_of_the_frozen_openapi():
    from app.main import create_app

    paths = create_app().openapi()["paths"]
    assert "/api/v1/approvals/{approval_id}/submission-origin" not in paths


def test_origin_payload_is_stable_across_reads(demo):
    """The creation time must come from storage, not from a per-read default.

    Regression guard for the pre-MVP-1.3 bug: ``Approval.created_at`` was not
    persisted, so the domain default regenerated it on every read.
    """
    client, db_path = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], "origin-stable")
    item = next(i for i in batch["results"] if i["case_id"] == "DEMO-INR-O7")

    conn = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)
    try:
        stored = conn.execute(
            "SELECT created_at FROM approvals WHERE approval_id = ?",
            (item["approval_id"],),
        ).fetchone()[0]
    finally:
        conn.close()

    first = _origin(client, item["approval_id"]).json()
    second = _origin(client, item["approval_id"]).json()
    assert first == second
    assert first["approval_created_at"] == stored
    assert first["approval_created_at_source"] == "CREATED"
