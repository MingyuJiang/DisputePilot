"""Batch autopilot triage — orchestrates the EXISTING service layer.

This module adds orchestration and a run record, nothing else. Every case goes
through the same three existing services the single-case demo uses:

    CaseService      -> case + evidence + observed runtime state
    AnalysisService  -> AI provider (frozen replay in the offline demo)
    PlanningService  -> candidate proposal draft
    ValidationService-> deterministic V1-V12 / V13-V18 report

Nothing here talks HTTP, opens a PayPal client or touches
:class:`ExecutionService`: TRIAGE_ONLY ends at a decision. The only write is
the run report (and the analysis/proposal rows the services themselves own),
which is what makes "no external action" verifiable rather than asserted.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy.exc import IntegrityError

from ..adapters.case_state import CaseStateStore
from ..domain.autopilot import (
    AutopilotMode,
    REVIEW_ELIGIBLE_DECISIONS,
    ReviewSubmissionStatus,
    RunStatus,
    SubmissionBatchStatus,
    SubmissionItemReason,
    TriageDecision,
    TriageReasonCode,
    aggregate_status,
    decide,
    submission_request_fingerprint,
)
from ..domain.evidence_policy import evaluate_evidence
from ..domain.enums import ActionType, ApprovalDecision, GroundedFactType, ProposalState, action_family_of
from ..domain.errors import (
    ConflictError,
    NotFoundError,
    ValidationFailedError,
)
from ..domain.models import content_hash
from ..infrastructure.repositories import (
    ApprovalRepository,
    AutopilotRunRepository,
    AutopilotSubmissionRepository,
    ProposalRepository,
)
from .analysis_service import AnalysisService
from .approval_service import ApprovalService
from .case_service import CaseService
from .payment_planning import capture_snapshot_block, is_payment_case
from .planning_service import PlanningService
from .validation_service import ValidationService

MODE_OFFLINE = "offline_replay"
MAX_CASES_PER_RUN = 50
SUBMIT_ENDPOINT_PREFIX = "autopilot-submit"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _now_iso_precise() -> str:
    """Microsecond timestamp: batches created in the same second must still sort
    chronologically (the list endpoint orders by created_at)."""
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _new_run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"APR-{stamp}-{secrets.token_hex(4)}"


def _new_batch_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"SUB-{stamp}-{secrets.token_hex(4)}"


class AutopilotService:
    """Runs one TRIAGE_ONLY batch and persists its report."""

    def __init__(
        self,
        session,
        case_service: CaseService,
        analysis_service: AnalysisService,
        planning_service: PlanningService,
        validation_service: ValidationService,
        *,
        approval_service: ApprovalService | None = None,
        state_store: CaseStateStore | None = None,
        runs_repository: AutopilotRunRepository | None = None,
        mode_guard: Callable[[], None] | None = None,
    ) -> None:
        self.session = session
        self.case_service = case_service
        self.analysis_service = analysis_service
        self.planning_service = planning_service
        self.validation_service = validation_service
        # Reused as-is for submit-for-review: no second approval mechanism.
        self.approval_service = approval_service
        self.state_store = state_store
        self.runs = runs_repository or AutopilotRunRepository(session)
        self.proposals = ProposalRepository(session)
        self.approvals = ApprovalRepository(session)
        self.submissions = AutopilotSubmissionRepository(session)
        self._mode_guard = mode_guard

    # ------------------------------------------------------------------- mode
    def _assert_triage_allowed(self, mode: AutopilotMode) -> None:
        """Refuse anything that is not an explicit offline triage run.

        The guard is injected in production wiring (``offline_only_guard``) and
        can be overridden in tests, but the default still fails closed.
        """
        if mode is not AutopilotMode.TRIAGE_ONLY:
            raise ValidationFailedError(
                f"autopilot mode {mode.value!r} is not supported; only "
                f"{AutopilotMode.TRIAGE_ONLY.value} exists in this release"
            )
        if self._mode_guard is not None:
            self._mode_guard()

    # -------------------------------------------------------------------- run
    def run(
        self,
        case_ids: list[str],
        *,
        mode: AutopilotMode = AutopilotMode.TRIAGE_ONLY,
        request_key: str | None = None,
        actor_id: str = "autopilot",
    ) -> dict[str, Any]:
        self._assert_triage_allowed(mode)
        ordered = _ordered_unique(case_ids)
        if not ordered:
            raise ValidationFailedError("case_ids must contain at least one case id")
        if len(ordered) > MAX_CASES_PER_RUN:
            raise ValidationFailedError(
                f"at most {MAX_CASES_PER_RUN} cases per run; got {len(ordered)}"
            )

        key = (request_key or "").strip() or None
        if key:
            existing = self.runs.get_by_request_key(key)
            if existing is not None:
                return {**existing, "idempotent_replay": True}

        run_id = _new_run_id()
        started_at = _now_iso()
        results = [self._triage_case(case_id, actor_id) for case_id in ordered]
        finished_at = _now_iso()

        counts = _count(results)
        payload = {
            "run_id": run_id,
            "mode": mode.value,
            "status": aggregate_status(
                total=len(results), failed=counts["failed_cases"]
            ).value,
            "requested_case_ids": ordered,
            "total_cases": len(results),
            "analyzed_cases": counts["analyzed_cases"],
            "ready_for_review_cases": counts["ready_for_review_cases"],
            "needs_human_cases": counts["needs_human_cases"],
            "blocked_cases": counts["blocked_cases"],
            "wait_cases": counts["wait_cases"],
            "failed_cases": counts["failed_cases"],
            "executed_actions": 0,
            "results": results,
            "started_at": started_at,
            "finished_at": finished_at,
            "idempotent_replay": False,
        }

        try:
            self.runs.add(payload, key)
            self.session.commit()
        except Exception:
            # A concurrent duplicate hit the unique request_key index: return
            # the run that won instead of creating a second one.
            self.session.rollback()
            if key:
                existing = self.runs.get_by_request_key(key)
                if existing is not None:
                    return {**existing, "idempotent_replay": True}
            raise
        return payload

    # ------------------------------------------------------------------- read
    def get_run(self, run_id: str) -> dict[str, Any]:
        run = self.runs.get(run_id)
        if run is None:
            raise NotFoundError(f"autopilot run {run_id!r} not found")
        return {**run, "idempotent_replay": False}

    # -------------------------------------------------- submit for review
    def submit_for_review(
        self,
        run_id: str,
        *,
        case_ids: list[str] | None = None,
        request_key: str | None = None,
        actor_id: str = "autopilot",
    ) -> dict[str, Any]:
        """Specialist submits every eligible candidate of one run for review.

        This is the batch equivalent of POST /proposals/{id}/submit: each case
        goes through :meth:`ApprovalService.submit`, which re-runs the
        deterministic validator, re-binds the payload/decision hashes and only
        then creates a PENDING approval. Nothing here approves or executes.
        """
        self._assert_triage_allowed(AutopilotMode.TRIAGE_ONLY)
        if self.approval_service is None:
            raise ConflictError(
                "submit-for-review is unavailable: no approval service is wired"
            )
        run = self.runs.get(run_id)
        if run is None:
            raise NotFoundError(f"autopilot run {run_id!r} not found")
        if run.get("mode") != AutopilotMode.TRIAGE_ONLY.value:
            raise ConflictError(
                f"run {run_id!r} has mode {run.get('mode')!r}; only "
                f"{AutopilotMode.TRIAGE_ONLY.value} runs can be submitted"
            )

        key = (request_key or "").strip() or None
        fingerprint = submission_request_fingerprint(case_ids)
        if key:
            existing = self.submissions.get_by_key(run_id, key)
            if existing is not None:
                if existing["request_fingerprint"] != fingerprint:
                    raise ConflictError(
                        f"idempotency key {key!r} was already used for run "
                        f"{run_id!r} with a different request body"
                    )
                return {**existing, "idempotent_replay": True}

        by_case = {item["case_id"]: item for item in run["results"]}
        if case_ids:
            selected = _ordered_unique(case_ids)
            outside_run = {c for c in selected if c not in by_case}
        else:
            selected = [
                item["case_id"]
                for item in run["results"]
                if item.get("decision") in REVIEW_ELIGIBLE_DECISIONS
            ]
            outside_run = set()

        results: list[dict[str, Any]] = []
        for case_id in selected:
            if case_id in outside_run:
                results.append(
                    _submission_result(
                        case_id,
                        run_decision=None,
                        status=ReviewSubmissionStatus.SKIPPED_NOT_ELIGIBLE,
                        reason_code=SubmissionItemReason.CASE_NOT_IN_RUN,
                        reasons=[
                            "case is not part of this run; no proposal was submitted"
                        ],
                    )
                )
                continue
            results.append(self._submit_case(by_case[case_id], actor_id))

        counts = _submission_counts(results)
        # QA-RC-07: cases of this run that were never submission candidates
        # (blocked / needs-human / wait at triage time). They are part of the
        # run, so the batch cannot claim to have finished all of them.
        excluded_cases = max(len(run["results"]) - len(selected), 0)
        payload = {
            "submission_batch_id": _new_batch_id(),
            "run_id": run_id,
            "mode": run.get("mode"),
            "idempotency_key": key,
            "request_fingerprint": fingerprint,
            "status": _submission_status(
                counts, total=len(results), excluded=excluded_cases
            ),
            "requested_case_ids": selected,
            "total_cases": len(results),
            "run_case_count": len(run["results"]),
            "excluded_cases": excluded_cases,
            "submitted_cases": counts["submitted_cases"],
            "already_submitted_cases": counts["already_submitted_cases"],
            "skipped_cases": counts["skipped_cases"],
            "blocked_cases": counts["blocked_cases"],
            "failed_cases": counts["failed_cases"],
            "actor_id": actor_id,
            "executed_actions": 0,
            "results": results,
            "submitted_at": _now_iso_precise(),
            "idempotent_replay": False,
        }
        try:
            self.submissions.add(payload, results)
            self.session.commit()
        except IntegrityError:
            # A concurrent retry won the (run_id, idempotency_key) race. The
            # per-case approvals are already idempotent, so the only thing to
            # drop is this duplicate batch row.
            self.session.rollback()
            if key:
                existing = self.submissions.get_by_key(run_id, key)
                if existing is not None:
                    if existing["request_fingerprint"] != fingerprint:
                        raise ConflictError(
                            f"idempotency key {key!r} was already used for run "
                            f"{run_id!r} with a different request body"
                        )
                    return {**existing, "idempotent_replay": True}
            raise
        # Read back from the database so the response and the query API can
        # never disagree about what was recorded.
        stored = self.submissions.get(payload["submission_batch_id"])
        final = {**(stored or payload), "idempotent_replay": False}
        return self._decorate_batch(final)

    def _decorate_batch(self, batch: dict[str, Any]) -> dict[str, Any]:
        """QA-RC-07: add the run-wide denominators to a stored batch.

        A batch row only stores what was attempted. Without the run size the UI
        can say "all disputes are waiting for you" while most of the run was
        never a candidate. Both counts are derived from the run, never invented.
        """
        run = self.runs.get(batch.get("run_id"))
        if run is None:
            return batch
        run_cases = len(run["results"])
        attempted = len(batch.get("requested_case_ids") or [])
        out = dict(batch)
        out["run_case_count"] = run_cases
        out["excluded_cases"] = max(run_cases - attempted, 0)
        return out

    # ------------------------------------------------------ submission reads
    def get_submission_batch(self, submission_batch_id: str) -> dict[str, Any]:
        batch = self.submissions.get(submission_batch_id)
        if batch is None:
            raise NotFoundError(
                f"submission batch {submission_batch_id!r} not found"
            )
        return self._decorate_batch(batch)

    def list_submission_batches(self, run_id: str) -> list[dict[str, Any]]:
        if self.runs.get(run_id) is None:
            raise NotFoundError(f"autopilot run {run_id!r} not found")
        return [self._decorate_batch(batch) for batch in self.submissions.list_for_run(run_id)]

    def _submit_case(self, run_result: dict[str, Any], actor_id: str) -> dict[str, Any]:
        case_id = run_result["case_id"]
        decision = run_result.get("decision")
        if decision not in REVIEW_ELIGIBLE_DECISIONS:
            return _submission_result(
                case_id,
                run_decision=decision,
                status=ReviewSubmissionStatus.SKIPPED_NOT_ELIGIBLE,
                reason_code=SubmissionItemReason.RUN_DECISION_NOT_REVIEWABLE,
                reasons=[
                    f"run decision is {decision}; only READY_FOR_REVIEW is eligible "
                    "for review submission"
                ],
                proposal_id=_candidate_id(run_result),
            )

        candidate = _primary_candidate(run_result)
        proposal_id = (candidate or {}).get("proposal_id")
        if not proposal_id:
            return _submission_result(
                case_id,
                run_decision=decision,
                status=ReviewSubmissionStatus.SKIPPED_NOT_ELIGIBLE,
                reason_code=SubmissionItemReason.NO_CANDIDATE_PROPOSAL,
                reasons=["the run recorded no candidate proposal for this case"],
            )

        proposal = self.proposals.get(proposal_id)
        if proposal is None:
            return _submission_result(
                case_id,
                run_decision=decision,
                status=ReviewSubmissionStatus.BLOCKED_STALE,
                reason_code=SubmissionItemReason.PROPOSAL_MISSING,
                reasons=[
                    f"proposal {proposal_id} no longer exists; the case changed "
                    "after the run — re-run the autopilot before submitting"
                ],
                proposal_id=proposal_id,
            )
        recorded_hash = (candidate or {}).get("payload_hash")
        # Recompute from the payload itself: a record whose stored hash no
        # longer matches its content was tampered with after the run.
        current_hash = content_hash(proposal.action_payload)
        if current_hash != proposal.payload_hash:
            return _submission_result(
                case_id,
                run_decision=decision,
                status=ReviewSubmissionStatus.BLOCKED_STALE,
                reason_code=SubmissionItemReason.PAYLOAD_CHANGED,
                reasons=[
                    "stored proposal payload does not match its own payload hash; "
                    "the record changed after the run — re-run the autopilot"
                ],
                proposal_id=proposal_id,
            )
        if recorded_hash and current_hash != recorded_hash:
            return _submission_result(
                case_id,
                run_decision=decision,
                status=ReviewSubmissionStatus.BLOCKED_STALE,
                reason_code=SubmissionItemReason.PAYLOAD_CHANGED,
                reasons=[
                    "the candidate payload changed after the run "
                    f"(recorded {recorded_hash[:12]}…, current "
                    f"{current_hash[:12]}…); re-run the autopilot"
                ],
                proposal_id=proposal_id,
            )
        if proposal.state in (
            ProposalState.REPLAY_EXECUTED,
            ProposalState.APPROVED,
            ProposalState.REJECTED,
            ProposalState.BLOCKED,
            ProposalState.FAILED,
        ):
            return _submission_result(
                case_id,
                run_decision=decision,
                status=ReviewSubmissionStatus.SKIPPED_NOT_ELIGIBLE,
                reason_code=SubmissionItemReason.PROPOSAL_STATE_INELIGIBLE,
                reasons=[
                    f"proposal state is {proposal.state.value}; it cannot be "
                    "submitted for review"
                ],
                proposal_id=proposal_id,
            )

        existing = self.approvals.get_for_proposal(proposal_id)
        if existing is not None and existing.decision == ApprovalDecision.PENDING:
            return _submission_result(
                case_id,
                run_decision=decision,
                status=ReviewSubmissionStatus.ALREADY_SUBMITTED,
                reason_code=SubmissionItemReason.ALREADY_PENDING_APPROVAL,
                reasons=[
                    "an approval for this proposal is already pending; no second "
                    "approval was created"
                ],
                proposal_id=proposal_id,
                approval_id=existing.approval_id,
                proposal_state=proposal.state.value,
                approval_decision=existing.decision.value,
                proposal=proposal,
            )

        try:
            submitted, approval = self.approval_service.submit(proposal_id, actor_id)
        except ValidationFailedError as exc:
            self.session.rollback()
            return _submission_result(
                case_id,
                run_decision=decision,
                status=ReviewSubmissionStatus.BLOCKED_VALIDATION,
                reason_code=SubmissionItemReason.VALIDATOR_REJECTED,
                validation_report_id=(exc.report or {}).get("report_id"),
                validation_passed=False,
                reasons=["submit-time validator rejected the proposal"]
                + [str(reason) for reason in (exc.report or {}).get("blocked_reasons", [])],
                proposal_id=proposal_id,
            )
        except ConflictError as exc:
            self.session.rollback()
            return _submission_result(
                case_id,
                run_decision=decision,
                status=ReviewSubmissionStatus.SKIPPED_NOT_ELIGIBLE,
                reason_code=SubmissionItemReason.PROPOSAL_STATE_INELIGIBLE,
                reasons=[str(exc)],
                proposal_id=proposal_id,
            )
        except Exception as exc:  # noqa: BLE001 — one case must not end the batch
            self.session.rollback()
            return _submission_result(
                case_id,
                run_decision=decision,
                status=ReviewSubmissionStatus.FAILED,
                reason_code=SubmissionItemReason.TECHNICAL_ERROR,
                reasons=[f"{type(exc).__name__}: {' '.join(str(exc).split())[:240]}"],
                proposal_id=proposal_id,
                error={"type": type(exc).__name__, "message": str(exc)[:240]},
            )

        report = self.validation_service.latest_report(proposal_id)
        return _submission_result(
            case_id,
            run_decision=decision,
            status=ReviewSubmissionStatus.SUBMITTED_FOR_REVIEW,
            reason_code=SubmissionItemReason.SUBMITTED_FOR_REVIEW,
            reasons=[
                "proposal revalidated and submitted; the approval is pending a "
                "manager decision (nothing was approved or executed)"
            ],
            proposal_id=proposal_id,
            approval_id=approval.approval_id,
            proposal_state=submitted.state.value,
            approval_decision=approval.decision.value,
            proposal=submitted,
            validator=(
                {"report_id": report.report_id, "passed": report.passed}
                if report is not None
                else None
            ),
        )

    # ------------------------------------------------------------ one case
    def _triage_case(self, case_id: str, actor_id: str) -> dict[str, Any]:
        """Analyse → plan → validate → decide. A failure stays local to the case."""
        try:
            case = self.case_service.get_case(case_id)
            state = self.case_service.get_state(case_id)
            analysis, plan = self.analysis_service.create_analysis(
                case_id, actor_id=actor_id
            )
            proposals = self.planning_service.generate(case_id, actor_id="autopilot")
            proposal = _primary_proposal(proposals)
            report = None
            if proposal is not None:
                proposal, report = self.validation_service.validate(
                    proposal.proposal_id, actor_id="autopilot-validator"
                )

            outcome = decide(
                action_type=proposal.action_type if proposal else None,
                action_family=(
                    action_family_of(proposal.action_type).value if proposal else None
                ),
                validator_passed=None if report is None else report.passed,
                blocked_reasons=list(report.blocked_reasons) if report else [],
                missing_evidence_facts=_missing_evidence(analysis, proposal),
                gate_reason=_gate_reason(plan),
                no_action_reason=_no_action_reason(case, plan),
            )
            missing_facts = _missing_evidence(analysis, proposal)
            return {
                "case_id": case_id,
                "decision": outcome.decision.value,
                "decision_reasons": outcome.reasons,
                "reason_codes": outcome.reason_codes,
                # Three independent facts a reviewer must be able to separate:
                # what the validator said, whether the evidence exists, and
                # whether a policy stopped the case.
                "validator": _validator_block(report),
                "evidence": {
                    "sufficient": not missing_facts,
                    "missing_evidence": list(analysis.missing_evidence),
                    "missing_facts": missing_facts,
                },
                "policy": {
                    "blocked": outcome.policy_blocked,
                    "code": outcome.policy_code,
                },
                "requires_human": outcome.decision.value
                in {TriageDecision.NEEDS_HUMAN.value, TriageDecision.BLOCKED.value},
                "executed": False,
                "analysis": _analysis_block(analysis, plan),
                "candidate_actions": _candidate_blocks(proposals),
                "business_refs": {
                    "case_id": case_id,
                    "analysis_id": analysis.analysis_id,
                    "proposal_ids": [p.proposal_id for p in proposals],
                    "validation_report_id": report.report_id if report else None,
                    "case_workflow_status": _workflow_status(self, case_id),
                },
                "capture_facts": (
                    capture_snapshot_block(case, state)
                    if is_payment_case(case)
                    else None
                ),
                "error": None,
            }
        except Exception as exc:  # noqa: BLE001 — one bad case must not end the run
            self.session.rollback()
            return {
                "case_id": case_id,
                "decision": TriageDecision.FAILED.value,
                "decision_reasons": [
                    "technical failure while triaging this case; the other cases "
                    "in the run were unaffected",
                    f"{type(exc).__name__}: {' '.join(str(exc).split())[:300]}",
                ],
                "reason_codes": [TriageReasonCode.TECHNICAL_ERROR.value],
                "requires_human": True,
                "executed": False,
                "analysis": None,
                "candidate_actions": [],
                "validator": None,
                "evidence": None,
                "policy": {"blocked": False, "code": None},
                "business_refs": {"case_id": case_id},
                "capture_facts": None,
                "error": {
                    "type": type(exc).__name__,
                    "message": " ".join(str(exc).split())[:300],
                },
            }


# ---------------------------------------------------------------------------
# module helpers (pure)
# ---------------------------------------------------------------------------
def offline_only_guard(network_mode: str, execution_mode: str, is_sandbox: bool) -> Callable[[], None]:
    """Fail closed unless the process is in OFFLINE_REPLAY."""

    def guard() -> None:
        if is_sandbox or network_mode != "NONE" or execution_mode != "REPLAY":
            raise ConflictError(
                "autopilot TRIAGE_ONLY is refused: this process is not in "
                "OFFLINE_REPLAY (PayPal Sandbox or write-enabled mode detected)"
            )

    return guard


def _ordered_unique(case_ids: list[str]) -> list[str]:
    seen: list[str] = []
    for raw in case_ids or []:
        case_id = str(raw or "").strip()
        if case_id and case_id not in seen:
            seen.append(case_id)
    return seen


def _count(results: list[dict]) -> dict[str, int]:
    counter = {d.value: 0 for d in TriageDecision}
    for result in results:
        counter[result["decision"]] = counter.get(result["decision"], 0) + 1
    return {
        "analyzed_cases": sum(1 for r in results if r["analysis"] is not None),
        "ready_for_review_cases": counter[TriageDecision.READY_FOR_REVIEW.value],
        "needs_human_cases": counter[TriageDecision.NEEDS_HUMAN.value],
        "blocked_cases": counter[TriageDecision.BLOCKED.value],
        "wait_cases": counter[TriageDecision.WAIT.value],
        "failed_cases": counter[TriageDecision.FAILED.value],
    }


def _primary_proposal(proposals):
    """A triage decision is about ONE candidate; prefer a real write over wait."""
    if not proposals:
        return None
    for proposal in proposals:
        if proposal.action_type != ActionType.WAIT.value:
            return proposal
    return proposals[0]


def _analysis_block(analysis, plan: dict) -> dict[str, Any]:
    return {
        "analysis_id": analysis.analysis_id,
        "analysis_mode": analysis.analysis_mode.value,
        "model_provider": analysis.model_provider,
        "model_name": analysis.model_name,
        "factual_summary": analysis.factual_summary,
        "recommendation": analysis.recommendation,
        "raw_recommendation": plan.get("raw_recommendation"),
        "effective_action": plan.get("effective_action") or analysis.recommendation,
        "grounded_fact_count": len(analysis.grounded_facts),
        "missing_evidence": list(analysis.missing_evidence),
        "contradictions": list(analysis.contradictions),
        "safety_flags": list(analysis.safety_flags),
        "gaps": [g.get("gap") for g in plan.get("gaps") or [] if isinstance(g, dict)],
    }


def _candidate_blocks(proposals) -> list[dict[str, Any]]:
    return [
        {
            "proposal_id": p.proposal_id,
            "action_type": p.action_type,
            "action_family": action_family_of(p.action_type).value,
            "state": p.state.value,
            "risk_level": p.risk_level.value,
            "validation_status": p.validation_status.value,
            "required_evidence": list(p.required_evidence),
            "evidence_ids": list(p.evidence_ids),
            "execution_authorized": p.execution_authorized,
            # Bound at decision time so submit-for-review can detect drift
            # instead of trusting a stale run report.
            "payload_hash": p.payload_hash,
            "snapshot_hash": p.snapshot_hash,
        }
        for p in proposals
    ]


# ---------------------------------------------------------------------------
# submit-for-review helpers (pure)
# ---------------------------------------------------------------------------
def _primary_candidate(run_result: dict[str, Any]) -> dict[str, Any] | None:
    candidates = run_result.get("candidate_actions") or []
    for candidate in candidates:
        if candidate.get("action_type") != ActionType.WAIT.value:
            return candidate
    return candidates[0] if candidates else None


def _candidate_id(run_result: dict[str, Any]) -> str | None:
    candidate = _primary_candidate(run_result)
    return (candidate or {}).get("proposal_id")


def _submission_result(
    case_id: str,
    *,
    run_decision: str | None,
    status: ReviewSubmissionStatus,
    reason_code: SubmissionItemReason,
    reasons: list[str],
    proposal_id: str | None = None,
    approval_id: str | None = None,
    proposal_state: str | None = None,
    approval_decision: str | None = None,
    proposal=None,
    validator: dict[str, Any] | None = None,
    validation_report_id: str | None = None,
    validation_passed: bool | None = None,
    error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    report_id = validation_report_id or (validator or {}).get("report_id")
    if validation_passed is None and validator is not None:
        validation_passed = validator.get("passed")
    return {
        "case_id": case_id,
        "run_decision": run_decision,
        "status": status.value,
        "reason_code": reason_code.value,
        "reasons": reasons,
        "proposal_id": proposal_id,
        "approval_id": approval_id,
        "proposal_state": proposal_state,
        "approval_decision": approval_decision,
        "action_payload_hash": getattr(proposal, "payload_hash", None),
        "case_snapshot_hash": getattr(proposal, "snapshot_hash", None),
        "validation_report_id": report_id,
        "validation_passed": validation_passed,
        "validator": validator,
        "error": error,
    }


def _submission_counts(results: list[dict[str, Any]]) -> dict[str, int]:
    counter = {status.value: 0 for status in ReviewSubmissionStatus}
    for result in results:
        counter[result["status"]] = counter.get(result["status"], 0) + 1
    return {
        "submitted_cases": counter[ReviewSubmissionStatus.SUBMITTED_FOR_REVIEW.value],
        "already_submitted_cases": counter[
            ReviewSubmissionStatus.ALREADY_SUBMITTED.value
        ],
        "skipped_cases": counter[ReviewSubmissionStatus.SKIPPED_NOT_ELIGIBLE.value],
        "blocked_cases": counter[ReviewSubmissionStatus.BLOCKED_VALIDATION.value]
        + counter[ReviewSubmissionStatus.BLOCKED_STALE.value],
        "failed_cases": counter[ReviewSubmissionStatus.FAILED.value],
    }


def _submission_status(counts: dict[str, int], *, total: int, excluded: int = 0) -> str:
    """Batch status over the *whole run*, not only over what was attempted.

    QA-RC-07: `selected` holds only the review-eligible cases, so a run of five
    cases with two eligible produced zero skips, zero blocks and zero failures
    — and was reported as COMPLETED, i.e. "every dispute in this run is waiting
    for your confirmation" while three of the five were never submitted at all.
    Cases that were never candidates (`excluded`) therefore count as unfinished.
    """
    in_review = counts["submitted_cases"] + counts["already_submitted_cases"]
    if counts["failed_cases"] and in_review == 0:
        return SubmissionBatchStatus.FAILED.value
    if in_review == 0:
        return SubmissionBatchStatus.NOTHING_SUBMITTED.value
    if (
        counts["skipped_cases"]
        or counts["blocked_cases"]
        or counts["failed_cases"]
        or excluded
    ):
        return SubmissionBatchStatus.PARTIAL.value
    return SubmissionBatchStatus.COMPLETED.value


def _validator_block(report) -> dict[str, Any] | None:
    if report is None:
        return None
    findings = [
        {
            "validator_id": f.validator_id,
            "status": f.status,
            "detail": f.detail,
        }
        for f in report.findings
    ]
    return {
        "report_id": report.report_id,
        "passed": report.passed,
        "blocked_reasons": list(report.blocked_reasons),
        "checked": len(findings),
        "failed": sum(1 for f in findings if f["status"] == "FAIL"),
        "findings": findings,
    }


def _missing_evidence(analysis, proposal) -> list[str]:
    """Only an explicit MISSING_EVIDENCE fact blocks a provide-evidence action.

    ``analysis.missing_evidence`` is advisory prose (every case has some), while
    a MISSING_EVIDENCE grounded fact is the analysis declaring that the material
    this action depends on does not exist. That distinction is what separates a
    reviewable evidence submission from one that would need fabricated proof.

    RC-1: the rule itself lives in ``domain/evidence_policy`` so the batch
    decision, the validator (V5), submission, approval and execution all apply
    exactly the same test. This function is now only the batch-facing adapter.
    """
    if proposal is None:
        return []
    verdict = evaluate_evidence(
        action_type=proposal.action_type,
        action_payload=proposal.action_payload,
        grounded_facts=analysis.grounded_facts,
    )
    return list(verdict.missing)


def _gate_reason(plan: dict) -> str | None:
    return plan.get("action_gate_reason") or None


def _no_action_reason(case, plan: dict) -> str | None:
    if is_payment_case(case):
        gaps = [g.get("gap") for g in plan.get("gaps") or [] if isinstance(g, dict)]
        return (
            "payment case: the capture planner produced no refund candidate"
            + (f" ({'; '.join(str(g) for g in gaps[:2])})" if gaps else "")
        )
    return None


def _workflow_status(service: AutopilotService, case_id: str) -> str:
    try:
        return service.case_service.get_case(case_id).status.value
    except Exception:  # noqa: BLE001 — reporting helper only
        return "UNKNOWN"


__all__ = ["AutopilotService", "MAX_CASES_PER_RUN", "offline_only_guard"]
