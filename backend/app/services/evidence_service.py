"""Evidence service — evidence access + integrity checks."""

from __future__ import annotations

from ..domain.errors import NotFoundError
from ..domain.models import CaseRecord, EvidenceRecord


class EvidenceService:
    def __init__(self, case_service):
        self.case_service = case_service

    def list_evidence(self, case_id: str) -> list[EvidenceRecord]:
        return self.case_service.get_evidence(case_id)

    def get_evidence(self, case_id: str, evidence_id: str) -> EvidenceRecord:
        for ev in self.case_service.get_evidence(case_id):
            if ev.evidence_id == evidence_id:
                return ev
        raise NotFoundError(
            f"evidence {evidence_id!r} not found for case {case_id!r}"
        )

    @staticmethod
    def evidence_ids(case: CaseRecord) -> set[str]:
        return {ev.evidence_id for ev in case.evidence}
