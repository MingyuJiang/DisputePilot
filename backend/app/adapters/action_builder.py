"""Deterministic action payloads + preconditions.

Extracted from the stub so both providers build proposals the same way: a
model may choose *which* action to suggest, but the payload shape is produced
by code and stays inside the V7 whitelist. Synthetic tracking fields remain
forbidden for posture-derived material.
"""

from __future__ import annotations

from ..domain.enums import ActionType
from ..domain.models import CaseRecord, CaseStateSnapshot


def build_action_payload(
    action: str, case: CaseRecord, state: CaseStateSnapshot, open_reqs: list
) -> dict:
    idem = f"DP-REPLAY-{case.case_id}-{action.upper().replace('-', '_')}-001"
    if action == ActionType.SEND_MESSAGE.value:
        req_text = (
            f"paypal has requested {open_reqs[0].evidence_type.value} from the seller"
            if open_reqs
            else "no evidence requirement is currently open"
        )
        return {
            "message": (
                f"SCENARIO_DEFINED sandbox test correspondence (offline replay draft) — "
                f"case {case.case_id}, {case.family.value} dispute for "
                f"{case.amount.display()}. The merchant acknowledges the buyer's claim "
                f"and is investigating; {req_text}. No real consumer transaction is "
                f"involved in this simulated dispute scenario."
            ),
            "idempotency_key": idem,
        }
    if action == ActionType.PROVIDE_EVIDENCE.value:
        req_type = open_reqs[0].evidence_type.value if open_reqs else "OTHER"
        return {
            "evidence_type": req_type,
            "notes": (
                f"SCENARIO_DEFINED SANDBOX TEST MATERIAL — case {case.case_id} "
                f"({case.scenario_id}). This submission is an automated "
                f"dispute-resolution test in the PayPal Sandbox environment. "
                f"Fulfillment posture: {case.fulfillment_posture.value}. No real "
                f"shipment exists; all fulfillment fields are synthetic test values "
                f"and must not be used as real logistics records."
            ),
            "idempotency_key": idem,
        }
    if action == ActionType.MAKE_OFFER.value:
        amount = state.dispute_amount
        if amount is None:
            return {"idempotency_key": idem}
        return {
            "offer_types": ["REFUND"],
            "amount": {
                "value": f"{amount.value_minor / 100:.2f}",
                "currency": amount.currency,
            },
            "idempotency_key": idem,
        }
    if action == ActionType.ACCEPT_CLAIM.value:
        return {"accept_claim_types": ["REFUND"], "idempotency_key": idem}
    if action == ActionType.ESCALATE.value:
        return {
            "note": (
                f"SCENARIO_DEFINED escalation request (offline replay draft) — "
                f"case {case.case_id}"
            ),
            "idempotency_key": idem,
        }
    return {}  # WAIT — no write


def action_preconditions(action: str, state: CaseStateSnapshot) -> list[str]:
    base = [f"state basis={state.basis.value}"]
    if action == ActionType.PROVIDE_EVIDENCE.value:
        base.append("open REQUESTED_FROM_SELLER requirement for the payload evidence_type")
    if action in (
        ActionType.MAKE_OFFER.value,
        ActionType.ESCALATE.value,
        ActionType.SEND_MESSAGE.value,
    ):
        base.append("lifecycle_stage=INQUIRY")
    if action == ActionType.SEND_MESSAGE.value:
        base.append("non-empty message within PayPal's character limit")
    if action in (ActionType.MAKE_OFFER.value, ActionType.ACCEPT_CLAIM.value):
        base.append("manager approval; amount within dispute/refund bounds")
    return base
