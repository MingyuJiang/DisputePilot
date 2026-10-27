"""Shared helpers for demo-database tests (reset / frozen replay).

The golden snapshot lives in the workspace ``integration`` folder and is not
part of the backend repo. Tests use it when present and are skipped otherwise,
so the backend suite stays runnable in isolation.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent
DEFAULT_GOLDEN = (
    WORKSPACE_ROOT
    / "integration"
    / "offline-demo-20261021"
    / "backups"
    / "demo.golden.sqlite3"
)
FALLBACK_VERIFIED = (
    WORKSPACE_ROOT
    / "integration"
    / "offline-demo-20261021"
    / "backups"
    / "demo.verified.sqlite3"
)

_ENV = (
    "DP_DATA_MODE",
    "DP_AUTO_IMPORT",
    "DP_PAYPAL_BASE_URL",
    "DP_PAYPAL_CLIENT_ID",
    "DP_PAYPAL_CLIENT_SECRET",
    "DP_PAYPAL_WRITES_ENABLED",
    "DP_PAYPAL_WRITE_ALLOW",
    "DP_PAYPAL_MERCHANT_ID",
    "DP_DEMO_GOLDEN",
    "DP_AI_PROVIDER",
    "DP_FROZEN_ANALYSES",
)


def clear_demo_env(monkeypatch) -> None:
    for name in _ENV:
        monkeypatch.delenv(name, raising=False)


def golden_or_skip() -> Path:
    env = os.environ.get("DP_DEMO_GOLDEN")
    if env and Path(env).is_file():
        return Path(env)
    packaged = WORKSPACE_ROOT / "data" / "demo.golden.sqlite3"
    if packaged.is_file():
        return packaged
    if DEFAULT_GOLDEN.is_file():
        return DEFAULT_GOLDEN
    if FALLBACK_VERIFIED.is_file():
        return FALLBACK_VERIFIED
    pytest.skip("offline demo golden database is not available in this workspace")


def copy_sqlite(source: Path, target: Path) -> Path:
    """Consistent copy through the SQLite backup API (never a file copy)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)
    dst = sqlite3.connect(str(target))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return target


def seed_demo_db(tmp_path: Path, name: str = "offline-demo") -> Path:
    directory = tmp_path / name
    directory.mkdir(parents=True, exist_ok=True)
    return copy_sqlite(golden_or_skip(), directory / "demo.sqlite3")


def read_audit(db_path: Path, event_type: str = "DEMO_RESET") -> list[dict]:
    import json

    conn = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            "SELECT event_id, case_id, actor_type, actor_id, payload_json "
            "FROM audit_events WHERE event_type = ? ORDER BY created_at",
            (event_type,),
        ).fetchall()
    finally:
        conn.close()
    return [
        {
            "event_id": row[0],
            "case_id": row[1],
            "actor_type": row[2],
            "actor_id": row[3],
            "payload": json.loads(row[4]),
        }
        for row in rows
    ]


def count_cases(db_path: Path) -> int:
    conn = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)
    try:
        return int(conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0])
    finally:
        conn.close()


@contextmanager
def demo_client(
    tmp_path: Path,
    monkeypatch,
    *,
    name: str = "offline-demo",
    golden: Path | None = None,
    data_mode: str = "offline_replay",
    ai_provider: str | None = None,
):
    """TestClient over a seeded offline-demo database (no fixture auto-import)."""
    from fastapi.testclient import TestClient

    db_path = seed_demo_db(tmp_path, name)
    clear_demo_env(monkeypatch)
    monkeypatch.setenv("DP_DATA_MODE", data_mode)
    monkeypatch.setenv("DP_AUTO_IMPORT", "0")
    if golden is not None:
        monkeypatch.setenv("DP_DEMO_GOLDEN", str(golden))
    if ai_provider is not None:
        monkeypatch.setenv("DP_AI_PROVIDER", ai_provider)

    from app.infrastructure import database
    from app.infrastructure.settings import settings

    database.reset_engine()
    settings.database_url = f"sqlite:///{db_path.as_posix()}"

    from app.main import create_app

    application = create_app()
    try:
        with TestClient(application) as client:
            yield client, db_path
    finally:
        database.reset_engine()
