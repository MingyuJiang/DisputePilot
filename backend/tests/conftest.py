"""Shared test fixtures — fully offline, isolated SQLite per test."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

SPECIALIST = {"X-Actor-Id": "specialist-1", "X-Actor-Role": "SPECIALIST"}
MANAGER = {"X-Actor-Id": "manager-1", "X-Actor-Role": "MANAGER"}
SYSTEM = {"X-Actor-Id": "system-1", "X-Actor-Role": "SYSTEM"}


@pytest.fixture()
def app(tmp_path):
    """Fresh app + fresh SQLite DB per test (no shared state)."""
    db_path = tmp_path / "test.sqlite3"
    os.environ["DP_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"

    from app.infrastructure import database
    from app.infrastructure import settings as settings_module

    database.reset_engine()
    settings_module.settings.database_url = f"sqlite:///{db_path.as_posix()}"

    from app.main import create_app

    application = create_app()
    yield application
    database.reset_engine()


@pytest.fixture()
def client(app):
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def ready(client):
    """A client where fixtures are imported (startup auto-import)."""
    r = client.get("/api/v1/cases")
    assert r.status_code == 200
    assert len(r.json()) == 15
    return client


def run_full_chain(client, case_id="O4", decision="APPROVED", reason="verified"):
    """Import → analysis → proposal → validation → submit → decide → replay."""
    r = client.post(f"/api/v1/cases/{case_id}/analyses", headers=SPECIALIST)
    assert r.status_code == 200, r.text
    analysis = r.json()
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
        json={"decision": decision, "reason": reason},
    )
    assert r.status_code == 200, r.text
    return analysis, proposal, approval_id
