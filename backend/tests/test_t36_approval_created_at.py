"""T36 — persisted approval creation time (MVP-1.3).

Covers the additive migration, the audit-based backfill and the stable
creation timeline exposed through the origin endpoint.
"""

from __future__ import annotations

import json
import sqlite3

import pytest
from sqlalchemy import create_engine, text

from tests.conftest import MANAGER, SPECIALIST
from tests.demo_support import demo_client

RUNS = "/api/v1/autopilot/runs"
ORIGIN = "/api/v1/approvals/{approval_id}/submission-origin"


def _run(client, key="created-run"):
    response = client.post(
        RUNS,
        json={"case_ids": ["DEMO-INR-O7", "DEMO-SNAD-O13"], "mode": "TRIAGE_ONLY"},
        headers={**SPECIALIST, "Idempotency-Key": key},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _submit(client, run_id, key="created-submit"):
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


def _clear_submitted_events(db_path) -> None:
    """Drop the submit events the app just wrote, so the DB looks pre-batch."""
    _exec(
        db_path,
        "DELETE FROM audit_events WHERE event_type = 'PROPOSAL_SUBMITTED'",
    )


def _add_event(db_path, event_id, case_id, payload, created_at) -> None:
    _exec(
        db_path,
        "INSERT INTO audit_events (event_id, case_id, event_type, actor_type, actor_id, "
        "payload_json, created_at) VALUES (?, ?, 'PROPOSAL_SUBMITTED', 'HUMAN', 'specialist-1', ?, ?)",
        (event_id, case_id, json.dumps(payload), created_at),
    )


def _row(db_path, approval_id):
    conn = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        return dict(conn.execute("SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)).fetchone())
    finally:
        conn.close()


@pytest.fixture()
def demo(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch, ai_provider="frozen") as (client, db_path):
        yield client, db_path


# ------------------------------------------------------------------ migration
def test_migration_adds_the_columns_without_touching_data(tmp_path):
    from app.infrastructure.migrations import upgrade_schema

    db_path = tmp_path / "legacy.sqlite3"
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE approvals (approval_id VARCHAR(96) PRIMARY KEY, "
                "proposal_id VARCHAR(96), decided_at VARCHAR(40))"
            )
        )
        conn.execute(
            text(
                "INSERT INTO approvals (approval_id, proposal_id, decided_at) "
                "VALUES ('AP-legacy', 'PR-legacy', '2026-10-01T00:00:00+00:00')"
            )
        )

    first = upgrade_schema(engine)
    second = upgrade_schema(engine)

    assert first["added"] == ["created_at", "created_at_source"]
    assert second["added"] == []  # repeat run is a no-op

    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM approvals WHERE approval_id='AP-legacy'")).mappings().one()
        assert dict(row)["decided_at"] == "2026-10-01T00:00:00+00:00"
        assert dict(row)["created_at"] is None
    engine.dispose()


# ------------------------------------------------------------------ backfill
def test_backfill_uses_the_unique_audit_event_and_records_its_source(demo):
    from app.infrastructure.database import get_session_factory
    from app.infrastructure.migrations import backfill_approval_created_at

    client, db_path = demo
    batch = _submit(client, _run(client)["run_id"])
    items = batch["results"]

    # simulate legacy rows: no stored creation time, no audit event
    _clear_submitted_events(db_path)
    _exec(db_path, "UPDATE approvals SET created_at = NULL, created_at_source = NULL")
    for index, item in enumerate(items):
        _add_event(
            db_path,
            f"AUD-backfill-{index}",
            item["case_id"],
            {"approval_id": item["approval_id"], "proposal_id": item["proposal_id"]},
            f"2026-10-01T00:00:0{index}+00:00",
        )

    session = get_session_factory()()
    try:
        report = backfill_approval_created_at(session)
    finally:
        session.close()

    assert report["backfilled"] == 2
    assert report["ambiguous"] == 0
    assert report["missing"] == 0
    row = _row(db_path, items[0]["approval_id"])
    assert row["created_at"] == "2026-10-01T00:00:00+00:00"
    assert row["created_at_source"] == "AUDIT:AUD-backfill-0"


def test_backfill_leaves_null_when_there_is_no_event(demo):
    from app.infrastructure.database import get_session_factory
    from app.infrastructure.migrations import backfill_approval_created_at

    client, db_path = demo
    batch = _submit(client, _run(client)["run_id"], key="no-event")
    item = batch["results"][0]

    _clear_submitted_events(db_path)
    _exec(db_path, "UPDATE approvals SET created_at = NULL, created_at_source = NULL")
    session = get_session_factory()()
    try:
        report = backfill_approval_created_at(session)
    finally:
        session.close()

    assert report["missing"] == 2
    assert report["backfilled"] == 0
    assert _row(db_path, item["approval_id"])["created_at"] is None
    # and the API reports the absence instead of failing or inventing a time
    origin = _origin(client, item["approval_id"]).json()
    assert origin["approval_created_at"] is None


def test_backfill_is_idempotent(demo):
    from app.infrastructure.database import get_session_factory
    from app.infrastructure.migrations import backfill_approval_created_at

    client, db_path = demo
    batch = _submit(client, _run(client)["run_id"], key="idempotent")
    item = batch["results"][0]

    _clear_submitted_events(db_path)
    _exec(db_path, "UPDATE approvals SET created_at = NULL, created_at_source = NULL")
    _add_event(
        db_path,
        "AUD-once",
        item["case_id"],
        {"approval_id": item["approval_id"], "proposal_id": item["proposal_id"]},
        "2026-10-05T00:00:00+00:00",
    )

    session = get_session_factory()()
    try:
        first = backfill_approval_created_at(session)
        second = backfill_approval_created_at(session)
    finally:
        session.close()

    assert first["backfilled"] == 1
    assert first["missing"] == 1
    # the unmatched row is still NULL, so it is re-examined but never rewritten
    assert second["examined"] == 1
    assert second["backfilled"] == 0
    assert _row(db_path, item["approval_id"])["created_at"] == "2026-10-05T00:00:00+00:00"


def test_backfill_does_not_guess_across_ambiguous_candidates(demo):
    from app.infrastructure.database import get_session_factory
    from app.infrastructure.migrations import backfill_approval_created_at

    client, db_path = demo
    batch = _submit(client, _run(client)["run_id"], key="ambiguous")
    item = batch["results"][0]

    _clear_submitted_events(db_path)
    _exec(db_path, "UPDATE approvals SET created_at = NULL, created_at_source = NULL")
    # two proposal-level events that cannot be attributed to a single approval
    for suffix, stamp in (("a", "2026-10-01T00:00:01+00:00"), ("b", "2026-10-01T00:00:02+00:00")):
        _add_event(
            db_path,
            f"AUD-ambiguous-{suffix}",
            item["case_id"],
            {"proposal_id": item["proposal_id"]},
            stamp,
        )

    session = get_session_factory()()
    try:
        report = backfill_approval_created_at(session)
    finally:
        session.close()

    assert report["ambiguous"] == 1
    assert report["backfilled"] == 0
    assert report["missing"] == 1
    assert _row(db_path, item["approval_id"])["created_at"] is None
    ambiguous = next(d for d in report["details"] if d["status"] == "AMBIGUOUS")
    assert len(ambiguous["candidates"]) == 2


def test_backfill_never_overwrites_an_existing_time(demo):
    from app.infrastructure.database import get_session_factory
    from app.infrastructure.migrations import backfill_approval_created_at

    client, db_path = demo
    batch = _submit(client, _run(client)["run_id"], key="keep")
    item = batch["results"][0]
    persisted = _row(db_path, item["approval_id"])["created_at"]
    assert persisted is not None
    _clear_submitted_events(db_path)

    _exec(
        db_path,
        "INSERT INTO audit_events (event_id, case_id, event_type, actor_type, actor_id, "
        "payload_json, created_at) VALUES ('AUD-older', ?, 'PROPOSAL_SUBMITTED', 'HUMAN', 's', ?, '2026-09-01T00:00:00+00:00')",
        (item["case_id"], json.dumps({"approval_id": item["approval_id"]})),
    )
    session = get_session_factory()()
    try:
        report = backfill_approval_created_at(session)
    finally:
        session.close()

    assert report["examined"] == 0
    assert _row(db_path, item["approval_id"])["created_at"] == persisted


# ------------------------------------------------------------- new approvals
def test_new_approvals_persist_a_stable_created_at(demo):
    client, db_path = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], key="stable-1")
    item = batch["results"][0]

    row = _row(db_path, item["approval_id"])
    assert row["created_at"] is not None
    assert row["created_at_source"] == "CREATED"

    first = _origin(client, item["approval_id"]).json()
    second = _origin(client, item["approval_id"]).json()
    assert first == second
    assert first["approval_created_at"] == row["created_at"]
    assert first["approval_created_at_source"] == "CREATED"

    # restart: the engine is rebuilt, the value must be identical
    from app.infrastructure import database

    database.reset_engine()
    after_restart = _origin(client, item["approval_id"]).json()
    assert after_restart["approval_created_at"] == row["created_at"]


def test_deciding_does_not_change_created_at(demo):
    client, db_path = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], key="decide")
    item = batch["results"][0]
    created = _row(db_path, item["approval_id"])["created_at"]

    decision = client.post(
        f"/api/v1/approvals/{item['approval_id']}/decision",
        json={"decision": "APPROVED", "reason": "timeline check"},
        headers=MANAGER,
    )
    assert decision.status_code == 200, decision.text

    row = _row(db_path, item["approval_id"])
    assert row["created_at"] == created
    assert row["decided_at"] != created
    origin = _origin(client, item["approval_id"]).json()
    assert origin["approval_created_at"] == created
    assert origin["approval_decision"] == "APPROVED"


def test_origin_time_is_not_the_batch_or_submission_time(demo):
    client, _ = demo
    run = _run(client)
    batch = _submit(client, run["run_id"], key="distinct")
    item = batch["results"][0]
    origin = _origin(client, item["approval_id"]).json()

    assert origin["approval_created_at"] is not None
    assert origin["submitted_at"] is not None
    assert origin["approval_created_at"] != origin["submitted_at"]
