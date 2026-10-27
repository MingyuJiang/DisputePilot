"""Execution service — offline replay or live sandbox write of approved proposals.

Gateway selection follows ``settings.data_mode`` (env-driven, per call):

- ``offline_replay`` (default) → :class:`ReplayExecutionGateway`; the historical
  behaviour is unchanged (``execution_mode=REPLAY``, ``simulated=true``).
- ``paypal_sandbox`` → :class:`PayPalSandboxGateway`; the operator double gate
  (``DP_PAYPAL_WRITES_ENABLED=1`` AND the exact ``<dispute_id>:<action>`` pair on
  ``DP_PAYPAL_WRITE_ALLOW``) is checked here, before the gateway is built and
  therefore before any OAuth/GET/POST. The gateway then re-checks it, performs
  the pre-GET (remote status + HATEOAS drift) and issues at most one POST.

Guarantees (both modes):
- only APPROVED proposals execute; rejected/blocked/unapproved never execute;
- V1–V12 re-runs at execution time (revalidation) — AI cannot override;
- approval binding (payload hash, snapshot hash, policy version, MANAGER role)
  is re-checked; any drift blocks the execution;
- duplicate/concurrent execution is impossible: DB UNIQUE(proposal_id); a live
  attempt additionally takes a durable one-shot claim **before** the POST, so
  two concurrent requests can never both write to PayPal;
- every outcome is audited; successful replays write an out/ artifact aligned
  with the S7 reporting contract (denominators + provenance + fixture sha256).

LIVE outcomes are never retried: EXECUTED → REPLAY_EXECUTED (the v1 executed
terminal state; execution_mode/result disambiguate), PENDING/UNVERIFIED/FAILED
→ FAILED, BLOCKED → BLOCKED. A PENDING payment (contract v1.2) is persisted as
``ExecutionResult.PENDING`` and is never reported as a success; the proposal
lands in FAILED only because v1.2 has no pending proposal state.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from ..adapters.case_state import CaseStateStore
from ..adapters.paypal.config import DATA_MODE_SANDBOX, PayPalConfig
from ..adapters.paypal.payments import capture_id_of_case
from ..adapters.replay_gateway import ReplayExecutionGateway
from ..domain.enums import (
    ActionFamily,
    ActorRole,
    ActorType,
    AuditEventType,
    CaseWorkflowStatus,
    ExecutionMode,
    ExecutionResult,
    ProposalState,
    action_family_of,
)
from ..domain.errors import ConflictError, NotFoundError
from ..domain.models import (
    ActionProposal,
    Approval,
    AuditEvent,
    CaseRecord,
    ExecutionRecord,
)
from ..domain.policies import (
    ValidationContext,
    check_approval_binding,
    validate_proposal,
)
from ..infrastructure.repositories import AuditRepository, ExecutionRepository, ProposalRepository
from ..infrastructure.settings import OUT_DIR, settings
from .case_service import CaseService

if TYPE_CHECKING:  # pragma: no cover - typing only; keeps httpx out of import time
    from ..adapters.paypal.gateway import PayPalSandboxGateway
    from ..adapters.paypal.refund import PayPalRefundGateway

SNAPSHOT_SHA256 = "0882328a0a0561baa78a14421dc1a0107f1098f090b59b7fc49813b0e72edb08"

SandboxGatewayFactory = Callable[[PayPalConfig], "PayPalSandboxGateway"]
RefundGatewayFactory = Callable[[PayPalConfig], "PayPalRefundGateway"]

# Write-gate messages. They name the exact operator switches that are closed
# and state that no request was issued (contract v1.1 is approved, so the
# message never mentions a contract approval).
LIVE_EXECUTION_DISABLED = (
    "live execution is disabled: DP_PAYPAL_WRITES_ENABLED=1 and a matching "
    "<dispute_id|capture_id>:<action> entry in DP_PAYPAL_WRITE_ALLOW are "
    "required; no request was issued"
)

LIVE_CONFIG_REQUIRED = (
    "live execution requires DP_PAYPAL_CLIENT_ID / DP_PAYPAL_CLIENT_SECRET and a "
    "valid PayPal Sandbox base URL; no request was issued"
)

LIVE_WRITE_NOT_ALLOWED = (
    "live write is not authorised for {dispute_id}:{action}; add the exact pair "
    "to DP_PAYPAL_WRITE_ALLOW; no request was issued"
)

LIVE_ALREADY_CLAIMED = (
    "a live execution attempt was already claimed for this proposal; "
    "outcome must be reconciled by a human, no automatic retry"
)

REFUND_ALREADY_CLAIMED = (
    "a refund attempt was already claimed for capture {capture_id}; "
    "its outcome must be reconciled (GET the refund) before any further "
    "refund — no automatic retry"
)


class ExecutionService:
    def __init__(
        self,
        session,
        case_service: CaseService,
        state_store: CaseStateStore,
        gateway: ReplayExecutionGateway,
        *,
        sandbox_gateway_factory: SandboxGatewayFactory | None = None,
        refund_gateway_factory: RefundGatewayFactory | None = None,
    ):
        self.session = session
        self.case_service = case_service
        self.state_store = state_store
        self.gateway = gateway
        self.sandbox_gateway_factory = sandbox_gateway_factory
        self.refund_gateway_factory = refund_gateway_factory
        self.proposals = ProposalRepository(session)
        self.executions = ExecutionRepository(session)
        self.audit = AuditRepository(session)

    # ------------------------------------------------------------------ replay
    def replay(self, proposal_id: str, actor_id: str) -> ExecutionRecord:
        config = settings.paypal_config()
        live = settings.data_mode == DATA_MODE_SANDBOX

        proposal = self.proposals.get(proposal_id)
        if proposal is None:
            raise NotFoundError(f"proposal {proposal_id!r} not found")

        # 1. state gate
        if proposal.state == ProposalState.REPLAY_EXECUTED:
            if live:
                raise ConflictError(
                    "proposal already executed; duplicate live execution refused"
                )
            raise ConflictError("proposal already replayed; duplicate execution refused")
        if live and proposal.state == ProposalState.FAILED:
            previous = self.executions.get_for_proposal(proposal_id)
            if previous is not None:
                raise ConflictError(
                    f"proposal already attempted (result={previous.result.value}); "
                    "a live execution is never retried"
                )
        if proposal.state != ProposalState.APPROVED:
            raise ConflictError(
                f"proposal state {proposal.state.value} is not executable; "
                "only APPROVED proposals may replay"
            )

        # 2. duplicate guard (DB-level UNIQUE is the final word; this gives a
        #    clean error before we attempt the insert)
        existing = self.executions.get_for_proposal(proposal_id)
        if existing is not None:
            raise ConflictError("execution record already exists for this proposal")

        case = self.case_service.get_case(proposal.case_id)
        state = self.case_service.get_state(proposal.case_id)
        approval = self._require_approval(proposal)

        # 3. revalidation at execution time (deterministic, fresh state)
        report = self._revalidate(proposal, case, state, approval, actor_id, live)

        # 4. execute through the mode-selected gateway
        if live:
            return self._execute_live(
                proposal, case, state, approval, config, actor_id
            )
        return self._execute_replay(proposal, case, state, approval, report, actor_id)

    # -------------------------------------------------------------- revalidate
    def _grounded_facts(self, proposal: ActionProposal) -> list:
        """Grounded facts for the execution-time evidence check (never raises)."""
        from ..infrastructure.repositories import AnalysisRepository

        try:
            analyses = AnalysisRepository(self.session).list_for_case(proposal.case_id)
        except Exception:
            return []
        if not analyses:
            return []
        for analysis in analyses:
            if getattr(analysis, "analysis_id", None) == proposal.analysis_id:
                return list(getattr(analysis, "grounded_facts", []) or [])
        return list(getattr(analyses[-1], "grounded_facts", []) or [])

    def _revalidate(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        state,
        approval: Approval,
        actor_id: str,
        live: bool,
    ):
        """V1–V12 (dispute) / V13–V18 (refund) + approval-binding re-check.

        Blocks (audited) on any drift. For a refund the remote half of V13–V16
        is deferred to the RefundGateway pre-GET: exactly one authoritative
        capture read happens at execution time, immediately before the POST,
        rather than a second one here.
        """
        ctx = ValidationContext(
            case=case,
            state=state,
            policy_version=settings.policy_version,
            mode="live" if live else "offline_fixture",
            bound_snapshot_hash=proposal.snapshot_hash,
            decision_at=proposal.created_at,
            extra={"retry_audit": {"clean": True, "files": 0}},
        )
        # RC-1: execution re-checks the same evidence-material rule. A proposal
        # approved before the analysis changed cannot slip through here.
        ctx.extra["evidence_facts"] = self._grounded_facts(proposal)
        if action_family_of(proposal.action_type) is ActionFamily.PAYMENT:
            from ..domain.refund_policies import RefundContext

            ctx.extra["refund_context"] = RefundContext(
                deferred_to_gateway=True,
                deferred_reason=(
                    "execution-time revalidation; the gateway re-checks the "
                    "balance before the single POST"
                ),
                pending_refund_ids=[],
            )

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        report = validate_proposal(
            proposal,
            ctx,
            report_id=f"VR-EXE-{proposal.proposal_id}-{stamp}-{secrets.token_hex(3)}",
        )
        violations = check_approval_binding(
            proposal, approval, case, state, settings.policy_version
        )
        if not report.passed or violations:
            reasons = list(report.blocked_reasons) + violations
            self.proposals.transition(proposal.proposal_id, ProposalState.BLOCKED)
            self.audit.append(
                AuditEvent(
                    event_id=(
                        f"AUD-{proposal.proposal_id}-BLOCKED-{stamp}-"
                        f"{secrets.token_hex(3)}"
                    ),
                    case_id=proposal.case_id,
                    event_type=AuditEventType.EXECUTION_BLOCKED.value,
                    actor_type=ActorType.SYSTEM,
                    actor_id=actor_id,
                    payload={"reasons": reasons, "stage": "pre-execution revalidation"},
                )
            )
            self.session.commit()
            raise ConflictError(f"execution blocked: {reasons}")
        return report

    # ------------------------------------------------------------------- replay
    def _execute_replay(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        state,
        approval: Approval,
        report,
        actor_id: str,
    ) -> ExecutionRecord:
        # deterministic simulation; never a PayPal response
        try:
            record = self.gateway.execute(proposal, case, state, approval)
        except ValueError as exc:
            # A replay precondition refused the proposal (e.g. a refund amount
            # that is not positive, not 2 decimals or above the remaining
            # balance). It must never become a successful replay.
            return self._replay_refused(
                proposal, case, state, approval, exc, actor_id
            )

        # persist with DB-level duplicate protection
        if not self.executions.try_add(record):
            raise ConflictError("execution record already exists for this proposal")
        self.proposals.transition(proposal.proposal_id, ProposalState.REPLAY_EXECUTED)
        self.case_service.set_workflow_status(
            proposal.case_id, CaseWorkflowStatus.REPLAYED
        )
        self.audit.append(
            AuditEvent(
                event_id=f"AUD-{record.execution_id}",
                case_id=proposal.case_id,
                event_type=AuditEventType.EXECUTION_REPLAYED.value,
                actor_type=ActorType.SYSTEM,
                actor_id=actor_id,
                payload={
                    "execution_id": record.execution_id,
                    "execution_mode": record.execution_mode.value,
                    "simulated": record.simulated,
                    "approval_id": approval.approval_id,
                    "verification": record.verification,
                    "artifact": self._artifact_name(record),
                },
            )
        )
        self.session.commit()
        self._write_artifact(record, case, proposal, approval, report)
        return record

    def _replay_refused(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        state,
        approval: Approval,
        error: ValueError,
        actor_id: str,
    ) -> ExecutionRecord:
        """Persist a refused replay as FAILED — never as a successful replay."""
        execution_id = f"EX-{secrets.token_hex(8)}"
        reason = str(error)
        record = ExecutionRecord(
            execution_id=execution_id,
            proposal_id=proposal.proposal_id,
            case_id=case.case_id,
            execution_mode=ExecutionMode.REPLAY,
            simulated=True,
            result=ExecutionResult.FAILED,
            gateway=self.gateway.name,
            request_snapshot={
                "action_type": proposal.action_type,
                "action_payload": proposal.action_payload,
                "idempotency_key": (proposal.action_payload or {}).get(
                    "idempotency_key"
                ),
                "case_snapshot_hash": case.snapshot_hash,
                "approval_id": approval.approval_id,
                "state_version": state.state_version,
            },
            response_snapshot={
                "simulated": True,
                "execution_mode": "REPLAY",
                "gateway": self.gateway.name,
                "refused": True,
                "reason": reason,
                "note": (
                    "offline replay refused the proposal; no write and no "
                    "refund were simulated"
                ),
            },
            verification={
                "method": "deterministic replay precondition",
                "basis": "FIXTURE_SNAPSHOT",
                "confirmed": False,
                "failed_stage": "replay_precondition",
                "error": reason,
                "simulated": True,
                "post_issued": False,
            },
        )
        if not self.executions.try_add(record):
            raise ConflictError("execution record already exists for this proposal")
        self.proposals.transition(proposal.proposal_id, ProposalState.FAILED)
        self.audit.append(
            AuditEvent(
                event_id=f"AUD-{execution_id}-EXECUTION_BLOCKED",
                case_id=proposal.case_id,
                event_type=AuditEventType.EXECUTION_BLOCKED.value,
                actor_type=ActorType.SYSTEM,
                actor_id=actor_id,
                payload={
                    "execution_id": execution_id,
                    "result": ExecutionResult.FAILED.value,
                    "stage": "replay_precondition",
                    "reason": reason,
                    "post_issued": False,
                },
            )
        )
        self.session.commit()
        return record

    # --------------------------------------------------------------------- live
    def _execute_live(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        state,
        approval: Approval,
        config: PayPalConfig,
        actor_id: str,
    ) -> ExecutionRecord:
        # Gate order: writes flag → allow-list → (gateway) pre-GET. All local:
        # no OAuth, no GET and no POST can happen before these pass.
        self._assert_live_write_gate(config, proposal, case)

        payment = action_family_of(proposal.action_type) is ActionFamily.PAYMENT
        if not payment:
            # Durable one-shot claim **before** the POST: UNIQUE(proposal_id)
            # only protects the record after the fact; this protects the remote
            # write from concurrent duplicate requests in any process. Refund
            # attempts use a capture-level claim instead (see _claim_refund),
            # taken after the pre-GET and immediately before the POST.
            self._claim_live_attempt(proposal.proposal_id)

        execution_id = f"EX-{secrets.token_hex(8)}"
        emitted: set[str] = set()

        def audit(event_type: str, payload: dict) -> None:
            emitted.add(event_type)
            self._append_live_audit(
                proposal, execution_id, event_type, payload, actor_id
            )

        if payment:
            gateway = self._build_refund_gateway(config)
            claim = lambda capture_id: self._claim_refund(capture_id)  # noqa: E731
        else:
            gateway = self._build_sandbox_gateway(config)
            claim = None
        try:
            if payment:
                outcome = gateway.execute(
                    proposal, case, state, approval, audit=audit, claim=claim
                )
            else:
                outcome = gateway.execute(
                    proposal, case, state, approval, audit=audit
                )
        finally:
            self._close_gateway(gateway)

        result = ExecutionResult(outcome.result)
        record = ExecutionRecord(
            execution_id=execution_id,
            proposal_id=proposal.proposal_id,
            case_id=proposal.case_id,
            execution_mode=ExecutionMode.LIVE,
            simulated=False,
            result=result,
            gateway=outcome.gateway,
            request_snapshot=outcome.request_snapshot,
            response_snapshot=outcome.response_snapshot,
            verification=outcome.verification,
        )

        if not self.executions.try_add(record):
            raise ConflictError("execution record already exists for this proposal")

        target = {
            ExecutionResult.EXECUTED: ProposalState.REPLAY_EXECUTED,
            # PENDING is not a success: the payment was accepted but not
            # settled, so the proposal must not enter the executed terminal
            # state. The execution record keeps result=PENDING as the source
            # of truth and a human reconciles it.
            ExecutionResult.PENDING: ProposalState.FAILED,
            ExecutionResult.UNVERIFIED: ProposalState.FAILED,
            ExecutionResult.BLOCKED: ProposalState.BLOCKED,
            ExecutionResult.FAILED: ProposalState.FAILED,
        }[result]
        self.proposals.transition(proposal.proposal_id, target)
        if result is ExecutionResult.EXECUTED:
            self.case_service.set_workflow_status(
                proposal.case_id, CaseWorkflowStatus.REPLAYED
            )

        # EXECUTED / PENDING / UNVERIFIED are audited by the gateway itself
        # (VERIFIED / UNKNOWN). BLOCKED/FAILED before the POST have no gateway
        # audit, so record the outcome here exactly once.
        if result in (ExecutionResult.BLOCKED, ExecutionResult.FAILED) and (
            AuditEventType.EXECUTION_BLOCKED.value not in emitted
        ):
            verification = record.verification
            self._append_live_audit(
                proposal,
                execution_id,
                AuditEventType.EXECUTION_BLOCKED.value,
                {
                    "result": result.value,
                    "stage": (
                        verification.get("blocked_stage")
                        or verification.get("failed_stage")
                        or "unknown"
                    ),
                    "reason": (
                        verification.get("blocked_reason")
                        or (verification.get("error") or {}).get("message")
                        or result.value
                    ),
                    "post_issued": bool(verification.get("post_issued", False)),
                },
                actor_id,
            )
        self.session.commit()
        return record

    def _assert_live_write_gate(
        self, config: PayPalConfig, proposal: ActionProposal, case: CaseRecord
    ) -> None:
        if not config.writes_enabled:
            raise ConflictError(LIVE_EXECUTION_DISABLED)
        action = str(proposal.action_type)
        # Dispute actions are allow-listed per dispute; refunds per capture,
        # because a capture has no dispute id at all.
        target = (
            capture_id_of_case(case)
            if action_family_of(action) is ActionFamily.PAYMENT
            else case.dispute_id
        )
        if not config.is_write_allowed(target, action):
            if not config.is_configured:
                raise ConflictError(LIVE_CONFIG_REQUIRED)
            raise ConflictError(
                LIVE_WRITE_NOT_ALLOWED.format(dispute_id=target, action=action)
            )

    def _claim_refund(self, capture_id: str) -> None:
        """Durable one-shot claim per capture, taken immediately before POST.

        UNIQUE(proposal_id) stops the same proposal twice; this stops two
        different approved proposals from refunding the same capture
        concurrently (in any process, including after a crash).
        """
        from sqlalchemy.exc import IntegrityError

        from ..infrastructure.repositories import IdempotencyRepository

        repo = IdempotencyRepository(self.session)
        key = f"refund-capture:{capture_id}"
        if repo.get(key) is not None:
            raise ConflictError(REFUND_ALREADY_CLAIMED.format(capture_id=capture_id))
        try:
            repo.put(
                key,
                "refund-capture",
                json.dumps({"state": "CLAIMED", "capture_id": capture_id}),
            )
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            raise ConflictError(
                REFUND_ALREADY_CLAIMED.format(capture_id=capture_id)
            ) from None

    def _claim_live_attempt(self, proposal_id: str) -> None:
        """Durable one-shot claim (idempotency_keys PK) taken before any POST."""
        from sqlalchemy.exc import IntegrityError

        from ..infrastructure.repositories import IdempotencyRepository

        repo = IdempotencyRepository(self.session)
        key = f"live-execution:{proposal_id}"
        if repo.get(key) is not None:
            raise ConflictError(LIVE_ALREADY_CLAIMED)
        try:
            repo.put(key, "live-execution", json.dumps({"state": "CLAIMED"}))
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            raise ConflictError(LIVE_ALREADY_CLAIMED) from None

    def _build_sandbox_gateway(self, config: PayPalConfig) -> "PayPalSandboxGateway":
        if self.sandbox_gateway_factory is not None:
            return self.sandbox_gateway_factory(config)
        # Imported lazily: app import time must stay free of HTTP clients.
        from ..adapters.paypal.client import PayPalApiClient
        from ..adapters.paypal.gateway import PayPalSandboxGateway

        return PayPalSandboxGateway(config, PayPalApiClient(config))

    def _build_refund_gateway(self, config: PayPalConfig) -> "PayPalRefundGateway":
        if self.refund_gateway_factory is not None:
            return self.refund_gateway_factory(config)
        from ..adapters.paypal.client import PayPalApiClient
        from ..adapters.paypal.refund import PayPalRefundGateway

        return PayPalRefundGateway(config, PayPalApiClient(config))

    @staticmethod
    def _close_gateway(gateway) -> None:
        close = getattr(getattr(gateway, "client", None), "close", None)
        if callable(close):
            close()

    def _append_live_audit(
        self,
        proposal: ActionProposal,
        execution_id: str,
        event_type: str,
        payload: dict,
        actor_id: str,
    ) -> None:
        enriched = dict(payload)
        enriched.setdefault("proposal_id", proposal.proposal_id)
        enriched["execution_mode"] = ExecutionMode.LIVE.value
        enriched["simulated"] = False
        self.audit.append(
            AuditEvent(
                event_id=(
                    f"AUD-{execution_id}-{event_type}-{secrets.token_hex(3)}"
                ),
                case_id=proposal.case_id,
                event_type=event_type,
                actor_type=ActorType.SYSTEM,
                actor_id=actor_id,
                payload=enriched,
            )
        )
        # Commit per event: EXECUTION_ATTEMPT must be durable before the POST.
        self.session.commit()

    # ------------------------------------------------------------------ helpers
    def _analysis_meta(self, case_id: str) -> dict:
        """Analysis provenance for the artifact (no inference, DB read only)."""
        from ..infrastructure.repositories import AnalysisRepository

        analyses = AnalysisRepository(self.session).list_for_case(case_id)
        if not analyses:
            return {}
        latest = analyses[-1]
        return {
            "analysis_mode": latest.analysis_mode.value,
            "model_provider": latest.model_provider,
            "model_name": latest.model_name,
        }

    def _require_approval(self, proposal: ActionProposal) -> Approval:
        from .approval_service import ApprovalService

        approval = ApprovalService(
            self.session, self.case_service, self.state_store
        ).approval_for_proposal(proposal.proposal_id)
        if approval is None:
            raise ConflictError("no approval bound to this proposal")
        if approval.decision.value != "APPROVED":
            raise ConflictError(
                f"approval decision is {approval.decision.value}, not APPROVED"
            )
        return approval

    @staticmethod
    def _artifact_name(record: ExecutionRecord) -> str:
        return f"replay_{record.execution_id}.json"

    def _write_artifact(self, record, case, proposal, approval, report) -> Path:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        analysis_meta = self._analysis_meta(case.case_id)
        artifact = {
            "report": "disputepilot-replay-v1",
            "harness_version": "a-backend-0.1.0",
            "generated_at": record.created_at,
            "execution_mode": record.execution_mode.value,
            "simulated": record.simulated,
            "case_id": case.case_id,
            "proposal_id": proposal.proposal_id,
            "approval_id": approval.approval_id,
            "input": {
                "case_snapshot_hash": case.snapshot_hash,
                "state_version": self.case_service.get_state(case.case_id).state_version,
                "action": proposal.action_type,
                "payload_hash": proposal.payload_hash,
            },
            "validator": report.model_dump(mode="json"),
            "approval": approval.model_dump(mode="json"),
            "execution": record.model_dump(mode="json"),
            "provenance": {
                "case_provenance": case.provenance.value,
                "case_verification_level": case.verification_level.value,
                "state_basis": self.case_service.get_state(case.case_id).basis.value,
                "state_value_provenance": self.case_service.get_state(
                    case.case_id
                ).provenance.value,
                "analysis_mode": analysis_meta.get("analysis_mode", "UNKNOWN"),
                "model_provider": analysis_meta.get("model_provider", "unknown"),
                "model_name": analysis_meta.get("model_name", "unknown"),
            },
            "fixture_sha256": {
                "canonical_cases_snapshot": SNAPSHOT_SHA256,
            },
            "denominators": {
                "executed_writes": 1,
                "decision_points": 1,
                "note": "single-proposal replay artifact; rates are always reported with n=",
            },
        }
        path = OUT_DIR / self._artifact_name(record)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(artifact, fh, indent=2, ensure_ascii=False)
        return path

    # -------------------------------------------------------------------- read
    def get_execution(self, proposal_id: str) -> ExecutionRecord:
        record = self.executions.get_for_proposal(proposal_id)
        if record is None:
            raise NotFoundError(f"no execution for proposal {proposal_id!r}")
        return record

    def list_executions(self, case_id: str) -> list[ExecutionRecord]:
        self.case_service.get_case(case_id)
        return self.executions.list_for_case(case_id)
