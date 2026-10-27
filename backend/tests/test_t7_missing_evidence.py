"""T7 — missing_evidence verbatim parsing regression (P0 A-1).

The frozen snapshot stores ``seller_side_expectation.missing_evidence`` as a
single STRING in 15/15 cases. The original loader ran ``list(str)`` over it,
exploding the prose into single characters (O4 returned 82 items instead of
2). These tests pin the normalized contract:

- type is always ``list[str]``;
- content is verbatim from the snapshot (never split, never fabricated);
- counts and content match the coordinator's expected baseline file.

Expectations are RECOMPUTED from the frozen snapshot inside the test (no
hard-coded literals for the 15 cases) and cross-checked against the
coordinator baseline ``expected_missing_evidence_baseline.json``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.adapters.fixture_loader import (
    normalize_missing_evidence,
)
from app.infrastructure.settings import settings

ROOT = Path(__file__).resolve().parents[1]
BASELINE_PATH = ROOT / "tests" / "fixtures" / "expected_missing_evidence_baseline.json"

CASE_IDS = [f"O{n}" for n in range(4, 19)]


# ---------------------------------------------------------------- normalizer
def test_normalizer_string_becomes_single_verbatim_item():
    assert normalize_missing_evidence("Real logistics records.") == [
        "Real logistics records."
    ]


def test_normalizer_string_is_never_split():
    """The P0 defect: list("abc") == ['a','b','c']. Must never happen."""
    value = "Tracking (none); photos (not fabricated)."
    assert normalize_missing_evidence(value) == [value]
    assert len(normalize_missing_evidence(value)) == 1


def test_normalizer_list_is_elementwise_verbatim():
    assert normalize_missing_evidence(["a", "b"]) == ["a", "b"]


def test_normalizer_empty_inputs_yield_empty_list():
    assert normalize_missing_evidence(None) == []
    assert normalize_missing_evidence("") == []
    assert normalize_missing_evidence([]) == []
    assert normalize_missing_evidence(()) == []


# ------------------------------------------------------- snapshot recompute
def _load_snapshot_cases() -> list[dict]:
    data = json.loads(settings.case_snapshot_path.read_text(encoding="utf-8"))
    return data["cases"]


def _expected_missing_evidence(raw: dict) -> list[str]:
    """Independent recomputation from the frozen snapshot.

    Documents the frozen format explicitly:
    - ``evidence.missing`` is a list of strings;
    - ``seller_side_expectation.missing_evidence`` is a single string.
    """
    evidence = raw.get("evidence", {})
    sse = raw.get("seller_side_expectation", {})
    expected: list[str] = []
    for item in evidence.get("missing", []) or []:
        assert isinstance(item, str), f"{raw['case_id']}: evidence.missing item not a str"
        expected.append(item)
    sse_missing = sse.get("missing_evidence")
    assert isinstance(
        sse_missing, str
    ), f"{raw['case_id']}: seller_side_expectation.missing_evidence must be a string"
    if sse_missing:
        expected.append(sse_missing)
    return expected


def _expected_by_case() -> dict[str, list[str]]:
    return {
        raw["case_id"]: _expected_missing_evidence(raw)
        for raw in _load_snapshot_cases()
    }


# ------------------------------------------------------------------- API
def test_missing_evidence_matches_snapshot_recompute_all_15(ready):
    """For every canonical case, AIAnalysis.missing_evidence (which passes
    through from CaseRecord) equals the snapshot-recomputed expectation."""
    expected = _expected_by_case()
    assert set(expected) == set(CASE_IDS)
    for case_id in CASE_IDS:
        r = ready.post(f"/api/v1/cases/{case_id}/analyses", headers={"X-Actor-Id": "s"})
        assert r.status_code == 200, r.text
        missing = r.json()["missing_evidence"]
        assert isinstance(missing, list), case_id
        assert all(isinstance(m, str) for m in missing), case_id
        assert missing == expected[case_id], case_id
        # explosion signature: single-character items
        assert all(len(m) > 1 for m in missing), case_id


def test_missing_evidence_counts_spot_checks(ready):
    """Coordinator-confirmed counts: O4=2, O5=2, O6=3, O7=3, O8=4, O9=3,
    O10=2, O11=2, O12=2, O13=3, O14=3, O15=3, O16=2, O17=2, O18=2."""
    expected_counts = {
        "O4": 2, "O5": 2, "O6": 3, "O7": 3, "O8": 4, "O9": 3,
        "O10": 2, "O11": 2, "O12": 2, "O13": 3, "O14": 3, "O15": 3,
        "O16": 2, "O17": 2, "O18": 2,
    }
    expected = _expected_by_case()
    assert {cid: len(v) for cid, v in expected.items()} == expected_counts
    for case_id, count in expected_counts.items():
        r = ready.post(f"/api/v1/cases/{case_id}/analyses", headers={"X-Actor-Id": "s"})
        assert r.status_code == 200, r.text
        assert len(r.json()["missing_evidence"]) == count, case_id


def test_o4_missing_evidence_exact_content(ready):
    """O4 regression anchor: exactly the two verbatim snapshot strings."""
    r = ready.post("/api/v1/cases/O4/analyses", headers={"X-Actor-Id": "s"})
    assert r.status_code == 200
    missing = r.json()["missing_evidence"]
    assert missing == [
        "real proof of fulfillment (deliberately NOT fabricated)",
        "Real logistics records (carrier/tracking/delivery confirmation) - not fabricated.",
    ]


def test_missing_evidence_matches_coordinator_baseline(ready):
    """Cross-check against the coordinator's precomputed ground-truth file
    (read-only external artifact; skipped if absent)."""
    if not BASELINE_PATH.exists():
        pytest.skip(f"baseline file not present at {BASELINE_PATH}")
    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    expected = _expected_by_case()
    assert set(baseline) == set(expected)
    for case_id, expected_items in expected.items():
        r = ready.post(f"/api/v1/cases/{case_id}/analyses", headers={"X-Actor-Id": "s"})
        assert r.status_code == 200, r.text
        actual = r.json()["missing_evidence"]
        assert actual == expected_items == baseline[case_id], case_id


def test_caseout_exposes_missing_evidence_d17(ready):
    """D-17: CaseOut carries missing_evidence verbatim from the snapshot."""
    expected = _expected_by_case()
    for case_id in CASE_IDS:
        case = ready.get(f"/api/v1/cases/{case_id}").json()
        assert case["missing_evidence"] == expected[case_id], case_id
