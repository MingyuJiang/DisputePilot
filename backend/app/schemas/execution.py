"""Execution + replay API schemas (typed response models).

These models pin the exact runtime shape of the execution endpoints — the
OpenAPI 200 responses were previously unconstrained ``object`` (P0 A-2).

Heterogeneous dict fields keep ``dict`` typing, but their key structure is
documented here and in ``contracts_proposal/SCHEMA_V1.md`` §7:

- ``request_snapshot``: ``{action_type, action_payload, idempotency_key,
  case_snapshot_hash, approval_id, state_version}``.
- ``response_snapshot``: ``{simulated: true, execution_mode: "REPLAY",
  gateway: "ReplayExecutionGateway", action, note, ...per-action detail}``
  where per-action detail is one of
  ``{message_recorded, message_sha256, expected_state_transition,
  merchant_contacted_reliability}`` (send-message),
  ``{evidence_recorded, evidence_type, notes_sha256,
  expected_state_transition}`` (provide-evidence),
  ``{offer_recorded, offer_types, amount, note}`` (make-offer),
  ``{claim_accepted, accept_claim_types, note}`` (accept-claim),
  ``{escalation_recorded}`` (escalate),
  ``{write_performed, reason}`` (wait).
- ``verification``: ``{method, basis: "FIXTURE_SNAPSHOT", ...}`` plus
  per-action proof keys (``message_byte_exact`` / ``message_sha256`` /
  ``state_before`` / ``state_after_expected`` / ``four_layer_note`` for
  send-message; ``expected_evidence_entry`` for provide-evidence;
  ``amount_within_bounds`` for make-offer; ``writes`` for wait).

A replay result is NEVER a PayPal API response (``simulated`` is always
true; ``execution_mode`` is always ``REPLAY``).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from ..domain.enums import ExecutionMode, ExecutionResult

REPLAY_WARNING = "OFFLINE REPLAY result — not a PayPal API response"


def execution_warning(execution_mode: ExecutionMode, result: ExecutionResult) -> str:
    """Runtime warning text; the schema field stays a plain string (v1.1)."""
    if execution_mode == ExecutionMode.LIVE:
        if result == ExecutionResult.EXECUTED:
            return (
                "LIVE PayPal Sandbox result — confirmed by a read-back GET; "
                "not an adjudication"
            )
        if result == ExecutionResult.PENDING:
            return (
                "LIVE payment PENDING — accepted by PayPal but NOT settled; "
                "this is not a success and must be reconciled by a later GET; "
                "no automatic retry"
            )
        if result == ExecutionResult.UNVERIFIED:
            return (
                "LIVE result UNVERIFIED — human review required; "
                "no automatic retry"
            )
        return "LIVE execution was not confirmed — see verification for provenance"
    return REPLAY_WARNING


class ExecutionSummaryOut(BaseModel):
    """One row of ``GET /api/v1/cases/{case_id}/executions``."""

    execution_id: str
    proposal_id: str
    execution_mode: ExecutionMode
    simulated: bool
    result: ExecutionResult
    gateway: str
    created_at: str


class ExecutionOut(BaseModel):
    """``GET /api/v1/proposals/{proposal_id}/execution`` — full record."""

    execution_id: str
    proposal_id: str
    case_id: str
    execution_mode: ExecutionMode
    simulated: bool
    result: ExecutionResult
    gateway: str
    request_snapshot: dict[str, Any] = Field(default_factory=dict)
    response_snapshot: dict[str, Any] = Field(default_factory=dict)
    verification: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    warning: str = "OFFLINE REPLAY result — not a PayPal API response"


class ReplayExecutionOut(BaseModel):
    """``POST /api/v1/approvals/{approval_id}/replay`` — replay response.

    Same execution payload as :class:`ExecutionOut` minus ``request_snapshot``
    (the request echo is available via the GET execution endpoint).
    """

    execution_id: str
    proposal_id: str
    case_id: str
    execution_mode: ExecutionMode
    simulated: bool
    result: ExecutionResult
    gateway: str
    response_snapshot: dict[str, Any] = Field(default_factory=dict)
    verification: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    warning: str = "OFFLINE REPLAY result — not a PayPal API response"
