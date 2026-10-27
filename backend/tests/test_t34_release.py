"""Release contract: synthetic refund and missing-proof safety, no network."""
from tests.conftest import MANAGER, SPECIALIST, SYSTEM
from tests.demo_support import demo_client

def test_release_refund_is_fixture_validated_and_replayed_without_remote_confirmation(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch, ai_provider="frozen") as (client, _):
        case = "CAP-DEMO-9001"
        analysis = client.post(f"/api/v1/cases/{case}/analyses", headers=SPECIALIST).json()
        draft = client.post(f"/api/v1/cases/{case}/proposals", headers=SPECIALIST, json={
            "case_id":case,"analysis_id":analysis["analysis_id"],"action_type":"partial-refund","action_family":"PAYMENT",
            "action_payload":{"capture_id":"DEMO-CAP-9001","mode":"partial","amount":"10.00","currency_code":"USD","reason":"Synthetic release check","idempotency_key":"release-10"}})
        assert draft.status_code == 200, draft.text
        pid = draft.json()["proposal_id"]
        submitted = client.post(f"/api/v1/proposals/{pid}/submit", headers=SPECIALIST)
        assert submitted.status_code == 200, submitted.text
        report = client.get(f"/api/v1/proposals/{pid}/validation").json()
        assert report["passed"] is True
        assert {f["validator_id"] for f in report["findings"]} == {f"V{x}" for x in range(13,19)}
        assert all(f["basis"] == "FIXTURE_SNAPSHOT" for f in report["findings"])
        aid = submitted.json()["approval"]["approval_id"]
        assert client.post(f"/api/v1/approvals/{aid}/replay",headers=MANAGER).status_code == 409
        assert client.post(f"/api/v1/approvals/{aid}/decision",headers=MANAGER,json={"decision":"APPROVED","reason":"Approved exact synthetic 10 USD"}).status_code == 200
        record = client.post(f"/api/v1/approvals/{aid}/replay",headers=MANAGER).json()
        assert record["result"] == "REPLAYED" and record["simulated"] is True
        assert record["response_snapshot"]["amount"] == "10.00"
        assert record["verification"]["remote_readback"] is False
        assert record["verification"]["confirmed"] is False
        assert record["verification"]["replay_succeeded"] is True
        assert client.post("/api/v1/demo/reset",headers=SYSTEM).status_code == 200
        assert len(client.get("/api/v1/cases").json()) == 5
        assert client.get("/api/v1/approvals").json() == []

def test_release_o9_validator_cannot_be_bypassed_by_a_new_draft(tmp_path, monkeypatch):
    with demo_client(tmp_path, monkeypatch, ai_provider="frozen") as (client, _):
        case="DEMO-BLOCK-O9"
        analysis=client.post(f"/api/v1/cases/{case}/analyses",headers=SPECIALIST).json()
        draft=client.post(f"/api/v1/cases/{case}/proposals",headers=SPECIALIST,json={"case_id":case,"analysis_id":analysis["analysis_id"],"action_type":"provide-evidence","action_payload":{"evidence_type":"PROOF_OF_FULFILLMENT","notes":"SCENARIO_DEFINED pretend proof is not actual fulfillment material","idempotency_key":"release-forged-proof"}})
        assert draft.status_code==200,draft.text
        submitted=client.post(f"/api/v1/proposals/{draft.json()['proposal_id']}/submit",headers=SPECIALIST)
        assert submitted.status_code==422
        assert any(f["validator_id"]=="V5" and f["status"]=="FAIL" for f in submitted.json()["error"]["validation_report"]["findings"])
        assert client.get("/api/v1/approvals").json()==[]
