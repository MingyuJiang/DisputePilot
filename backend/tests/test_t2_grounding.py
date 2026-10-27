"""T2 — AI grounding: grounded facts cite existing evidence ids, unknown ids
rejected, missing evidence triggers gaps, stub vs LLM explicitly separated."""

from __future__ import annotations

FIVE_LABELS = {
    "PAYPAL_API_OBSERVED",
    "HUMAN_OBSERVED_SANDBOX_UI",
    "SCENARIO_DEFINED",
    "AI_INFERRED",
    "SIMULATED_COMPOSITE",
}


def test_every_grounded_fact_cites_existing_evidence(ready):
    r = ready.post("/api/v1/cases/O4/analyses", headers={"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"})
    assert r.status_code == 200
    analysis = r.json()
    evidence_ids = {e["evidence_id"] for e in ready.get("/api/v1/cases/O4/evidence").json()}
    assert analysis["grounded_facts"], "stub must produce grounded facts"
    for fact in analysis["grounded_facts"]:
        assert fact["evidence_ids"], f"fact {fact['fact_id']} has no evidence citation"
        for eid in fact["evidence_ids"]:
            assert eid in evidence_ids, f"fact cites unknown evidence {eid}"


def test_grounded_facts_fact_types_are_separated(ready):
    analysis = ready.post(
        "/api/v1/cases/O4/analyses", headers={"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"}
    ).json()
    types = {f["fact_type"] for f in analysis["grounded_facts"]}
    assert types <= {"OBSERVED_FACT", "SUPPORTED_INFERENCE", "UNVERIFIED_CLAIM", "MISSING_EVIDENCE"}
    assert "OBSERVED_FACT" in types


def test_missing_evidence_surfaces_gap(ready):
    analysis = ready.post(
        "/api/v1/cases/O4/analyses", headers={"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"}
    ).json()
    assert analysis["missing_evidence"], "O4 posture NONE must surface missing evidence"
    assert any("fabricated" in m.lower() or "not fabricated" in m.lower()
               for m in analysis["missing_evidence"])


def test_stub_output_explicitly_not_llm(ready):
    analysis = ready.post(
        "/api/v1/cases/O4/analyses", headers={"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"}
    ).json()
    assert analysis["analysis_mode"] == "STUB_DETERMINISTIC"
    assert analysis["model_provider"] == "deterministic-stub"
    assert any("not a real LLM" in f for f in analysis["safety_flags"])


def test_plan_schema_structural_gate(ready):
    """S7 benchmark: malformed Plan = automatic M2 failure."""
    analysis = ready.post(
        "/api/v1/cases/O4/analyses", headers={"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"}
    ).json()
    plan = analysis["plan"]
    for key in ("recommended_action", "rationale", "gaps", "alternatives", "wait_rule_applies"):
        assert key in plan, f"Plan schema missing {key}"
    for gap in plan["gaps"]:
        assert "gap" in gap and "severity" in gap
    assert plan["recommended_action"] in {
        "provide-evidence", "send-message", "make-offer", "escalate",
        "accept-claim", "provide-supporting-info", "wait",
    }


def test_o4_recommendation_matches_human_approved_action(ready):
    """Benchmark M2 anchor: documented human-approved action on O4 = send-message."""
    analysis = ready.post(
        "/api/v1/cases/O4/analyses", headers={"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"}
    ).json()
    assert analysis["recommendation"] == "send-message"


def test_o5_recommendation_is_provide_evidence_notes_branch(ready):
    analysis = ready.post(
        "/api/v1/cases/O5/analyses", headers={"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"}
    ).json()
    assert analysis["recommendation"] == "provide-evidence"
    proposals = ready.post(
        "/api/v1/cases/O5/proposals/generate", headers={"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"}
    ).json()
    payload = proposals[0]["action_payload"]
    assert payload["evidence_type"] == "PROOF_OF_FULFILLMENT"
    assert "SCENARIO_DEFINED" in payload["notes"]
    # structured tracking fields are forbidden for synthetic values
    assert "tracking_info" not in payload


def test_unknown_evidence_id_rejected_in_proposal(ready):
    ready.post("/api/v1/cases/O4/analyses", headers={"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"})
    analysis_id = ready.get("/api/v1/cases/O4/analyses").json()[0]["analysis_id"]
    r = ready.post(
        "/api/v1/cases/O4/proposals",
        headers={"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"},
        json={
            "case_id": "O4",
            "analysis_id": analysis_id,
            "action_type": "send-message",
            "action_payload": {"message": "x", "idempotency_key": "k"},
            "evidence_ids": ["EV-DOES-NOT-EXIST"],
        },
    )
    assert r.status_code == 422
    assert "not found" in r.json()["error"]["message"]


def test_analysis_binds_decision_snapshot_hash(ready):
    """The analysis binds the full decision context (case + runtime state):
    re-analyzing an unchanged case yields the same binding hash."""
    h = {"X-Actor-Id": "s", "X-Actor-Role": "SPECIALIST"}
    a1 = ready.post("/api/v1/cases/O4/analyses", headers=h).json()
    a2 = ready.post("/api/v1/cases/O4/analyses", headers=h).json()
    assert a1["case_snapshot_hash"]
    assert a1["case_snapshot_hash"] == a2["case_snapshot_hash"]
