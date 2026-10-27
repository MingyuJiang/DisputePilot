"""T32 — Autopilot MVP-0: batch TRIAGE_ONLY over the five offline demo cases.

Every test runs against an isolated copy of the offline demo database
(``tests.demo_support``) with the frozen AI provider: no PayPal client, no
model, no shared database.
"""

from __future__ import annotations

import sqlite3

import pytest

from tests.conftest import SPECIALIST
from tests.demo_support import demo_client

CASES = [
    "DEMO-INR-O7",
    "DEMO-SNAD-O13",
    "DEMO-BILL-O16",
    "DEMO-BLOCK-O9",
    "CAP-DEMO-9001",
]
RUNS = "/api/v1/autopilot/runs"


def _run(client, case_ids=CASES, *, key=None, mode="TRIAGE_ONLY"):
    headers = dict(SPECIALIST)
    if key:
        headers["Idempotency-Key"] = key
    return client.post(
        RUNS, json={"case_ids": list(case_ids), "mode": mode}, headers=headers
    )


def _by_case(run: dict) -> dict[str, dict]:
    return {item["case_id"]: item for item in run["results"]}


def _count(db_path, table: str) -> int:
    conn = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    finally:
        conn.close()


@pytest.fixture()
def demo(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch, ai_provider="frozen") as (client, db_path):
        yield client, db_path


# --------------------------------------------------------------- one batch, five
def test_one_request_triages_all_five_offline_cases(demo):
    client, _ = demo
    response = _run(client)
    assert response.status_code == 200, response.text
    run = response.json()

    assert run["mode"] == "TRIAGE_ONLY"
    assert run["status"] == "COMPLETED"
    assert run["total_cases"] == 5
    assert run["analyzed_cases"] == 5
    assert run["failed_cases"] == 0
    assert run["executed_actions"] == 0
    assert [item["case_id"] for item in run["results"]] == CASES
    assert run["run_id"].startswith("APR-")
    assert run["started_at"] <= run["finished_at"]


def test_every_case_carries_its_own_evidence_backed_result(demo):
    client, _ = demo
    run = _run(client).json()
    cases = _by_case(run)

    for case_id, item in cases.items():
        assert item["decision_reasons"], f"{case_id} returned no reasons"
        assert item["executed"] is False
        assert item["business_refs"]["case_id"] == case_id
        assert item["analysis"]["analysis_id"]
        # dispute cases replay the frozen analysis; a capture case uses the
        # deterministic payment planner (no model, no inference)
        expected_mode = (
            "STUB_DETERMINISTIC"
            if case_id.startswith("CAP-")
            else "FROZEN_REPLAY"
        )
        assert item["analysis"]["analysis_mode"] == expected_mode
        if item["candidate_actions"]:
            assert item["validator"] is not None
            # dispute actions run V1-V12; capture refunds run V13-V18
            family = item["candidate_actions"][0]["action_family"]
            assert item["validator"]["checked"] == (6 if family == "PAYMENT" else 12)
        else:
            # No candidate means no validation; that must be said out loud and
            # must never read as a clean pass.
            assert item["validator"] is None
            assert item["decision"] == "NEEDS_HUMAN"

    # decisions are per-case, not one flag for the whole batch
    assert cases["DEMO-INR-O7"]["decision"] == "READY_FOR_REVIEW"
    assert cases["DEMO-SNAD-O13"]["decision"] == "READY_FOR_REVIEW"
    assert cases["DEMO-BILL-O16"]["decision"] == "WAIT"
    assert cases["DEMO-BLOCK-O9"]["decision"] == "BLOCKED"
    assert cases["CAP-DEMO-9001"]["decision"] == "NEEDS_HUMAN"

    # the summary is derived from the results, not asserted independently
    assert run["ready_for_review_cases"] == sum(
        1 for r in run["results"] if r["decision"] == "READY_FOR_REVIEW"
    )
    assert run["needs_human_cases"] == sum(
        1 for r in run["results"] if r["decision"] == "NEEDS_HUMAN"
    )
    assert run["blocked_cases"] == sum(
        1 for r in run["results"] if r["decision"] == "BLOCKED"
    )
    assert run["wait_cases"] == sum(1 for r in run["results"] if r["decision"] == "WAIT")
    assert run["failed_cases"] == sum(
        1 for r in run["results"] if r["decision"] == "FAILED"
    )
    assert (
        run["ready_for_review_cases"]
        + run["needs_human_cases"]
        + run["blocked_cases"]
        + run["wait_cases"]
        + run["failed_cases"]
        == run["total_cases"]
    )


def test_inr_message_case_is_reviewable_but_not_sent(demo):
    client, db_path = demo
    run = _run(client).json()
    item = _by_case(run)["DEMO-INR-O7"]

    assert item["validator"]["passed"] is True
    assert item["reason_codes"] == ["VALIDATOR_PASSED", "NO_EXECUTION_TRIAGE_ONLY"]
    assert item["policy"] == {"blocked": False, "code": None}
    assert item["evidence"]["sufficient"] is True
    assert item["candidate_actions"][0]["action_type"] == "send-message"
    assert item["candidate_actions"][0]["execution_authorized"] is False
    assert item["requires_human"] is False
    assert _count(db_path, "executions") == 0


def test_billing_case_downgrades_an_unavailable_action_to_wait(demo):
    """The recorded AI asked for provide-evidence; the state has no such link."""
    client, _ = demo
    item = _by_case(_run(client).json())["DEMO-BILL-O16"]

    assert item["analysis"]["raw_recommendation"] == "provide-evidence"
    assert item["analysis"]["effective_action"] == "wait"
    assert item["decision"] == "WAIT"
    assert "WAIT_NO_LEGAL_ACTION" in item["reason_codes"]
    assert item["policy"]["blocked"] is False
    assert any("planner gate" in reason for reason in item["decision_reasons"])
    assert [c["action_type"] for c in item["candidate_actions"]] == ["wait"]


# ------------------------------------------------------------------- evidence block
def test_o9_evidence_block_is_reported_and_v5_still_rejects_a_mismatch(demo):
    """O9 must not become reviewable, and the V5 gate must still bite."""
    client, _ = demo
    item = _by_case(_run(client, ["DEMO-BLOCK-O9"]).json())["DEMO-BLOCK-O9"]

    assert item["decision"] == "BLOCKED"
    assert item["requires_human"] is True
    assert any("EVIDENCE_MATERIAL_MISSING" in reason for reason in item["decision_reasons"])
    assert item["candidate_actions"][0]["action_type"] == "provide-evidence"

    # Missing material is a shared V5 rule, including single-case submit.
    assert item["validator"]["passed"] is False
    assert any(f["validator_id"] == "V5" and f["status"] == "FAIL" for f in item["validator"]["findings"])
    assert item["reason_codes"] == ["VALIDATOR_BLOCKED"]
    assert item["policy"] == {"blocked": False, "code": None}
    assert item["evidence"]["sufficient"] is False
    assert item["evidence"]["missing_facts"]

    # The validator itself is untouched: a payload whose evidence_type does not
    # match the open requirement is still rejected by V5.
    r = client.post("/api/v1/cases/DEMO-BLOCK-O9/analyses", headers=SPECIALIST)
    assert r.status_code == 200, r.text
    analysis_id = r.json()["analysis_id"]
    r = client.post(
        "/api/v1/cases/DEMO-BLOCK-O9/proposals",
        headers=SPECIALIST,
        json={
            "case_id": "DEMO-BLOCK-O9",
            "analysis_id": analysis_id,
            "action_type": "provide-evidence",
            "action_payload": {
                "evidence_type": "OTHER",
                "notes": "SCENARIO_DEFINED mismatch probe",
                "idempotency_key": "DP-PROBE-O9-OTHER-001",
            },
        },
    )
    assert r.status_code == 200, r.text
    proposal_id = r.json()["proposal_id"]
    r = client.post(f"/api/v1/proposals/{proposal_id}/submit", headers=SPECIALIST)
    assert r.status_code == 422, r.text
    reasons = r.json()["error"]["validation_report"]["blocked_reasons"]
    assert any(reason.startswith("V5:") for reason in reasons), reasons


def test_snad_case_states_its_evidence_gaps(demo):
    client, _ = demo
    item = _by_case(_run(client, ["DEMO-SNAD-O13"]).json())["DEMO-SNAD-O13"]

    assert item["decision"] == "READY_FOR_REVIEW"
    assert item["analysis"]["missing_evidence"], "SNAD must state what is missing"
    assert item["analysis"]["gaps"], "SNAD must report the plan gaps"
    assert item["candidate_actions"][0]["action_type"] == "provide-evidence"


# ------------------------------------------------------------------------ refunds
def test_cap_refund_requires_a_human_and_is_never_executed(demo):
    """The capture is now readable end-to-end: a 30.00 refund is planned,
    validated by V13-V18, and still stops at NEEDS_HUMAN."""
    client, db_path = demo
    item = _by_case(_run(client, ["CAP-DEMO-9001"]).json())["CAP-DEMO-9001"]

    assert item["decision"] == "NEEDS_HUMAN"
    assert item["requires_human"] is True
    assert item["executed"] is False

    facts = item["capture_facts"]
    assert facts["capture_id"] == "DEMO-CAP-9001"
    assert facts["status"] == "COMPLETED"
    assert facts["original_amount"] == "42.00"
    assert facts["total_refunded"] == "12.00"
    assert facts["refundable_remaining"] == "30.00"

    assert "PAYMENT_REQUIRES_APPROVAL" in item["reason_codes"]
    assert item["policy"]["blocked"] is False
    refund = item["candidate_actions"][0]
    assert refund["action_family"] == "PAYMENT"
    assert refund["action_type"] == "full-refund"
    assert refund["execution_authorized"] is False

    validator = item["validator"]
    assert validator["passed"] is True
    checked = {finding["validator_id"] for finding in validator["findings"]}
    assert checked == {"V13", "V14", "V15", "V16", "V17", "V18"}
    assert all(f["status"] != "FAIL" for f in validator["findings"])
    # 30.00 is the remaining refundable balance, never the 42.00 capture amount
    v15 = next(f for f in validator["findings"] if f["validator_id"] == "V15")
    assert "30.00" in v15["detail"]
    assert _count(db_path, "executions") == 0


def test_capture_without_a_readable_status_is_not_planned(demo):
    """No status means no refund plan: the planner refuses to guess."""
    client, db_path = demo
    conn = sqlite3.connect(str(db_path))
    try:
        import json

        row = conn.execute(
            "SELECT record_json FROM cases WHERE case_id = ?", ("CAP-DEMO-9001",)
        ).fetchone()
        record = json.loads(row[0])
        record["capture_status"] = ""
        record["live_status_note"] = "SYNTHETIC_OFFLINE_FIXTURE — no status recorded."
        conn.execute(
            "UPDATE cases SET live_status_note = ?, record_json = ? WHERE case_id = ?",
            (record["live_status_note"], json.dumps(record), "CAP-DEMO-9001"),
        )
        conn.commit()
    finally:
        conn.close()

    item = _by_case(_run(client, ["CAP-DEMO-9001"]).json())["CAP-DEMO-9001"]

    assert item["decision"] == "NEEDS_HUMAN"
    assert item["candidate_actions"] == []
    assert item["validator"] is None
    assert any("UNKNOWN" in reason or "reconcile" in reason for reason in item["decision_reasons"])
    assert _count(db_path, "executions") == 0


def test_capture_status_prefers_the_structured_field():
    """The structured field wins over prose; legacy notes still parse."""
    from app.domain.enums import DisputeFamily, DisputeReason, ProvenanceLabel
    from app.domain.models import CaseRecord, Money
    from app.services.payment_planning import _capture_status

    def case(capture_status: str, note: str) -> CaseRecord:
        return CaseRecord(
            case_id="CAP-TEST-1",
            family=DisputeFamily.BILLING,
            reason=DisputeReason.OTHER,
            amount=Money(value_minor=4200, currency="USD"),
            provenance=ProvenanceLabel.SIMULATED_COMPOSITE,
            live_status_note=note,
            capture_status=capture_status,
        )

    assert _capture_status(case("COMPLETED", "status=REFUNDED")) == "COMPLETED"
    assert _capture_status(case("", "capture status=PARTIALLY_REFUNDED")) == "PARTIALLY_REFUNDED"
    assert _capture_status(case("", "SYNTHETIC — status=COMPLETED; original=42.00")) == "COMPLETED"
    assert _capture_status(case("", "no status word here")) == "UNKNOWN"


# ---------------------------------------------------------------------- isolation
def test_a_broken_case_does_not_abort_the_batch(demo):
    client, _ = demo
    response = _run(client, ["DEMO-INR-O7", "NO-SUCH-CASE", "DEMO-BILL-O16"])
    assert response.status_code == 200, response.text
    run = response.json()

    assert run["status"] == "PARTIAL"
    assert run["failed_cases"] == 1
    assert run["ready_for_review_cases"] == 1
    assert run["wait_cases"] == 1

    cases = _by_case(run)
    failed = cases["NO-SUCH-CASE"]
    assert failed["decision"] == "FAILED"
    assert failed["error"]["type"] == "NotFoundError"
    assert failed["analysis"] is None
    # the failure is reported, not swallowed into a success
    assert cases["DEMO-INR-O7"]["decision"] == "READY_FOR_REVIEW"
    assert cases["DEMO-BILL-O16"]["decision"] == "WAIT"


# ------------------------------------------------------------- no external action
def test_no_paypal_client_and_no_execution_service_are_used(demo, monkeypatch):
    """Prove the boundary by making both seams explode if touched."""
    from app.adapters.paypal import client as paypal_client
    from app.services import execution_service

    def _forbidden(*_args, **_kwargs):
        raise AssertionError("autopilot must not build a PayPal client")

    def _no_execution(*_args, **_kwargs):
        raise AssertionError("autopilot must not call ExecutionService")

    monkeypatch.setattr(paypal_client.PayPalApiClient, "__init__", _forbidden)
    monkeypatch.setattr(execution_service.ExecutionService, "replay", _no_execution)

    client, db_path = demo
    response = _run(client)
    assert response.status_code == 200, response.text
    run = response.json()

    assert run["executed_actions"] == 0
    assert all(item["executed"] is False for item in run["results"])
    assert _count(db_path, "executions") == 0


def test_repeated_request_does_not_reprocess_the_batch(demo):
    client, db_path = demo
    first = _run(client, key="batch-001")
    assert first.status_code == 200, first.text
    analyses_after_first = _count(db_path, "analyses")
    proposals_after_first = _count(db_path, "proposals")

    second = _run(client, key="batch-001")
    assert second.status_code == 200, second.text

    assert second.json()["run_id"] == first.json()["run_id"]
    assert second.json()["idempotent_replay"] is True
    assert _count(db_path, "analyses") == analyses_after_first
    assert _count(db_path, "proposals") == proposals_after_first
    assert _count(db_path, "autopilot_runs") == 1


# ---------------------------------------------------------------- persistence/read
def test_run_is_readable_by_id_and_survives_a_restart(demo):
    client, db_path = demo
    run = _run(client).json()

    r = client.get(f"{RUNS}/{run['run_id']}")
    assert r.status_code == 200, r.text
    assert r.json()["run_id"] == run["run_id"]
    assert len(r.json()["results"]) == 5

    # simulate a restart: drop the engine and read the report through a brand
    # new session on the same database file
    from app.infrastructure import database
    from app.infrastructure.repositories import AutopilotRunRepository

    database.reset_engine()
    session = database.get_session_factory()()
    try:
        stored = AutopilotRunRepository(session).get(run["run_id"])
    finally:
        session.close()

    assert stored is not None
    assert stored["status"] == run["status"]
    assert stored["results"] == run["results"]


def test_unknown_run_id_is_404(demo):
    client, _ = demo
    r = client.get(f"{RUNS}/APR-does-not-exist")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"


# ------------------------------------------------------------------------- guards
def test_sandbox_mode_is_refused_and_creates_no_run(tmp_path, monkeypatch):
    with demo_client(
        tmp_path, monkeypatch, name="sandbox-mode", data_mode="paypal_sandbox"
    ) as (client, db_path):
        response = _run(client)
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "CONFLICT"
        assert _count(db_path, "autopilot_runs") == 0
        assert _count(db_path, "analyses") == 0


def test_empty_case_list_is_rejected(demo):
    client, db_path = demo
    response = _run(client, [])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REQUEST_INVALID"
    assert _count(db_path, "autopilot_runs") == 0


def test_blank_case_ids_are_rejected(demo):
    client, _ = demo
    response = _run(client, ["   "])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
