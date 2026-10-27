"""Case service — fixture import, listing, detail, evidence access."""

from __future__ import annotations

from ..adapters.case_state import CaseStateStore
from ..adapters.fixture_loader import ImportReport, import_snapshot
from ..domain.enums import AuditEventType, ActorType, CaseWorkflowStatus
from ..domain.errors import NotFoundError
from ..domain.models import AuditEvent, CaseRecord, CaseStateSnapshot, EvidenceRecord
from ..infrastructure.repositories import (
    AuditRepository,
    CaseRepository,
    CaseStateRepository,
    NegativeSampleRepository,
)


class CaseService:
    def __init__(self, session, state_store: CaseStateStore):
        self.session = session
        self.state_store = state_store
        self.cases = CaseRepository(session)
        self.states = CaseStateRepository(session)
        self.audit = AuditRepository(session)
        self.negatives = NegativeSampleRepository(session)

    # ------------------------------------------------------------------ import
    def import_fixtures(self, snapshot_path, states_path=None) -> ImportReport:
        states = self.state_store.all()
        report = import_snapshot(snapshot_path, states)
        imported = 0
        skipped = 0
        for case in report.cases:
            if self.cases.upsert_from_import(case):
                imported += 1
                self.audit.append(
                    AuditEvent(
                        event_id=f"AUD-IMPORT-{case.case_id}",
                        case_id=case.case_id,
                        event_type=AuditEventType.CASE_IMPORTED.value,
                        actor_type=ActorType.SYSTEM,
                        actor_id="fixture-loader",
                        payload={
                            "provenance": case.provenance.value,
                            "verification_level": case.verification_level.value,
                            "snapshot_hash": case.snapshot_hash,
                            "evidence_count": len(case.evidence),
                            "dispute_id": case.dispute_id,
                        },
                    )
                )
            else:
                skipped += 1
        report.skipped_duplicates = skipped
        neg_added = self.negatives.add_all(report.negative_samples)
        # mirror fixture states into the local DB (runtime authority is the store)
        for case_id, state in states.items():
            self.states.upsert(
                case_id, state.model_dump_json(), state.compute_state_hash(), state.state_version
            )
        self.session.commit()
        report.negative_samples = self.negatives.list()
        report.warnings.append(f"negative_samples_recognized={neg_added}")
        return report

    # -------------------------------------------------------------------- read
    def get_case(self, case_id: str) -> CaseRecord:
        case = self.cases.get(case_id)
        if case is None:
            raise NotFoundError(f"case {case_id!r} not found")
        return case

    def list_cases(self) -> list[CaseRecord]:
        return self.cases.list()

    def get_evidence(self, case_id: str) -> list[EvidenceRecord]:
        case = self.get_case(case_id)
        return case.evidence

    def get_state(self, case_id: str):
        state = self.state_store.get(case_id)
        if state is None:
            # The in-memory store is rebuilt from fixtures on every boot. If a
            # persisted state exists (e.g. a PayPal Sandbox import from an
            # earlier process), load it lazily so a restart cannot turn a real
            # case into a 404.
            row = self.states.get(case_id)
            if row is not None:
                state = CaseStateSnapshot.model_validate_json(row.record_json)
                self.state_store.upsert(state)
        if state is None:
            raise NotFoundError(f"replay state for case {case_id!r} not found")
        return state

    def negative_samples(self) -> list[dict]:
        return self.negatives.list()

    def set_workflow_status(self, case_id: str, status: CaseWorkflowStatus) -> None:
        self.cases.update_status(case_id, status)
        self.session.commit()

    def apply_state_update(self, case_id: str, changes: dict, note: str = ""):
        """SYSTEM-only test/demo hook: simulate a PayPal-side state change.

        Updates the in-memory fixture store, mirrors to the DB, bumps the
        state version, and audits the change. Approvals bound to the previous
        decision hash become stale.
        """
        from ..domain.enums import AuditEventType, ActorType
        from ..domain.models import AuditEvent

        self.get_case(case_id)  # 404 if unknown
        state = self.state_store.apply_update(case_id, changes, note)
        self.states.upsert(
            case_id, state.model_dump_json(), state.compute_state_hash(), state.state_version
        )
        self.audit.append(
            AuditEvent(
                event_id=f"AUD-STATE-{case_id}-{state.state_version}",
                case_id=case_id,
                event_type=AuditEventType.CASE_STATE_CHANGED.value,
                actor_type=ActorType.SYSTEM,
                actor_id="state-hook",
                payload={
                    "changes": changes,
                    "state_version": state.state_version,
                    "state_hash": state.compute_state_hash(),
                    "note": note,
                },
            )
        )
        self.session.commit()
        return state
