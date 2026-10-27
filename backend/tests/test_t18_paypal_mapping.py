"""T18 — real-shape PayPal mapping fixes (MockTransport only, zero network).

Covers the two observed defects:
- ``disputed_transactions[0]`` must feed ``transaction_reference``;
- an evidence label outside the frozen enum (``CREATE``) must survive in
  ``source_reference`` while the enum stays legal;
- a second import must refresh normalized fields without duplicating rows.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters.paypal.client import PayPalApiClient
from app.adapters.paypal.normalize import normalize_dispute
from app.adapters.paypal.source import PayPalCaseSource
from app.api.deps import paypal_source_provider
from app.domain.enums import DisputeStatus, EvidenceType
from app.domain.models import UNKNOWN
from app.infrastructure.settings import settings
from tests.conftest import SYSTEM
from tests.paypal_helpers import (
    SENTINEL_CLIENT_ID,
    SENTINEL_SECRET,
    raw_dispute,
    sandbox_config,
    token_json,
)

_ENV = (
    "DP_DATA_MODE",
    "DP_PAYPAL_BASE_URL",
    "DP_PAYPAL_CLIENT_ID",
    "DP_PAYPAL_CLIENT_SECRET",
    "DP_PAYPAL_WRITES_ENABLED",
    "DP_PAYPAL_WRITE_ALLOW",
    "DP_AUTO_IMPORT",
)

SELLER_TXN = "8T9285075D872761K"

DETAIL = {
    "dispute_id": "PP-D-100",
    "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    "status": "WAITING_FOR_SELLER_RESPONSE",
    "dispute_life_cycle_stage": "INQUIRY",
    "dispute_amount": {"currency_code": "USD", "value": "129.99"},
    "disputed_transactions": [
        {
            "seller_transaction_id": SELLER_TXN,
            "buyer_transaction_id": "BUYER-TXN-0001",
            "transaction_status": "COMPLETED",
            "gross_amount": {"currency_code": "USD", "value": "129.99"},
            "create_time": "2026-10-01T10:00:00Z",
        }
    ],
    "evidences": [
        {
            "evidence_id": "EV-1",
            "evidence_type": "CREATE",
            "source": "SUBMITTED_BY_SELLER",
            "evidence_documents": [],
        }
    ],
    "links": [{"rel": "self", "method": "GET"}],
}


def _detail(**overrides):
    payload = dict(DETAIL)
    payload.update(overrides)
    return payload


def test_transaction_reference_maps_disputed_transaction():
    case = normalize_dispute(_detail()).case
    reference = case.transaction_reference
    assert reference.capture_id == SELLER_TXN
    assert reference.buyer_transaction_id == "BUYER-TXN-0001"
    assert reference.dispute_id == "PP-D-100"
    # No explicit order field in the payload -> never guessed.
    assert reference.order_id == UNKNOWN


def test_explicit_capture_id_and_order_id_win():
    payload = _detail(
        order_id="ORDER-EXPLICIT-1",
        disputed_transactions=[
            {
                "capture_id": "CAPTURE-EXPLICIT-1",
                "seller_transaction_id": SELLER_TXN,
                "buyer_transaction_id": "BUYER-TXN-0001",
            }
        ],
    )
    case = normalize_dispute(payload).case
    assert case.transaction_reference.capture_id == "CAPTURE-EXPLICIT-1"
    assert case.transaction_reference.order_id == "ORDER-EXPLICIT-1"


def test_missing_transaction_fields_stay_unknown():
    payload = raw_dispute(dispute_id="PP-D-NOTXN")
    case = normalize_dispute(payload).case
    reference = case.transaction_reference
    assert reference.capture_id == UNKNOWN
    assert reference.buyer_transaction_id == UNKNOWN
    assert reference.order_id == UNKNOWN
    assert reference.dispute_id == "PP-D-NOTXN"

    partial = _detail(disputed_transactions=[{"transaction_status": "COMPLETED"}])
    partial_case = normalize_dispute(partial).case
    assert partial_case.transaction_reference.capture_id == UNKNOWN
    assert partial_case.transaction_reference.buyer_transaction_id == UNKNOWN


def test_create_evidence_label_is_preserved_not_invented():
    case = normalize_dispute(_detail()).case
    evidence = case.evidence[0]
    assert evidence.evidence_type == EvidenceType.OTHER
    assert "paypal_evidence_type=CREATE" in evidence.source_reference
    assert evidence.source_type == "PAYPAL_DISPUTE_EVIDENCE"
    assert evidence.provenance.value == "PAYPAL_API_OBSERVED"


class _DisputeAPI:
    """Real-shape double: list returns a summary, detail GET holds the truth."""

    def __init__(self, detail: dict) -> None:
        self.detail = detail

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        if path == "/v1/customer/disputes":
            return httpx.Response(
                200, json={"items": [{"dispute_id": "PP-D-100"}], "links": []}
            )
        if request.method == "GET" and path == "/v1/customer/disputes/PP-D-100":
            return httpx.Response(200, json=self.detail)
        return httpx.Response(404, json={"name": "NOT_FOUND"})


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in _ENV:
        monkeypatch.delenv(name, raising=False)
    settings.paypal_last_read_at = ""
    settings.paypal_last_error = ""


def test_second_import_refreshes_normalized_fields(app, monkeypatch):
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    monkeypatch.setenv("DP_AUTO_IMPORT", "0")

    api = _DisputeAPI(_detail())
    source = PayPalCaseSource(
        sandbox_config(),
        client=PayPalApiClient(sandbox_config(), transport=api.transport()),
    )
    app.dependency_overrides[paypal_source_provider] = lambda: source

    with TestClient(app) as client:
        first = client.post("/api/v1/cases/import", headers=SYSTEM).json()
        assert (first["imported"], first["skipped_duplicates"]) == (1, 0)
        before = client.get("/api/v1/cases/PP-D-100").json()
        assert before["transaction_reference"]["capture_id"] == SELLER_TXN
        assert before["dispute_status"] == "WAITING_FOR_SELLER_RESPONSE"

        # Remote moves on: new transaction id/status and one extra evidence.
        api.detail = _detail(
            status="UNDER_REVIEW",
            disputed_transactions=[
                {
                    "seller_transaction_id": "NEW-SELLER-TXN-2",
                    "buyer_transaction_id": "BUYER-TXN-0001",
                }
            ],
            evidences=DETAIL["evidences"]
            + [
                {
                    "evidence_id": "EV-2",
                    "evidence_type": "PROOF_OF_FULFILLMENT",
                    "source": "SUBMITTED_BY_SELLER",
                    "evidence_documents": [{"document_id": "DOC-7", "type": "RECEIPT"}],
                }
            ],
        )

        second = client.post("/api/v1/cases/import", headers=SYSTEM).json()
        assert (second["imported"], second["skipped_duplicates"]) == (0, 1)

        after = client.get("/api/v1/cases/PP-D-100").json()
        assert after["transaction_reference"]["capture_id"] == "NEW-SELLER-TXN-2"
        assert after["dispute_status"] == DisputeStatus.UNDER_REVIEW.value
        assert after["evidence_count"] == 2
        assert after["created_at"] == before["created_at"]
        assert after["snapshot_hash"] != before["snapshot_hash"]

        evidence = client.get("/api/v1/cases/PP-D-100/evidence").json()
        assert len(evidence) == 2  # refreshed, never duplicated
        ids = {item["evidence_id"] for item in evidence}
        assert len(ids) == 2
        create_row = next(
            item for item in evidence if "paypal_evidence_type=CREATE" in item["source_reference"]
        )
        assert create_row["evidence_type"] == EvidenceType.OTHER.value

        audit = client.get("/api/v1/cases/PP-D-100/audit").json()
        imported = [e for e in audit["events"] if e["event_type"] == "CASE_IMPORTED"]
        assert len(imported) == 2
        assert imported[-1]["payload"]["inserted"] is False
        assert imported[-1]["payload"]["read_at"]
        assert len(client.get("/api/v1/cases").json()) == 1
