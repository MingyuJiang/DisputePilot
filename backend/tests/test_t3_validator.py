"""T3 — Policy validator: unsupported actions, missing HATEOAS, wrong stage,
illegal params, unsatisfied evidence requirements are all blocked."""

from __future__ import annotations

import pytest

from tests.conftest import SPECIALIST


def _draft(client, case_id, action_type, payload, evidence_ids=None):
    analyses = client.get(f"/api/v1/cases/{case_id}/analyses").json()
    analysis_id = analyses[-1]["analysis_id"] if analyses else "any"
    return client.post(
        f"/api/v1/cases/{case_id}/proposals",
        headers=SPECIALIST,
        json={
            "case_id": case_id,
            "analysis_id": analysis_id,
            "action_type": action_type,
            "action_payload": payload,
            "evidence_ids": evidence_ids or [],
        },
    )


def _submit_report(client, proposal_id):
    r = client.post(f"/api/v1/proposals/{proposal_id}/submit", headers=SPECIALIST)
    return r


@pytest.fixture()
def analyzed(ready):
    ready.post("/api/v1/cases/O4/analyses", headers=SPECIALIST)
    return ready


def test_unsupported_action_blocked_v2(analyzed):
    r = _draft(analyzed, "O4", "refund", {"amount": {"value": "15.00", "currency": "USD"}})
    assert r.status_code == 200
    pid = r.json()["proposal_id"]
    r = _submit_report(analyzed, pid)
    assert r.status_code == 422
    body = r.json()
    assert any("V2" in reason for reason in body["error"]["validation_report"]["blocked_reasons"])


def test_missing_hateoas_blocked_v3(analyzed):
    """provide-supporting-info has no live HATEOAS link in the fixture state."""
    r = _draft(
        analyzed,
        "O4",
        "provide-supporting-info",
        {"notes": "SCENARIO_DEFINED test note", "idempotency_key": "DP-X-001"},
    )
    pid = r.json()["proposal_id"]
    r = _submit_report(analyzed, pid)
    assert r.status_code == 422
    reasons = r.json()["error"]["validation_report"]["blocked_reasons"]
    assert any("V3" in x for x in reasons)


def test_wrong_stage_blocked_v4(analyzed):
    """make-offer requires INQUIRY; simulate a terminal-ish stage first."""
    r = analyzed.post(
        "/api/v1/cases/O4/state",
        headers={"X-Actor-Id": "s", "X-Actor-Role": "SYSTEM"},
        json={"lifecycle_stage": "UNDER_PAYPAL_REVIEW"},
    )
    assert r.status_code == 200
    r = _draft(
        analyzed,
        "O4",
        "make-offer",
        {
            "offer_types": ["REFUND"],
            "amount": {"value": "10.00", "currency": "USD"},
            "idempotency_key": "DP-O4-OFFER-001",
        },
    )
    pid = r.json()["proposal_id"]
    r = _submit_report(analyzed, pid)
    assert r.status_code == 422
    reasons = r.json()["error"]["validation_report"]["blocked_reasons"]
    assert any("V4" in x for x in reasons)


def test_illegal_amount_blocked_v6(analyzed):
    r = _draft(
        analyzed,
        "O4",
        "make-offer",
        {
            "offer_types": ["REFUND"],
            "amount": {"value": "999.00", "currency": "USD"},
            "idempotency_key": "DP-O4-OFFER-002",
        },
    )
    pid = r.json()["proposal_id"]
    r = _submit_report(analyzed, pid)
    assert r.status_code == 422
    reasons = r.json()["error"]["validation_report"]["blocked_reasons"]
    assert any("V6" in x for x in reasons)


def test_disallowed_offer_type_blocked_v6(analyzed):
    r = _draft(
        analyzed,
        "O4",
        "make-offer",
        {
            "offer_types": ["PARTIAL_REFUND"],
            "idempotency_key": "DP-O4-OFFER-003",
        },
    )
    pid = r.json()["proposal_id"]
    r = _submit_report(analyzed, pid)
    assert r.status_code == 422
    reasons = r.json()["error"]["validation_report"]["blocked_reasons"]
    assert any("V6" in x for x in reasons)


def test_forbidden_internal_fields_blocked_v7(analyzed):
    r = _draft(
        analyzed,
        "O4",
        "send-message",
        {
            "message": "hello",
            "idempotency_key": "DP-O4-MSG-001",
            "_note": "internal",
            "debug": "do not log",
        },
    )
    pid = r.json()["proposal_id"]
    r = _submit_report(analyzed, pid)
    assert r.status_code == 422
    reasons = r.json()["error"]["validation_report"]["blocked_reasons"]
    assert any("V7" in x for x in reasons)


def test_unlabeled_evidence_blocked_v8(analyzed):
    r = _draft(
        analyzed,
        "O4",
        "provide-evidence",
        {
            "evidence_type": "PROOF_OF_FULFILLMENT",
            "notes": "shipped via carrier XYZ tracking 123456",  # no SCENARIO_DEFINED label
            "idempotency_key": "DP-O4-EV-001",
        },
    )
    pid = r.json()["proposal_id"]
    r = _submit_report(analyzed, pid)
    assert r.status_code == 422
    reasons = r.json()["error"]["validation_report"]["blocked_reasons"]
    assert any("V8" in x for x in reasons)


def test_missing_idempotency_key_blocked_v11(analyzed):
    r = _draft(analyzed, "O4", "send-message", {"message": "hello"})
    pid = r.json()["proposal_id"]
    r = _submit_report(analyzed, pid)
    assert r.status_code == 422
    reasons = r.json()["error"]["validation_report"]["blocked_reasons"]
    assert any("V11" in x for x in reasons)


def test_evidence_requirement_mismatch_blocked_v5(analyzed):
    """SNAD case O6 expects OTHER; requesting PROOF_OF_FULFILLMENT mismatches."""
    analyzed.post("/api/v1/cases/O6/analyses", headers=SPECIALIST)
    r = _draft(
        analyzed,
        "O6",
        "provide-evidence",
        {
            "evidence_type": "PROOF_OF_FULFILLMENT",
            "notes": "SCENARIO_DEFINED test material",
            "idempotency_key": "DP-O6-EV-001",
        },
    )
    pid = r.json()["proposal_id"]
    r = _submit_report(analyzed, pid)
    assert r.status_code == 422
    reasons = r.json()["error"]["validation_report"]["blocked_reasons"]
    assert any("V5" in x for x in reasons)


def test_valid_proposal_passes_all_twelve(analyzed):
    r = _draft(
        analyzed,
        "O4",
        "send-message",
        {
            "message": "SCENARIO_DEFINED sandbox test correspondence for case O4.",
            "idempotency_key": "DP-O4-MSG-OK-001",
        },
    )
    pid = r.json()["proposal_id"]
    r = _submit_report(analyzed, pid)
    assert r.status_code == 200, r.text
    report = analyzed.get(f"/api/v1/proposals/{pid}/validation").json()
    assert report["passed"] is True
    assert [f["validator_id"] for f in report["findings"]] == [f"V{i}" for i in range(1, 13)]
    for f in report["findings"]:
        assert f["status"] in ("PASS", "SKIPPED")
        assert f["doc_reference"] == "S6_1_AI_ACTION_PLAN.md D3"
        assert f["basis"] == "FIXTURE_SNAPSHOT"


def test_validator_report_is_decision_object_only(analyzed):
    """V10: the report carries no execution fields."""
    r = _draft(
        analyzed,
        "O4",
        "send-message",
        {"message": "SCENARIO_DEFINED test", "idempotency_key": "DP-O4-V10-001"},
    )
    pid = r.json()["proposal_id"]
    _submit_report(analyzed, pid)
    report = analyzed.get(f"/api/v1/proposals/{pid}/validation").json()
    banned = {"execution_mode", "response", "http_status", "paypal_response"}
    assert not (banned & set(report.keys()))
    v10 = next(f for f in report["findings"] if f["validator_id"] == "V10")
    assert v10["status"] == "PASS"
