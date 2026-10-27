"""T30 — Demo reset: safety gates, SQLite backup API, idempotent restore."""

from __future__ import annotations

import sqlite3

from tests.conftest import MANAGER, SYSTEM
from tests.demo_support import count_cases, demo_client, read_audit


def _reset(client, headers=SYSTEM):
    return client.post("/api/v1/demo/reset", headers=headers)


# ----------------------------------------------------------------- happy path
def test_reset_restores_five_cases_and_writes_backup(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch) as (client, db_path):
        assert len(client.get("/api/v1/cases").json()) == 5

        response = _reset(client)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["reset"] is True
        assert body["cases"] == 5
        assert body["backup"].startswith("reset-")
        assert body["backup"].endswith(".sqlite3")

        backup = db_path.parent / "backups" / body["backup"]
        assert backup.is_file()
        assert count_cases(backup) == 5

        cases = client.get("/api/v1/cases").json()
        assert len(cases) == 5
        assert {c["case_id"] for c in cases} == {
            "CAP-DEMO-9001",
            "DEMO-BILL-O16",
            "DEMO-BLOCK-O9",
            "DEMO-INR-O7",
            "DEMO-SNAD-O13",
        }

        audits = read_audit(db_path)
        assert len(audits) == 1
        audit = audits[0]
        assert audit["case_id"] == "DEMO-RESET"
        assert audit["actor_type"] == "SYSTEM"
        assert audit["actor_id"] == "system"
        assert audit["payload"]["backup"] == body["backup"]
        assert len(audit["payload"]["golden_sha256"]) == 64
        assert audit["payload"]["cases"] == 5


def test_reset_is_idempotent(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch) as (client, db_path):
        first = _reset(client)
        second = _reset(client)
        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert first.json()["cases"] == second.json()["cases"] == 5
        assert first.json()["backup"] != second.json()["backup"]

        cases = client.get("/api/v1/cases").json()
        assert len(cases) == 5
        assert len({c["case_id"] for c in cases}) == 5
        assert len(read_audit(db_path)) == 1  # one reset event in the restored DB


def test_backup_file_is_a_consistent_sqlite_database(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch) as (client, db_path):
        body = _reset(client).json()
    backup = db_path.parent / "backups" / body["backup"]
    conn = sqlite3.connect(f"{backup.as_uri()}?mode=ro", uri=True)
    try:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0] == 5
    finally:
        conn.close()


# -------------------------------------------------------------------- gates
def test_sandbox_database_path_is_refused_with_zero_writes(tmp_path, monkeypatch):
    with demo_client(
        tmp_path, monkeypatch, name="offline-demo-sandbox"
    ) as (client, db_path):
        response = _reset(client)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
        assert "sandbox" in response.json()["error"]["message"]

        assert count_cases(db_path) == 5
        assert read_audit(db_path) == []
        assert not (db_path.parent / "backups").exists()


def test_sandbox_mode_is_refused_with_zero_writes(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch, data_mode="paypal_sandbox") as (
        client,
        db_path,
    ):
        response = _reset(client)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
        assert "offline_replay" in response.json()["error"]["message"]

        assert count_cases(db_path) == 5
        assert read_audit(db_path) == []
        assert not (db_path.parent / "backups").exists()


def test_missing_golden_is_refused_with_zero_writes(tmp_path, monkeypatch):
    missing = tmp_path / "does-not-exist.sqlite3"
    with demo_client(tmp_path, monkeypatch, golden=missing) as (client, db_path):
        response = _reset(client)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "CONFLICT"

        assert count_cases(db_path) == 5
        assert read_audit(db_path) == []
        assert not (db_path.parent / "backups").exists()


def test_only_system_role_may_reset(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch) as (client, db_path):
        response = _reset(client, headers=MANAGER)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
        assert read_audit(db_path) == []
        assert not (db_path.parent / "backups").exists()
