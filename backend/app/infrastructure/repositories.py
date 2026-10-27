"""ORM tables + repositories.

Table design inherits ``reference/docs/schema.sql`` (9-table relationships,
minor-unit money, action_audit vocabulary) and adds the four structures the
v2 safety model requires: approvals, executions, idempotency keys, case
snapshots (version + hash binding).

Safety-relevant constraints:
- executions.proposal_id is UNIQUE → duplicate/concurrent replay attempts are
  rejected by the database, not by in-memory flags.
- approvals.proposal_id is UNIQUE → one decision per immutable proposal.
- audit_events has no update/delete path anywhere in this codebase.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    sessionmaker,
)

from ..domain.enums import (
    ActorRole,
    ActorType,
    ApprovalDecision,
    AuditEventType,
    CaseWorkflowStatus,
    ExecutionMode,
    ProposalState,
    ValidationStatus,
)
from ..domain.models import (
    ActionProposal,
    Approval,
    AuditEvent,
    CaseRecord,
    CaseStateSnapshot,
    EvidenceRecord,
    ExecutionRecord,
)
from ..domain import policies


class Base(DeclarativeBase):
    pass


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# ORM tables
# ---------------------------------------------------------------------------
class CaseRow(Base):
    __tablename__ = "cases"

    case_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scenario_id: Mapped[str] = mapped_column(String(128), default="UNKNOWN")
    dispute_id: Mapped[str] = mapped_column(String(64), default="UNKNOWN")
    family: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default=CaseWorkflowStatus.IMPORTED.value)
    dispute_status: Mapped[str] = mapped_column(String(64), default="UNKNOWN")
    lifecycle_stage: Mapped[str] = mapped_column(String(64), default="UNKNOWN")
    amount_minor: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    fulfillment_posture: Mapped[str] = mapped_column(String(32), default="NONE")
    seller_contacted: Mapped[bool] = mapped_column(Boolean, default=False)
    provenance: Mapped[str] = mapped_column(String(32))
    verification_level: Mapped[str] = mapped_column(String(64), default="UNKNOWN")
    case_version: Mapped[int] = mapped_column(Integer, default=1)
    snapshot_hash: Mapped[str] = mapped_column(String(64), default="")
    live_status_note: Mapped[str] = mapped_column(Text, default="")
    record_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow)
    updated_at: Mapped[str] = mapped_column(String(40), default=_utcnow)


class EvidenceRow(Base):
    __tablename__ = "evidence"

    evidence_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    case_id: Mapped[str] = mapped_column(String(64), ForeignKey("cases.case_id"), index=True)
    evidence_type: Mapped[str] = mapped_column(String(48))
    content: Mapped[str] = mapped_column(Text, default="")
    source_type: Mapped[str] = mapped_column(String(48), default="CASE_SNAPSHOT")
    provenance: Mapped[str] = mapped_column(String(32))
    verification_level: Mapped[str] = mapped_column(String(64), default="UNKNOWN")
    source_reference: Mapped[str] = mapped_column(String(255), default="UNKNOWN")
    observed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    integrity_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)


class AnalysisRow(Base):
    __tablename__ = "analyses"

    analysis_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    case_id: Mapped[str] = mapped_column(String(64), ForeignKey("cases.case_id"), index=True)
    case_snapshot_hash: Mapped[str] = mapped_column(String(64))
    model_provider: Mapped[str] = mapped_column(String(64))
    model_name: Mapped[str] = mapped_column(String(64))
    analysis_mode: Mapped[str] = mapped_column(String(32))
    record_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow)


class ProposalRow(Base):
    __tablename__ = "proposals"

    proposal_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    case_id: Mapped[str] = mapped_column(String(64), ForeignKey("cases.case_id"), index=True)
    analysis_id: Mapped[str] = mapped_column(String(96), index=True)
    action_type: Mapped[str] = mapped_column(String(48))
    action_payload_json: Mapped[str] = mapped_column(Text)
    payload_hash: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(32), default=ProposalState.DRAFT.value)
    risk_level: Mapped[str] = mapped_column(String(16))
    validation_status: Mapped[str] = mapped_column(
        String(16), default=ValidationStatus.NOT_RUN.value
    )
    snapshot_hash: Mapped[str] = mapped_column(String(64))
    policy_version: Mapped[str] = mapped_column(String(32))
    execution_authorized: Mapped[bool] = mapped_column(Boolean, default=False)
    record_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow)
    updated_at: Mapped[str] = mapped_column(String(40), default=_utcnow)


class ApprovalRow(Base):
    __tablename__ = "approvals"
    __table_args__ = (UniqueConstraint("proposal_id", name="uq_approval_proposal"),)

    approval_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    proposal_id: Mapped[str] = mapped_column(String(96), ForeignKey("proposals.proposal_id"))
    case_id: Mapped[str] = mapped_column(String(64), index=True)
    action_payload_hash: Mapped[str] = mapped_column(String(64))
    case_snapshot_hash: Mapped[str] = mapped_column(String(64))
    policy_version: Mapped[str] = mapped_column(String(32))
    decision: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[str] = mapped_column(String(64))
    actor_role: Mapped[str] = mapped_column(String(16))
    decided_at: Mapped[str] = mapped_column(String(40), default=_utcnow)
    # Added by the startup migration (nullable: legacy rows may stay unknown).
    created_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at_source: Mapped[str | None] = mapped_column(String(120), nullable=True)


class ExecutionRow(Base):
    __tablename__ = "executions"
    __table_args__ = (UniqueConstraint("proposal_id", name="uq_execution_proposal"),)

    execution_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    proposal_id: Mapped[str] = mapped_column(String(96), ForeignKey("proposals.proposal_id"))
    case_id: Mapped[str] = mapped_column(String(64), index=True)
    execution_mode: Mapped[str] = mapped_column(
        String(16), default=ExecutionMode.REPLAY.value
    )
    simulated: Mapped[bool] = mapped_column(Boolean, default=True)
    result: Mapped[str] = mapped_column(String(24))
    gateway: Mapped[str] = mapped_column(String(48))
    record_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow)


class AuditEventRow(Base):
    __tablename__ = "audit_events"

    event_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    case_id: Mapped[str] = mapped_column(String(64), index=True)
    event_type: Mapped[str] = mapped_column(String(48))
    actor_type: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow, index=True)


class IdempotencyKeyRow(Base):
    __tablename__ = "idempotency_keys"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    endpoint: Mapped[str] = mapped_column(String(128))
    response_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow)


class CaseStateRow(Base):
    """Runtime replay state per case (fixture capability snapshot)."""

    __tablename__ = "case_states"

    case_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    state_version: Mapped[int] = mapped_column(Integer, default=1)
    state_hash: Mapped[str] = mapped_column(String(64))
    record_json: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(String(40), default=_utcnow)


class NegativeSampleRow(Base):
    """Negative-control samples (rejection/upgrade tests only, never executed)."""

    __tablename__ = "negative_samples"

    sample_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    category6: Mapped[str] = mapped_column(String(128))
    claim_summary: Mapped[str] = mapped_column(Text)
    expected_ai_behavior: Mapped[str] = mapped_column(Text)
    why_negative: Mapped[str] = mapped_column(Text)
    source_review_status: Mapped[str] = mapped_column(String(128))
    record_json: Mapped[str] = mapped_column(Text)


# ---------------------------------------------------------------------------
# Repositories
# ---------------------------------------------------------------------------
class Repository:
    def __init__(self, session):
        self.session = session


def _evidence_row(ev: EvidenceRecord) -> EvidenceRow:
    return EvidenceRow(
        evidence_id=ev.evidence_id,
        case_id=ev.case_id,
        evidence_type=ev.evidence_type.value,
        content=ev.content,
        source_type=ev.source_type,
        provenance=ev.provenance.value,
        verification_level=ev.verification_level.value,
        source_reference=ev.source_reference,
        observed_at=ev.observed_at,
        integrity_hash=ev.integrity_hash,
    )


class CaseRepository(Repository):
    def upsert_from_import(self, case: CaseRecord) -> bool:
        """Insert a case. Fixture immutability: re-import of identical content
        is a no-op (returns False); content drift raises (returns False too but
        the caller reports it)."""
        existing = self.session.get(CaseRow, case.case_id)
        if existing is not None:
            return False
        row = CaseRow(
            case_id=case.case_id,
            scenario_id=case.scenario_id,
            dispute_id=case.dispute_id,
            family=case.family.value,
            reason=case.reason.value,
            status=case.status.value,
            dispute_status=case.dispute_status.value,
            lifecycle_stage=case.lifecycle_stage.value,
            amount_minor=case.amount.value_minor,
            currency=case.amount.currency,
            fulfillment_posture=case.fulfillment_posture.value,
            seller_contacted=case.seller_contacted,
            provenance=case.provenance.value,
            verification_level=case.verification_level.value,
            case_version=case.case_version,
            snapshot_hash=case.snapshot_hash,
            live_status_note=case.live_status_note,
            record_json=case.model_dump_json(),
        )
        self.session.add(row)
        self.session.flush()
        for ev in case.evidence:
            self.session.add(_evidence_row(ev))
        self.session.flush()
        return True

    def refresh_from_import(self, case: CaseRecord) -> None:
        """Refresh an existing case from a newer remote read (sandbox re-import).

        The remote read is authoritative for everything PayPal supplied
        (transaction references, observed status, evidence), while the local
        workflow status and creation time are preserved so a re-import never
        rewinds our own workflow. Evidence is reconciled by evidence_id:
        existing rows are updated, new rows inserted, and stale PayPal rows
        removed — never duplicated.
        """
        existing = self.session.get(CaseRow, case.case_id)
        if existing is None:
            raise KeyError(case.case_id)

        # created_at belongs to this case's first appearance, not to the
        # refresh; read it from the stored record (legacy rows may differ from
        # the column default).
        try:
            created_at = json.loads(existing.record_json).get("created_at")
        except (TypeError, ValueError):
            created_at = None
        record = case.model_copy(
            update={
                "status": CaseWorkflowStatus(existing.status),
                "case_version": existing.case_version,
                "created_at": created_at or existing.created_at,
                "updated_at": _utcnow(),
            }
        )
        existing.scenario_id = record.scenario_id
        existing.dispute_id = record.dispute_id
        existing.family = record.family.value
        existing.reason = record.reason.value
        existing.dispute_status = record.dispute_status.value
        existing.lifecycle_stage = record.lifecycle_stage.value
        existing.amount_minor = record.amount.value_minor
        existing.currency = record.amount.currency
        existing.fulfillment_posture = record.fulfillment_posture.value
        existing.seller_contacted = record.seller_contacted
        existing.provenance = record.provenance.value
        existing.verification_level = record.verification_level.value
        existing.snapshot_hash = record.snapshot_hash
        existing.live_status_note = record.live_status_note
        existing.record_json = record.model_dump_json()
        existing.updated_at = record.updated_at
        self._reconcile_evidence(record)
        self.session.flush()

    def _reconcile_evidence(self, case: CaseRecord) -> None:
        rows = {
            row.evidence_id: row
            for row in self.session.query(EvidenceRow).filter_by(case_id=case.case_id).all()
        }
        incoming = {ev.evidence_id for ev in case.evidence}
        for ev in case.evidence:
            row = rows.get(ev.evidence_id)
            if row is None:
                self.session.add(_evidence_row(ev))
                continue
            row.evidence_type = ev.evidence_type.value
            row.content = ev.content
            row.source_type = ev.source_type
            row.provenance = ev.provenance.value
            row.verification_level = ev.verification_level.value
            row.source_reference = ev.source_reference
            row.observed_at = ev.observed_at
            row.integrity_hash = ev.integrity_hash
        for evidence_id, row in rows.items():
            if evidence_id not in incoming and row.source_type == "PAYPAL_DISPUTE_EVIDENCE":
                self.session.delete(row)

    def get(self, case_id: str) -> CaseRecord | None:
        row = self.session.get(CaseRow, case_id)
        if row is None:
            return None
        case = CaseRecord.model_validate_json(row.record_json)
        evidence = [
            EvidenceRecord(
                evidence_id=e.evidence_id,
                case_id=e.case_id,
                evidence_type=e.evidence_type,
                content=e.content,
                source_type=e.source_type,
                provenance=e.provenance,
                verification_level=e.verification_level,
                source_reference=e.source_reference,
                observed_at=e.observed_at,
                integrity_hash=e.integrity_hash,
            )
            for e in self.session.query(EvidenceRow).filter_by(case_id=case_id).all()
        ]
        case.evidence = evidence
        return case

    def list(self) -> list[CaseRecord]:
        return [self.get(r.case_id) for r in self.session.query(CaseRow).all()]

    def update_status(self, case_id: str, status: CaseWorkflowStatus) -> None:
        """Update the workflow status column AND the persisted record.

        ``get``/``list`` read ``record_json`` (the domain record), so updating
        only the column would make ``GET /cases`` keep reporting the status the
        case had at import time. Both must move together.
        """
        row = self.session.get(CaseRow, case_id)
        if row is None:
            raise KeyError(case_id)
        row.status = status.value
        row.updated_at = _utcnow()
        case = CaseRecord.model_validate_json(row.record_json)
        case.status = status
        case.updated_at = row.updated_at
        row.record_json = case.model_dump_json()
        self.session.flush()


class AnalysisRepository(Repository):
    def add(self, analysis) -> str:
        self.session.add(
            AnalysisRow(
                analysis_id=analysis.analysis_id,
                case_id=analysis.case_id,
                case_snapshot_hash=analysis.case_snapshot_hash,
                model_provider=analysis.model_provider,
                model_name=analysis.model_name,
                analysis_mode=analysis.analysis_mode.value,
                record_json=analysis.model_dump_json(),
            )
        )
        self.session.flush()
        return analysis.analysis_id

    def list_for_case(self, case_id: str) -> list:
        rows = (
            self.session.query(AnalysisRow)
            .filter_by(case_id=case_id)
            .order_by(AnalysisRow.created_at)
            .all()
        )
        from ..domain.models import AIAnalysis

        return [AIAnalysis.model_validate_json(r.record_json) for r in rows]


class ProposalRepository(Repository):
    def add(self, proposal: ActionProposal) -> str:
        self.session.add(
            ProposalRow(
                proposal_id=proposal.proposal_id,
                case_id=proposal.case_id,
                analysis_id=proposal.analysis_id,
                action_type=proposal.action_type,
                action_payload_json=json.dumps(proposal.action_payload, sort_keys=True),
                payload_hash=proposal.payload_hash,
                state=proposal.state.value,
                risk_level=proposal.risk_level.value,
                validation_status=proposal.validation_status.value,
                snapshot_hash=proposal.snapshot_hash,
                policy_version=proposal.policy_version,
                execution_authorized=proposal.execution_authorized,
                record_json=proposal.model_dump_json(),
            )
        )
        self.session.flush()
        return proposal.proposal_id

    def get(self, proposal_id: str) -> ActionProposal | None:
        row = self.session.get(ProposalRow, proposal_id)
        if row is None:
            return None
        return ActionProposal.model_validate_json(row.record_json)

    def list_for_case(self, case_id: str) -> list[ActionProposal]:
        rows = (
            self.session.query(ProposalRow)
            .filter_by(case_id=case_id)
            .order_by(ProposalRow.created_at)
            .all()
        )
        return [ActionProposal.model_validate_json(r.record_json) for r in rows]

    def transition(self, proposal_id: str, target: ProposalState, **field_updates) -> ActionProposal:
        row = self.session.get(ProposalRow, proposal_id)
        if row is None:
            raise KeyError(proposal_id)
        proposal = ActionProposal.model_validate_json(row.record_json)
        policies.assert_transition(proposal.state, target)
        proposal.state = target
        for key, value in field_updates.items():
            setattr(proposal, key, value)
        proposal.updated_at = _utcnow()
        row.state = target.value
        row.validation_status = proposal.validation_status.value
        row.execution_authorized = proposal.execution_authorized
        row.record_json = proposal.model_dump_json()
        row.updated_at = proposal.updated_at
        self.session.flush()
        return proposal


class ApprovalRepository(Repository):
    def add(self, approval: Approval) -> str:
        self.session.add(
            ApprovalRow(
                approval_id=approval.approval_id,
                proposal_id=approval.proposal_id,
                case_id=self._case_of(approval.proposal_id),
                action_payload_hash=approval.action_payload_hash,
                case_snapshot_hash=approval.case_snapshot_hash,
                policy_version=approval.policy_version,
                decision=approval.decision.value,
                reason=approval.reason,
                actor_id=approval.actor_id,
                actor_role=approval.actor_role.value,
                decided_at=approval.decided_at,
                created_at=approval.created_at,
                created_at_source=approval.created_at_source,
            )
        )
        self.session.flush()
        return approval.approval_id

    def _case_of(self, proposal_id: str) -> str:
        row = self.session.get(ProposalRow, proposal_id)
        return row.case_id if row else ""

    def _to_domain(self, row) -> Approval:
        return Approval(
            approval_id=row.approval_id,
            proposal_id=row.proposal_id,
            action_payload_hash=row.action_payload_hash,
            case_snapshot_hash=row.case_snapshot_hash,
            policy_version=row.policy_version,
            decision=ApprovalDecision(row.decision),
            reason=row.reason,
            actor_id=row.actor_id,
            actor_role=ActorRole(row.actor_role),
            decided_at=row.decided_at,
            created_at=row.created_at,
            created_at_source=row.created_at_source,
        )

    def get(self, approval_id: str) -> Approval | None:
        row = self.session.get(ApprovalRow, approval_id)
        return self._to_domain(row) if row else None

    def get_for_proposal(self, proposal_id: str) -> Approval | None:
        row = (
            self.session.query(ApprovalRow)
            .filter_by(proposal_id=proposal_id)
            .order_by(ApprovalRow.decided_at.desc())
            .first()
        )
        return self._to_domain(row) if row else None

    def list(self) -> list[Approval]:
        rows = self.session.query(ApprovalRow).order_by(ApprovalRow.decided_at.desc()).all()
        return [self._to_domain(r) for r in rows]

    def decide(
        self, approval_id: str, decision: ApprovalDecision, reason: str, actor_id: str,
        actor_role: ActorRole,
    ) -> Approval | None:
        """Exactly-once decision via conditional update (WHERE decision='PENDING').

        Returns None when the approval was already decided (concurrency-safe).
        """
        row = self.session.get(ApprovalRow, approval_id)
        if row is None:
            return None
        if row.decision != ApprovalDecision.PENDING.value:
            return None
        now = _utcnow()
        result = self.session.execute(
            ApprovalRow.__table__.update()
            .where(ApprovalRow.approval_id == approval_id)
            .where(ApprovalRow.decision == ApprovalDecision.PENDING.value)
            .values(
                decision=decision.value,
                reason=reason,
                actor_id=actor_id,
                actor_role=actor_role.value,
                decided_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            return None
        self.session.flush()
        row = self.session.get(ApprovalRow, approval_id, populate_existing=True)
        return self._to_domain(row)


class ExecutionRepository(Repository):
    def try_add(self, execution: ExecutionRecord) -> bool:
        """Insert an execution; the UNIQUE(proposal_id) constraint makes
        duplicate/concurrent executions impossible at the database level."""
        try:
            with self.session.begin_nested():
                self.session.add(
                    ExecutionRow(
                        execution_id=execution.execution_id,
                        proposal_id=execution.proposal_id,
                        case_id=execution.case_id,
                        execution_mode=execution.execution_mode.value,
                        simulated=execution.simulated,
                        result=execution.result.value,
                        gateway=execution.gateway,
                        record_json=execution.model_dump_json(),
                    )
                )
                self.session.flush()
            return True
        except IntegrityError:
            return False

    def get_for_proposal(self, proposal_id: str) -> ExecutionRecord | None:
        row = self.session.query(ExecutionRow).filter_by(proposal_id=proposal_id).first()
        if row is None:
            return None
        return ExecutionRecord.model_validate_json(row.record_json)

    def list_for_case(self, case_id: str) -> list[ExecutionRecord]:
        rows = self.session.query(ExecutionRow).filter_by(case_id=case_id).all()
        return [ExecutionRecord.model_validate_json(r.record_json) for r in rows]


class AuditRepository(Repository):
    """Append-only. There is deliberately no update() or delete()."""

    def append(self, event: AuditEvent) -> str:
        self.session.add(
            AuditEventRow(
                event_id=event.event_id,
                case_id=event.case_id,
                event_type=event.event_type,
                actor_type=event.actor_type.value,
                actor_id=event.actor_id,
                payload_json=json.dumps(event.payload, sort_keys=True),
                created_at=event.created_at,
            )
        )
        self.session.flush()
        return event.event_id

    def timeline(self, case_id: str) -> list[AuditEvent]:
        rows = (
            self.session.query(AuditEventRow)
            .filter_by(case_id=case_id)
            .order_by(AuditEventRow.created_at, AuditEventRow.event_id)
            .all()
        )
        return [
            AuditEvent(
                event_id=r.event_id,
                case_id=r.case_id,
                event_type=r.event_type,
                actor_type=ActorType(r.actor_type),
                actor_id=r.actor_id,
                payload=json.loads(r.payload_json),
                created_at=r.created_at,
            )
            for r in rows
        ]


class CaseStateRepository(Repository):
    def upsert(self, case_id: str, record_json: str, state_hash: str, version: int) -> None:
        row = self.session.get(CaseStateRow, case_id)
        if row is None:
            row = CaseStateRow(case_id=case_id, state_version=version, state_hash=state_hash, record_json=record_json)
            self.session.add(row)
        else:
            row.state_version = version
            row.state_hash = state_hash
            row.record_json = record_json
            row.updated_at = _utcnow()
        self.session.flush()

    def get(self, case_id: str):
        return self.session.get(CaseStateRow, case_id)

    def list_all(self) -> list[CaseStateSnapshot]:
        """Every persisted state, validated back into its domain model."""
        rows = self.session.query(CaseStateRow).all()
        return [CaseStateSnapshot.model_validate_json(row.record_json) for row in rows]


class NegativeSampleRepository(Repository):
    def add_all(self, samples: list[dict]) -> int:
        added = 0
        for s in samples:
            if self.session.get(NegativeSampleRow, s["sample_id"]) is not None:
                continue
            self.session.add(
                NegativeSampleRow(
                    sample_id=s["sample_id"],
                    category6=s.get("category6", ""),
                    claim_summary=s.get("claim_summary", ""),
                    expected_ai_behavior=s.get("expected_ai_behavior", ""),
                    why_negative=s.get("why_negative", ""),
                    source_review_status=s.get("source_review_status", ""),
                    record_json=json.dumps(s, sort_keys=True),
                )
            )
            added += 1
        self.session.flush()
        return added

    def list(self) -> list[dict]:
        rows = self.session.query(NegativeSampleRow).all()
        return [json.loads(r.record_json) for r in rows]

    def count(self) -> int:
        return self.session.query(NegativeSampleRow).count()


class IdempotencyRepository(Repository):
    def get(self, key: str):
        return self.session.get(IdempotencyKeyRow, key)

    def put(self, key: str, endpoint: str, response_json: str) -> None:
        self.session.add(
            IdempotencyKeyRow(key=key, endpoint=endpoint, response_json=response_json)
        )
        self.session.flush()


class AutopilotRunRow(Base):
    """One autopilot triage run — a report, never an execution record.

    Deliberately flat: MVP-0 needs exactly one row per run so a run survives a
    restart. Per-case results are stored verbatim as JSON so a read path can
    never re-derive (or silently re-decide) a historical classification.
    """

    __tablename__ = "autopilot_runs"

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    mode: Mapped[str] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(String(16))
    # Optional caller-supplied key: a unique index makes a duplicate request a
    # database-level no-op instead of a second analysis pass.
    request_key: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    payload_json: Mapped[str] = mapped_column(Text)
    started_at: Mapped[str] = mapped_column(String(40))
    finished_at: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow, index=True)


class AutopilotRunRepository(Repository):
    def add(self, payload: dict, request_key: str | None) -> None:
        self.session.add(
            AutopilotRunRow(
                run_id=payload["run_id"],
                mode=payload["mode"],
                status=payload["status"],
                request_key=request_key,
                payload_json=json.dumps(payload, sort_keys=True, default=str),
                started_at=payload["started_at"],
                finished_at=payload["finished_at"],
            )
        )
        self.session.flush()

    def get(self, run_id: str) -> dict | None:
        row = self.session.get(AutopilotRunRow, run_id)
        return None if row is None else json.loads(row.payload_json)

    def get_by_request_key(self, request_key: str) -> dict | None:
        row = (
            self.session.query(AutopilotRunRow)
            .filter(AutopilotRunRow.request_key == request_key)
            .one_or_none()
        )
        return None if row is None else json.loads(row.payload_json)


class AutopilotSubmissionBatchRow(Base):
    """One submit-for-review request — the durable audit anchor of a batch.

    ``(run_id, idempotency_key)`` is UNIQUE so a retry is resolved by the
    database, not by an in-memory flag. SQLite allows multiple NULLs, so
    requests without a key still create independent batches.
    """

    __tablename__ = "autopilot_submission_batches"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "idempotency_key", name="uq_submission_batch_run_key"
        ),
    )

    submission_batch_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Canonical hash of the request body; a key reused with a different body is
    # a conflict, never a silent replay.
    request_fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24))
    # The request's case selection (not the effective one) so a batch can be
    # replayed/audited without recomputing it from the run.
    requested_case_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    submitted_count: Mapped[int] = mapped_column(Integer, default=0)
    already_submitted_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    blocked_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    actor_id: Mapped[str] = mapped_column(String(64), default="autopilot")
    created_at: Mapped[str] = mapped_column(String(40), index=True)
    updated_at: Mapped[str] = mapped_column(String(40))


class AutopilotSubmissionItemRow(Base):
    """One case inside a batch: the durable answer to "what happened here?"."""

    __tablename__ = "autopilot_submission_items"
    __table_args__ = (
        UniqueConstraint(
            "submission_batch_id", "case_id", name="uq_submission_item_batch_case"
        ),
    )

    item_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    submission_batch_id: Mapped[str] = mapped_column(String(64), index=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    case_id: Mapped[str] = mapped_column(String(64), index=True)
    run_decision: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32))
    reason_code: Mapped[str] = mapped_column(String(48))
    reasons_json: Mapped[str] = mapped_column(Text, default="[]")
    proposal_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    approval_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    # State observed at submit time (never re-derived later).
    proposal_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    approval_decision: Mapped[str | None] = mapped_column(String(16), nullable=True)
    action_payload_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    case_snapshot_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    validation_report_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    validation_passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))


class AutopilotSubmissionRepository(Repository):
    """Read/write access to submission batches and their per-case items."""

    def add(self, batch: dict, items: list[dict]) -> None:
        self.session.add(
            AutopilotSubmissionBatchRow(
                submission_batch_id=batch["submission_batch_id"],
                run_id=batch["run_id"],
                idempotency_key=batch.get("idempotency_key"),
                request_fingerprint=batch["request_fingerprint"],
                status=batch["status"],
                requested_case_ids_json=json.dumps(
                    batch.get("requested_case_ids") or [], default=str
                ),
                total_count=batch["total_cases"],
                submitted_count=batch["submitted_cases"],
                already_submitted_count=batch["already_submitted_cases"],
                skipped_count=batch["skipped_cases"],
                blocked_count=batch["blocked_cases"],
                failed_count=batch["failed_cases"],
                actor_id=batch.get("actor_id") or "autopilot",
                created_at=batch["submitted_at"],
                updated_at=batch["submitted_at"],
            )
        )
        for item in items:
            self.session.add(
                AutopilotSubmissionItemRow(
                    item_id=f"{batch['submission_batch_id']}:{item['case_id']}",
                    submission_batch_id=batch["submission_batch_id"],
                    run_id=batch["run_id"],
                    case_id=item["case_id"],
                    run_decision=item.get("run_decision"),
                    status=item["status"],
                    reason_code=item["reason_code"],
                    reasons_json=json.dumps(item.get("reasons") or [], default=str),
                    proposal_id=item.get("proposal_id"),
                    approval_id=item.get("approval_id"),
                    proposal_state=item.get("proposal_state"),
                    approval_decision=item.get("approval_decision"),
                    action_payload_hash=item.get("action_payload_hash"),
                    case_snapshot_hash=item.get("case_snapshot_hash"),
                    validation_report_id=item.get("validation_report_id"),
                    validation_passed=item.get("validation_passed"),
                    created_at=batch["submitted_at"],
                )
            )
        self.session.flush()

    # ------------------------------------------------------------------ reads
    def get(self, submission_batch_id: str) -> dict | None:
        row = self.session.get(AutopilotSubmissionBatchRow, submission_batch_id)
        return None if row is None else self._payload(row)

    def get_by_key(self, run_id: str, idempotency_key: str) -> dict | None:
        row = (
            self.session.query(AutopilotSubmissionBatchRow)
            .filter(
                AutopilotSubmissionBatchRow.run_id == run_id,
                AutopilotSubmissionBatchRow.idempotency_key == idempotency_key,
            )
            .one_or_none()
        )
        return None if row is None else self._payload(row)

    def list_for_run(self, run_id: str) -> list[dict]:
        rows = (
            self.session.query(AutopilotSubmissionBatchRow)
            .filter(AutopilotSubmissionBatchRow.run_id == run_id)
            # Stable order: oldest first, batch id as the deterministic tiebreak.
            .order_by(
                AutopilotSubmissionBatchRow.created_at,
                AutopilotSubmissionBatchRow.submission_batch_id,
            )
            .all()
        )
        return [self._payload(row) for row in rows]

    def find_origin_for_approval(self, approval_id: str) -> tuple[dict, dict] | None:
        """Reverse lookup: which batch item created this approval?

        Resolved strictly through the stored ``approval_id`` column — never from
        the id's string prefix. Several batches may *reference* the same
        approval (a later run reports ALREADY_SUBMITTED); the origin is the item
        that actually submitted it, so a SUBMITTED_FOR_REVIEW row wins over the
        earlier already-submitted references.
        """
        items = (
            self.session.query(AutopilotSubmissionItemRow)
            .filter(AutopilotSubmissionItemRow.approval_id == approval_id)
            .order_by(
                AutopilotSubmissionItemRow.created_at,
                AutopilotSubmissionItemRow.item_id,
            )
            .all()
        )
        if not items:
            return None
        chosen = next(
            (
                item
                for item in items
                if item.status == "SUBMITTED_FOR_REVIEW"
            ),
            items[0],
        )
        batch = self.session.get(
            AutopilotSubmissionBatchRow, chosen.submission_batch_id
        )
        if batch is None:  # dangling reference: report no origin, never invent one
            return None
        return self._item_payload(chosen), self._payload(batch)

    @staticmethod
    def _item_payload(item: AutopilotSubmissionItemRow) -> dict:
        return {
            "case_id": item.case_id,
            "run_decision": item.run_decision,
            "status": item.status,
            "reason_code": item.reason_code,
            "reasons": json.loads(item.reasons_json or "[]"),
            "proposal_id": item.proposal_id,
            "approval_id": item.approval_id,
            "proposal_state": item.proposal_state,
            "approval_decision": item.approval_decision,
            "action_payload_hash": item.action_payload_hash,
            "case_snapshot_hash": item.case_snapshot_hash,
            "validation_report_id": item.validation_report_id,
            "validation_passed": item.validation_passed,
            # Shape kept from MVP-1 so stored batches and their API view agree.
            "validator": (
                {
                    "report_id": item.validation_report_id,
                    "passed": item.validation_passed,
                }
                if item.validation_report_id is not None
                else None
            ),
            "error": None,
            "created_at": item.created_at,
        }

    def _payload(self, row: AutopilotSubmissionBatchRow) -> dict:
        items = (
            self.session.query(AutopilotSubmissionItemRow)
            .filter(
                AutopilotSubmissionItemRow.submission_batch_id
                == row.submission_batch_id
            )
            .order_by(AutopilotSubmissionItemRow.case_id)
            .all()
        )
        return {
            "submission_batch_id": row.submission_batch_id,
            "run_id": row.run_id,
            "idempotency_key": row.idempotency_key,
            "request_fingerprint": row.request_fingerprint,
            "status": row.status,
            "requested_case_ids": json.loads(row.requested_case_ids_json or "[]"),
            "total_cases": row.total_count,
            "submitted_cases": row.submitted_count,
            "already_submitted_cases": row.already_submitted_count,
            "skipped_cases": row.skipped_count,
            "blocked_cases": row.blocked_count,
            "failed_cases": row.failed_count,
            "actor_id": row.actor_id,
            "executed_actions": 0,
            "results": [self._item_payload(item) for item in items],
            "submitted_at": row.created_at,
        }


def create_all(engine) -> None:
    Base.metadata.create_all(engine)

