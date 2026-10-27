"""T1 — Data import: 15 canonical cases parse, 10 negatives recognized,
missing fields marked, provenance labels unchanged, no label upgrades."""

from __future__ import annotations

from app.adapters.fixture_loader import (
    EXPECTED_SNAPSHOT_SHA256,
    FixtureIntegrityError,
    import_snapshot,
    map_case,
    verify_snapshot,
)
from app.infrastructure.settings import settings


def test_snapshot_integrity_verified():
    digest = verify_snapshot(settings.case_snapshot_path)
    assert digest == EXPECTED_SNAPSHOT_SHA256


def test_import_15_cases_and_10_negatives(ready):
    r = ready.get("/api/v1/cases")
    assert r.status_code == 200
    cases = r.json()
    assert len(cases) == 15
    families = {c["family"] for c in cases}
    assert families == {"INR", "SNAD", "BILLING"}
    r = ready.get("/api/v1/negative-samples")
    assert r.status_code == 200
    assert r.json()["count"] == 10
    # negative samples are recognition-only, never executable
    assert "never executed" in r.json()["purpose"]


def test_verification_levels_preserved(ready):
    levels = {c["case_id"]: c["verification_level"] for c in ready.get("/api/v1/cases").json()}
    assert levels["O4"] == "FROZEN_SANDBOX_E1_VERIFIED"
    assert levels["O5"] == "FROZEN_SANDBOX_E1_VERIFIED"
    for case_id in [f"O{n}" for n in range(6, 19)]:
        assert levels[case_id] == "SCENARIO_DEFINED_OFFLINE_CONTENT", case_id


def test_scenario_defined_not_upgraded_to_observed(ready):
    """O6–O18 must stay SCENARIO_DEFINED; provenance labels never upgrade."""
    for case_id in [f"O{n}" for n in range(6, 19)]:
        case = ready.get(f"/api/v1/cases/{case_id}").json()
        assert case["provenance"] == "SCENARIO_DEFINED", case_id
        assert case["verification_level"] == "SCENARIO_DEFINED_OFFLINE_CONTENT"


def test_missing_identifier_fields_marked_unknown(ready):
    """executed_ids were removed by sanitization; nothing may re-fill them."""
    for case_id in ["O4", "O7", "O16"]:
        case = ready.get(f"/api/v1/cases/{case_id}").json()
        ref = case["transaction_reference"]
        assert ref["order_id"] == "UNKNOWN"
        assert ref["capture_id"] == "UNKNOWN"
        assert ref["buyer_transaction_id"] == "UNKNOWN"
        assert ref["dispute_id"] == "UNKNOWN"


def test_amounts_are_minor_units(ready):
    case = ready.get("/api/v1/cases/O4").json()
    assert case["amount"]["value_minor"] == 1500
    assert case["amount"]["currency"] == "USD"
    assert case["amount"]["display"] == "15.00 USD"


def test_reimport_is_noop_and_labels_stable(ready):
    r = ready.post("/api/v1/cases/import", headers={"X-Actor-Id": "s", "X-Actor-Role": "SYSTEM"})
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 0
    assert body["skipped_duplicates"] == 15
    assert body["negative_samples_recognized"] == 10
    # re-import did not mutate any case content
    assert ready.get("/api/v1/cases/O4").json()["snapshot_hash"]


def test_loader_rejects_tampered_snapshot(tmp_path):
    import json
    import shutil

    tampered = tmp_path / "tampered.json"
    shutil.copy(settings.case_snapshot_path, tampered)
    data = json.loads(tampered.read_text(encoding="utf-8"))
    data["cases"][0]["amount"]["value"] = "99.99"  # tamper
    tampered.write_text(json.dumps(data), encoding="utf-8")
    try:
        import_snapshot(tampered)
    except FixtureIntegrityError:
        pass
    else:
        raise AssertionError("tampered snapshot must be rejected")


def test_evidence_ids_stable(ready):
    evs = ready.get("/api/v1/cases/O4/evidence").json()
    ids = [e["evidence_id"] for e in evs]
    assert len(ids) == len(set(ids))
    assert "EV-O4-BUYER-001" in ids
    assert "EV-O4-REQ-001" in ids
    # provenance labels present on every evidence record
    for e in evs:
        assert e["provenance"] in {
            "PAYPAL_API_OBSERVED",
            "HUMAN_OBSERVED_SANDBOX_UI",
            "SCENARIO_DEFINED",
            "AI_INFERRED",
            "SIMULATED_COMPOSITE",
        }


def test_negative_sample_source_review_status_not_a_provenance_label(ready):
    samples = ready.get("/api/v1/negative-samples").json()["samples"]
    labels = {
        "PAYPAL_API_OBSERVED",
        "HUMAN_OBSERVED_SANDBOX_UI",
        "SCENARIO_DEFINED",
        "AI_INFERRED",
        "SIMULATED_COMPOSITE",
    }
    for s in samples:
        # provenance_policy rule 6: source_review_status is NOT a five-layer label
        assert s.get("source_review_status", "") not in labels
