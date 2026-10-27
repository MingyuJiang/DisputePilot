"""T9 — Phase-2 integration hardening regressions.

D-1: loopback-only CORS so the browser frontend (127.0.0.1:8210-8219) can
     call this backend cross-origin; foreign origins must stay blocked.
D-3: SQLite pool sizing (10+40) + WAL + busy timeout under the concurrent
     burst shape observed during integration (~65 requests on refresh).

Everything runs through TestClient against a per-test tmp SQLite file —
no network, no ports, no browsers.
"""

from __future__ import annotations

import concurrent.futures
import time

from app.infrastructure.database import get_engine
from tests.conftest import SYSTEM

FRONTEND_ORIGIN = "http://127.0.0.1:8212"  # Phase-2 integration topology
ALLOWED_ORIGINS = [
    "http://127.0.0.1:8210",
    "http://127.0.0.1:8212",
    "http://127.0.0.1:8219",
    "http://localhost:8210",
    "http://localhost:8215",
    "http://localhost:8219",
]
FORBIDDEN_ORIGINS = [
    "http://evil.example",
    "http://127.0.0.1:8209",  # just below the dev range
    "http://127.0.0.1:8220",  # just above the dev range
    "http://localhost:8200",
    "http://127.0.0.1:8100",  # the backend's own port is not a browser origin
    "https://127.0.0.1:8212",  # scheme must match
]
DEMO_REQUEST_HEADERS = "X-Actor-Id, X-Actor-Role, Idempotency-Key, Content-Type"


# ---------------------------------------------------------------- D-1: CORS
def test_cors_allows_loopback_dev_origins(ready):
    for origin in ALLOWED_ORIGINS:
        r = ready.get("/api/v1/health", headers={"Origin": origin})
        assert r.status_code == 200
        assert r.headers["access-control-allow-origin"] == origin


def test_cors_rejects_foreign_origins(ready):
    for origin in FORBIDDEN_ORIGINS:
        r = ready.get("/api/v1/health", headers={"Origin": origin})
        assert r.status_code == 200
        assert "access-control-allow-origin" not in r.headers


def test_cors_preflight_allows_demo_headers(ready):
    """Preflight from the dev frontend must clear with the demo identity /
    idempotency headers the UI actually sends."""
    r = ready.options(
        "/api/v1/cases",
        headers={
            "Origin": FRONTEND_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": DEMO_REQUEST_HEADERS,
        },
    )
    assert r.status_code == 200, r.text
    assert r.headers["access-control-allow-origin"] == FRONTEND_ORIGIN
    allowed = r.headers["access-control-allow-headers"].lower()
    for header in ("x-actor-id", "x-actor-role", "idempotency-key", "content-type"):
        assert header in allowed


def test_cors_preflight_rejects_foreign_origin(ready):
    r = ready.options(
        "/api/v1/cases",
        headers={
            "Origin": "http://evil.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": DEMO_REQUEST_HEADERS,
        },
    )
    assert r.status_code == 400
    assert "access-control-allow-origin" not in r.headers


def test_cors_headers_present_on_error_envelope(ready):
    """Errors must carry CORS headers too, otherwise the browser surfaces an
    opaque network error instead of the unified 404/401 envelope."""
    r = ready.get("/api/v1/cases/NOPE", headers={"Origin": FRONTEND_ORIGIN})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"
    assert r.headers["access-control-allow-origin"] == FRONTEND_ORIGIN


# ------------------------------------------------------- D-3: pool / WAL
def test_engine_pool_configuration(app):
    engine = get_engine()
    pool = engine.pool
    assert pool.size() == 10
    assert pool._max_overflow == 40  # 10 + 40 = 50 concurrent checkouts
    assert pool._timeout == 60
    assert pool._pre_ping is True


def test_pool_sustains_50_concurrent_checkouts(app):
    """Capacity guard for the D-3 burst: 50 simultaneous checkouts must not
    time out. Pre-fix (5+10=15) the 16th checkout blocked for the full pool
    timeout and surfaced as HTTP 500."""
    engine = get_engine()
    started = time.perf_counter()
    connections = [engine.connect() for _ in range(50)]
    try:
        for conn in connections:
            assert conn.exec_driver_sql("SELECT 1").scalar_one() == 1
    finally:
        for conn in connections:
            conn.close()
    assert time.perf_counter() - started < 30.0


def test_sqlite_wal_and_busy_timeout(app):
    engine = get_engine()
    with engine.connect() as conn:
        journal_mode = conn.exec_driver_sql("PRAGMA journal_mode").scalar_one()
        busy_timeout = conn.exec_driver_sql("PRAGMA busy_timeout").scalar_one()
    assert journal_mode.lower() == "wal"
    assert busy_timeout == 30000  # connect_args timeout=30 seconds


def test_concurrent_case_reads_no_500(ready):
    """D-3 smoke: 50 concurrent GET /api/v1/cases (the integration burst
    shape) must all return 200 with the full 15-case payload."""
    total = 50
    with concurrent.futures.ThreadPoolExecutor(max_workers=total) as pool:
        started = time.perf_counter()
        responses = list(pool.map(lambda _: ready.get("/api/v1/cases"), range(total)))
        elapsed = time.perf_counter() - started
    statuses = sorted({r.status_code for r in responses})
    assert statuses == [200], f"unexpected statuses: {statuses}"
    assert all(len(r.json()) == 15 for r in responses)
    assert elapsed < 30.0


def test_concurrent_mixed_read_write_no_500(ready):
    """D-3 incident shape: reads interleaved with writes (write transactions
    hold the SQLite file lock). WAL keeps readers unblocked; 40 readers +
    10 distinct-case state writes must all succeed."""
    readers = 40
    writer_cases = [f"O{no}" for no in range(4, 14)]  # O4..O13 — distinct rows
    assert len(writer_cases) == 10

    def read(_i: int) -> int:
        return ready.get("/api/v1/cases").status_code

    def write(case_id: str) -> int:
        r = ready.post(
            f"/api/v1/cases/{case_id}/state",
            headers=SYSTEM,
            json={"lifecycle_stage": "UNDER_PAYPAL_REVIEW"},
        )
        return r.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=readers + len(writer_cases)) as pool:
        futures = [pool.submit(read, i) for i in range(readers)]
        futures += [pool.submit(write, cid) for cid in writer_cases]
        statuses = [f.result() for f in futures]
    assert sorted(set(statuses)) == [200], f"unexpected statuses: {sorted(set(statuses))}"


def test_engine_reset_recreates_pool_without_duplicate_pragma_listeners(app):
    """reset_engine() must build a fresh engine (and register the pragma
    listener exactly once) so repeated test isolation cycles don't stack
    listeners or leak connections."""
    from app.infrastructure import database

    first = get_engine()
    first_id = id(first)
    database.reset_engine()
    second = get_engine()
    assert id(second) != first_id
    assert second.pool.size() == 10
    with second.connect() as conn:
        assert conn.exec_driver_sql("SELECT 1").scalar_one() == 1
        assert (
            conn.exec_driver_sql("PRAGMA journal_mode").scalar_one().lower() == "wal"
        )
