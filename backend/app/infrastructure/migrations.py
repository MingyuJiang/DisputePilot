"""Schema upgrades + audit-based backfill for SQLite (no Alembic in this project).

Two additive columns on ``approvals`` are needed by the persisted approval
timeline. ``Base.metadata.create_all`` creates *new* tables but never alters an
existing one, so the upgrade runs explicitly before any query:

    CREATE TABLE ... (create_all)
        ↓
    upgrade_schema(engine)          -- ALTER TABLE ... ADD COLUMN, idempotent
        ↓
    backfill_approval_created_at()  -- only WHERE created_at IS NULL
        ↓
    application queries

Design rules
------------
- Never destructive: no table rebuild, no drop, no data rewrite.
- Idempotent: a second run adds nothing and backfills nothing.
- Honest: a legacy row with no provable audit event keeps ``created_at = NULL``.
- Auditable: every backfilled value records ``created_at_source = AUDIT:<id>``.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

APPROVAL_COLUMNS: tuple[tuple[str, str], ...] = (
    ("created_at", "VARCHAR(40)"),
    ("created_at_source", "VARCHAR(120)"),
)


def upgrade_schema(engine: Engine) -> dict[str, Any]:
    """Add the approval timeline columns when missing. Safe to re-run."""
    report: dict[str, Any] = {"table_present": False, "added": [], "already_present": []}
    tables = set(inspect(engine).get_table_names())
    if "approvals" not in tables:
        return report
    report["table_present"] = True

    existing = {column["name"] for column in inspect(engine).get_columns("approvals")}
    for name, ddl_type in APPROVAL_COLUMNS:
        if name in existing:
            report["already_present"].append(name)
            continue
        try:
            with engine.begin() as connection:
                connection.execute(
                    text(f"ALTER TABLE approvals ADD COLUMN {name} {ddl_type}")
                )
            report["added"].append(name)
        except (OperationalError, ProgrammingError) as exc:
            # A concurrent starter may have added it between inspect() and DDL.
            # Re-inspect: "duplicate column" means someone else won the race.
            if "duplicate column" not in str(exc).lower():
                raise
            report["already_present"].append(name)
    return report


def _parse_event_time(raw: str) -> datetime | None:
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def backfill_approval_created_at(session) -> dict[str, Any]:
    """Recover ``approvals.created_at`` from PROPOSAL_SUBMITTED audit events.

    Matching priority (never id-prefix guessing):
      1. payload.approval_id == approval_id, exactly one event;
      2. payload.proposal_id == proposal_id and the event carries no
         approval_id (so it cannot belong to a different approval), unique;
      3. otherwise leave NULL and report why.
    """
    approvals = session.execute(
        text(
            "SELECT approval_id, proposal_id, created_at FROM approvals "
            "WHERE created_at IS NULL"
        )
    ).mappings().all()

    events = session.execute(
        text(
            "SELECT event_id, payload_json, created_at FROM audit_events "
            "WHERE event_type = 'PROPOSAL_SUBMITTED' ORDER BY created_at, event_id"
        )
    ).mappings().all()

    by_approval: dict[str, list[dict]] = {}
    by_proposal: dict[str, list[dict]] = {}
    anomalies: list[str] = []
    for event in events:
        try:
            payload = json.loads(event["payload_json"] or "{}")
        except ValueError:
            anomalies.append(f"{event['event_id']}: payload is not JSON")
            continue
        if not isinstance(payload, dict):
            anomalies.append(f"{event['event_id']}: payload is not an object")
            continue
        if _parse_event_time(event["created_at"]) is None:
            anomalies.append(f"{event['event_id']}: unparseable created_at")
            continue
        approval_id = str(payload.get("approval_id") or "").strip()
        proposal_id = str(payload.get("proposal_id") or "").strip()
        if approval_id:
            by_approval.setdefault(approval_id, []).append(event)
        elif proposal_id:
            by_proposal.setdefault(proposal_id, []).append(event)

    report: dict[str, Any] = {
        "examined": len(approvals),
        "backfilled": 0,
        "ambiguous": 0,
        "missing": 0,
        "anomalies": anomalies,
        "details": [],
    }

    for approval in approvals:
        approval_id = approval["approval_id"]
        proposal_id = approval["proposal_id"]
        candidates = by_approval.get(approval_id, [])
        source_rule = "approval_id"
        if not candidates:
            candidates = by_proposal.get(proposal_id, [])
            source_rule = "proposal_id"

        if len(candidates) > 1:
            report["ambiguous"] += 1
            report["details"].append(
                {
                    "approval_id": approval_id,
                    "status": "AMBIGUOUS",
                    "rule": source_rule,
                    "candidates": [event["event_id"] for event in candidates],
                }
            )
            continue
        if not candidates:
            report["missing"] += 1
            report["details"].append(
                {"approval_id": approval_id, "status": "NO_EVENT", "rule": None}
            )
            continue

        event = candidates[0]
        updated = session.execute(
            text(
                "UPDATE approvals SET created_at = :created_at, "
                "created_at_source = :source "
                "WHERE approval_id = :approval_id AND created_at IS NULL"
            ),
            {
                "created_at": event["created_at"],
                "source": f"AUDIT:{event['event_id']}",
                "approval_id": approval_id,
            },
        )
        if updated.rowcount:
            report["backfilled"] += 1
            report["details"].append(
                {
                    "approval_id": approval_id,
                    "status": "BACKFILLED",
                    "rule": source_rule,
                    "event_id": event["event_id"],
                    "created_at": event["created_at"],
                }
            )
    session.commit()
    return report


def migrate(engine: Engine, *, session_factory=None) -> dict[str, Any]:
    """Run the schema upgrade and the backfill in one call."""
    from ..infrastructure.database import get_session_factory

    schema = upgrade_schema(engine)
    factory = session_factory or get_session_factory()
    session = factory()
    try:
        backfill = backfill_approval_created_at(session)
    finally:
        session.close()
    return {"schema": schema, "backfill": backfill}


def backup_sqlite(database_path: str | Path, target: str | Path) -> Path:
    """Consistent copy through the SQLite backup API (WAL-safe)."""
    source = Path(database_path)
    destination = Path(target)
    destination.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)
    dst = sqlite3.connect(str(destination))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return destination


def _sqlite_path_from_url(url: str) -> Path | None:
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return None
    return Path(url[len(prefix):])


def main() -> None:  # pragma: no cover - operational CLI
    """Audited one-off run: backup, migrate, print the report.

    Usage:  python -m app.infrastructure.migrations
    """
    from .database import get_engine
    from .settings import settings

    db_path = _sqlite_path_from_url(os.environ.get("DP_DATABASE_URL", settings.database_url))
    if db_path is None:
        raise SystemExit("only sqlite:/// URLs are supported by this migration tool")
    if not db_path.exists():
        raise SystemExit(f"database file not found: {db_path}")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = backup_sqlite(db_path, db_path.with_suffix(db_path.suffix + f".bak-{stamp}"))
    report = migrate(get_engine())
    report["database"] = str(db_path)
    report["backup"] = str(backup)
    print(json.dumps(report, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":  # pragma: no cover
    main()
