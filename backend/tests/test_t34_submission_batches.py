"""T34 — durable submission batches (MVP-1.1).

The batch row is the record of truth: it must survive a restart, answer which
approvals were created, and make a keyed retry distinguishable from a reused
key with a different body.
"""

from __future__ import annotations

import sqlite3

import pytest
from sqlalchemy.exc import IntegrityError

from tests.conftest import SPECIALIST
from tests.demo_support import demo_client

CASES = [
    "DEMO-INR-O7",
    "DEMO-SNAD-O13",
    "DEMO-BILL-O16",
    "DEMO-BLOCK-O9",
    "CAP-DEMO-9001",
]
RUNS = "/api/v1/autopilot/runs"
BATCHES = "/api/v1/autopilot/submission-batches"


def _run(client, case_ids=CASES, key="run-batch-1"):
    response = client.post(
        RUNS,
        json={"case_ids": list(case_ids), "mode": "TRIAGE_ONLY"},
        headers={**SPECIALIST, "Idempotency-Key": key},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _submit(client, run_id, *, body=None, key=None):
    headers = dict(SPECIALIST)
    if key:
        headers["Idempotency-Key"] = key
    return client.post(
        f"{RUNS}/{run_id}/submit-for-review",
        json=body if body is not None else {},
        headers=headers,
    )


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


# ------------------------------------------------------------------ persistence
def test_batch_is_persisted_with_iterable_case_results(demo):
    client, db_path = demo
    run = _run(client)

    body = _submit(client, run["run_id"], key="batch-001").json()
    batch_id = body["submission_batch_id"]
    assert batch_id.startswith("SUB-")

    # the row exists independently of the response object
    assert _count(db_path, "autopilot_submission_batches") == 1
    assert _count(db_path, "autopilot_submission_items") == 2

    stored = client.get(f"{BATCHES}/{batch_id}")
    assert stored.status_code == 200, stored.text
    batch = stored.json()

    assert batch["submission_batch_id"] == batch_id
    assert batch["run_id"] == run["run_id"]
    assert batch["status"] == body["status"]
    assert batch["total_cases"] == 2
    assert batch["submitted_cases"] == 2
    assert batch["executed_actions"] == 0

    by_case = {item["case_id"]: item for item in batch["results"]}
    assert set(by_case) == {"DEMO-INR-O7", "DEMO-SNAD-O13"}
    for item in by_case.values():
        assert item["status"] == "SUBMITTED_FOR_REVIEW"
        assert item["reason_code"] == "SUBMITTED_FOR_REVIEW"
        assert item["proposal_id"]
        assert item["approval_id"]
        assert item["action_payload_hash"] and item["case_snapshot_hash"]
        assert item["validation_report_id"]
        assert item["validator"]["passed"] is True
        assert item["created_at"]


def test_batch_links_to_the_approvals_it_created(demo):
    client, db_path = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], key="batch-links").json()

    approvals = {a["approval_id"]: a for a in client.get("/api/v1/approvals").json()}
    assert len(approvals) == 2
    for item in batch["results"]:
        approval = approvals[item["approval_id"]]
        assert approval["proposal_id"] == item["proposal_id"]
        assert approval["decision"] == "PENDING"
        assert approval["action_payload_hash"] == item["action_payload_hash"]
        assert approval["case_snapshot_hash"] == item["case_snapshot_hash"]

    # the batch's proposal ids are exactly the run's candidates
    run_candidates = {
        item["case_id"]: item["candidate_actions"][0]["proposal_id"]
        for item in run["results"]
        if item["decision"] == "READY_FOR_REVIEW"
    }
    assert {
        item["case_id"]: item["proposal_id"] for item in batch["results"]
    } == run_candidates


def test_batch_survives_a_restart(demo):
    client, _ = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], key="batch-restart").json()

    # drop the engine: the next request opens new connections on the same file
    from app.infrastructure import database

    database.reset_engine()

    response = client.get(f"{BATCHES}/{batch['submission_batch_id']}")
    assert response.status_code == 200, response.text
    assert response.json()["results"] == batch["results"]

    listed = client.get(f"{RUNS}/{run['run_id']}/submission-batches")
    assert listed.status_code == 200, listed.text
    assert [b["submission_batch_id"] for b in listed.json()] == [
        batch["submission_batch_id"]
    ]


def test_run_lists_batches_in_creation_order(demo):
    client, _ = demo
    run = _run(client)
    first = _submit(client, run["run_id"], key="batch-a").json()
    second = _submit(client, run["run_id"], key="batch-b").json()

    listed = client.get(f"{RUNS}/{run['run_id']}/submission-batches").json()
    assert [b["submission_batch_id"] for b in listed] == [
        first["submission_batch_id"],
        second["submission_batch_id"],
    ]
    assert [b["submitted_cases"] for b in listed] == [2, 0]
    assert [b["already_submitted_cases"] for b in listed] == [0, 2]


# ------------------------------------------------------------------- idempotency
def test_same_key_same_request_returns_the_stored_batch(demo):
    client, db_path = demo
    run = _run(client)

    first = _submit(client, run["run_id"], key="same-key").json()
    second = _submit(client, run["run_id"], key="same-key").json()

    assert second["submission_batch_id"] == first["submission_batch_id"]
    assert second["idempotent_replay"] is True
    assert _count(db_path, "autopilot_submission_batches") == 1
    assert _count(db_path, "autopilot_submission_items") == 2
    assert _count(db_path, "approvals") == 2


def test_same_key_different_request_is_a_conflict(demo):
    client, db_path = demo
    run = _run(client)

    first = _submit(client, run["run_id"], body={"case_ids": ["DEMO-INR-O7"]}, key="k1")
    assert first.status_code == 200, first.text

    conflicting = _submit(
        client, run["run_id"], body={"case_ids": ["DEMO-SNAD-O13"]}, key="k1"
    )
    assert conflicting.status_code == 409, conflicting.text
    assert conflicting.json()["error"]["code"] == "CONFLICT"
    assert "different request body" in conflicting.json()["error"]["message"]

    assert _count(db_path, "autopilot_submission_batches") == 1
    assert _count(db_path, "approvals") == 1


def test_different_key_does_not_create_a_second_approval(demo):
    client, db_path = demo
    run = _run(client)

    _submit(client, run["run_id"], key="first-key")
    second = _submit(client, run["run_id"], key="second-key").json()

    assert second["submitted_cases"] == 0
    assert second["already_submitted_cases"] == 2
    assert all(item["status"] == "ALREADY_SUBMITTED" for item in second["results"])
    assert all(
        item["reason_code"] == "ALREADY_PENDING_APPROVAL" for item in second["results"]
    )
    assert _count(db_path, "approvals") == 2
    assert _count(db_path, "autopilot_submission_batches") == 2


def test_unique_constraint_rejects_a_duplicate_key_row(demo):
    from app.infrastructure.repositories import AutopilotSubmissionRepository

    client, db_path = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], key="dup-key").json()

    from app.infrastructure.database import get_session_factory

    session = get_session_factory()()
    try:
        with pytest.raises(IntegrityError):
            AutopilotSubmissionRepository(session).add(
                {
                    **batch,
                    "submission_batch_id": "SUB-duplicate-attempt",
                    "idempotency_key": "dup-key",
                },
                [],
            )
            session.commit()
    finally:
        session.rollback()
        session.close()


# ---------------------------------------------------------------- partial/failed
def test_partial_batch_records_both_outcomes(demo):
    client, db_path = demo
    run = _run(client)

    body = _submit(
        client, run["run_id"], body={"case_ids": ["DEMO-INR-O7", "DEMO-BLOCK-O9"]}, key="part"
    ).json()

    assert body["status"] == "PARTIAL"
    assert body["submitted_cases"] == 1
    assert body["skipped_cases"] == 1
    assert body["blocked_cases"] == 0

    by_case = {item["case_id"]: item for item in body["results"]}
    assert by_case["DEMO-INR-O7"]["status"] == "SUBMITTED_FOR_REVIEW"
    assert by_case["DEMO-BLOCK-O9"]["status"] == "SKIPPED_NOT_ELIGIBLE"
    assert by_case["DEMO-BLOCK-O9"]["reason_code"] == "RUN_DECISION_NOT_REVIEWABLE"
    assert by_case["DEMO-BLOCK-O9"]["approval_id"] is None

    stored = client.get(f"{BATCHES}/{body['submission_batch_id']}").json()
    assert stored["status"] == "PARTIAL"
    assert {i["case_id"]: i["reason_code"] for i in stored["results"]} == {
        "DEMO-INR-O7": "SUBMITTED_FOR_REVIEW",
        "DEMO-BLOCK-O9": "RUN_DECISION_NOT_REVIEWABLE",
    }
    assert _count(db_path, "approvals") == 1


def test_nothing_submitted_batch_is_not_reported_as_success(demo):
    client, _ = demo
    run = _run(client)

    body = _submit(
        client,
        run["run_id"],
        body={"case_ids": ["DEMO-BILL-O16", "DEMO-BLOCK-O9", "CAP-DEMO-9001"]},
        key="none",
    ).json()

    assert body["status"] == "NOTHING_SUBMITTED"
    assert body["submitted_cases"] == 0
    assert body["skipped_cases"] == 3
    assert body["failed_cases"] == 0


def test_unknown_batch_and_unknown_run_are_404(demo):
    client, _ = demo
    assert client.get(f"{BATCHES}/SUB-missing").status_code == 404
    assert client.get(f"{BATCHES}/SUB-missing").json()["error"]["code"] == "NOT_FOUND"

    missing = client.get(f"{RUNS}/APR-missing/submission-batches")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------- safety
def test_batch_recording_never_executes_or_calls_paypal(demo, monkeypatch):
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
    body = _submit(client, run["run_id"], key="safety").json()

    assert body["submitted_cases"] == 2
    assert _count(db_path, "executions") == 0
    stored = client.get(f"{BATCHES}/{body['submission_batch_id']}").json()
    assert stored["executed_actions"] == 0
