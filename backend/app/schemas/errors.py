"""Unified error model (P0 A-3) + OpenAPI error-response declarations.

Every error response — domain errors, demo-auth failures, request-format
failures — uses ONE envelope::

    {"error": {"code": "...", "message": "...",
               "details"?: [...], "validation_report"?: {...}}}

Error codes (see ``contracts_proposal/SCHEMA_V1.md`` §9 for the full table):

- ``UNAUTHORIZED`` (401) — missing ``X-Actor-Id`` demo identity header;
- ``FORBIDDEN`` (403) — actor role not permitted for the operation;
- ``NOT_FOUND`` (404) — unknown resource id;
- ``CONFLICT`` (409) — duplicate execution / already decided / state conflict;
- ``ILLEGAL_STATE_TRANSITION`` (409) — proposal state machine violation;
- ``VALIDATION_FAILED`` (422) — BUSINESS policy block (V1–V12); carries
  ``validation_report``;
- ``REQUEST_INVALID`` (422) — REQUEST FORMAT error (malformed body/params);
  carries ``details``. Distinct from ``VALIDATION_FAILED``.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class ErrorCode(str, Enum):
    """Stable machine-readable error codes (envelope ``error.code``)."""

    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    ILLEGAL_STATE_TRANSITION = "ILLEGAL_STATE_TRANSITION"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    REQUEST_INVALID = "REQUEST_INVALID"
    DOMAIN_ERROR = "DOMAIN_ERROR"  # fallback for unmapped domain/HTTP errors


class ErrorBody(BaseModel):
    """Envelope body. ``details``/``validation_report`` appear only when the
    error class provides them (``REQUEST_INVALID`` / ``VALIDATION_FAILED``)."""

    code: ErrorCode
    message: str
    details: list | None = None
    validation_report: dict | None = None


class ErrorResponse(BaseModel):
    """The single error envelope used by every 4xx/5xx response."""

    error: ErrorBody


# ---------------------------------------------------------------------------
# OpenAPI declarations
# ---------------------------------------------------------------------------
def error_response(description: str) -> dict:
    """Build an OpenAPI response entry for ErrorResponse.

    Uses FastAPI's native ``model`` declaration (NOT a hand-written
    ``$ref``): FastAPI passes hand-written ``responses=`` schemas through
    verbatim and never registers them into ``components/schemas``, which
    produced a dangling ``$ref``. With ``{"model": ErrorResponse}`` FastAPI
    generates the full schema, registers it once, and every declaration
    resolves.
    """
    return {"model": ErrorResponse, "description": description}


RESPONSES_AUTH: dict = {
    401: error_response("Missing X-Actor-Id demo identity header (UNAUTHORIZED)"),
    403: error_response("Actor role not permitted for this operation (FORBIDDEN)"),
}
RESPONSES_NOT_FOUND: dict = {404: error_response("Unknown resource id (NOT_FOUND)")}
RESPONSES_CONFLICT: dict = {
    409: error_response(
        "Duplicate / already-decided / state conflict "
        "(CONFLICT or ILLEGAL_STATE_TRANSITION)"
    )
}
RESPONSES_VALIDATION_FAILED: dict = {
    422: error_response(
        "Business validation failed — deterministic V1–V12 block "
        "(VALIDATION_FAILED; includes validation_report)"
    )
}
RESPONSES_REQUEST_INVALID: dict = {
    422: error_response(
        "Request format invalid — malformed body or parameters "
        "(REQUEST_INVALID; includes details)"
    )
}
RESPONSES_422_BOTH: dict = {
    422: error_response(
        "REQUEST_INVALID (request format; includes details) OR "
        "VALIDATION_FAILED (business grounding/policy block; includes "
        "validation_report)"
    )
}


def merge_responses(*groups: dict) -> dict:
    """Merge response groups; later groups override same status codes."""
    merged: dict = {}
    for group in groups:
        merged.update(group)
    return merged
