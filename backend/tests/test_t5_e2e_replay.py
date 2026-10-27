"""T5 — End-to-end offline replay: full chain + negative path + audit proof."""

from __future__ import annotations

import json
from pathlib import Path
from app.infrastructure.settings import OUT_DIR

from tests.conftest import MANAGER, SPECIALIST, SYSTEM


def test_full_replay_chain_o4(ready):
    """Case Import → Analysis → Proposal → Validation → Submit → Approve →
    Revalidation → Replay → Audit."""
    # import already happened at startup; assert it is audited
    events = ready.get("/api/v1/cases/O4/audit").json()["events"]
    assert events[0]["event_type"] == "CASE_IMPORTED"

    analysis = ready.post("/api/v1/cases/O4/analyses", headers=SPECIALIST).json()
    assert analysis["recommendation"] == "send-message"

    proposals = ready.post("/api/v1/cases/O4/proposals/generate", headers=SPECIALIST).json()
    proposal = proposals[0]
    assert proposal["action_type"] == "send-message"

    sub = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    ).json()
    approval_id = sub["approval"]["approval_id"]
    assert sub["proposal"]["state"] == "PENDING_APPROVAL"

    decided = ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "rationale verified against evidence"},
    ).json()
    assert decided["decision"] == "APPROVED"

    replay = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER).json()
    assert replay["execution_mode"] == "REPLAY"
    assert replay["simulated"] is True
    assert replay["result"] == "REPLAYED"
    assert "not a PayPal API response" in replay["warning"]

    # audit timeline proves the whole chain
    types = [e["event_type"] for e in ready.get("/api/v1/cases/O4/audit").json()["events"]]
    for expected in [
        "CASE_IMPORTED",
        "ANALYSIS_CREATED",
        "PROPOSAL_CREATED",
        "VALIDATION_RECORDED",
        "PROPOSAL_SUBMITTED",
        "APPROVAL_DECIDED",
        "EXECUTION_REPLAYED",
    ]:
        assert expected in types, expected

    # replay artifact written with denominators + provenance + fixture hash
    artifact_path = OUT_DIR / f"replay_{replay['execution_id']}.json"
    assert artifact_path.exists(), f"missing artifact {artifact_path}"
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    assert artifact["simulated"] is True
    assert artifact["execution_mode"] == "REPLAY"
    assert artifact["provenance"]["case_verification_level"] == "FROZEN_SANDBOX_E1_VERIFIED"
    assert artifact["provenance"]["analysis_mode"] == "STUB_DETERMINISTIC"
    assert artifact["denominators"]["executed_writes"] == 1
    assert artifact["fixture_sha256"]["canonical_cases_snapshot"].startswith("0882328a")


def test_full_replay_chain_o5_provide_evidence(ready):
    ready.post("/api/v1/cases/O5/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O5/proposals/generate", headers=SPECIALIST).json()[0]
    assert proposal["action_type"] == "provide-evidence"
    sub = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    ).json()
    approval_id = sub["approval"]["approval_id"]
    ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "notes-only simulated evidence acceptable"},
    )
    replay = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER).json()
    assert replay["result"] == "REPLAYED"
    verification = replay["verification"]
    assert verification["expected_evidence_entry"]["source"] == "SUBMITTED_BY_SELLER"
    assert verification["expected_evidence_entry"]["evidence_type"] == "PROOF_OF_FULFILLMENT"


def test_negative_path_blocked_proposal_never_reaches_approval(ready):
    """A validator-blocked proposal cannot be submitted (no approval created)."""
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    analysis_id = ready.get("/api/v1/cases/O7/analyses").json()[-1]["analysis_id"]
    draft = ready.post(
        "/api/v1/cases/O7/proposals",
        headers=SPECIALIST,
        json={
            "case_id": "O7",
            "analysis_id": analysis_id,
            "action_type": "accept-claim",
            "action_payload": {
                "accept_claim_types": ["FULL_REFUND_NOT_ALLOWED"],
                "idempotency_key": "DP-O7-BAD-001",
            },
        },
    ).json()
    r = ready.post(f"/api/v1/proposals/{draft['proposal_id']}/submit", headers=SPECIALIST)
    assert r.status_code == 422
    # no approval exists for a blocked proposal
    approvals = ready.get("/api/v1/approvals").json()
    assert all(a["proposal_id"] != draft["proposal_id"] for a in approvals)


def test_get_requests_never_change_state(ready):
    """No state writes through GET (idempotent reads)."""
    ready.post("/api/v1/cases/O7/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O7/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    ).json()
    approval_id = sub["approval"]["approval_id"]
    for _ in range(3):
        assert ready.get("/api/v1/cases/O7").status_code == 200
        assert ready.get("/api/v1/approvals").status_code == 200
        assert ready.get(f"/api/v1/approvals/{approval_id}").status_code == 200
        assert ready.get("/api/v1/cases/O7/audit").status_code == 200
    approval = ready.get(f"/api/v1/approvals/{approval_id}").json()
    assert approval["decision"] == "PENDING"  # unchanged by reads


def test_idempotency_key_returns_same_response(ready):
    headers = {**SPECIALIST, "Idempotency-Key": "fixed-key-001"}
    r1 = ready.post("/api/v1/cases/O10/analyses", headers=headers)
    r2 = ready.post("/api/v1/cases/O10/analyses", headers=headers)
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["analysis_id"] == r2.json()["analysis_id"]


def test_audit_is_append_only_no_mutation_endpoints(ready):
    """There is no PUT/PATCH/DELETE for audit events anywhere in the API."""
    schema = ready.get("/openapi.json").json()
    for path, methods in schema["paths"].items():
        if "/audit" in path:
            assert {m.upper() for m in methods.keys()} <= {"GET"}, path


def test_replay_artifact_has_no_paypal_response_claims(ready):
    ready.post("/api/v1/cases/O11/analyses", headers=SPECIALIST)
    proposal = ready.post("/api/v1/cases/O11/proposals/generate", headers=SPECIALIST).json()[0]
    sub = ready.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    ).json()
    approval_id = sub["approval"]["approval_id"]
    ready.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "ok"},
    )
    replay = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER).json()
    text = json.dumps(replay)
    assert "http_status" not in replay["response_snapshot"]
    assert "debug_id" not in text
    assert replay["response_snapshot"]["simulated"] is True
