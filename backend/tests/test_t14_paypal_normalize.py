"""T14 — normalization: mapping table, UNKNOWN discipline, stable snapshot hash."""

from __future__ import annotations

import pytest

from app.adapters.paypal.normalize import case_id_for, normalize_dispute
from app.domain.enums import (
    CapabilityBasis,
    DisputeFamily,
    DisputeReason,
    DisputeStatus,
    EvidenceSource,
    EvidenceType,
    LifecycleStage,
    ProvenanceLabel,
    ValidationLevel,
)
from tests.paypal_helpers import raw_dispute


def test_full_dispute_maps_all_observed_fields():
    result = normalize_dispute(raw_dispute(), read_at="2026-10-19T10:00:00+00:00")
    case, state = result.case, result.state

    assert case.case_id == "PP-D-100"
    assert case.dispute_id == "PP-D-100"
    assert case.family == DisputeFamily.INR
    assert case.reason == DisputeReason.MERCHANDISE_OR_SERVICE_NOT_RECEIVED
    assert case.amount.value_minor == 12999
    assert case.amount.currency == "USD"
    assert case.dispute_status == DisputeStatus.WAITING_FOR_SELLER_RESPONSE
    assert case.lifecycle_stage == LifecycleStage.INQUIRY
    assert case.provenance == ProvenanceLabel.PAYPAL_API_OBSERVED
    assert case.verification_level == ValidationLevel.UNKNOWN
    assert case.snapshot_hash and len(case.snapshot_hash) == 64
    assert case.live_status_note.startswith("PayPal Sandbox read at 2026-10-19T10:00:00")
    assert "remote status=WAITING_FOR_SELLER_RESPONSE" in case.live_status_note

    assert [a.rel for a in case.available_actions] == ["provide_evidence", "self"]
    assert all(a.basis == CapabilityBasis.LIVE_HATEOAS for a in case.available_actions)
    assert case.missing_evidence == ["PROOF_OF_FULFILLMENT"]
    assert case.evidence_requirements[0].open is True
    assert case.evidence_requirements[0].source == EvidenceSource.REQUESTED_FROM_SELLER
    assert case.evidence[0].evidence_type == EvidenceType.PROOF_OF_FULFILLMENT
    assert case.evidence[0].observed_at == "2026-10-19T10:00:00+00:00"

    assert state.basis == CapabilityBasis.LIVE_HATEOAS
    assert state.provenance == ProvenanceLabel.PAYPAL_API_OBSERVED
    assert state.dispute_status == case.dispute_status
    assert state.observed_at == "2026-10-19T10:00:00+00:00"


def test_snapshot_hash_is_stable_across_read_times():
    first = normalize_dispute(raw_dispute(), read_at="2026-10-19T10:00:00+00:00")
    second = normalize_dispute(raw_dispute(), read_at="2026-10-20T11:11:11+00:00")
    assert first.case.snapshot_hash == second.case.snapshot_hash
    assert first.case.live_status_note != second.case.live_status_note


def test_snapshot_hash_changes_when_payload_changes():
    base = normalize_dispute(raw_dispute())
    changed_raw = raw_dispute()
    changed_raw["evidences"] = changed_raw["evidences"] + [
        {"evidence_type": "PROOF_OF_REFUND", "source": "SUBMITTED_BY_SELLER"}
    ]
    changed = normalize_dispute(changed_raw)
    assert base.case.snapshot_hash != changed.case.snapshot_hash


def test_missing_fields_become_unknown_not_guessed():
    raw = {
        "dispute_id": "PP-D-MISSING",
        "reason": "SOMETHING_NEW",
        "status": "SOMETHING_ELSE",
        # no amount, no lifecycle, no evidences, no links
    }
    result = normalize_dispute(raw)
    case = result.case
    assert case.reason == DisputeReason.OTHER
    assert case.family == DisputeFamily.BILLING
    assert case.dispute_status == DisputeStatus.UNKNOWN
    assert case.lifecycle_stage == LifecycleStage.UNKNOWN
    assert case.amount.value_minor == 0
    assert case.amount.currency == "UNK"
    assert case.available_actions == []
    assert case.evidence == []
    assert case.missing_evidence == []
    assert any("unknown reason" in warning for warning in result.warnings)
    assert any("unknown dispute status" in warning for warning in result.warnings)


def test_unknown_evidence_type_and_source_are_not_invented():
    raw = raw_dispute(
        evidences=[
            {
                "evidence_id": "EV-X",
                "evidence_type": "RECEIPT",
                "source": "SOMEWHERE_ELSE",
                "evidence_documents": [{"document_id": "DOC-9", "type": "RECEIPT"}],
            }
        ]
    )
    result = normalize_dispute(raw)
    evidence = result.case.evidence[0]
    assert evidence.evidence_type == EvidenceType.OTHER
    assert "RECEIPT" in evidence.content
    assert evidence.source_reference == "DOC-9;paypal_evidence_type=RECEIPT"
    assert result.case.evidence_requirements == []
    assert any("unknown evidence_type RECEIPT" in w for w in result.warnings)
    assert any("unknown evidence source" in w for w in result.warnings)


def test_empty_links_and_evidences_are_safe():
    raw = raw_dispute(evidences=[], links=[])
    result = normalize_dispute(raw)
    assert result.case.available_actions == []
    assert result.case.evidence == []
    assert result.state.links == []


def test_payload_without_dispute_id_raises():
    with pytest.raises(ValueError):
        normalize_dispute({"status": "OPEN"})
    with pytest.raises(ValueError):
        normalize_dispute("not-an-object")  # type: ignore[arg-type]


def test_long_dispute_id_gets_a_stable_short_case_id():
    long_id = "PP-D-" + "x" * 80
    first = case_id_for(long_id)
    second = case_id_for(long_id)
    assert first == second
    assert len(first) <= 64
    assert first.startswith("PP-D-")
