"""Demo reset — restore the offline demo database from a golden snapshot.

This is a DEMO-ONLY operational endpoint with hard safety gates. It exists so
the hackathon demo can be replayed from a known-good state without touching
PayPal or hand-copying files.

Safety contract
---------------
1. ``DP_DATA_MODE`` must be ``offline_replay``.
2. The SQLite database path must contain ``offline-demo`` and must NOT contain
   ``sandbox``.
3. The golden file must exist and be readable.
Any failure is raised BEFORE a single write; no backup directory is created.

Restore mechanism
-----------------
Both the pre-reset backup and the restore use the SQLite online backup API
(``Connection.backup``), never ``cp``/``shutil.copy``. Copying an open SQLite
database file can tear a write; the backup API produces a consistent snapshot.

After the restore one ``DEMO_RESET`` audit event is appended (actor ``system``)
with the backup filename, golden sha256 and restored case count. The audit
repository stays append-only; the reset itself intentionally replaces the
database (that is the point of a demo reset).
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import make_url

from ..adapters.paypal.config import DATA_MODE_OFFLINE, PayPalConfig
from ..domain.enums import ActorType, AuditEventType
from ..domain.errors import ConflictError, ForbiddenError
from ..domain.models import AuditEvent
from ..infrastructure.database import get_engine, get_session_factory, reset_engine
from ..infrastructure.repositories import AuditRepository, CaseStateRepository
from ..infrastructure.settings import APP_ROOT, settings

WORKSPACE_ROOT = APP_ROOT.parent

# RC-5 (review P1-05): the standalone package ships its own golden snapshot next
# to the demo database. The dev workspace keeps the historical path. The first
# that exists wins; DP_DEMO_GOLDEN still overrides both.
PACKAGED_DATA_DIR = WORKSPACE_ROOT / "data"
PACKAGED_GOLDEN_PATH = PACKAGED_DATA_DIR / "demo.golden.sqlite3"
LEGACY_GOLDEN_PATH = (
    WORKSPACE_ROOT
    / "integration"
    / "offline-demo-20261021"
    / "backups"
    / "demo.golden.sqlite3"
)

GOLDEN_ENV = "DP_DEMO_GOLDEN"
AUDIT_CASE_ID = "DEMO-RESET"


class DemoResetRefused(ForbiddenError):
    """A safety gate refused the reset (403, zero writes)."""

    code = "FORBIDDEN"


class DemoGoldenMissing(ConflictError):
    """The golden snapshot is missing/unreadable (409, zero writes)."""

    code = "CONFLICT"


def _sqlite_path(database_url: str) -> Path:
    try:
        url = make_url(database_url)
    except Exception as exc:  # malformed URL — never guess a path
        raise DemoResetRefused(f"database URL is not parseable: {exc}") from None
    if url.get_backend_name() != "sqlite" or not url.database:
        raise DemoResetRefused(
            "demo reset requires a file-backed SQLite database "
            f"(got backend {url.get_backend_name()!r})"
        )
    return Path(url.database).resolve()


def _normalized(path: Path) -> str:
    return path.as_posix().lower()


def _golden_path() -> Path:
    raw = os.environ.get(GOLDEN_ENV)
    if raw:
        return Path(raw).expanduser().resolve()
    for candidate in (PACKAGED_GOLDEN_PATH, LEGACY_GOLDEN_PATH):
        if candidate.is_file():
            return candidate.resolve()
    # Report the packaged location in the error: that is what a standalone
    # install is expected to provide.
    return PACKAGED_GOLDEN_PATH.resolve()


def _validate_gates(database_url: str) -> tuple[Path, Path]:
    """All gates, in order, before any file is written."""
    mode = PayPalConfig.from_env().data_mode
    if mode != DATA_MODE_OFFLINE:
        raise DemoResetRefused(
            "demo reset is only available in DP_DATA_MODE=offline_replay "
            f"(current: {mode!r}); no write was performed"
        )

    db_path = _sqlite_path(database_url)
    normalized = _normalized(db_path)
    # RC-5: two layouts are legitimate — the dev workspace
    # (…/offline-demo-20261021/demo.sqlite3) and the standalone package
    # (<app>/data/demo.sqlite3). Everything else is refused.
    in_package = PACKAGED_DATA_DIR.resolve() == db_path.parent
    if "offline-demo" not in normalized and not in_package:
        raise DemoResetRefused(
            "demo reset refuses this database path: expected the packaged "
            f"data/demo.sqlite3 or a path containing 'offline-demo' "
            f"(got {db_path.as_posix()!r}); no write was performed"
        )
    if "sandbox" in normalized:
        raise DemoResetRefused(
            "demo reset refuses a sandbox database path "
            f"({db_path.as_posix()!r}); no write was performed"
        )
    if "disputepilot_dev" in normalized:
        raise DemoResetRefused(
            "demo reset refuses the development database "
            f"({db_path.as_posix()!r}); no write was performed"
        )
    if not db_path.is_file():
        raise DemoResetRefused(
            f"demo database {db_path.as_posix()!r} does not exist; no write was performed"
        )

    golden = _golden_path()
    if not golden.is_file():
        raise DemoGoldenMissing(
            f"demo golden snapshot {golden.as_posix()!r} is missing; "
            "set DP_DEMO_GOLDEN to an existing SQLite backup; no write was performed"
        )
    return db_path, golden


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _backup_connection(source: sqlite3.Connection, target_path: Path) -> None:
    """Consistent snapshot via the SQLite online backup API (never ``cp``)."""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target = sqlite3.connect(str(target_path))
    try:
        source.backup(target)
    finally:
        target.close()


def _restore_connection(target: sqlite3.Connection, golden: Path) -> None:
    source = sqlite3.connect(f"{golden.as_uri()}?mode=ro", uri=True)
    try:
        # backup() copies FROM self INTO its argument, so the golden source
        # drives the copy into the live database connection.
        source.backup(target)
    finally:
        source.close()


def _reset_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def reset_offline_demo(state_store, *, database_url: str | None = None) -> dict:
    """Restore the golden demo DB and return the reset summary.

    Raises :class:`DemoResetRefused` / :class:`DemoGoldenMissing` before any
    write when a gate fails.
    """
    database_url = database_url or settings.database_url
    db_path, golden = _validate_gates(database_url)

    # Close pooled connections so the checkpoint sees a quiescent database.
    get_engine().dispose()

    backup_path = db_path.parent / "backups" / f"reset-{_reset_timestamp()}.sqlite3"
    current = sqlite3.connect(str(db_path), timeout=30)
    try:
        current.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        _backup_connection(current, backup_path)
        _restore_connection(current, golden)
        current.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        current.close()

    golden_sha256 = _sha256_file(golden)

    # The restored file is the new source of truth: rebuild the engine/session
    # factory so no connection keeps a pre-restore snapshot.
    reset_engine()
    session = get_session_factory()()
    try:
        cases = int(session.execute(text("SELECT COUNT(*) FROM cases")).scalar_one())
        AuditRepository(session).append(
            AuditEvent(
                event_id=f"AUD-DEMO-RESET-{_reset_timestamp()}",
                case_id=AUDIT_CASE_ID,
                event_type=AuditEventType.DEMO_RESET.value,
                actor_type=ActorType.SYSTEM,
                actor_id="system",
                payload={
                    "backup": backup_path.name,
                    "golden": golden.name,
                    "golden_sha256": golden_sha256,
                    "cases": cases,
                },
            )
        )
        session.commit()
        state_store.restore(CaseStateRepository(session).list_all())
    finally:
        session.close()

    return {
        "reset": True,
        "cases": cases,
        "backup": backup_path.name,
    }
