"""Replay execution gateway — the ONLY execution path in this workspace.

Hard guarantees:
- Never opens a network connection; never builds a PayPal client.
- Every result carries execution_mode=REPLAY and simulated=True.
- A replay result is NEVER a PayPal response and never claims one.
- Verification follows the O4/O5 observed patterns (byte-exact message /
  evidences[] diff / state transition), recorded as expected effects with
  basis=FIXTURE_SNAPSHOT.

Refunds are replayed against the approved ``capture_snapshot`` only: the
fixture balance is the whole authority. No capture GET, no POST, no
``PayPalRefundGateway`` — the replay says ``COMPLETED`` as a deterministic
offline fixture outcome and explicitly denies being a PayPal response or a
real money movement.

The future ``LiveDisputeGateway`` port (pre-execution live GET, HATEOAS
re-check, atomic authorization, single POST, ambiguity read-back, Post-GET
verification) is a design extension point only — not implemented here.
"""

from __future__ import annotations

import hashlib
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from ..domain.enums import ActionType, ExecutionMode, ExecutionResult
from ..domain.models import (
    ActionProposal,
    Approval,
    CaseRecord,
    CaseStateSnapshot,
    ExecutionRecord,
)

# Exact 2-decimal strings only — ``"4.5"`` is an error, never a rounding input.
_EXACT_2DP_RE = re.compile(r"^(?:0|[1-9]\d{0,9})\.\d{2}$")

REFUND_REPLAY_NOTE = (
    "OFFLINE REPLAY — deterministic fixture result. This is NOT a PayPal "
    "response and no funds moved."
)
REFUND_VERIFICATION_NOTE = (
    "offline replay of a frozen capture snapshot — represents NO real money "
    "movement and is NOT a PayPal response"
)
REFUND_DISPUTE_NOTE = (
    "a refund is a payments-side money movement; it never accepts a claim, "
    "resolves or closes a dispute and is not evidence of buyer acceptance"
)


class ReplayExecutionGateway:
    """Deterministic offline simulator for approved proposals."""

    name = "ReplayExecutionGateway"

    def execute(
        self,
        proposal: ActionProposal,
        case: CaseRecord,
        state: CaseStateSnapshot,
        approval: Approval,
    ) -> ExecutionRecord:
        action = proposal.action_type
        payload = proposal.action_payload
        if action == ActionType.SEND_MESSAGE.value:
            response, verification = self._replay_send_message(payload, case, state)
        elif action == ActionType.PROVIDE_EVIDENCE.value:
            response, verification = self._replay_provide_evidence(payload, case, state)
        elif action == ActionType.MAKE_OFFER.value:
            response, verification = self._replay_make_offer(payload, case, state)
        elif action == ActionType.ACCEPT_CLAIM.value:
            response, verification = self._replay_accept_claim(payload, case, state)
        elif action == ActionType.ESCALATE.value:
            response, verification = self._replay_escalate(payload, case, state)
        elif action == ActionType.WAIT.value:
            response, verification = self._replay_wait(case, state)
        elif action in (
            ActionType.PARTIAL_REFUND.value,
            ActionType.FULL_REFUND.value,
        ):
            response, verification = self._replay_refund(action, payload, proposal)
        else:
            raise ValueError(f"unsupported replay action {action!r}")

        return ExecutionRecord(
            execution_id=self._execution_id(proposal),
            proposal_id=proposal.proposal_id,
            case_id=case.case_id,
            execution_mode=ExecutionMode.REPLAY,
            simulated=True,
            result=ExecutionResult.REPLAYED,
            gateway=self.name,
            request_snapshot={
                "action_type": action,
                "action_payload": payload,
                "idempotency_key": payload.get("idempotency_key"),
                "case_snapshot_hash": case.snapshot_hash,
                "approval_id": approval.approval_id,
                "state_version": state.state_version,
            },
            response_snapshot=response,
            verification=verification,
        )

    # -- deterministic helpers ------------------------------------------------
    @staticmethod
    def _execution_id(proposal: ActionProposal) -> str:
        digest = hashlib.sha256(
            f"{proposal.proposal_id}|{proposal.payload_hash}".encode()
        ).hexdigest()[:16]
        return f"EXE-{digest}"

    @staticmethod
    def _simulated_response(action: str, detail: dict[str, Any]) -> dict[str, Any]:
        return {
            "simulated": True,
            "execution_mode": "REPLAY",
            "gateway": "ReplayExecutionGateway",
            "action": action,
            "note": (
                "This is a deterministic OFFLINE REPLAY result against a frozen "
                "fixture state. It is NOT a PayPal API response and must not be "
                "recorded or reported as one."
            ),
            **detail,
        }

    # -- per-action replay logic ----------------------------------------------
    def _replay_send_message(self, payload, case, state):
        message = str(payload.get("message", ""))
        message_hash = hashlib.sha256(message.encode("utf-8")).hexdigest()
        response = self._simulated_response(
            "send-message",
            {
                "message_recorded": True,
                "message_sha256": message_hash,
                # O4 observed pattern: after the seller message the dispute moves
                # to UNDER_REVIEW and the write links collapse to [self]
                # (S7_GOLDEN_TRAJECTORY §4; mechanism of requirement disappearance
                # is unknown and is NOT claimed as evidence acceptance).
                "expected_state_transition": {
                    "dispute_status": "UNDER_REVIEW",
                    "links": ["self"],
                },
                "merchant_contacted_reliability": (
                    "UNRELIABLE — merchant_contacted stayed false after a verified "
                    "message on O4; not a success indicator"
                ),
            },
        )
        verification = {
            "method": "byte-exact message comparison (O4 pattern)",
            "basis": "FIXTURE_SNAPSHOT",
            "message_byte_exact": True,
            "message_sha256": message_hash,
            "state_before": {
                "dispute_status": state.dispute_status.value,
                "links": [link.rel for link in state.links],
            },
            "state_after_expected": {
                "dispute_status": "UNDER_REVIEW",
                "links": ["self"],
            },
            "four_layer_note": (
                "API acceptance != evidence recorded != evidence sufficiency != "
                "adjudication (S7 pilot matrix honesty rule)"
            ),
        }
        return response, verification

    def _replay_provide_evidence(self, payload, case, state):
        notes = str(payload.get("notes", ""))
        evidence_type = str(payload.get("evidence_type", ""))
        notes_hash = hashlib.sha256(notes.encode("utf-8")).hexdigest()
        response = self._simulated_response(
            "provide-evidence",
            {
                "evidence_recorded": True,
                "evidence_type": evidence_type,
                "notes_sha256": notes_hash,
                "expected_state_transition": {
                    "dispute_status": "UNDER_REVIEW",
                    "seller_response_due_date": "cleared",
                },
            },
        )
        verification = {
            "method": "evidences[] diff (O5 pattern)",
            "basis": "FIXTURE_SNAPSHOT",
            "expected_evidence_entry": {
                "evidence_type": evidence_type,
                "source": "SUBMITTED_BY_SELLER",
                "notes_sha256": notes_hash,
            },
            "state_before": {
                "dispute_status": state.dispute_status.value,
                "open_requirements": [
                    r.evidence_type.value for r in state.evidence_requirements if r.open
                ],
            },
            "state_after_expected": {
                "dispute_status": "UNDER_REVIEW",
                "seller_response_due_date": "cleared",
            },
        }
        return response, verification

    def _replay_make_offer(self, payload, case, state):
        response = self._simulated_response(
            "make-offer",
            {
                "offer_recorded": True,
                "offer_types": payload.get("offer_types", []),
                "amount": payload.get("amount"),
                "note": "HIGH-IMPACT monetary action — replay only; any real offer requires separate approval",
            },
        )
        verification = {
            "method": "offer recorded in dispute timeline (simulated)",
            "basis": "FIXTURE_SNAPSHOT",
            "amount_within_bounds": True,
        }
        return response, verification

    def _replay_accept_claim(self, payload, case, state):
        response = self._simulated_response(
            "accept-claim",
            {
                "claim_accepted": True,
                "accept_claim_types": payload.get("accept_claim_types", []),
                "note": "TERMINAL monetary action (closes + refunds) — replay only",
            },
        )
        verification = {
            "method": "terminal resolution recorded (simulated)",
            "basis": "FIXTURE_SNAPSHOT",
        }
        return response, verification

    def _replay_escalate(self, payload, case, state):
        response = self._simulated_response("escalate", {"escalation_recorded": True})
        verification = {"method": "escalation recorded (simulated)", "basis": "FIXTURE_SNAPSHOT"}
        return response, verification

    def _replay_wait(self, case, state):
        response = self._simulated_response(
            "wait",
            {"write_performed": False, "reason": "no legal action exists (WAIT restraint)"},
        )
        verification = {
            "method": "no-write assertion",
            "basis": "FIXTURE_SNAPSHOT",
            "writes": 0,
        }
        return response, verification

    # -- refund replay --------------------------------------------------------
    def _replay_refund(self, action: str, payload: dict[str, Any], proposal: ActionProposal):
        """Refund replay from the approved capture snapshot — offline only.

        The snapshot is the whole authority: no capture GET, no POST, no
        PayPal client. Any payload that could not describe a real refund is a
        ``ValueError`` (the caller records FAILED); a success is only ever
        produced for a well-formed, in-bounds request.
        """
        snapshot = payload.get("capture_snapshot")
        if not isinstance(snapshot, dict):
            raise ValueError(
                "refund replay requires capture_snapshot in the action payload"
            )

        capture_id = str(snapshot.get("capture_id") or "").strip()
        if not capture_id:
            raise ValueError("capture_snapshot.capture_id is required")

        declared_capture = str(payload.get("capture_id") or "").strip()
        if declared_capture and declared_capture != capture_id:
            raise ValueError(
                f"payload capture_id {declared_capture!r} != "
                f"capture_snapshot.capture_id {capture_id!r}"
            )

        currency = str(snapshot.get("currency_code") or "").strip().upper()
        if len(currency) != 3:
            raise ValueError(
                "capture_snapshot.currency_code is missing or not ISO-4217"
            )
        declared_currency = str(payload.get("currency_code") or "").strip().upper()
        if declared_currency and declared_currency != currency:
            raise ValueError(
                f"payload currency {declared_currency} != capture currency {currency}"
            )

        remaining_minor = self._refund_minor(
            snapshot.get("refundable_remaining"),
            "capture_snapshot.refundable_remaining",
        )
        if remaining_minor <= 0:
            raise ValueError("refundable remaining must be greater than 0.00")

        if action == ActionType.PARTIAL_REFUND.value:
            amount_minor = self._refund_minor(payload.get("amount"), "amount")
            if amount_minor <= 0:
                raise ValueError("refund amount must be greater than 0.00")
            if amount_minor > remaining_minor:
                raise ValueError(
                    f"refund amount {self._format_minor(amount_minor)} {currency} "
                    "exceeds the refundable remaining "
                    f"{self._format_minor(remaining_minor)} {currency}"
                )
            mode = "PARTIAL"
        elif action == ActionType.FULL_REFUND.value:
            amount_minor = remaining_minor
            mode = "FULL"
        else:  # defensive: execute() routes only the two refund actions here
            raise ValueError(f"unsupported refund action {action!r}")

        amount = self._format_minor(amount_minor)
        refund_id = self._refund_id(proposal, capture_id, amount, currency, mode)

        response = self._simulated_response(
            action,
            {
                "refund_id": refund_id,
                "status": "COMPLETED",
                "amount": amount,
                "currency_code": currency,
                "capture_id": capture_id,
                "mode": mode,
                "note": REFUND_REPLAY_NOTE,
            },
        )
        verification = {
            "method": "deterministic replay (offline fixture)",
            "basis": "FIXTURE_SNAPSHOT",
            # QA-RC-04: `confirmed` means "a read-back against the remote API
            # agrees". An offline replay performs no read-back at all, so it is
            # False even though the deterministic replay itself succeeded —
            # otherwise the UI reported "Remote confirmed: yes" for a run that
            # never touched PayPal.
            "confirmed": False,
            "remote_readback": False,
            "replay_succeeded": True,
            "refund_status": "COMPLETED",
            "amount": amount,
            "currency": currency,
            "capture_id": capture_id,
            "simulated": True,
            "refund_id": refund_id,
            "note": REFUND_VERIFICATION_NOTE,
            "dispute_resolution": "NONE",
            "dispute_resolution_note": REFUND_DISPUTE_NOTE,
        }
        return response, verification

    @staticmethod
    def _refund_minor(value: Any, field: str) -> int:
        """Exact 2-decimal amount → minor units; anything else is a ValueError.

        Deliberately local: the replay gateway must not import anything from
        the PayPal adapter tree, even pure normalisation helpers.
        """
        text = str(value).strip() if value is not None else ""
        if not _EXACT_2DP_RE.match(text):
            raise ValueError(
                f"{field} {text!r} must be an exact 2-decimal amount (e.g. \"4.00\")"
            )
        try:
            parsed = Decimal(text)
        except InvalidOperation:  # pragma: no cover - the regex already proves it
            raise ValueError(f"{field} {text!r} is not a decimal") from None
        if not parsed.is_finite():  # pragma: no cover - the regex already proves it
            raise ValueError(f"{field} {text!r} is not finite")
        return int(parsed * 100)

    @staticmethod
    def _format_minor(minor: int) -> str:
        return f"{minor // 100}.{minor % 100:02d}"

    @staticmethod
    def _refund_id(
        proposal: ActionProposal,
        capture_id: str,
        amount: str,
        currency: str,
        mode: str,
    ) -> str:
        """Deterministic ``RF-<hash12>`` — same proposal ⇒ same replay refund id."""
        digest = hashlib.sha256(
            f"{proposal.proposal_id}|{capture_id}|{amount}|{currency}|{mode}".encode()
        ).hexdigest()[:12]
        return f"RF-{digest}"
