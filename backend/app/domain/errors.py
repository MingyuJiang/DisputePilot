"""Domain errors — mapped to HTTP codes by the API layer."""

from __future__ import annotations


class DomainError(Exception):
    """Base class for domain errors."""

    code = "DOMAIN_ERROR"


class NotFoundError(DomainError):
    code = "NOT_FOUND"


class ConflictError(DomainError):
    code = "CONFLICT"


class ValidationFailedError(DomainError):
    code = "VALIDATION_FAILED"

    def __init__(self, message: str, report: dict | None = None):
        super().__init__(message)
        self.report = report or {}


class ForbiddenError(DomainError):
    code = "FORBIDDEN"
