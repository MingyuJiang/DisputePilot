"""Domain enumerations.

Provenance labels are the five-layer vocabulary mandated by the workspace
provenance policy (README_WORKSPACE §5, provenance_policy in the case
snapshot). They are NEVER mixed or upgraded at runtime.

Reason codes are the official PayPal dispute reason enum, taken verbatim from
``DisputePilot_v2_Handoff_2026-10-14.md`` §5 (note the official spelling
``UNAUTHORISED``).
"""

from __future__ import annotations

from enum import Enum


class ProvenanceLabel(str, Enum):
    """Five-layer provenance vocabulary (禁混写)."""

    PAYPAL_API_OBSERVED = "PAYPAL_API_OBSERVED"
    HUMAN_OBSERVED_SANDBOX_UI = "HUMAN_OBSERVED_SANDBOX_UI"
    SCENARIO_DEFINED = "SCENARIO_DEFINED"
    AI_INFERRED = "AI_INFERRED"
    SIMULATED_COMPOSITE = "SIMULATED_COMPOSITE"


class ValidationLevel(str, Enum):
    """Verification level of a case snapshot (CASE_SNAPSHOT_NOTES §4)."""

    FROZEN_SANDBOX_E1_VERIFIED = "FROZEN_SANDBOX_E1_VERIFIED"
    SCENARIO_DEFINED_OFFLINE_CONTENT = "SCENARIO_DEFINED_OFFLINE_CONTENT"
    NEGATIVE_CONTROL_REJECTION_TEST_ONLY = "NEGATIVE_CONTROL_REJECTION_TEST_ONLY"
    UNKNOWN = "UNKNOWN"


class DisputeFamily(str, Enum):
    INR = "INR"
    SNAD = "SNAD"
    BILLING = "BILLING"


class DisputeReason(str, Enum):
    """Official PayPal dispute reasons (verbatim spelling, incl. UNAUTHORISED)."""

    MERCHANDISE_OR_SERVICE_NOT_RECEIVED = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED = "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
    UNAUTHORISED = "UNAUTHORISED"
    CREDIT_NOT_PROCESSED = "CREDIT_NOT_PROCESSED"
    DUPLICATE_TRANSACTION = "DUPLICATE_TRANSACTION"
    INCORRECT_AMOUNT = "INCORRECT_AMOUNT"
    PAYMENT_BY_OTHER_MEANS = "PAYMENT_BY_OTHER_MEANS"
    CANCELED_RECURRING_BILLING = "CANCELED_RECURRING_BILLING"
    OTHER = "OTHER"


class FulfillmentPosture(str, Enum):
    """ScenarioSpec fulfillment posture (SCENARIO_FACTORY_ARCHITECTURE §2)."""

    NONE = "NONE"
    SHIPPED_NO_TRACKING = "SHIPPED_NO_TRACKING"
    SIMULATED_FULFILLMENT = "SIMULATED_FULFILLMENT"
    SHIPPED_WITH_TRACKING = "SHIPPED_WITH_TRACKING"
    REFUNDED = "REFUNDED"


class CaseWorkflowStatus(str, Enum):
    """Offline workflow status of a case inside THIS backend.

    Deliberately separate from the observed PayPal dispute status
    (``dispute_status`` / ``lifecycle_stage`` fields on CaseRecord).
    """

    IMPORTED = "IMPORTED"
    ANALYZED = "ANALYZED"
    PROPOSED = "PROPOSED"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REPLAYED = "REPLAYED"
    BLOCKED = "BLOCKED"


class DisputeStatus(str, Enum):
    """Observed PayPal dispute status values seen in fixtures/docs."""

    WAITING_FOR_SELLER_RESPONSE = "WAITING_FOR_SELLER_RESPONSE"
    WAITING_FOR_BUYER_RESPONSE = "WAITING_FOR_BUYER_RESPONSE"
    UNDER_REVIEW = "UNDER_REVIEW"
    RESOLVED = "RESOLVED"
    OTHER = "OTHER"
    UNKNOWN = "UNKNOWN"


class LifecycleStage(str, Enum):
    """``dispute_life_cycle_stage`` values (API_CAPABILITY_MATRIX §7.3)."""

    INQUIRY = "INQUIRY"
    UNDER_PAYPAL_REVIEW = "UNDER_PAYPAL_REVIEW"
    APPEAL = "APPEAL"
    RESOLVED = "RESOLVED"
    UNKNOWN = "UNKNOWN"


class ActionType(str, Enum):
    """Action vocabulary.

    The dispute-side members are the V2 whitelist (S6_1 D3). The two refund
    members are Payments-API family actions: they are deliberately NOT part of
    the dispute whitelist (V2), they are validated by V13–V18 instead, and they
    are executed by the RefundGateway against a capture, never against a
    dispute. A refund is a money movement, not a dispute resolution.
    """

    PROVIDE_EVIDENCE = "provide-evidence"
    SEND_MESSAGE = "send-message"
    MAKE_OFFER = "make-offer"
    ESCALATE = "escalate"
    ACCEPT_CLAIM = "accept-claim"
    PROVIDE_SUPPORTING_INFO = "provide-supporting-info"
    WAIT = "wait"
    # v1.2 payments family (capture-level money actions).
    PARTIAL_REFUND = "partial-refund"
    FULL_REFUND = "full-refund"


class ActionFamily(str, Enum):
    """Which side of PayPal an action touches (contract v1.2, additive).

    ``DISPUTE`` — dispute-side actions (provide-evidence, send-message, …).
    ``PAYMENT`` — capture-level money actions (partial-refund, full-refund).
    The family is always DERIVED from the action type; it is never trusted
    from client input.
    """

    DISPUTE = "DISPUTE"
    PAYMENT = "PAYMENT"


PAYMENT_ACTION_TYPES: tuple[ActionType, ...] = (
    ActionType.PARTIAL_REFUND,
    ActionType.FULL_REFUND,
)

PAYMENT_ACTION_VALUES: frozenset[str] = frozenset(a.value for a in PAYMENT_ACTION_TYPES)

ACTION_FAMILY_BY_TYPE: dict[ActionType, ActionFamily] = {
    ActionType.PROVIDE_EVIDENCE: ActionFamily.DISPUTE,
    ActionType.SEND_MESSAGE: ActionFamily.DISPUTE,
    ActionType.MAKE_OFFER: ActionFamily.DISPUTE,
    ActionType.ESCALATE: ActionFamily.DISPUTE,
    ActionType.ACCEPT_CLAIM: ActionFamily.DISPUTE,
    ActionType.PROVIDE_SUPPORTING_INFO: ActionFamily.DISPUTE,
    ActionType.WAIT: ActionFamily.DISPUTE,
    ActionType.PARTIAL_REFUND: ActionFamily.PAYMENT,
    ActionType.FULL_REFUND: ActionFamily.PAYMENT,
}


def action_family_of(action_type: str) -> ActionFamily:
    """Derive the action family from the action type (never from the client)."""
    try:
        return ACTION_FAMILY_BY_TYPE[ActionType(str(action_type))]
    except ValueError:
        return ActionFamily.DISPUTE


# V2 whitelist exactly as documented in S6_1 D3.
ACTION_WHITELIST: tuple[ActionType, ...] = (
    ActionType.PROVIDE_EVIDENCE,
    ActionType.SEND_MESSAGE,
    ActionType.MAKE_OFFER,
    ActionType.ESCALATE,
    ActionType.ACCEPT_CLAIM,
    ActionType.PROVIDE_SUPPORTING_INFO,
    ActionType.WAIT,
)

# HATEOAS rel names per action (fixture link vocabulary, S7 golden trajectory §2 stage 7).
ACTION_REL: dict[ActionType, str] = {
    ActionType.PROVIDE_EVIDENCE: "provide_evidence",
    ActionType.SEND_MESSAGE: "send_message",
    ActionType.MAKE_OFFER: "make_offer",
    ActionType.ESCALATE: "escalate",
    ActionType.ACCEPT_CLAIM: "accept_claim",
    ActionType.PROVIDE_SUPPORTING_INFO: "provide_supporting_info",
    ActionType.WAIT: "self",  # WAIT needs no write link
}

# Forbidden payload fields, verbatim from S6_1 D2 ("Forbidden payload fields").
FORBIDDEN_PAYLOAD_FIELDS: tuple[str, ...] = (
    "_note",
    "_scenario",
    "source",
    "provenance",
    "debug",
    "comment",
    "metadata",
    "internal_label",
)


class CapabilityBasis(str, Enum):
    """Three-layer capability distinction (Master Prompt §7)."""

    THEORETICAL_DOC = "THEORETICAL_DOC"          # documented capability, not observed here
    FIXTURE_SNAPSHOT = "FIXTURE_SNAPSHOT"        # shown by the offline fixture state
    LIVE_HATEOAS = "LIVE_HATEOAS"                # future real-time GET observation


class EvidenceType(str, Enum):
    """Evidence types referenced by capability matrix §3 / case snapshots."""

    PROOF_OF_FULFILLMENT = "PROOF_OF_FULFILLMENT"
    PROOF_OF_REFUND = "PROOF_OF_REFUND"
    OTHER = "OTHER"
    # Non-PayPal-native case-snapshot evidence categories (offline fixture layer).
    BUYER_STATEMENT = "BUYER_STATEMENT"
    ORDER_RECORD = "ORDER_RECORD"
    CAPTURE_RECORD = "CAPTURE_RECORD"
    SELLER_COMMUNICATION = "SELLER_COMMUNICATION"
    CASE_NOTE = "CASE_NOTE"


class EvidenceSource(str, Enum):
    """``source`` values observed inside dispute ``evidences[]``."""

    REQUESTED_FROM_SELLER = "REQUESTED_FROM_SELLER"
    SUBMITTED_BY_SELLER = "SUBMITTED_BY_SELLER"
    SUBMITTED_BY_BUYER = "SUBMITTED_BY_BUYER"
    UNKNOWN = "UNKNOWN"


class GroundedFactType(str, Enum):
    """Fact classes used by Evidence Grounding (Master Prompt §6 Step 2)."""

    OBSERVED_FACT = "OBSERVED_FACT"
    SUPPORTED_INFERENCE = "SUPPORTED_INFERENCE"
    UNVERIFIED_CLAIM = "UNVERIFIED_CLAIM"
    MISSING_EVIDENCE = "MISSING_EVIDENCE"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class AnalysisMode(str, Enum):
    """Explicit separation of stub vs real LLM output (S7 §3 discipline). v1.3 adds FROZEN_REPLAY for pre-recorded, verified analyses replayed without a model."""

    STUB_DETERMINISTIC = "STUB_DETERMINISTIC"
    LLM = "LLM"  # reserved for FutureLLMProvider; never produced today
    FROZEN_REPLAY = "FROZEN_REPLAY"


class ExecutionMode(str, Enum):
    REPLAY = "REPLAY"      # offline deterministic replay (the only mode today)
    LIVE = "LIVE"          # reserved for future PayPal adapter; never produced today


class ExecutionResult(str, Enum):
    """Outcome of one (replay) execution attempt.

    REPLAYED — the deterministic replay ran to completion (still NOT a PayPal
    success); BLOCKED — pre-execution revalidation or approval-binding check
    refused the write; FAILED — reserved for a gateway-level failure.
    """

    REPLAYED = "REPLAYED"
    BLOCKED = "BLOCKED"
    FAILED = "FAILED"
    # v1.1 additive, LIVE mode only. EXECUTED — the single live request was
    # accepted and a subsequent GET confirmed the remote state. UNVERIFIED —
    # the live outcome is unknown (timeout/disconnect/GET could not confirm);
    # a human must review and the write is NEVER retried. Neither value is
    # ever produced by the offline replay gateway.
    EXECUTED = "EXECUTED"
    UNVERIFIED = "UNVERIFIED"
    # v1.2 additive, LIVE payment actions only (e.g. a refund the processor has
    # accepted but not settled). PENDING is NOT a success: it must be shown as
    # in-progress and reconciled by a later GET, never as executed.
    PENDING = "PENDING"


class ProposalState(str, Enum):
    """Approval state machine (Master Prompt §7)."""

    DRAFT = "DRAFT"
    VALIDATED = "VALIDATED"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    BLOCKED = "BLOCKED"
    REPLAY_EXECUTED = "REPLAY_EXECUTED"
    FAILED = "FAILED"


class ValidationStatus(str, Enum):
    NOT_RUN = "NOT_RUN"
    PASSED = "PASSED"
    FAILED = "FAILED"


class ApprovalDecision(str, Enum):
    PENDING = "PENDING"        # submitted, awaiting manager decision
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class ActorRole(str, Enum):
    """Demo roles. Production auth is a future port (see security/authorization.py)."""

    SPECIALIST = "SPECIALIST"
    MANAGER = "MANAGER"
    SYSTEM = "SYSTEM"


class AuditEventType(str, Enum):
    CASE_IMPORTED = "CASE_IMPORTED"
    ANALYSIS_CREATED = "ANALYSIS_CREATED"
    PROPOSAL_CREATED = "PROPOSAL_CREATED"
    VALIDATION_RECORDED = "VALIDATION_RECORDED"
    PROPOSAL_SUBMITTED = "PROPOSAL_SUBMITTED"
    APPROVAL_DECIDED = "APPROVAL_DECIDED"
    EXECUTION_REPLAYED = "EXECUTION_REPLAYED"
    EXECUTION_BLOCKED = "EXECUTION_BLOCKED"
    # LIVE (sandbox) vocabulary, mirrored by app.adapters.paypal.gateway.
    EXECUTION_ATTEMPT = "EXECUTION_ATTEMPT"
    EXECUTION_VERIFIED = "EXECUTION_VERIFIED"
    EXECUTION_UNKNOWN = "EXECUTION_UNKNOWN"
    CASE_STATE_CHANGED = "CASE_STATE_CHANGED"
    # Demo-only: the offline demo database was restored from its golden copy.
    DEMO_RESET = "DEMO_RESET"


class ActorType(str, Enum):
    """schema.sql action_audit actor_type vocabulary."""

    HUMAN = "HUMAN"
    SYSTEM = "SYSTEM"
    AI = "AI"


# Proposal state machine: legal transitions (domain-enforced).
LEGAL_PROPOSAL_TRANSITIONS: dict[ProposalState, tuple[ProposalState, ...]] = {
    ProposalState.DRAFT: (ProposalState.VALIDATED, ProposalState.BLOCKED),
    ProposalState.VALIDATED: (ProposalState.PENDING_APPROVAL, ProposalState.BLOCKED),
    ProposalState.PENDING_APPROVAL: (ProposalState.APPROVED, ProposalState.REJECTED),
    ProposalState.APPROVED: (
        ProposalState.REPLAY_EXECUTED,
        ProposalState.BLOCKED,
        ProposalState.FAILED,
    ),
    # REJECTED / BLOCKED / REPLAY_EXECUTED / FAILED are terminal.
    ProposalState.REJECTED: (),
    ProposalState.BLOCKED: (),
    ProposalState.REPLAY_EXECUTED: (),
    ProposalState.FAILED: (),
}

# Risk level per action type (planning-time default; manager sees it).
ACTION_RISK_LEVEL: dict[ActionType, RiskLevel] = {
    ActionType.PROVIDE_EVIDENCE: RiskLevel.MEDIUM,
    ActionType.SEND_MESSAGE: RiskLevel.LOW,
    ActionType.MAKE_OFFER: RiskLevel.HIGH,
    ActionType.ESCALATE: RiskLevel.MEDIUM,
    ActionType.ACCEPT_CLAIM: RiskLevel.HIGH,
    ActionType.PROVIDE_SUPPORTING_INFO: RiskLevel.MEDIUM,
    ActionType.WAIT: RiskLevel.LOW,
    # Money leaves the merchant's balance here: always high.
    ActionType.PARTIAL_REFUND: RiskLevel.HIGH,
    ActionType.FULL_REFUND: RiskLevel.HIGH,
}
