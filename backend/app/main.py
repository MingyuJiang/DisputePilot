"""FastAPI application factory + startup wiring."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware

from .api import approvals, cases, executions, analyses, proposals, payments, demo, llm, autopilot
from .api.deps import build_container
from .domain.errors import DomainError
from .domain.policies import IllegalStateTransition
from .infrastructure.database import get_engine
from .infrastructure.repositories import create_all
from .infrastructure.settings import settings
from .schemas.errors import ErrorCode

logger = logging.getLogger("disputepilot")

# DomainError.code -> HTTP status (contract SCHEMA_V1 §9).
_DOMAIN_ERROR_STATUS = {
    ErrorCode.NOT_FOUND.value: 404,
    ErrorCode.CONFLICT.value: 409,
    ErrorCode.VALIDATION_FAILED.value: 422,
    ErrorCode.FORBIDDEN.value: 403,
    ErrorCode.UNAUTHORIZED.value: 401,
    ErrorCode.ILLEGAL_STATE_TRANSITION.value: 409,
    ErrorCode.REQUEST_INVALID.value: 422,
}

# Starlette HTTPException status -> envelope code.
_HTTP_STATUS_TO_CODE = {
    401: ErrorCode.UNAUTHORIZED.value,
    403: ErrorCode.FORBIDDEN.value,
    404: ErrorCode.NOT_FOUND.value,
    409: ErrorCode.CONFLICT.value,
    422: ErrorCode.REQUEST_INVALID.value,
}


def _envelope(code: str, message: str, **extra) -> dict:
    body = {"code": code, "message": message}
    body.update({k: v for k, v in extra.items() if v is not None})
    return {"error": body}


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .adapters.paypal.config import PayPalConfig
    from .adapters.paypal.errors import PayPalError
    from .adapters.paypal.source import PayPalCaseSource

    container = build_container()
    app.state.container = container
    engine = get_engine()
    create_all(engine)
    # create_all() adds tables but never alters an existing one, so the
    # approval-timeline columns are upgraded explicitly — before anything
    # queries approvals — and historical rows are backfilled from audit events.
    from .infrastructure.migrations import migrate

    migration = migrate(engine)
    logger.info(
        "schema upgrade: added=%s already=%s | backfill: examined=%d "
        "backfilled=%d ambiguous=%d missing=%d",
        migration["schema"]["added"] or "none",
        migration["schema"]["already_present"] or "none",
        migration["backfill"]["examined"],
        migration["backfill"]["backfilled"],
        migration["backfill"]["ambiguous"],
        migration["backfill"]["missing"],
    )

    # The runtime state store is in-memory and starts from the bundled
    # fixtures. Restore the durable copy so cases imported by an earlier
    # process (PayPal Sandbox) keep their state across a restart.
    from .infrastructure.database import get_session_factory
    from .infrastructure.repositories import CaseStateRepository

    hydrate_session = get_session_factory()()
    try:
        restored = container.state_store.restore(
            CaseStateRepository(hydrate_session).list_all()
        )
        if restored:
            logger.info("restored %d persisted case states", restored)
    finally:
        hydrate_session.close()

    config = PayPalConfig.from_env()
    if config.is_sandbox_mode:
        # Sandbox mode NEVER imports offline fixtures: mixing provenance
        # labels would make a fixture case look like a live observation.
        # Auto-import is opt-in here (explicit DP_AUTO_IMPORT=1) and a failure
        # is recorded in /health instead of blocking startup.
        if os.environ.get("DP_AUTO_IMPORT") == "1" and config.is_configured:
            from .infrastructure.database import get_session_factory

            session = get_session_factory()()
            source = PayPalCaseSource(config)
            try:
                report = source.sync(session, container.state_store)
                settings.paypal_last_read_at = report.read_at
                settings.paypal_last_error = ""
                logger.info(
                    "paypal sandbox import: imported=%d skipped=%d remote=%d",
                    report.imported,
                    report.skipped,
                    report.remote_count,
                )
            except PayPalError as exc:
                settings.paypal_last_error = f"{exc.kind.value}: {exc.message}"
                logger.warning("paypal sandbox import failed: %s", exc.to_public())
            except Exception as exc:  # never block startup on an adapter fault
                settings.paypal_last_error = f"UNEXPECTED: {type(exc).__name__}"
                logger.warning(
                    "paypal sandbox import failed unexpectedly: %s",
                    type(exc).__name__,
                )
            finally:
                source.close()
                session.close()
    elif settings.auto_import_on_startup:
        from .services.case_service import CaseService
        from .infrastructure.database import get_session_factory

        session = get_session_factory()()
        try:
            service = CaseService(session, container.state_store)
            report = service.import_fixtures(settings.case_snapshot_path)
            logger.info(
                "fixture import: cases=%d skipped=%d negatives=%d",
                len(report.cases),
                report.skipped_duplicates,
                len(report.negative_samples),
            )
        finally:
            session.close()
    yield


def _mount_frontend(app: FastAPI) -> None:
    """Serve a pre-built SPA from the same process (standalone demo mode).

    Off by default: only when ``DP_STATIC_DIR`` points at a directory that
    contains ``index.html``. The hosted frontend calls the API on its own
    origin, so no CORS/CDN assumptions are needed.

    API routes are registered before this mount, so ``/api/v1/...`` keeps
    winning; unknown ``/api`` paths still return a JSON 404 instead of
    index.html, and the catch-all stays out of the OpenAPI schema.
    """
    static_dir = os.environ.get("DP_STATIC_DIR", "").strip()
    if not static_dir:
        return
    root = Path(static_dir).expanduser().resolve()
    if not (root / "index.html").is_file():
        logger.warning("DP_STATIC_DIR has no index.html: %s", root)
        return

    assets = root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False, response_model=None)
    async def spa_fallback(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse(
                status_code=404,
                content={"error": {"code": "NOT_FOUND", "message": "no such endpoint"}},
            )
        candidate = (root / full_path).resolve()
        # never serve outside the build directory
        if full_path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(root / "index.html")

    logger.info("serving frontend from %s", root)


def create_app() -> FastAPI:
    app = FastAPI(
        title="DisputePilot API",
        version="1.3.0",
        description=(
            "**DEMO ONLY — NOT FOR PRODUCTION USE.** "
            "DisputePilot v2.0 — PayPal AI Hackathon 2026. API contract v1.3. "
            "Runs in OFFLINE REPLAY (frozen fixtures) or PAYPAL SANDBOX "
            "(read-only by default; live writes require an explicit switch and "
            "a per-action allow-list entry). Identity headers (X-Actor-Id / "
            "X-Actor-Role) are demo role markers, NOT production authentication. "
            "All error responses use the unified ErrorResponse envelope "
            "(see SCHEMA_V1 §9)."
        ),
        lifespan=lifespan,
    )

    # D-1: the Phase-2 browser frontend (127.0.0.1:8210-8219) calls this
    # backend cross-origin; without CORS headers the browser same-origin
    # policy blocks every response (Node clients were unaffected, which is
    # why tests never exposed it). Loopback dev origins only — allow_origins
    # is deliberately NOT "*": the origin surface stays minimal even though
    # the demo identity headers (X-Actor-Id/X-Actor-Role) are not credentials.
    # Methods/headers are permissive so X-Actor-Id, X-Actor-Role,
    # Idempotency-Key and Content-Type pass preflight.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://(127\.0\.0\.1|localhost):821\d$",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(DomainError)
    async def domain_error_handler(_request: Request, exc: DomainError):
        # ``http_status`` is an opt-in override (e.g. local-LLM failures are
        # 503); the envelope code is unchanged, so the frozen contract holds.
        status = getattr(exc, "http_status", None) or _DOMAIN_ERROR_STATUS.get(
            exc.code, 400
        )
        report = getattr(exc, "report", None)
        details = getattr(exc, "details", None)
        payload = _envelope(
            exc.code,
            str(exc),
            details=details if details is not None else None,
            validation_report=report or None,
        )
        return JSONResponse(status_code=status, content=payload)

    @app.exception_handler(IllegalStateTransition)
    async def illegal_transition_handler(_request: Request, exc: IllegalStateTransition):
        return JSONResponse(
            status_code=409,
            content=_envelope(ErrorCode.ILLEGAL_STATE_TRANSITION.value, str(exc)),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_request: Request, exc: StarletteHTTPException):
        """Normalize auth/HTTP errors into the unified envelope.

        401 (missing X-Actor-Id) -> UNAUTHORIZED; 403 (role mismatch) ->
        FORBIDDEN; 404 -> NOT_FOUND; 409 -> CONFLICT; 422 -> REQUEST_INVALID.
        """
        code = _HTTP_STATUS_TO_CODE.get(exc.status_code, ErrorCode.DOMAIN_ERROR.value)
        if isinstance(exc.detail, str):
            payload = _envelope(code, exc.detail)
        else:
            payload = _envelope(
                code, f"request rejected with status {exc.status_code}", details=exc.detail
            )
        return JSONResponse(status_code=exc.status_code, content=payload)

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(_request: Request, exc: RequestValidationError):
        """Request FORMAT errors (malformed body / params) -> REQUEST_INVALID.

        Distinct from VALIDATION_FAILED, which is a BUSINESS policy block and
        carries a validation_report instead of details.
        """
        from fastapi.encoders import jsonable_encoder

        return JSONResponse(
            status_code=422,
            content=_envelope(
                ErrorCode.REQUEST_INVALID.value,
                "request format invalid; see details",
                details=jsonable_encoder(exc.errors()),
            ),
        )

    app.include_router(cases.router)
    app.include_router(analyses.router)
    app.include_router(proposals.router)
    app.include_router(approvals.router)
    app.include_router(executions.router)
    # Payments lives outside the frozen v1.2 contract surface: the router is
    # include_in_schema=False, so the published OpenAPI stays 0-diff while the
    # capture-import endpoint is still served.
    app.include_router(payments.router)
    # Demo operations (reset) and model-runtime status are hidden operational
    # endpoints: include_in_schema=False keeps the frozen contract 0-diff.
    app.include_router(demo.router)
    app.include_router(llm.router)
    # Autopilot (MVP-0 batch triage) — additive, hidden from the frozen contract.
    app.include_router(autopilot.router)
    _mount_frontend(app)
    return app


app = create_app()
