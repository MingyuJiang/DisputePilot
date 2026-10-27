"""T31 — Frozen AI / no-Ollama mode (v1.3 FROZEN_REPLAY).

The frozen provider replays four pre-recorded LLM analyses exported from the
offline demo database. No model, no HTTP, no GPU. A missing case is an explicit
404; ``/api/v1/llm/status`` never falls back to STUB.
"""

from __future__ import annotations

import json
import socket
from pathlib import Path

from fastapi.testclient import TestClient

from app.adapters.frozen_ai import FrozenReplayProvider
from tests.conftest import SPECIALIST
from tests.demo_support import demo_client

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "fixtures"
    / "OFFLINE_FROZEN_ANALYSES.json"
)
O7 = "DEMO-INR-O7"
O16 = "DEMO-BILL-O16"


class _NetworkForbidden:
    def __init__(self, *_args, **_kwargs) -> None:
        raise AssertionError("network client constructed in frozen mode")


def _forbid_network(monkeypatch) -> None:
    """Any outbound HTTP request (model or PayPal) is a test failure."""
    import http.client

    def _no_call(*_args, **_kwargs):
        raise AssertionError("HTTP request attempted in frozen mode")

    monkeypatch.setattr(http.client.HTTPConnection, "request", _no_call)


# -------------------------------------------------------------------- replay
def test_frozen_analysis_is_frozen_replay_with_zero_network(tmp_path, monkeypatch):
    _forbid_network(monkeypatch)
    with demo_client(
        tmp_path, monkeypatch, ai_provider="frozen"
    ) as (client, _db_path):
        client.app.state.container.payment_client_factory = _NetworkForbidden
        provider = client.app.state.container.ai_provider
        assert isinstance(provider, FrozenReplayProvider)
        assert not hasattr(provider, "transport")

        response = client.post(
            f"/api/v1/cases/{O7}/analyses", headers=SPECIALIST
        )
        assert response.status_code == 200, response.text
        analysis = response.json()

    assert analysis["analysis_mode"] == "FROZEN_REPLAY"
    assert analysis["model_provider"] == "frozen-replay"
    assert analysis["model_name"] == "qwen3.6:35b-a3b-q4_K_M"
    assert any("Frozen AI Output / Offline Replay" in f for f in analysis["safety_flags"])

    entry = json.loads(FIXTURE.read_text(encoding="utf-8"))["analyses"][O7]
    # Recorded values are preserved verbatim, not re-generated.
    assert analysis["recommendation"] == entry["recommendation"] == "send-message"
    assert analysis["missing_evidence"] == entry["missing_evidence"]
    assert analysis["grounded_facts"] == entry["grounded_facts"]
    assert analysis["plan"]["raw_recommendation"] == entry["recommendation"]


def test_frozen_o16_is_gated_to_wait_and_keeps_recorded_action(tmp_path, monkeypatch):
    with demo_client(
        tmp_path, monkeypatch, ai_provider="frozen"
    ) as (client, _db_path):
        analysis = client.post(
            f"/api/v1/cases/{O16}/analyses", headers=SPECIALIST
        ).json()
        assert analysis["analysis_mode"] == "FROZEN_REPLAY"
        assert analysis["recommendation"] == "wait"
        assert analysis["plan"]["raw_recommendation"] == "provide-evidence"
        assert analysis["plan"]["effective_action"] == "wait"
        assert (
            analysis["plan"]["action_gate_reason"]
            == "no POST rel 'provide_evidence' in observed state"
        )
        assert analysis["plan"]["alternatives"] == [
            "send-message",
            "accept-claim",
            "wait",
        ]

        proposals = client.post(
            f"/api/v1/cases/{O16}/proposals/generate", headers=SPECIALIST
        )
        assert proposals.status_code == 200, proposals.text
        assert proposals.json()[0]["action_type"] == "wait"


def test_frozen_missing_case_is_an_explicit_404(app, monkeypatch):
    monkeypatch.setenv("DP_AI_PROVIDER", "frozen")
    monkeypatch.setenv("DP_AUTO_IMPORT", "1")
    with TestClient(app) as client:
        response = client.post("/api/v1/cases/O4/analyses", headers=SPECIALIST)

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "NOT_FOUND"
    assert "no frozen analysis" in error["message"]
    assert "no model call was made" in error["message"]


# ------------------------------------------------------------------- status
def test_llm_status_frozen_is_always_available(client, monkeypatch):
    monkeypatch.setenv("DP_AI_PROVIDER", "frozen")
    response = client.get("/api/v1/llm/status")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["provider"] == "frozen"
    assert body["available"] is True
    assert body["model"] == "qwen3.6:35b-a3b-q4_K_M"
    assert "no model call" in body["detail"]


def test_llm_status_ollama_unavailable_is_false_without_stub_fallback(
    client, monkeypatch
):
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    closed_port = probe.getsockname()[1]
    probe.close()

    monkeypatch.setenv("DP_AI_PROVIDER", "ollama_local")
    monkeypatch.setenv("DP_LLM_BASE_URL", f"http://127.0.0.1:{closed_port}")
    response = client.get("/api/v1/llm/status")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["provider"] == "ollama_local"
    assert body["available"] is False
    assert body["detail"].startswith(("LLM_CONNECTION_ERROR", "LLM_TIMEOUT"))
    assert "no STUB fallback" in body["detail"]


def test_frozen_fixture_preserves_the_four_recorded_analyses():
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    meta = raw["_meta"]
    entries = raw["analyses"]

    assert meta["source"] == "RECORDED_LLM_ANALYSES"
    assert meta["case_count"] == 4
    assert set(entries) == {
        "DEMO-INR-O7",
        "DEMO-SNAD-O13",
        "DEMO-BILL-O16",
        "DEMO-BLOCK-O9",
    }
    for entry in entries.values():
        # These are recorded LLM outputs, not stub or fabricated analyses.
        assert entry["recorded_analysis_mode"] == "LLM"
        assert entry["model_provider"] == "ollama-local"
        assert entry["grounded_facts"]
        assert entry["recommendation"]
        assert "missing_evidence" in entry
        assert "plan" in entry
