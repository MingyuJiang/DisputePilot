"""T19 — a sandbox import must leave a usable CaseStateSnapshot behind.

The runtime store is in-memory and reloads fixtures on boot, so the durable
``case_states`` row is what keeps imported disputes analysable after a
restart. These tests use only ``httpx.MockTransport`` (zero network).
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters.case_state import CaseStateStore
from app.adapters.paypal.client import PayPalApiClient
from app.adapters.paypal.source import PayPalCaseSource
from app.api.deps import paypal_source_provider
from app.domain.enums import (
    CapabilityBasis,
    DisputeStatus,
    EvidenceSource,
    EvidenceType,
    LifecycleStage,
    ProvenanceLabel,
)
from app.infrastructure.settings import settings
from app.services.case_service import CaseService
from tests.conftest import SPECIALIST, SYSTEM
from tests.paypal_helpers import (
    SENTINEL_CLIENT_ID,
    SENTINEL_SECRET,
    raw_dispute,
    sandbox_config,
    token_json,
)

CASE_ID = "PP-R-QYW-10193141"

_ENV = (
    "DP_DATA_MODE",
    "DP_PAYPAL_BASE_URL",
    "DP_PAYPAL_CLIENT_ID",
    "DP_PAYPAL_CLIENT_SECRET",
    "DP_PAYPAL_WRITES_ENABLED",
    "DP_PAYPAL_WRITE_ALLOW",
    "DP_AUTO_IMPORT",
)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in _ENV:
        monkeypatch.delenv(name, raising=False)
    settings.paypal_last_read_at = ""
    settings.paypal_last_error = ""


def _enable_sandbox(monkeypatch) -> None:
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    monkeypatch.setenv("DP_AUTO_IMPORT", "0")


def _override(app, detail: dict) -> PayPalCaseSource:
    source = PayPalCaseSource(
        sandbox_config(),
        client=PayPalApiClient(sandbox_config(), transport=_DisputeAPI(detail).transport()),
    )
    app.dependency_overrides[paypal_source_provider] = lambda: source
    return source


def _read_state(app, case_id: str):
    from app.infrastructure.database import get_session_factory

    session = get_session_factory()()
    try:
        return CaseService(session, app.state.container.state_store).get_state(case_id)
    finally:
        session.close()


class _DisputeAPI:
    """List summary + detail GET, with mutable detail for refresh tests."""

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
                200,
                json={"items": [{"dispute_id": self.detail["dispute_id"]}], "links": []},
            )
        if request.method == "GET" and path.startswith("/v1/customer/disputes/"):
            return httpx.Response(200, json=self.detail)
        return httpx.Response(404, json={"name": "NOT_FOUND"})


def test_import_upserts_state_from_observed_response(app, monkeypatch):
    _enable_sandbox(monkeypatch)
    _override(app, raw_dispute(dispute_id=CASE_ID))

    with TestClient(app) as client:
        assert client.post("/api/v1/cases/import", headers=SYSTEM).status_code == 200

        state = _read_state(app, "PP-R-QYW-10193141")
        assert state.dispute_status == DisputeStatus.WAITING_FOR_SELLER_RESPONSE
        assert state.lifecycle_stage == LifecycleStage.INQUIRY
        assert state.basis == CapabilityBasis.LIVE_HATEOAS
        assert state.provenance == ProvenanceLabel.PAYPAL_API_OBSERVED
        assert state.observed_at
        assert state.dispute_amount is not None
        assert state.dispute_amount.value_minor == 12999
        assert state.dispute_amount.currency == "USD"
        # Not observable from the dispute payload -> stays at the safe default.
        assert state.seller_contacted is False

        requirement = state.open_requirement(EvidenceType.PROOF_OF_FULFILLMENT)
        assert requirement is not None
        assert requirement.source == EvidenceSource.REQUESTED_FROM_SELLER
        assert requirement.open is True

        assert {(link.rel, link.method) for link in state.links} == {
            ("provide_evidence", "POST"),
            ("self", "GET"),
        }
        assert all(link.basis == CapabilityBasis.LIVE_HATEOAS for link in state.links)

        # The case record and the runtime state describe the same observation.
        assert state.dispute_status.value == client.get(
            "/api/v1/cases/PP-R-QYW-10193141"
        ).json()["dispute_status"]


def test_state_survives_restart_and_analysis_chain_runs(app, monkeypatch):
    _enable_sandbox(monkeypatch)
    _override(app, raw_dispute(dispute_id=CASE_ID))

    # First process: import only (the coordinator's observed sequence).
    with TestClient(app) as client:
        assert client.post("/api/v1/cases/import", headers=SYSTEM).status_code == 200
        assert _read_state(app, "PP-R-QYW-10193141").dispute_status == (
            DisputeStatus.WAITING_FOR_SELLER_RESPONSE
        )

    # Second process: lifespan rebuilds the store from the DB, then the full
    # analysis -> proposal -> validation chain must work.
    with TestClient(app) as client:
        analysis = client.post("/api/v1/cases/PP-R-QYW-10193141/analyses", headers=SPECIALIST)
        assert analysis.status_code == 200, analysis.text
        body = analysis.json()
        assert body["case_id"] == "PP-R-QYW-10193141"
        assert body["plan"]
        assert body["case_snapshot_hash"]

        generated = client.post(
            "/api/v1/cases/PP-R-QYW-10193141/proposals/generate", headers=SPECIALIST
        )
        assert generated.status_code == 200, generated.text
        proposals = generated.json()
        assert proposals
        proposal_id = proposals[0]["proposal_id"]

        submitted = client.post(
            f"/api/v1/proposals/{proposal_id}/submit", headers=SPECIALIST
        )
        assert submitted.status_code == 200, submitted.text
        payload = submitted.json()
        assert payload["proposal"]["state"] == "PENDING_APPROVAL"
        assert payload["approval"]["approval_id"]


def test_second_import_refreshes_state_and_persistence(app, monkeypatch):
    _enable_sandbox(monkeypatch)
    detail = raw_dispute(dispute_id=CASE_ID)
    api = _DisputeAPI(detail)
    source = PayPalCaseSource(
        sandbox_config(),
        client=PayPalApiClient(sandbox_config(), transport=api.transport()),
    )
    app.dependency_overrides[paypal_source_provider] = lambda: source

    with TestClient(app) as client:
        first = client.post("/api/v1/cases/import", headers=SYSTEM)
        assert first.status_code == 200, first.text
        before = _read_state(app, "PP-R-QYW-10193141")
        assert before.open_requirement(EvidenceType.PROOF_OF_FULFILLMENT) is not None
        assert all(link.rel != "send_message" for link in before.links)

        # Remote moves on: status changes, requested evidence is fulfilled,
        # and a new HATEOAS action appears.
        api.detail = raw_dispute(
            dispute_id=CASE_ID,
            status="UNDER_REVIEW",
            evidences=[
                {
                    "evidence_id": "EV-1",
                    "evidence_type": "PROOF_OF_FULFILLMENT",
                    "source": "REQUESTED_FROM_SELLER",
                    "evidence_documents": [{"document_id": "DOC-1", "type": "RECEIPT"}],
                }
            ],
            links=[
                {"rel": "self", "method": "GET"},
                {"rel": "provide-evidence", "method": "POST"},
                {"rel": "send-message", "method": "POST"},
            ],
        )

        second = client.post("/api/v1/cases/import", headers=SYSTEM)
        assert second.status_code == 200, second.text
        assert second.json()["skipped_duplicates"] == 1

        after = _read_state(app, "PP-R-QYW-10193141")
        assert after.dispute_status == DisputeStatus.UNDER_REVIEW
        assert after.compute_state_hash() != before.compute_state_hash()
        requirement = after.open_requirement(EvidenceType.PROOF_OF_FULFILLMENT)
        assert requirement is None  # fulfilled -> no longer open
        assert {link.rel for link in after.links} >= {"send_message", "provide_evidence"}

        # The durable row was refreshed too, so the restart path sees the new
        # state rather than the first import.
        from app.infrastructure.database import get_session_factory
        from app.infrastructure.repositories import CaseStateRepository

        session = get_session_factory()()
        try:
            row = CaseStateRepository(session).get("PP-R-QYW-10193141")
            assert row is not None
            persisted = row.record_json
            assert '"dispute_status":"UNDER_REVIEW"' in persisted
            assert '"send_message"' in persisted
        finally:
            session.close()


def test_get_state_falls_back_to_persisted_row(app, monkeypatch):
    """A worker whose store missed the import still resolves the state."""
    _enable_sandbox(monkeypatch)
    _override(app, raw_dispute(dispute_id=CASE_ID))

    with TestClient(app) as client:
        assert client.post("/api/v1/cases/import", headers=SYSTEM).status_code == 200

        fresh_store = CaseStateStore(settings.replay_states_path)
        assert fresh_store.get(CASE_ID) is None

        from app.infrastructure.database import get_session_factory

        session = get_session_factory()()
        try:
            state = CaseService(session, fresh_store).get_state(CASE_ID)
        finally:
            session.close()
        assert state.case_id == CASE_ID
        assert state.basis == CapabilityBasis.LIVE_HATEOAS
        # The lazy read also warms the local store for later validators.
        assert fresh_store.get(CASE_ID) is not None


def test_explicit_seller_contacted_and_dispute_state_alias():
    explicit = raw_dispute(dispute_id=CASE_ID)
    explicit["seller_contacted"] = True
    explicit["dispute_state"] = "WAITING_FOR_BUYER_RESPONSE"
    explicit.pop("status")

    from app.adapters.paypal.normalize import normalize_dispute

    normalized = normalize_dispute(explicit)
    assert normalized.state.seller_contacted is True
    assert normalized.case.seller_contacted is True
    assert normalized.state.dispute_status == DisputeStatus.WAITING_FOR_BUYER_RESPONSE
    assert normalized.remote_status == "WAITING_FOR_BUYER_RESPONSE"
