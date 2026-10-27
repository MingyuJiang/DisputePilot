"""T25 — payment-case guards: V18 scope, capture-only planning, status refresh.

Every PayPal interaction is a ``httpx.MockTransport`` double: no real POST is
ever issued. The three defects covered here were found by a real read-only
pre-check:

1. V18's allowed-field list was narrower than the refund payload, so a legal
   partial/full refund carrying ``capture_id`` / ``mode`` / ``reason`` was
   rejected before V13–V17 could speak;
2. a payment case was analysed/planned by the dispute decision tree and could
   recommend ``provide-evidence`` on a case that has no dispute;
3. ``CaseRepository.update_status`` only wrote the column, so ``GET /cases``
   kept reporting the import-time status.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.adapters.paypal.client import PayPalApiClient
from app.domain.models import AvailableAction, CaseRecord, CaseStateSnapshot, Money
from app.services.payment_planning import (
    PAYMENT_RECOMMENDATIONS,
    payment_plan,
)
from tests.conftest import MANAGER, SPECIALIST, SYSTEM, run_full_chain
from tests.paypal_helpers import (
    CAPTURE_ID,
    MERCHANT_ID,
    SENTINEL_CLIENT_ID,
    SENTINEL_SECRET,
    MockPayments,
    raw_capture,
)

CAPTURE = CAPTURE_ID
CASE_ID = f"CAP-{CAPTURE}"
PARTIAL = "partial-refund"
FULL = "full-refund"
KEY = "DP-REFUND-KEY-T25"

DISPUTE_ACTIONS = {"provide-evidence", "send-message", "make-offer", "accept-claim"}


# --------------------------------------------------------------------- rig
def _env(monkeypatch) -> None:
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    monkeypatch.setenv("DP_PAYPAL_MERCHANT_ID", MERCHANT_ID)
    monkeypatch.setenv("DP_AUTO_IMPORT", "0")
    monkeypatch.setenv("DP_PAYPAL_WRITES_ENABLED", "1")
    monkeypatch.setenv(
        "DP_PAYPAL_WRITE_ALLOW", f"{CAPTURE}:{PARTIAL},{CAPTURE}:{FULL}"
    )


class Rig:
    """One app client + one Payments double (capture GET only, no POST)."""

    def __init__(self, client: TestClient, mock: MockPayments) -> None:
        self.client = client
        self.mock = mock
        client.app.state.container.payment_client_factory = (
            lambda config: PayPalApiClient(config, transport=mock.transport())
        )

    def import_capture(self):
        return self.client.post(
            f"/api/v1/payments/captures/{CAPTURE}/import", headers=SYSTEM
        )

    def analyse(self) -> dict:
        response = self.client.post(
            f"/api/v1/cases/{CASE_ID}/analyses", headers=SPECIALIST
        )
        assert response.status_code == 200, response.text
        return response.json()

    def draft(self, action: str = PARTIAL, payload: dict | None = None):
        analysis_id = self.analyse()["analysis_id"]
        body = {
            "case_id": CASE_ID,
            "analysis_id": analysis_id,
            "action_type": action,
            "action_payload": (
                {"amount": "4.00", "idempotency_key": KEY}
                if payload is None
                else payload
            ),
        }
        return self.client.post(
            f"/api/v1/cases/{CASE_ID}/proposals", headers=SPECIALIST, json=body
        )

    def submit(self, proposal_id: str):
        return self.client.post(
            f"/api/v1/proposals/{proposal_id}/submit", headers=SPECIALIST
        )

    def generate(self) -> list[dict]:
        response = self.client.post(
            f"/api/v1/cases/{CASE_ID}/proposals/generate", headers=SPECIALIST
        )
        assert response.status_code == 200, response.text
        return response.json()


@pytest.fixture()
def rig(app, monkeypatch):
    _env(monkeypatch)
    mock = MockPayments()
    with TestClient(app) as client:
        yield Rig(client, mock)


def _failed(response) -> list[str]:
    report = response.json()["error"]["validation_report"]
    return [f["validator_id"] for f in report["findings"] if f["status"] == "FAIL"]


def _findings(response) -> dict:
    report = response.json()["error"]["validation_report"]
    return {f["validator_id"]: f for f in report["findings"]}


# ==============================================  V18 accepts client hint fields
@pytest.mark.parametrize(
    "action, payload",
    [
        (
            PARTIAL,
            {
                "capture_id": CAPTURE,
                "mode": "partial",
                "amount": "4.00",
                "reason": "goodwill gesture",
                "idempotency_key": KEY,
            },
        ),
        (
            FULL,
            {
                "capture_id": CAPTURE,
                "mode": "full",
                "reason": "buyer cancelled the order",
                "idempotency_key": KEY,
            },
        ),
    ],
)
def test_client_hint_fields_do_not_trip_v18(rig, action, payload):
    """capture_id / mode / reason are documented payment-payload fields."""
    assert rig.import_capture().status_code == 200
    proposal = rig.draft(action, payload)
    assert proposal.status_code == 200, proposal.text

    submitted = rig.submit(proposal.json()["proposal_id"])
    assert submitted.status_code == 200, submitted.text

    report = rig.client.get(
        f"/api/v1/proposals/{proposal.json()['proposal_id']}/validation"
    ).json()
    findings = {f["validator_id"]: f for f in report["findings"]}
    assert report["passed"] is True
    assert findings["V18"]["status"] == "PASS"
    assert set(findings) == {"V13", "V14", "V15", "V16", "V17", "V18"}


# ============================================  V18 still blocks dispute fields
@pytest.mark.parametrize("field", ["accept_claim", "resolve", "close_dispute"])
def test_dispute_resolution_fields_are_v18(rig, field):
    assert rig.import_capture().status_code == 200
    proposal = rig.draft(
        payload={"amount": "4.00", "idempotency_key": KEY, field: True}
    )
    assert proposal.status_code == 200, proposal.text

    response = rig.submit(proposal.json()["proposal_id"])
    assert response.status_code == 422
    assert _failed(response) == ["V18"]
    assert field in response.text
    assert rig.mock.refund_post_calls == 0


# ==================================  V13–V17 own the business blocking, not V18
@pytest.mark.parametrize(
    "capture, expected",
    [
        (raw_capture(status="PENDING"), "does not allow a refund"),
        (
            raw_capture(status="REFUNDED", total_refunded="100.00"),
            "already been fully refunded",
        ),
    ],
)
def test_non_refundable_capture_is_v14_and_v18_stays_clean(app, monkeypatch, capture, expected):
    _env(monkeypatch)
    mock = MockPayments(capture=capture)
    with TestClient(app) as client:
        rig = Rig(client, mock)
        assert rig.import_capture().status_code == 200
        proposal = rig.draft(
            PARTIAL,
            {
                "capture_id": CAPTURE,
                "mode": "partial",
                "amount": "4.00",
                "reason": "goodwill gesture",
                "idempotency_key": KEY,
            },
        )
        response = rig.submit(proposal.json()["proposal_id"])

    assert response.status_code == 422
    failed = _failed(response)
    assert "V14" in failed
    assert "V18" not in failed
    assert _findings(response)["V18"]["status"] == "PASS"
    assert expected in response.text
    assert mock.refund_post_calls == 0


# ==================================================  capture-only analysis
def test_payment_analysis_never_recommends_a_dispute_action(rig):
    assert rig.import_capture().status_code == 200
    analysis = rig.analyse()

    assert analysis["recommendation"] in PAYMENT_RECOMMENDATIONS
    assert analysis["recommendation"] not in DISPUTE_ACTIONS
    assert analysis["recommendation"] == FULL

    summary = analysis["factual_summary"]
    assert "dispute" not in summary.lower()
    assert "No refund has been executed." in summary
    assert "capture status=COMPLETED" in summary

    plan = analysis["plan"]
    assert plan["action_family"] == "PAYMENT"
    assert plan["recommended_action"] == FULL
    assert plan["capture_snapshot"]["refundable_remaining"] == "100.00"

    # deterministic planner — never reported as model output
    assert analysis["analysis_mode"] == "STUB_DETERMINISTIC"
    assert analysis["model_provider"] == "payment-capture-planner"


def test_payment_generate_proposes_only_refunds_or_wait(rig):
    assert rig.import_capture().status_code == 200
    rig.analyse()
    proposals = rig.generate()

    assert proposals, "a refundable capture yields exactly one draft"
    action_types = [p["action_type"] for p in proposals]
    assert set(action_types) <= {PARTIAL, FULL, "wait"}
    assert not (set(action_types) & DISPUTE_ACTIONS)
    assert action_types == [FULL]

    # the generated draft is submittable: V13–V18 pass on the offline facts
    response = rig.submit(proposals[0]["proposal_id"])
    assert response.status_code == 200, response.text
    assert proposals[0]["action_payload"].get("amount") is None


# ==========================================================  WAIT planning
def test_pending_capture_plans_wait_not_a_refund(app, monkeypatch):
    _env(monkeypatch)
    mock = MockPayments(capture=raw_capture(status="PENDING"))
    with TestClient(app) as client:
        rig = Rig(client, mock)
        assert rig.import_capture().status_code == 200
        analysis = rig.analyse()
        proposals = rig.generate()

    assert analysis["recommendation"] == "WAIT"
    assert "does not allow a refund" in " ".join(analysis["plan"]["rationale"])
    assert [p["action_type"] for p in proposals] == ["wait"]
    assert mock.refund_post_calls == 0


def test_zero_remaining_balance_plans_wait(app, monkeypatch):
    _env(monkeypatch)
    # PARTIALLY_REFUNDED but nothing left: refundable status, zero balance.
    mock = MockPayments(capture=raw_capture(total_refunded="100.00", status="PARTIALLY_REFUNDED"))
    with TestClient(app) as client:
        rig = Rig(client, mock)
        assert rig.import_capture().status_code == 200
        analysis = rig.analyse()
        proposals = rig.generate()

    assert analysis["recommendation"] == "WAIT"
    assert "nothing left to refund" in " ".join(analysis["plan"]["rationale"])
    assert [p["action_type"] for p in proposals] == ["wait"]
    assert mock.refund_post_calls == 0


def test_explicit_amount_selects_partial_over_full():
    """Planner rule: an explicit amount below the balance means partial."""
    case = CaseRecord(
        case_id="CAP-EXPLICIT",
        family="BILLING",
        reason="OTHER",
        amount=Money(value_minor=10000, currency="USD"),
        provenance="PAYPAL_API_OBSERVED",
        live_status_note="capture status=COMPLETED",
    )
    state = CaseStateSnapshot(
        case_id=case.case_id,
        links=[AvailableAction(rel="refund", method="POST")],
        dispute_amount=Money(value_minor=10000, currency="USD"),
        allowed_refund_amount=Money(value_minor=10000, currency="USD"),
    )

    assert payment_plan(case, state)["recommended_action"] == FULL
    partial = payment_plan(case, state, requested_amount_minor=400)
    assert partial["recommended_action"] == PARTIAL
    assert partial["requested_amount"] == "4.00"


# ======================================================  status refresh
def test_get_cases_reflects_the_workflow_status_after_analysis(ready):
    before = {c["case_id"]: c["status"] for c in ready.get("/api/v1/cases").json()}
    assert before["O4"] == "IMPORTED"

    ready.post("/api/v1/cases/O4/analyses", headers=SPECIALIST)

    after = {c["case_id"]: c["status"] for c in ready.get("/api/v1/cases").json()}
    assert after["O4"] == "ANALYZED"
    assert ready.get("/api/v1/cases/O4").json()["status"] == "ANALYZED"


def test_get_cases_reflects_the_status_after_replay(ready):
    _analysis, proposal, approval_id = run_full_chain(ready, case_id="O4")
    replayed = ready.post(
        f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
    )
    assert replayed.status_code == 200, replayed.text

    listed = {c["case_id"]: c["status"] for c in ready.get("/api/v1/cases").json()}
    assert listed["O4"] == "REPLAYED"
    assert ready.get("/api/v1/cases/O4").json()["status"] == "REPLAYED"
