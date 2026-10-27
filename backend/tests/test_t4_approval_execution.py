"""T4 — Approval & execution safety: roles, state machine, binding drift,
duplicate/concurrent execution protection."""

from __future__ import annotations

import threading

from tests.conftest import MANAGER, SPECIALIST, SYSTEM, run_full_chain


def test_specialist_cannot_approve(ready):
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    ).json()
    approval_id = sub["approval"]["approval_id"]
    r = ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=SPECIALIST,
        json={"decision": "APPROVED", "reason": "sneaky"},
    )
    assert r.status_code == 403


def test_manager_can_approve_and_reject(ready):
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    ).json()
    approval_id = sub["approval"]["approval_id"]
    r = ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "REJECTED", "reason": "insufficient rationale"},
    )
    assert r.status_code == 200
    assert r.json()["decision"] == "REJECTED"
    assert r.json()["actor_role"] == "MANAGER"


def test_unapproved_proposal_cannot_execute(ready):
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    ).json()
    approval_id = sub["approval"]["approval_id"]
    r = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
    assert r.status_code == 409
    assert "not executable" in r.json()["error"]["message"]


def test_rejected_proposal_cannot_execute(ready):
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    ).json()
    approval_id = sub["approval"]["approval_id"]
    ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "REJECTED", "reason": "no"},
    )
    r = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
    assert r.status_code == 409


def test_case_state_change_invalidates_approval(ready):
    """Case snapshot change after approval ⇒ stale approval ⇒ blocked replay."""
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    ).json()
    approval_id = sub["approval"]["approval_id"]
    ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "ok"},
    )
    # PayPal-side state change (SYSTEM test hook): stage moves out of INQUIRY
    r = ready.post(
        "/api/v1/cases/O7/state",
        headers=SYSTEM,
        json={"lifecycle_stage": "UNDER_PAYPAL_REVIEW"},
    )
    assert r.status_code == 200
    r = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
    assert r.status_code == 409
    # the proposal is now BLOCKED and an audit event records why
    p = ready.get(f"/api/v1/proposals/{proposal['proposal_id']}").json()
    assert p["state"] == "BLOCKED"
    events = ready.get("/api/v1/cases/O7/audit").json()["events"]
    blocked = [e for e in events if e["event_type"] == "EXECUTION_BLOCKED"]
    assert blocked, "blocked execution must be audited"


def test_payload_change_requires_new_proposal(ready):
    """Proposals are immutable: identical content → same id (idempotent);
    different content → different id, and the old approval does not carry."""
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    analysis_id = ready.get("/api/v1/cases/O7/analyses").json()[-1]["analysis_id"]
    p1 = ready.post(
        "/api/v1/cases/O7/proposals",
        headers=SPECIALIST,
        json={
            "case_id": "O7",
            "analysis_id": analysis_id,
            "action_type": "send-message",
            "action_payload": {"message": "A", "idempotency_key": "DP-O7-A"},
        },
    ).json()
    p2 = ready.post(
        "/api/v1/cases/O7/proposals",
        headers=SPECIALIST,
        json={
            "case_id": "O7",
            "analysis_id": analysis_id,
            "action_type": "send-message",
            "action_payload": {"message": "A", "idempotency_key": "DP-O7-A"},
        },
    ).json()
    assert p1["proposal_id"] == p2["proposal_id"]
    p3 = ready.post(
        "/api/v1/cases/O7/proposals",
        headers=SPECIALIST,
        json={
            "case_id": "O7",
            "analysis_id": analysis_id,
            "action_type": "send-message",
            "action_payload": {"message": "B", "idempotency_key": "DP-O7-B"},
        },
    ).json()
    assert p3["proposal_id"] != p1["proposal_id"]


def test_executed_proposal_cannot_execute_again(ready):
    _analysis, proposal, approval_id = run_full_chain(ready, case_id="O7")
    first = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
    assert first.status_code == 200
    r = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
    assert r.status_code == 409
    assert "already replayed" in r.json()["error"]["message"]


def test_concurrent_replay_requests_execute_once(ready):
    """Concurrent duplicate POSTs must not create two successful executions."""
    _analysis, proposal, approval_id = run_full_chain(ready, case_id="O8")
    results: list[int] = []

    def attempt():
        r = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
        results.append(r.status_code)

    threads = [threading.Thread(target=attempt) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(200) == 1, f"expected exactly one success, got {results}"
    assert results.count(409) == 3
    executions = ready.get("/api/v1/cases/O8/executions").json()
    assert len(executions) == 1


def test_illegal_state_transitions_rejected(ready):
    """Domain state machine: BLOCKED cannot go back to PENDING_APPROVAL etc."""
    from app.domain.enums import ProposalState
    from app.domain.policies import IllegalStateTransition, assert_transition

    assert_transition(ProposalState.DRAFT, ProposalState.VALIDATED)
    for bad in [
        (ProposalState.REJECTED, ProposalState.APPROVED),
        (ProposalState.REPLAY_EXECUTED, ProposalState.APPROVED),
        (ProposalState.DRAFT, ProposalState.REPLAY_EXECUTED),
        (ProposalState.BLOCKED, ProposalState.PENDING_APPROVAL),
    ]:
        try:
            assert_transition(*bad)
        except IllegalStateTransition:
            pass
        else:
            raise AssertionError(f"transition {bad} must be illegal")


def test_approval_binds_payload_and_snapshot_hashes(ready):
    _analysis, proposal, approval_id = run_full_chain(ready, case_id="O9")
    approval = ready.get(f"/api/v1/approvals/{approval_id}").json()
    p = ready.get(f"/api/v1/proposals/{proposal['proposal_id']}").json()
    assert approval["action_payload_hash"] == p["payload_hash"]
    assert approval["case_snapshot_hash"] == p["snapshot_hash"]
    assert approval["policy_version"] == p["policy_version"]


def test_repeated_validation_and_resubmit_are_robust(ready):
    """Regression: repeated validations / submits must not collide on audit ids
    (append-only store) and must return clean 4xx, never 500."""
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    ).json()
    approval_id = sub["approval"]["approval_id"]
    ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "REJECTED", "reason": "needs more rationale"},
    )
    # resubmitting a rejected proposal: clean 409, not a 500
    r = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    )
    assert r.status_code == 409
    assert "cannot submit" in r.json()["error"]["message"]
    # a second decision on the same approval: clean 409
    r = ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "changed mind"},
    )
    assert r.status_code == 409
