"""T22 — post-write verification must match the submitted evidence content.

A count or status delta can be produced by anybody touching the case, so it is
recorded as an observation only. ``EXECUTED`` requires finding the submitted
entry itself (evidence_type + verbatim notes + SUBMITTED_BY_SELLER). All
transports are ``httpx.MockTransport`` — zero real network.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.adapters.paypal.client import PayPalApiClient
from app.adapters.paypal.gateway import (
    RESULT_EXECUTED,
    RESULT_UNVERIFIED,
    PayPalSandboxGateway,
)
from app.adapters.paypal.normalize import normalize_dispute
from tests.paypal_helpers import (
    MockPayPal,
    make_approval,
    make_proposal,
    raw_dispute,
    sandbox_config,
)

NOTES = "Sandbox adapter test"


def _gateway(
    mock: MockPayPal,
) -> tuple[PayPalSandboxGateway, Any, Any, Any, PayPalApiClient]:
    config = sandbox_config()
    api = PayPalApiClient(config, transport=mock.transport())
    normalized = normalize_dispute(mock.pre)
    proposal = make_proposal(normalized.case)
    approval = make_approval(proposal)
    return PayPalSandboxGateway(config, api), normalized, proposal, approval, api


def _observations(outcome) -> dict:
    return outcome.verification["observations"]


def test_count_increase_with_wrong_notes_is_unverified():
    mock = MockPayPal(post_status="ok", readback="mismatch_notes")
    gateway, normalized, proposal, approval, api = _gateway(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    obs = _observations(outcome)
    assert outcome.result == RESULT_UNVERIFIED
    assert outcome.verification["confirmed"] is False
    assert mock.post_calls == 1
    # The old heuristic would have confirmed on the count alone.
    assert obs["evidence_count_before"] == 1
    assert obs["evidence_count_after"] == 2
    assert obs["evidence_delta"] == 1
    assert obs["matched_evidence_type"] is None
    assert obs["matched_source"] is None
    assert obs["matched_notes_len"] is None
    assert "no evidence matching the submitted payload" in outcome.verification[
        "uncertain_reason"
    ]


def test_count_decrease_with_exact_match_is_executed():
    pre = raw_dispute(
        evidences=[
            {
                "evidence_id": "EV-CREATE",
                "evidence_type": "CREATE",
                "source": "SUBMITTED_BY_BUYER",
                "notes": "buyer filing narrative",
            },
            {
                "evidence_id": "EV-REQ-1",
                "evidence_type": "PROOF_OF_FULFILLMENT",
                "source": "REQUESTED_FROM_SELLER",
                "evidence_documents": [],
            },
            {
                "evidence_id": "EV-REQ-2",
                "evidence_type": "PROOF_OF_FULFILLMENT",
                "source": "REQUESTED_FROM_SELLER",
                "evidence_documents": [],
            },
        ]
    )
    # Mirrors the real sandbox behaviour: the REQUESTED_FROM_SELLER placeholder
    # is replaced by the submitted entry, so the count goes 3 → 2.
    mock = MockPayPal(pre=pre, post_status="ok", readback="replace_requested")
    gateway, normalized, proposal, approval, api = _gateway(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    obs = _observations(outcome)
    assert outcome.result == RESULT_EXECUTED
    assert outcome.verification["confirmed"] is True
    assert mock.post_calls == 1
    assert obs["evidence_count_before"] == 3
    assert obs["evidence_count_after"] == 2
    assert obs["evidence_delta"] == -1
    assert obs["matched_evidence_type"] == "PROOF_OF_FULFILLMENT"
    assert obs["matched_source"] == "SUBMITTED_BY_SELLER"
    assert obs["matched_notes_len"] == len(NOTES)


def test_status_change_without_matching_evidence_is_unverified():
    mock = MockPayPal(post_status="ok", readback="status_only")
    gateway, normalized, proposal, approval, api = _gateway(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    obs = _observations(outcome)
    assert outcome.result == RESULT_UNVERIFIED
    assert outcome.verification["confirmed"] is False
    # Status did change — and that alone must not confirm the write.
    assert obs["status_before"] == "WAITING_FOR_SELLER_RESPONSE"
    assert obs["status_after"] == "UNDER_REVIEW"
    assert obs["evidence_count_before"] == obs["evidence_count_after"] == 1
    assert obs["matched_evidence_type"] is None
    assert outcome.verification["remote_status"] == "UNDER_REVIEW"


def test_verification_get_failure_is_unverified():
    mock = MockPayPal(
        post_status="ok", readback="echo_submitted", get_after_post_status=500
    )
    gateway, normalized, proposal, approval, api = _gateway(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    obs = _observations(outcome)
    assert outcome.result == RESULT_UNVERIFIED
    assert outcome.verification["confirmed"] is False
    assert mock.post_calls == 1
    assert mock.get_calls == 2  # pre-check + failed verification GET, no retry
    assert obs["matched_evidence_type"] is None
    assert "verification GET failed" in outcome.verification["uncertain_reason"]


def test_identical_readback_with_matching_entry_is_executed():
    """Zero delta, zero status change: only the content proves the write.

    This is the shape of a repeated read of an already-submitted case (the
    real EX-8ee659f98d6b6a5a snapshots get1.json / get2.json).
    """
    pre = raw_dispute(
        evidences=[
            {
                "evidence_id": "EV-1",
                "evidence_type": "PROOF_OF_FULFILLMENT",
                "source": "SUBMITTED_BY_SELLER",
                "notes": NOTES,
                "evidence_documents": [],
                "action_info": {"action": "PROVIDE_EVIDENCE"},
            }
        ]
    )
    mock = MockPayPal(pre=pre, post_status="ok", apply_change_on_post=False)
    gateway, normalized, proposal, approval, api = _gateway(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    obs = _observations(outcome)
    assert outcome.result == RESULT_EXECUTED
    assert outcome.verification["confirmed"] is True
    assert obs["evidence_delta"] == 0
    assert obs["status_before"] == obs["status_after"]
    assert obs["matched_evidence_type"] == "PROOF_OF_FULFILLMENT"
    assert obs["matched_notes_len"] == len(NOTES)


@pytest.mark.parametrize("notes", ["", "Sandbox adapter test "])
def test_notes_must_match_verbatim(notes):
    """A trailing space or missing notes is not a match."""
    pre = raw_dispute(
        evidences=[
            {
                "evidence_id": "EV-1",
                "evidence_type": "PROOF_OF_FULFILLMENT",
                "source": "SUBMITTED_BY_SELLER",
                "notes": notes,
            }
        ]
    )
    mock = MockPayPal(pre=pre, post_status="ok", apply_change_on_post=False)
    gateway, normalized, proposal, approval, api = _gateway(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    assert outcome.result == RESULT_UNVERIFIED
    assert outcome.verification["confirmed"] is False
