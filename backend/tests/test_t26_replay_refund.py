"""T26 — Refund replay: offline, deterministic, never a PayPal response.

Partial/full refunds are replayed from the approved ``capture_snapshot`` only.
There is no capture GET, no POST and no ``PayPalRefundGateway`` anywhere in
this file: the gateway is a pure function of the proposal payload. Invalid
amounts are a ``ValueError`` (the execution layer records FAILED), and the
existing proposal state machine still refuses a second replay.
"""

from __future__ import annotations

import re

import pytest

from app.adapters.replay_gateway import ReplayExecutionGateway
from app.domain.enums import (
    ActionType,
    ActorRole,
    ApprovalDecision,
    CapabilityBasis,
    DisputeFamily,
    DisputeReason,
    ExecutionMode,
    ExecutionResult,
    ProposalState,
    ProvenanceLabel,
    RiskLevel,
    ValidationLevel,
    ValidationStatus,
)
from app.domain.models import (
    ActionProposal,
    Approval,
    CaseRecord,
    CaseStateSnapshot,
    Money,
    TransactionReference,
    utc_now_iso,
)
from app.domain.policies import decision_hash
from app.infrastructure.settings import settings
from tests.conftest import MANAGER

CAPTURE_ID = "DEMO-REFUND-1"
CASE_ID = f"CAP-{CAPTURE_ID}"
PARTIAL = ActionType.PARTIAL_REFUND.value
FULL = ActionType.FULL_REFUND.value
REFUND_ID_RE = re.compile(r"^RF-[0-9a-f]{12}$")


# --------------------------------------------------------------------- helpers
def _snapshot(
    *,
    remaining: str = "6.50",
    currency: str = "USD",
    capture_id: str = CAPTURE_ID,
) -> dict:
    return {
        "capture_id": capture_id,
        "status": "COMPLETED",
        "original_amount": "10.00",
        "total_refunded": "3.50",
        "refundable_remaining": remaining,
        "currency_code": currency,
    }


def _proposal(
    action: str,
    *,
    amount: str | None = None,
    currency: str = "USD",
    snapshot_currency: str = "USD",
    remaining: str = "6.50",
    capture_id: str = CAPTURE_ID,
    proposal_id: str | None = None,
) -> ActionProposal:
    payload: dict = {
        "capture_snapshot": _snapshot(
            remaining=remaining, currency=snapshot_currency, capture_id=capture_id
        ),
        "currency_code": currency,
        "idempotency_key": f"DP-{CASE_ID}-{action}",
    }
    if amount is not None:
        payload["amount"] = amount
    proposal = ActionProposal(
        proposal_id=proposal_id or f"PRP-{CASE_ID}-{action}",
        case_id=CASE_ID,
        analysis_id=f"ANL-{CASE_ID}",
        action_type=action,
        action_payload=payload,
        risk_level=RiskLevel.HIGH,
        validation_status=ValidationStatus.PASSED,
        state=ProposalState.APPROVED,
    )
    proposal.bind_hashes(settings.policy_version)
    return proposal


def _case() -> CaseRecord:
    case = CaseRecord(
        case_id=CASE_ID,
        family=DisputeFamily.BILLING,
        reason=DisputeReason.OTHER,
        amount=Money(value_minor=1000, currency="USD"),
        transaction_reference=TransactionReference(capture_id=CAPTURE_ID),
        provenance=ProvenanceLabel.SCENARIO_DEFINED,
        verification_level=ValidationLevel.SCENARIO_DEFINED_OFFLINE_CONTENT,
    )
    case.bind_snapshot_hash()
    return case


def _state() -> CaseStateSnapshot:
    return CaseStateSnapshot(
        case_id=CASE_ID,
        dispute_amount=Money(value_minor=1000, currency="USD"),
        allowed_refund_amount=Money(value_minor=650, currency="USD"),
        basis=CapabilityBasis.FIXTURE_SNAPSHOT,
        provenance=ProvenanceLabel.SCENARIO_DEFINED,
    )


def _execute(proposal: ActionProposal):
    case, state = _case(), _state()
    approval = Approval(
        approval_id=f"APR-{proposal.proposal_id}",
        proposal_id=proposal.proposal_id,
        action_payload_hash=proposal.payload_hash,
        case_snapshot_hash=decision_hash(case, state),
        policy_version=settings.policy_version,
        decision=ApprovalDecision.APPROVED,
        reason="offline demo approval",
        actor_id="manager-1",
        actor_role=ActorRole.MANAGER,
        decided_at=utc_now_iso(),
    )
    return ReplayExecutionGateway().execute(proposal, case, state, approval)


# ------------------------------------------------------------------ happy path
def test_partial_refund_replay_is_simulated_and_completed():
    record = _execute(_proposal(PARTIAL, amount="4.00"))

    assert record.execution_mode is ExecutionMode.REPLAY
    assert record.simulated is True
    assert record.result is ExecutionResult.REPLAYED
    assert record.gateway == "ReplayExecutionGateway"

    snapshot = record.response_snapshot
    assert snapshot["simulated"] is True
    assert snapshot["execution_mode"] == "REPLAY"
    assert snapshot["gateway"] == "ReplayExecutionGateway"
    assert snapshot["status"] == "COMPLETED"
    assert snapshot["amount"] == "4.00"
    assert snapshot["currency_code"] == "USD"
    assert snapshot["capture_id"] == CAPTURE_ID
    assert snapshot["mode"] == "PARTIAL"
    assert REFUND_ID_RE.match(snapshot["refund_id"])
    assert "NOT a PayPal response" in snapshot["note"]
    assert "no funds moved" in snapshot["note"]

    verification = record.verification
    assert verification["method"] == "deterministic replay (offline fixture)"
    assert verification["basis"] == "FIXTURE_SNAPSHOT"
    assert verification["confirmed"] is False
    assert verification["remote_readback"] is False
    assert verification["replay_succeeded"] is True
    assert verification["refund_status"] == "COMPLETED"
    assert verification["amount"] == "4.00"
    assert verification["currency"] == "USD"
    assert verification["capture_id"] == CAPTURE_ID
    assert verification["simulated"] is True
    assert "NO real money movement" in verification["note"]


def test_full_refund_replay_uses_refundable_remaining():
    proposal = _proposal(FULL, remaining="6.50")
    record = _execute(proposal)

    assert record.result is ExecutionResult.REPLAYED
    assert record.response_snapshot["mode"] == "FULL"
    assert record.response_snapshot["amount"] == "6.50"
    assert record.response_snapshot["currency_code"] == "USD"
    assert record.verification["amount"] == "6.50"
    assert record.verification["refund_status"] == "COMPLETED"

    # Deterministic: replaying the same proposal yields the same ids.
    again = _execute(proposal)
    assert again.execution_id == record.execution_id
    assert again.response_snapshot["refund_id"] == record.response_snapshot["refund_id"]


def test_refund_replay_never_calls_paypal_refund_gateway(monkeypatch):
    import app.adapters.paypal.refund as refund_module

    def _forbidden(*_args, **_kwargs):
        raise AssertionError("PayPalRefundGateway must not run in offline replay")

    monkeypatch.setattr(
        refund_module.PayPalRefundGateway, "execute", _forbidden, raising=True
    )
    record = _execute(_proposal(PARTIAL, amount="4.00"))
    assert record.result is ExecutionResult.REPLAYED


# ---------------------------------------------------------------- invalid input
@pytest.mark.parametrize(
    "proposal",
    [
        _proposal(PARTIAL, amount="0.00"),          # zero
        _proposal(PARTIAL, amount="-1.00"),         # negative
        _proposal(PARTIAL, amount="6.51"),          # above remaining
        _proposal(PARTIAL, amount="4.5"),           # one decimal
        _proposal(PARTIAL, amount="4.005"),         # three decimals
        _proposal(PARTIAL),                         # missing amount
        _proposal(PARTIAL, amount="4.00", currency="EUR"),  # currency mismatch
        _proposal(FULL, remaining="0.00"),          # nothing left to refund
    ],
    ids=[
        "zero",
        "negative",
        "above-remaining",
        "one-decimal",
        "three-decimals",
        "missing-amount",
        "currency-mismatch",
        "nothing-remaining",
    ],
)
def test_invalid_refund_is_refused_and_never_replayed(proposal):
    with pytest.raises(ValueError):
        _execute(proposal)


# --------------------------------------------------------- state-machine guard
def _seed_approved_refund(client, *, amount: str = "4.00") -> tuple[str, str]:
    """Insert an APPROVED partial-refund proposal for a payment capture.

    Seeded directly: the payment import path needs a sandbox capture read, and
    this test is about the replay guard, not the import.
    """
    from app.infrastructure.database import get_session_factory
    from app.infrastructure.repositories import (
        ApprovalRepository,
        CaseRepository,
        ProposalRepository,
    )

    case, state = _case(), _state()
    proposal = _proposal(PARTIAL, amount=amount)
    proposal.snapshot_hash = decision_hash(case, state)
    approval = Approval(
        approval_id=f"APR-{proposal.proposal_id}",
        proposal_id=proposal.proposal_id,
        action_payload_hash=proposal.payload_hash,
        case_snapshot_hash=decision_hash(case, state),
        policy_version=settings.policy_version,
        decision=ApprovalDecision.APPROVED,
        reason="offline demo approval",
        actor_id="manager-1",
        actor_role=ActorRole.MANAGER,
        decided_at=utc_now_iso(),
    )

    session = get_session_factory()()
    try:
        CaseRepository(session).upsert_from_import(case)
        ProposalRepository(session).add(proposal)
        ApprovalRepository(session).add(approval)
        session.commit()
    finally:
        session.close()

    client.app.state.container.state_store.upsert(state)
    return proposal.proposal_id, approval.approval_id


def test_second_replay_of_same_refund_proposal_is_refused(client):
    proposal_id, approval_id = _seed_approved_refund(client)

    first = client.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["result"] == "REPLAYED"
    assert body["execution_mode"] == "REPLAY"
    assert body["simulated"] is True
    assert body["response_snapshot"]["status"] == "COMPLETED"
    assert body["response_snapshot"]["amount"] == "4.00"
    assert "not a PayPal API response" in body["warning"]

    second = client.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
    assert second.status_code == 409
    assert "already replayed" in second.json()["error"]["message"]

    executions = client.get(f"/api/v1/cases/{CASE_ID}/executions").json()
    assert len(executions) == 1
    assert executions[0]["proposal_id"] == proposal_id


def test_refused_replay_is_recorded_as_failed(client, monkeypatch):
    """A gateway ValueError becomes FAILED — never a successful replay."""
    proposal_id, approval_id = _seed_approved_refund(client)

    def _refuse(*_args, **_kwargs):
        raise ValueError("refund amount '4.005' must be an exact 2-decimal amount")

    monkeypatch.setattr(
        client.app.state.container.gateway, "execute", _refuse, raising=True
    )
    response = client.post(
        f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["result"] == "FAILED"
    assert body["execution_mode"] == "REPLAY"
    assert body["simulated"] is True
    assert body["verification"]["confirmed"] is False
    assert "2-decimal" in body["verification"]["error"]

    proposal = client.get(f"/api/v1/proposals/{proposal_id}").json()
    assert proposal["state"] == "FAILED"
