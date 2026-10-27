"""Audit service — append-only timeline access."""

from __future__ import annotations

from ..domain.errors import NotFoundError
from ..domain.models import AuditEvent
from ..infrastructure.repositories import AuditRepository
from .case_service import CaseService


class AuditService:
    def __init__(self, session, case_service: CaseService):
        self.session = session
        self.case_service = case_service
        self.repo = AuditRepository(session)

    def timeline(self, case_id: str) -> list[AuditEvent]:
        self.case_service.get_case(case_id)  # 404 if unknown case
        return self.repo.timeline(case_id)
