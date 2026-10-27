"""T28 — Planner action consistency (v1.3 RC).

The local model may suggest any whitelisted action, but the observed state is
the only runtime permission. ``HATEOAS`` decides whether the suggestion becomes
the effective action; otherwise the plan is downgraded to ``wait`` while the
raw model suggestion is preserved for audit.
"""

from __future__ import annotations

import json

import pytest

from app.adapters.local_llm import LLMConfig, LocalLLMProvider
from app.domain.enums import ActionType
from app.domain.models import AvailableAction, EvidenceRequirement, EvidenceType
from tests.conftest import SPECIALIST

O16 = "O16"


class FakeTransport:
    def __init__(self) -> None:
        self.response: dict | None = None
        self.calls: list[dict] = []

    def chat(self, payload: dict, timeout_s: float | None = None) -> dict:
        self.calls.append(payload)
        assert self.response is not None
        return self.response


def _ollama_response(draft: dict) -> dict:
    return {
        "model": "qwen3.6:35b-a3b-q4_K_M",
        "message": {"role": "assistant", "content": json.dumps(draft)},
        "done": True,
        "done_reason": "stop",
    }


def _draft(evidence_id: str, action: str, span: str) -> dict:
    return {
        "factual_summary": "BILLING duplicate-transaction dispute, offline demo.",
        "candidate_facts": [
            {
                "fact_id": "F1",
                "statement": "The buyer statement is recorded on the case.",
                "fact_type": "OBSERVED_FACT",
                "evidence_ids": [evidence_id],
                "evidence_span": span,
                "confidence": "HIGH",
                "uncertainty": "none",
            }
        ],
        "cited_evidence_ids": [evidence_id],
        "missing_evidence_candidates": ["merchant refund record"],
        "suggested_action": action,
        "rationale": ["model reasoning"],
        "uncertainty": "low",
    }


def _evidence(client, case_id: str) -> list[dict]:
    response = client.get(f"/api/v1/cases/{case_id}/evidence")
    assert response.status_code == 200, response.text
    return response.json()


def _set_state(
    client,
    case_id: str,
    *,
    links: list[str],
    requirements: list[EvidenceRequirement] | None = None,
    seller_contacted: bool | None = None,
):
    store = client.app.state.container.state_store
    state = store.get(case_id)
    assert state is not None
    changes = {
        "links": [
            AvailableAction(rel=rel, method="POST") for rel in links
        ]
    }
    if requirements is not None:
        changes["evidence_requirements"] = requirements
    if seller_contacted is not None:
        changes["seller_contacted"] = seller_contacted
    store.upsert(state.model_copy(update=changes))
    return store.get(case_id)


@pytest.fixture()
def llm(ready):
    """App with a LocalLLMProvider whose transport is a deterministic fake."""
    transport = FakeTransport()
    provider = LocalLLMProvider(
        LLMConfig(provider="ollama_local"), transport=transport
    )
    ready.app.state.container.ai_provider = provider
    ready.transport = transport
    ready.provider = provider
    return ready


# --------------------------------------------------------- O16: no POST link
def test_o16_gate_downgrades_to_wait_and_preserves_raw_recommendation(llm):
    evidence = _evidence(llm, O16)
    _set_state(
        llm, O16, links=["send_message", "accept_claim"], requirements=[]
    )
    llm.transport.response = _ollama_response(
        _draft(evidence[0]["evidence_id"], "provide-evidence", evidence[0]["content"])
    )

    response = llm.post(f"/api/v1/cases/{O16}/analyses", headers=SPECIALIST)
    assert response.status_code == 200, response.text
    analysis = response.json()

    assert analysis["recommendation"] == "wait"
    plan = analysis["plan"]
    assert plan["raw_recommendation"] == "provide-evidence"
    assert plan["effective_action"] == "wait"
    assert plan["recommended_action"] == "wait"
    assert plan["action_gate_reason"] == "no POST rel 'provide_evidence' in observed state"
    assert plan["wait_rule_applies"] is True
    assert plan["alternatives"] == ["send-message", "accept-claim", "wait"]
    assert any("PLANNER_ACTION_GATED" in flag for flag in analysis["safety_flags"])


def test_o16_with_send_message_link_still_wait_no_fallback(llm):
    """A missing provide_evidence link downgrades to WAIT — never to send-message."""
    evidence = _evidence(llm, O16)
    _set_state(llm, O16, links=["send_message"], requirements=[], seller_contacted=False)
    llm.transport.response = _ollama_response(
        _draft(evidence[0]["evidence_id"], "provide-evidence", evidence[0]["content"])
    )

    analysis = llm.post(f"/api/v1/cases/{O16}/analyses", headers=SPECIALIST).json()
    assert analysis["recommendation"] == "wait"
    assert "send-message" in analysis["plan"]["alternatives"]

    proposals = llm.post(f"/api/v1/cases/{O16}/proposals/generate", headers=SPECIALIST)
    assert proposals.status_code == 200, proposals.text
    assert proposals.json()[0]["action_type"] == "wait"


def test_link_backed_provide_evidence_stays_effective(llm):
    evidence = _evidence(llm, O16)
    _set_state(
        llm,
        O16,
        links=["provide_evidence", "send_message"],
        requirements=[
            EvidenceRequirement(
                evidence_type=EvidenceType.PROOF_OF_REFUND, open=True
            )
        ],
    )
    llm.transport.response = _ollama_response(
        _draft(evidence[0]["evidence_id"], "provide-evidence", evidence[0]["content"])
    )

    analysis = llm.post(f"/api/v1/cases/{O16}/analyses", headers=SPECIALIST).json()
    assert analysis["recommendation"] == "provide-evidence"
    assert analysis["plan"]["effective_action"] == "provide-evidence"
    assert analysis["plan"]["action_gate_reason"] is None
    assert "provide-evidence" not in analysis["plan"]["alternatives"]
    assert set(analysis["plan"]["alternatives"]) <= {"send-message", "wait"}


def test_gate_is_deterministic_for_identical_input(llm):
    evidence = _evidence(llm, O16)
    state = _set_state(
        llm, O16, links=["send_message", "accept_claim"], requirements=[]
    )
    llm.transport.response = _ollama_response(
        _draft(evidence[0]["evidence_id"], "provide-evidence", evidence[0]["content"])
    )

    from app.infrastructure.database import get_session_factory
    from app.services.case_service import CaseService

    session = get_session_factory()()
    try:
        case_service = CaseService(session, llm.app.state.container.state_store)
        case = case_service.get_case(O16)
        first = llm.provider.analyze(case, state)
        second = llm.provider.analyze(case, state)
    finally:
        session.close()

    keys = (
        "recommended_action",
        "raw_recommendation",
        "effective_action",
        "action_gate_reason",
        "alternatives",
    )
    assert {k: first.plan[k] for k in keys} == {k: second.plan[k] for k in keys}
    assert first.recommendation == second.recommendation == "wait"


def test_plan_re_gates_when_state_loses_a_link(llm):
    evidence = _evidence(llm, O16)
    state_with_link = _set_state(
        llm, O16, links=["accept_claim"], requirements=[]
    )
    llm.transport.response = _ollama_response(
        _draft(evidence[0]["evidence_id"], "accept-claim", evidence[0]["content"])
    )
    from app.infrastructure.database import get_session_factory
    from app.services.case_service import CaseService

    session = get_session_factory()()
    try:
        case = CaseService(session, llm.app.state.container.state_store).get_case(O16)
        analysis = llm.provider.analyze(case, state_with_link)
        assert analysis.recommendation == "accept-claim"

        # The state changed after the analysis: the link is gone.
        later_state = state_with_link.model_copy(
            update={"links": [AvailableAction(rel="send_message", method="POST")]}
        )
        proposals = llm.provider.plan(case, later_state, analysis)
    finally:
        session.close()

    assert len(proposals) == 1
    assert proposals[0].action_type == ActionType.WAIT.value
    assert proposals[0].action_payload == {}


def test_v3_does_not_fire_on_gated_wait(llm):
    evidence = _evidence(llm, O16)
    _set_state(llm, O16, links=["send_message", "accept_claim"], requirements=[])
    llm.transport.response = _ollama_response(
        _draft(evidence[0]["evidence_id"], "provide-evidence", evidence[0]["content"])
    )
    llm.post(f"/api/v1/cases/{O16}/analyses", headers=SPECIALIST)
    proposal = llm.post(
        f"/api/v1/cases/{O16}/proposals/generate", headers=SPECIALIST
    ).json()[0]
    assert proposal["action_type"] == "wait"

    submitted = llm.post(
        f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST
    )
    assert submitted.status_code == 200, submitted.text
    report = llm.get(
        f"/api/v1/proposals/{proposal['proposal_id']}/validation"
    ).json()
    assert report is not None
    v3 = next(f for f in report["findings"] if f["validator_id"] == "V3")
    assert v3["status"] != "FAIL"
    assert "no write link" in v3["detail"]
    assert report["passed"] is True
