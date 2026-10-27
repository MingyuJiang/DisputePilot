"""Internal error taxonomy for the local LLM path.

These are INTERNAL codes. They deliberately do NOT extend the frozen contract
``ErrorCode`` enum: the HTTP surface stays ``503`` + ``DOMAIN_ERROR`` and the
internal code travels in ``error.details[0].internal_code``.
"""

from __future__ import annotations

from ...domain.errors import DomainError

LLM_TIMEOUT = "LLM_TIMEOUT"
LLM_CONNECTION_ERROR = "LLM_CONNECTION_ERROR"
LLM_OUTPUT_TRUNCATED = "LLM_OUTPUT_TRUNCATED"
LLM_INVALID_JSON = "LLM_INVALID_JSON"
LLM_SCHEMA_INVALID = "LLM_SCHEMA_INVALID"
LLM_UNSUPPORTED_EVIDENCE = "LLM_UNSUPPORTED_EVIDENCE"
LLM_MODEL_UNAVAILABLE = "LLM_MODEL_UNAVAILABLE"

INTERNAL_CODES: tuple[str, ...] = (
    LLM_TIMEOUT,
    LLM_CONNECTION_ERROR,
    LLM_OUTPUT_TRUNCATED,
    LLM_INVALID_JSON,
    LLM_SCHEMA_INVALID,
    LLM_UNSUPPORTED_EVIDENCE,
    LLM_MODEL_UNAVAILABLE,
)


class LLMServiceError(DomainError):
    """A local-inference failure that must be surfaced, never silently stubbed.

    ``code`` stays ``DOMAIN_ERROR`` (frozen contract); ``http_status`` is 503;
    ``details`` is the ErrorResponse ``details`` list carrying the internal
    code plus non-sensitive context (no prompt text, no model output).
    """

    code = "DOMAIN_ERROR"
    http_status = 503

    def __init__(self, internal_code: str, message: str, **context):
        if internal_code not in INTERNAL_CODES:
            raise ValueError(f"unknown LLM internal code {internal_code!r}")
        super().__init__(message)
        self.internal_code = internal_code
        self.context = {k: v for k, v in context.items() if v is not None}
        self.details = [{"internal_code": internal_code, **self.context}]
