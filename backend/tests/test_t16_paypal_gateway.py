"""T16 — live gateway unit tests: single multipart POST, ambiguity re-read, gates.

Contract v1.1 now defines EXECUTED/UNVERIFIED; the gateway maps to them, but
the API write path stays closed (see T17). All transports are mocked.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.adapters.paypal.client import PayPalApiClient
from app.adapters.paypal.errors import PayPalErrorKind, PayPalWriteBlocked
from app.adapters.paypal.gateway import (
    RESULT_BLOCKED,
    RESULT_EXECUTED,
    RESULT_FAILED,
    RESULT_UNVERIFIED,
    PayPalSandboxGateway,
)
from app.adapters.paypal.normalize import normalize_dispute
from tests.paypal_helpers import (
    SENTINEL_CLIENT_ID,
    SENTINEL_SECRET,
    SENTINEL_TOKEN,
    MockPayPal,
    make_approval,
    make_proposal,
    raw_dispute,
    sandbox_config,
)


def _setup(mock: MockPayPal, **config_overrides):
    config = sandbox_config(**config_overrides)
    api = PayPalApiClient(config, transport=mock.transport())
    normalized = normalize_dispute(mock.pre)
    proposal = make_proposal(normalized.case)
    approval = make_approval(proposal)
    gateway = PayPalSandboxGateway(config, api)
    return gateway, normalized, proposal, approval, api


def test_write_gate_disabled_refuses_before_any_network():
    mock = MockPayPal()
    gateway, normalized, proposal, approval, api = _setup(mock, writes_enabled=False)
    try:
        with pytest.raises(PayPalWriteBlocked):
            gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()
    assert mock.token_calls == 0
    assert mock.get_calls == 0
    assert mock.post_calls == 0


def test_allow_list_miss_refuses_before_any_network():
    mock = MockPayPal()
    gateway, normalized, proposal, approval, api = _setup(
        mock, write_allow=("PP-D-999:provide-evidence",)
    )
    try:
        with pytest.raises(PayPalWriteBlocked):
            gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()
    assert mock.token_calls == 0
    assert mock.post_calls == 0


def test_single_post_then_verified_readback_is_executed():
    mock = MockPayPal(post_status="ok", apply_change_on_post=True)
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    assert outcome.result == RESULT_EXECUTED
    assert outcome.execution_mode == "LIVE"
    assert outcome.simulated is False
    assert mock.post_calls == 1  # exactly one POST
    assert mock.get_calls == 2  # pre-check + verification
    assert mock.token_calls == 1  # token cached
    assert outcome.verification["method"] == "LIVE_GET"
    assert outcome.verification["basis"] == "REMOTE_GET"
    assert outcome.verification["confirmed"] is True
    assert outcome.verification["observations"]["evidence_delta"] == 1
    assert outcome.response_snapshot["http_status"] == 204
    assert outcome.response_snapshot["simulated"] is False
    assert outcome.request_snapshot["remote_precheck"]["status"] == (
        "WAITING_FOR_SELLER_RESPONSE"
    )
    assert outcome.request_snapshot["state_version"] == 1
    assert "multipart/form-data" in (mock.last_post_content_type or "")
    assert mock.last_post_body == {
        "evidences": [
            {
                "evidence_type": "PROOF_OF_FULFILLMENT",
                "notes": "Sandbox adapter test",
            }
        ]
    }
    assert mock.last_post_path == "/v1/customer/disputes/PP-D-100/provide-evidence"
    assert mock.last_post_idempotency
    assert len(mock.last_post_idempotency) == 32


def test_post_timeout_then_readback_confirmation_is_executed():
    mock = MockPayPal(post_status="timeout", apply_change_on_post=True)
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    assert outcome.result == RESULT_EXECUTED
    assert mock.post_calls == 1
    assert outcome.verification["post_outcome_unknown"] is True
    assert outcome.verification["post_error"]["kind"] == "UNAVAILABLE"
    assert outcome.response_snapshot["http_status"] is None


def test_post_timeout_without_observable_change_is_unverified():
    mock = MockPayPal(post_status="timeout", apply_change_on_post=False)
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()

    assert outcome.result == RESULT_UNVERIFIED
    assert mock.post_calls == 1  # never retried
    assert outcome.verification["confirmed"] is False
    assert "no evidence matching the submitted payload" in outcome.verification[
        "uncertain_reason"
    ]


def test_post_500_is_ambiguous_and_not_retried():
    mock = MockPayPal(post_status="500", apply_change_on_post=False)
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()
    assert outcome.result == RESULT_UNVERIFIED
    assert mock.post_calls == 1
    assert outcome.verification["post_error"]["kind"] == "UNAVAILABLE"


@pytest.mark.parametrize(
    ("status", "kind"),
    [("401", PayPalErrorKind.AUTH), ("403", PayPalErrorKind.PERMISSION)],
)
def test_post_auth_and_permission_errors_map_to_failed(status, kind):
    mock = MockPayPal(post_status=status)
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()
    assert outcome.result == RESULT_FAILED
    assert outcome.verification["error"]["kind"] == kind.value
    assert mock.post_calls == 1
    assert mock.get_calls == 1  # no verification GET after a definite rejection


def test_post_429_is_failed_with_retry_after_and_no_retry():
    mock = MockPayPal(post_status="429")
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()
    assert outcome.result == RESULT_FAILED
    assert outcome.verification["error"]["kind"] == "RATE_LIMITED"
    assert outcome.verification["error"]["retry_after"] == 3.0
    assert mock.post_calls == 1


def test_precheck_status_drift_blocks_without_post():
    state_source = raw_dispute(status="WAITING_FOR_SELLER_RESPONSE")
    state_norm = normalize_dispute(state_source)
    mock = MockPayPal(pre=raw_dispute(status="UNDER_REVIEW"))
    config = sandbox_config()
    api = PayPalApiClient(config, transport=mock.transport())
    proposal = make_proposal(state_norm.case)
    approval = make_approval(proposal)
    gateway = PayPalSandboxGateway(config, api)
    try:
        outcome = gateway.execute(proposal, state_norm.case, state_norm.state, approval)
    finally:
        api.close()
    assert outcome.result == RESULT_BLOCKED
    assert outcome.verification["blocked_stage"] == "precheck"
    assert "remote state changed" in outcome.verification["blocked_reason"]
    assert mock.post_calls == 0


def test_missing_hateoas_post_link_blocks():
    raw = raw_dispute(links=[{"rel": "self", "href": "/x", "method": "GET"}])
    normalized = normalize_dispute(raw)
    mock = MockPayPal(pre=raw)
    config = sandbox_config()
    api = PayPalApiClient(config, transport=mock.transport())
    proposal = make_proposal(normalized.case)
    approval = make_approval(proposal)
    gateway = PayPalSandboxGateway(config, api)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()
    assert outcome.result == RESULT_BLOCKED
    assert outcome.verification["blocked_stage"] == "hateoas"
    assert mock.post_calls == 0


def test_unsupported_live_action_blocks_without_network():
    mock = MockPayPal()
    gateway, normalized, proposal, approval, api = _setup(
        mock,
        write_allow=("PP-D-100:escalate",),
    )
    proposal = make_proposal(normalized.case, action="escalate")
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()
    assert outcome.result == RESULT_BLOCKED
    assert outcome.verification["blocked_stage"] == "action_support"
    assert mock.post_calls == 0
    assert mock.get_calls == 0


def test_audit_events_are_ordered_and_secret_free():
    mock = MockPayPal(post_status="ok", apply_change_on_post=True)
    gateway, normalized, proposal, approval, api = _setup(mock)
    events: list[tuple[str, dict]] = []
    try:
        gateway.execute(
            proposal,
            normalized.case,
            normalized.state,
            approval,
            audit=lambda name, payload: events.append((name, payload)),
        )
    finally:
        api.close()

    assert [name for name, _ in events] == ["EXECUTION_ATTEMPT", "EXECUTION_VERIFIED"]
    assert events[0][1]["approval_id"] == approval.approval_id
    assert events[0][1]["precheck"]["status"] == "WAITING_FOR_SELLER_RESPONSE"
    serialized = json.dumps(events, sort_keys=True)
    assert SENTINEL_CLIENT_ID not in serialized
    assert SENTINEL_SECRET not in serialized
    assert SENTINEL_TOKEN not in serialized
    assert "Authorization" not in serialized


def test_unverified_emits_unknown_audit_event():
    mock = MockPayPal(post_status="timeout", apply_change_on_post=False)
    gateway, normalized, proposal, approval, api = _setup(mock)
    events: list[str] = []
    try:
        gateway.execute(
            proposal,
            normalized.case,
            normalized.state,
            approval,
            audit=lambda name, _payload: events.append(name),
        )
    finally:
        api.close()
    assert events == ["EXECUTION_ATTEMPT", "EXECUTION_UNKNOWN"]


def test_outcome_serialization_has_no_secrets():
    mock = MockPayPal()
    gateway, normalized, proposal, approval, api = _setup(mock)
    try:
        outcome = gateway.execute(proposal, normalized.case, normalized.state, approval)
    finally:
        api.close()
    serialized = json.dumps(outcome.to_public(), sort_keys=True)
    assert SENTINEL_CLIENT_ID not in serialized
    assert SENTINEL_SECRET not in serialized
    assert SENTINEL_TOKEN not in serialized
