"""T23 — P0-A send-message: one JSON POST, verified by the message body.

Every transport is ``httpx.MockTransport``: no socket is opened and no real
POST exists anywhere in this file. ``EXECUTED`` requires the submitted text to
be found verbatim in a SELLER entry of the read-back ``messages[]``; status
changes, message counts and ``merchant_contacted`` are observations only, and
nothing here ever claims the buyer received or read the message.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters.ai_provider import DeterministicStubProvider
from app.adapters.paypal.client import PayPalApiClient
from app.adapters.paypal.gateway import (
    RESULT_BLOCKED,
    RESULT_EXECUTED,
    RESULT_FAILED,
    RESULT_UNVERIFIED,
    PayPalSandboxGateway,
)
from app.adapters.paypal.normalize import normalize_dispute
from app.domain.policies import (
    MAX_SEND_MESSAGE_CHARS,
    ValidationContext,
    validate_proposal,
)
from app.infrastructure.database import get_session_factory
from app.infrastructure.repositories import (
    CaseRepository,
    CaseStateRepository,
    IdempotencyRepository,
)
from tests.conftest import MANAGER, SPECIALIST
from tests.paypal_helpers import (
    SENTINEL_CLIENT_ID,
    SENTINEL_SECRET,
    MockPayPal,
    make_approval,
    make_proposal,
    raw_dispute,
    sandbox_config,
    send_message_links,
)

MESSAGE = "SCENARIO_DEFINED sandbox test correspondence for case PP-D-100."
PAYLOAD = {"message": MESSAGE, "idempotency_key": "DP-SM-001"}
ALLOW = ("PP-D-100:send-message",)


# --------------------------------------------------------------------- helpers
def _send_pre(**overrides):
    overrides.setdefault("links", send_message_links())
    return raw_dispute(**overrides)


def _setup(mock: MockPayPal, **config_overrides):
    config = sandbox_config(write_allow=ALLOW, **config_overrides)
    api = PayPalApiClient(config, transport=mock.transport())
    normalized = normalize_dispute(mock.pre)
    proposal = make_proposal(
        normalized.case, action="send-message", payload=dict(PAYLOAD)
    )
    approval = make_approval(proposal)
    return PayPalSandboxGateway(config, api), normalized, proposal, approval, api


def _run(mock: MockPayPal, **config_overrides):
    gateway, normalized, proposal, approval, api = _setup(mock, **config_overrides)
    try:
        outcome = gateway.execute(
            proposal, normalized.case, normalized.state, approval
        )
    finally:
        api.close()
    return outcome, mock


# --------------------------------------------------------------- happy path
def test_inquiry_with_link_posts_once_and_confirms_verbatim_body():
    mock = MockPayPal(pre=_send_pre(), post_status="ok")
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_EXECUTED
    assert outcome.execution_mode == "LIVE"
    assert outcome.simulated is False
    assert mock.message_post_calls == 1  # exactly one POST
    assert mock.post_calls == 0  # never the provide-evidence endpoint
    assert mock.get_calls == 2  # pre-check + verification
    assert mock.token_calls == 1

    # JSON body is exactly {"message": text} — nothing else is forwarded
    assert mock.last_message_path == "/v1/customer/disputes/PP-D-100/send-message"
    assert mock.last_message_body == {"message": MESSAGE}
    assert "application/json" in (mock.last_message_content_type or "")
    assert len(mock.last_message_idempotency or "") == 32

    verification = outcome.verification
    assert verification["method"] == "LIVE_GET"
    assert verification["basis"] == "REMOTE_GET"
    assert verification["confirmed"] is True
    assert verification["messages_observable"] is True
    assert verification["matched_message_id"] == "MSG-SUBMITTED-1"
    assert verification["matched_message_len"] == len(MESSAGE)
    assert verification["match_basis"] == "BYTE_EXACT_SELLER_BODY"
    assert verification["delivery_claim"] == "NONE"
    assert verification["observations"]["message_delta"] == 1
    assert verification["observations"]["status_after"] == "UNDER_REVIEW"
    assert verification["observations"]["merchant_contacted_is_delivery_evidence"] is False
    assert outcome.response_snapshot["http_status"] == 200
    assert outcome.request_snapshot["remote_precheck"]["lifecycle"] == "INQUIRY"
    assert outcome.request_snapshot["message_len"] == len(MESSAGE)


def test_post_body_is_never_expanded_or_reencoded():
    mock = MockPayPal(pre=_send_pre(), post_status="ok")
    gateway, normalized, proposal, approval, api = _setup(mock)
    message = "  leading and trailing spaces are part of the text  "
    proposal = make_proposal(
        normalized.case,
        action="send-message",
        payload={"message": message, "idempotency_key": "DP-SM-002"},
    )
    try:
        outcome = gateway.execute(
            proposal, normalized.case, normalized.state, approval
        )
    finally:
        api.close()

    assert outcome.result == RESULT_EXECUTED
    assert mock.last_message_body == {"message": message}
    # PayPal stores what it received; whitespace is preserved, not stripped.
    assert outcome.verification["matched_message_len"] == len(message)
    assert mock.last_message_raw is not None
    assert message.encode("utf-8") in mock.last_message_raw


# ------------------------------------------------------------- preconditions
def test_chargeback_stage_blocks_with_zero_posts():
    mock = MockPayPal(
        pre=raw_dispute(lifecycle="CHARGEBACK", links=send_message_links())
    )
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_BLOCKED
    assert outcome.verification["blocked_stage"] == "lifecycle"
    assert outcome.verification["post_issued"] is False
    assert "INQUIRY" in outcome.verification["blocked_reason"]
    assert mock.message_post_calls == 0
    assert mock.get_calls == 1  # only the pre-check


def test_missing_send_message_link_blocks():
    mock = MockPayPal(pre=raw_dispute())  # provide-evidence + self only
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_BLOCKED
    assert outcome.verification["blocked_stage"] == "hateoas"
    assert mock.message_post_calls == 0


def test_send_message_link_with_get_method_blocks():
    links = [
        {"rel": "send-message", "href": "/x", "method": "GET"},
        {"rel": "self", "href": "/x", "method": "GET"},
    ]
    mock = MockPayPal(pre=raw_dispute(links=links))
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_BLOCKED
    assert outcome.verification["blocked_stage"] == "hateoas"
    assert mock.message_post_calls == 0


@pytest.mark.parametrize("message", ["", "   ", None, 123])
def test_empty_or_non_string_message_blocks_before_any_network(message):
    mock = MockPayPal(pre=_send_pre())
    gateway, normalized, _proposal, approval, api = _setup(mock)
    proposal = make_proposal(
        normalized.case,
        action="send-message",
        payload={"message": message, "idempotency_key": "DP-SM-EMPTY"},
    )
    try:
        outcome = gateway.execute(
            proposal, normalized.case, normalized.state, approval
        )
    finally:
        api.close()

    assert outcome.result == RESULT_BLOCKED
    assert outcome.verification["blocked_stage"] == "payload"
    assert mock.message_post_calls == 0
    assert mock.get_calls == 0
    assert mock.token_calls == 0


def test_message_over_paypal_limit_blocks_before_any_network():
    mock = MockPayPal(pre=_send_pre())
    gateway, normalized, _proposal, approval, api = _setup(mock)
    proposal = make_proposal(
        normalized.case,
        action="send-message",
        payload={"message": "x" * 2001, "idempotency_key": "DP-SM-LONG"},
    )
    try:
        outcome = gateway.execute(
            proposal, normalized.case, normalized.state, approval
        )
    finally:
        api.close()

    assert outcome.result == RESULT_BLOCKED
    assert outcome.verification["blocked_stage"] == "payload"
    assert "2000" in outcome.verification["blocked_reason"]
    assert mock.message_post_calls == 0
    assert mock.token_calls == 0


# ------------------------------------------------------------- post failures
def test_post_400_is_failed_without_readback_or_retry():
    mock = MockPayPal(pre=_send_pre(), post_status="400")
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_FAILED
    assert mock.message_post_calls == 1  # never retried
    assert mock.get_calls == 1  # definite rejection → no verification GET
    assert outcome.verification["failed_stage"] == "post"
    assert outcome.verification["error"]["http_status"] == 400


def test_post_500_is_failed_after_a_single_readback():
    mock = MockPayPal(pre=_send_pre(), post_status="500", apply_change_on_post=False)
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_FAILED
    assert mock.message_post_calls == 1  # never retried
    assert mock.get_calls == 2  # pre-check + exactly one read-back
    assert outcome.verification["post_outcome_unknown"] is True
    assert outcome.verification["failed_stage"] == "post"
    assert "no matching seller message" in outcome.verification["failure_reason"]


def test_post_timeout_is_resolved_by_readback_only():
    mock = MockPayPal(pre=_send_pre(), post_status="timeout")
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_EXECUTED
    assert mock.message_post_calls == 1
    assert mock.get_calls == 2
    assert outcome.verification["post_outcome_unknown"] is True
    assert outcome.verification["confirmed"] is True
    assert outcome.response_snapshot["http_status"] is None


def test_post_timeout_without_the_message_is_unverified():
    mock = MockPayPal(
        pre=_send_pre(), post_status="timeout", apply_change_on_post=False
    )
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_UNVERIFIED
    assert mock.message_post_calls == 1  # never retried
    assert outcome.verification["confirmed"] is False
    assert "no seller message matching" in outcome.verification["uncertain_reason"]


# -------------------------------------------------------- verification proof
def test_2xx_with_unreadable_messages_is_unverified():
    mock = MockPayPal(pre=_send_pre(), messages_observable=False)
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_UNVERIFIED
    assert mock.message_post_calls == 1
    assert outcome.verification["messages_observable"] is False
    assert outcome.verification["matched_message_id"] is None
    assert "not observable" in outcome.verification["uncertain_reason"]


def test_messages_field_disappearing_after_post_is_unverified():
    mock = MockPayPal(pre=_send_pre(), messages=[], message_readback="absent")
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_UNVERIFIED
    assert mock.message_post_calls == 1
    assert outcome.verification["messages_observable"] is False
    assert outcome.verification["observations"]["message_count_after"] is None


def test_altered_body_is_unverified_even_though_the_count_grew():
    mock = MockPayPal(pre=_send_pre(), message_readback="mismatch")
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_UNVERIFIED
    assert outcome.verification["confirmed"] is False
    assert outcome.verification["observations"]["message_delta"] == 1
    assert outcome.verification["observations"]["status_after"] == "UNDER_REVIEW"
    assert outcome.verification["matched_message_id"] is None


def test_buyer_message_with_the_same_body_is_not_a_match():
    mock = MockPayPal(pre=_send_pre(), message_readback="buyer")
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_UNVERIFIED
    assert outcome.verification["confirmed"] is False
    assert outcome.verification["observations"]["message_delta"] == 1


def test_prior_seller_message_is_matched_verbatim():
    """A re-read of an already-sent message still matches on content alone."""
    pre = _send_pre(
        messages=[
            {
                "id": "MSG-EXISTING",
                "from": "SELLER",
                "body": MESSAGE,
                "created": "2026-10-19T10:00:00Z",
            }
        ]
    )
    mock = MockPayPal(pre=pre, apply_change_on_post=False)
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_EXECUTED
    assert outcome.verification["matched_message_id"] == "MSG-EXISTING"
    assert outcome.verification["observations"]["message_delta"] == 0


def test_verification_get_failure_is_unverified():
    mock = MockPayPal(pre=_send_pre(), get_after_post_status=500)
    outcome, mock = _run(mock)

    assert outcome.result == RESULT_UNVERIFIED
    assert mock.message_post_calls == 1
    assert mock.get_calls == 2  # pre-check + failed verification GET, no retry
    assert "verification GET failed" in outcome.verification["uncertain_reason"]


# ------------------------------------------------------------------ normalize
def test_normalize_keeps_messages_verbatim():
    raw = raw_dispute(
        messages=[{"id": "M1", "from": "BUYER", "body": "where is it?", "created": "t"}]
    )
    normalized = normalize_dispute(raw)

    assert normalized.messages_observable is True
    assert normalized.message_count == 1
    assert normalized.messages == [
        {"id": "M1", "from": "BUYER", "body": "where is it?", "created": "t"}
    ]


def test_normalize_missing_messages_is_unobserved_not_empty():
    normalized = normalize_dispute(raw_dispute())

    assert normalized.messages_observable is False
    assert normalized.message_count is None
    assert normalized.messages == []
    assert any("UNOBSERVED" in warning for warning in normalized.warnings)


# --------------------------------------------------------------- policy layer
def _policy_context(**raw_overrides):
    raw = raw_dispute(dispute_id="PP-D-100123", **raw_overrides)
    normalized = normalize_dispute(raw)
    return normalized.case, normalized.state


def _finding(report, validator_id: str):
    return next(f for f in report.findings if f.validator_id == validator_id)


def _validate(state_case, payload=None, links_action="send-message"):
    case, state = state_case
    proposal = make_proposal(
        case,
        action=links_action,
        payload=payload or {"message": "SCENARIO_DEFINED test", "idempotency_key": "DP-SM-V7"},
    )
    ctx = ValidationContext(case=case, state=state, policy_version="policy-v1.0")
    return validate_proposal(proposal, ctx, report_id="VR-T23")


def test_v3_checks_the_send_message_rel():
    report = _validate(_policy_context(links=send_message_links("PP-D-100123")))
    assert _finding(report, "V3").status == "PASS"
    assert "send_message" in _finding(report, "V3").detail

    report = _validate(_policy_context())  # no send_message link
    assert _finding(report, "V3").status == "FAIL"


def test_v4_send_message_requires_inquiry():
    report = _validate(_policy_context(links=send_message_links("PP-D-100123")))
    assert _finding(report, "V4").status == "PASS"

    report = _validate(
        _policy_context(
            lifecycle="CHARGEBACK", links=send_message_links("PP-D-100123")
        )
    )
    v4 = _finding(report, "V4")
    assert v4.status == "FAIL"
    assert "INQUIRY" in v4.detail


def test_v5_is_skipped_for_send_message():
    report = _validate(_policy_context(links=send_message_links("PP-D-100123")))
    v5 = _finding(report, "V5")
    assert v5.status in ("PASS", "SKIPPED")
    assert "no evidence" in v5.detail


def test_v6_does_not_treat_send_message_as_monetary():
    report = _validate(_policy_context(links=send_message_links("PP-D-100123")))
    v6 = _finding(report, "V6")
    assert v6.status in ("PASS", "SKIPPED")
    assert v6.status != "FAIL"


@pytest.mark.parametrize(
    ("payload", "fragment"),
    [
        ({"message": 123, "idempotency_key": "k"}, "must be a string"),
        ({"message": "", "idempotency_key": "k"}, "empty"),
        ({"message": "   \n ", "idempotency_key": "k"}, "empty"),
        (
            {"message": "x" * (MAX_SEND_MESSAGE_CHARS + 1), "idempotency_key": "k"},
            "PayPal limit",
        ),
        (
            {"message": "hello", "idempotency_key": "k", "extra": "x"},
            "outside schema whitelist",
        ),
    ],
)
def test_v7_send_message_payload_rules(payload, fragment):
    report = _validate(
        _policy_context(links=send_message_links("PP-D-100123")), payload=payload
    )
    v7 = _finding(report, "V7")
    assert v7.status == "FAIL"
    assert fragment in v7.detail


def test_v7_accepts_the_documented_limit_boundary():
    report = _validate(
        _policy_context(links=send_message_links("PP-D-100123")),
        payload={
            "message": "x" * MAX_SEND_MESSAGE_CHARS,
            "idempotency_key": "DP-SM-BOUNDARY",
        },
    )
    assert _finding(report, "V7").status == "PASS"
    assert report.passed is True


# ------------------------------------------------------------------- planner
def test_planner_suggests_send_message_only_when_the_link_exists():
    provider = DeterministicStubProvider()

    case, state = _policy_context(
        evidences=[], links=send_message_links("PP-D-100123")
    )
    assert provider.plan_preview(case, state)["recommended_action"] == "send-message"

    case, state = _policy_context(evidences=[])
    preview = provider.plan_preview(case, state)
    assert preview["recommended_action"] == "wait"
    assert any("no POST rel 'send_message'" in line for line in preview["rationale"])


def test_planner_payload_stays_inside_the_v7_whitelist():
    provider = DeterministicStubProvider()
    case, state = _policy_context(
        evidences=[], links=send_message_links("PP-D-100123")
    )
    analysis = provider.analyze(case, state)
    proposal = provider.plan(case, state, analysis)[0]

    assert proposal.action_type == "send-message"
    assert set(proposal.action_payload) == {"message", "idempotency_key"}
    assert 0 < len(proposal.action_payload["message"]) <= MAX_SEND_MESSAGE_CHARS


# ------------------------------------------------------- live wiring (claim)
DISPUTE_ID = "PP-D-123456789"
CASE_ID = DISPUTE_ID
LIVE_ALLOW = f"{DISPUTE_ID}:send-message"


def _mock_live(**overrides) -> MockPayPal:
    overrides.setdefault(
        "pre",
        raw_dispute(
            dispute_id=DISPUTE_ID,
            links=send_message_links(DISPUTE_ID),
            evidences=[],
        ),
    )
    return MockPayPal(**overrides)


def _sandbox_env(monkeypatch) -> None:
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    monkeypatch.setenv("DP_PAYPAL_WRITES_ENABLED", "1")
    monkeypatch.setenv("DP_PAYPAL_WRITE_ALLOW", LIVE_ALLOW)


def _seed_case(mock: MockPayPal):
    normalized = normalize_dispute(mock.pre)
    session = get_session_factory()()
    try:
        CaseRepository(session).upsert_from_import(normalized.case)
        CaseStateRepository(session).upsert(
            normalized.case.case_id,
            normalized.state.model_dump_json(),
            normalized.state.compute_state_hash(),
            normalized.state.state_version,
        )
        session.commit()
    finally:
        session.close()
    return normalized


def _install_mock(client: TestClient, mock: MockPayPal) -> None:
    client.app.state.container.sandbox_gateway_factory = (
        lambda config: PayPalSandboxGateway(
            config, PayPalApiClient(config, transport=mock.transport())
        )
    )


def _approved_send_message(client: TestClient) -> tuple[dict, str, str]:
    r = client.post(f"/api/v1/cases/{CASE_ID}/analyses", headers=SPECIALIST)
    assert r.status_code == 200, r.text
    analysis_id = r.json()["analysis_id"]

    r = client.post(
        f"/api/v1/cases/{CASE_ID}/proposals",
        headers=SPECIALIST,
        json={
            "case_id": CASE_ID,
            "analysis_id": analysis_id,
            "action_type": "send-message",
            "action_payload": {
                "message": MESSAGE,
                "idempotency_key": "DP-LIVE-T23",
            },
        },
    )
    assert r.status_code == 200, r.text
    proposal = r.json()

    r = client.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    )
    assert r.status_code == 200, r.text
    approval_id = r.json()["approval"]["approval_id"]

    r = client.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "send-message wiring test"},
    )
    assert r.status_code == 200, r.text
    return proposal, approval_id, analysis_id


def test_live_send_message_executes_and_refuses_a_second_call(app, monkeypatch):
    mock = _mock_live(post_status="ok")
    _sandbox_env(monkeypatch)

    with TestClient(app) as client:
        _seed_case(mock)
        _install_mock(client, mock)
        proposal, approval_id, _analysis = _approved_send_message(client)

        first = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )
        assert first.status_code == 200, first.text
        body = first.json()
        audit = client.get(f"/api/v1/cases/{CASE_ID}/audit").json()["events"]

        second = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )

    assert body["result"] == "EXECUTED"
    assert body["execution_mode"] == "LIVE"
    assert body["verification"]["matched_message_len"] == len(MESSAGE)
    assert body["verification"]["delivery_claim"] == "NONE"
    assert mock.message_post_calls == 1
    assert mock.post_calls == 0

    assert second.status_code == 409
    assert "already executed" in second.json()["error"]["message"]
    assert mock.message_post_calls == 1

    types = [event["event_type"] for event in audit]
    assert types.index("EXECUTION_ATTEMPT") < types.index("EXECUTION_VERIFIED")


def test_concurrent_send_message_attempt_hits_the_claim(app, monkeypatch):
    mock = _mock_live(post_status="ok")
    _sandbox_env(monkeypatch)

    with TestClient(app) as client:
        _seed_case(mock)
        _install_mock(client, mock)
        proposal, approval_id, _analysis = _approved_send_message(client)

        session = get_session_factory()()
        try:
            IdempotencyRepository(session).put(
                f"live-execution:{proposal['proposal_id']}",
                "live-execution",
                '{"state": "CLAIMED"}',
            )
            session.commit()
        finally:
            session.close()

        response = client.post(
            f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
        )

    assert response.status_code == 409
    assert "already claimed" in response.json()["error"]["message"]
    assert mock.token_calls == 0
    assert mock.get_calls == 0
    assert mock.message_post_calls == 0


def test_mock_transport_cannot_reach_the_network():
    mock = _mock_live()
    assert isinstance(mock.transport(), httpx.MockTransport)
