/**
 * Adapter layer: Agent A wire format (snake_case) ↔ B UI types (camelCase).
 *
 * This module is the SINGLE place where contract differences are absorbed
 * (FIELD_MAPPING_A_TO_B.md). When Agent A freezes v1 — or ships A-1/A-2/A-3
 * (missing_evidence, response schematisation, unified error model) — only the
 * wire types in `./http/types.ts` and the mappers below change; pages and
 * components never do.
 *
 * Mapping rules implemented here (FIELD_MAPPING references):
 *  §2.1 CaseRecord  §2.2 EvidenceRecord  §2.3 AIAnalysis  §2.4 ActionProposal
 *  §2.5 Approval    §2.6 AuditEvent      §2.7 ReplayResult / ExecutionRecord
 *  §3.1–§3.11 enum vocabularies, R1–R5 naming/money/identifier/hash rules.
 */

import type {
  ActionKind,
  ActionProposal,
  AIAnalysis,
  ApprovalRecord,
  AuditEvent,
  CaseRecord,
  CheckStatus,
  Contradiction,
  DisputeFamily,
  DisputeStatus,
  EvidenceGap,
  EvidenceRecord,
  EvidenceRequirement,
  ExecutionRecord,
  ExecutionVerification,
  GroundedFact,
  GroundingClass,
  HateoasLink,
  HateoasSnapshot,
  LifecycleStage,
  PayloadField,
  PolicyCheck,
  ProposalState,
  Provenance,
  ReplayResult,
  RiskLevel,
  ValidationLevel,
} from "./types";
// Contract v1.1: unknown wire enum values must degrade to UNKNOWN, never success.
import { mapExecutionResult, resolveExecutionResult } from "../lib/executionResult";
import {
  isRefundAction,
  normalizeCaptureSnapshot,
  parseDecimalAmountToMinor,
  refundProposalState,
} from "../lib/refund";
import type {
  WireAnalysis,
  WireApproval,
  WireAuditEvent,
  WireAvailableAction,
  WireCase,
  WireEvidence,
  WireEvidenceRequirement,
  WireExecution,
  WireGroundedFact,
  WirePlan,
  WireProposal,
  WireValidationFinding,
  WireValidationReport,
} from "./http/types";

/* ------------------------------------------------------------------ *
 * Label tables (B-local display vocabulary; A has no label fields)
 * ------------------------------------------------------------------ */

export const REASON_LABEL: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised transaction",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  DUPLICATE_TRANSACTION: "Duplicate transaction",
  INCORRECT_AMOUNT: "Incorrect amount",
  PAYMENT_BY_OTHER_MEANS: "Payment by other means",
  CANCELED_RECURRING_BILLING: "Cancelled recurring billing",
  OTHER: "Other",
};

export const ACTION_LABEL: Record<ActionKind, string> = {
  "send-message": "Send message to buyer",
  "provide-evidence": "Provide evidence (notes branch)",
  "make-offer": "Make offer",
  "accept-claim": "Accept claim",
  escalate: "Escalate",
  "provide-supporting-info": "Provide supporting info",
  wait: "Wait",
  "partial-refund": "Partial refund",
  "full-refund": "Full refund",
};

export const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  PROOF_OF_FULFILLMENT: "Proof of fulfillment",
  PROOF_OF_REFUND: "Proof of refund",
  OTHER: "Other document",
  BUYER_STATEMENT: "Buyer statement",
  ORDER_RECORD: "Order record",
  CAPTURE_RECORD: "Capture record",
  SELLER_COMMUNICATION: "Seller communication",
  CASE_NOTE: "Case note",
};

/** V1–V12 validator labels (same table the mock fixtures use). */
export const CHECK_LABELS: Record<string, string> = {
  V1: "Dispute identity",
  V2: "Action whitelist",
  V3: "HATEOAS permission",
  V4: "Stage / status compatibility",
  V5: "Evidence requirement match",
  V6: "Amount / type bounds",
  V7: "Payload whitelist",
  V8: "Evidence labelling",
  V9: "Snapshot freshness",
  V10: "No-execution invariant",
  V11: "Idempotency readiness",
  V12: "Retry prohibition",
  V13: "Capture identity",
  V14: "Capture refundable",
  V15: "Refund amount bounds",
  V16: "Refund currency",
  V17: "Refund amount precision",
  V18: "No duplicate / unknown refund",
};

/** action_payload dict key → PayloadField label (FIELD_MAPPING §2.4). */
const PAYLOAD_FIELD_LABELS: Record<string, string> = {
  message: "Message body",
  evidence_type: "Evidence type",
  notes: "Notes",
  offer_types: "Offer types",
  amount: "Amount",
  note_to_buyer: "Note to buyer",
  accept_claim_types: "Accept claim types",
  note: "Note",
  idempotency_key: "Request ID",
  capture_id: "Capture ID",
  mode: "Mode",
  currency_code: "Currency",
  reason: "Refund reason",
  original_amount: "Original amount",
  total_refunded: "Total refunded",
  refundable_remaining: "Refundable remaining",
};

const UNKNOWN_TRANSACTION_NOTE =
  "Every transaction identifier is UNKNOWN on the backend (脱敏 discipline). No value is inferred or back-filled.";

const BACKEND_CASE_NOTE =
  "Sourced from the offline replay backend (Agent A). No live PayPal call was made.";

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const ACTION_KINDS: ActionKind[] = [
  "send-message",
  "provide-evidence",
  "make-offer",
  "accept-claim",
  "escalate",
  "provide-supporting-info",
  "wait",
  "partial-refund",
  "full-refund",
];

export const normalizeActionKind = (value: string): ActionKind =>
  (ACTION_KINDS as string[]).includes(value) ? (value as ActionKind) : "wait";

/** Pull an ActionKind out of free text (backend plan alternatives are strings). */
export const parseActionKind = (value: string): ActionKind | undefined =>
  ACTION_KINDS.find((kind) => value.toLowerCase().includes(kind));

const str = (value: unknown): string =>
  value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);

const strArray = (value: unknown): string[] => (Array.isArray(value) ? value.map(str) : []);

const field = (label: string, value: unknown): { label: string; value: string } | null =>
  value === undefined || value === null || value === "" ? null : { label, value: str(value) };

const fields = (...pairs: ({ label: string; value: string } | null)[]): { label: string; value: string }[] =>
  pairs.filter((item): item is { label: string; value: string } => item !== null);

/* ------------------------------------------------------------------ *
 * Enum vocabularies (FIELD_MAPPING §3)
 * ------------------------------------------------------------------ */

/** §3.1: A's ProposalState is authoritative; the UI vocabulary keeps its names. */
const PROPOSAL_STATE_TO_UI: Record<string, ProposalState> = {
  DRAFT: "DRAFT",
  // VALIDATED = "checks passed, not yet submitted" → closest UI state is DRAFT.
  VALIDATED: "DRAFT",
  PENDING_APPROVAL: "AWAITING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  BLOCKED: "BLOCKED",
  // An offline replay is its own state: it is never a live execution.
  REPLAY_EXECUTED: "REPLAYED",
  // Contract v1.2: a payment accepted but not settled is its own state.
  PENDING: "PENDING",
  // FAILED (validation/execution failure) is NOT BLOCKED: blocked means no
  // request was sent; failed means the backend reported a failed attempt.
  FAILED: "FAILED",
};

/**
 * Wire value → UI proposal state. Unknown values become UNKNOWN (never DRAFT);
 * the raw string is preserved in `ActionProposal.backendState` for the tooltip.
 */
export const mapProposalState = (state: string): ProposalState =>
  PROPOSAL_STATE_TO_UI[state] ?? "UNKNOWN";

/**
 * Display state of a proposal, with the execution record taking precedence.
 *
 * `wire.state` alone cannot be displayed honestly: the backend uses
 * REPLAY_EXECUTED for offline replays (which is not a live execution) and
 * collapses a LIVE attempt whose result is unknown into FAILED. When an
 * execution record exists its resolved result decides the state, following the
 * same rule as the badges — an unknown or contradictory combination never
 * reaches EXECUTED.
 */
export const resolveProposalState = (
  state: string,
  execution?: ExecutionRecord,
): ProposalState => {
  const resolved = resolveExecutionResult(execution);
  switch (resolved) {
    case "REPLAYED":
      return "REPLAYED";
    case "EXECUTED":
      return "EXECUTED";
    case "PENDING":
      // Accepted, not settled. Never shown as executed.
      return "PENDING";
    case "FAILED":
      return "FAILED";
    case "BLOCKED":
      return "BLOCKED";
    // UNVERIFIED / UNKNOWN: the request may have landed — never success, and
    // "blocked" would wrongly imply that nothing was sent.
    case "UNVERIFIED":
    case "UNKNOWN":
      return "UNVERIFIED";
    default:
      return mapProposalState(state);
  }
};

/** §3.5 (D-05): fact_type ↔ grounding is a semantic mapping, not a rename. */
const FACT_TYPE_TO_GROUNDING: Record<string, GroundingClass> = {
  OBSERVED_FACT: "VERIFIED_OBSERVATION",
  SUPPORTED_INFERENCE: "AI_INFERENCE",
  UNVERIFIED_CLAIM: "UNVERIFIED_CLAIM",
  MISSING_EVIDENCE: "MISSING",
};

export const mapFactTypeToGrounding = (factType: string): GroundingClass =>
  FACT_TYPE_TO_GROUNDING[factType] ?? "UNKNOWN";

/**
 * Evidence records carry `provenance` (a source dimension), not `grounding`.
 * The UI badge needs a grounding class, so derive the conservative equivalent.
 */
const PROVENANCE_TO_GROUNDING: Record<string, GroundingClass> = {
  PAYPAL_API_OBSERVED: "VERIFIED_OBSERVATION",
  HUMAN_OBSERVED_SANDBOX_UI: "VERIFIED_OBSERVATION",
  SCENARIO_DEFINED: "SCENARIO_DEFINED",
  AI_INFERRED: "AI_INFERENCE",
  SIMULATED_COMPOSITE: "SCENARIO_DEFINED",
};

export const mapProvenanceToGrounding = (provenance: string): GroundingClass =>
  PROVENANCE_TO_GROUNDING[provenance] ?? "UNKNOWN";

/** §2.2: A's source_type → B's direction vocabulary. */
export const mapSourceTypeToDirection = (sourceType: string): EvidenceRecord["direction"] => {
  const value = sourceType.toUpperCase();
  if (value.includes("BUYER")) return "FROM_BUYER";
  if (value.includes("REQUIREMENT")) return "REQUESTED_FROM_SELLER";
  if (value.includes("SNAPSHOT")) return "FROM_CASE_SNAPSHOT";
  if (value.includes("SELLER") || value.includes("MERCHANT")) return "FROM_MERCHANT";
  if (value.includes("PAYPAL") || value.includes("API")) return "FROM_PAYPAL";
  return "FROM_PAYPAL";
};

/** §3.7: validation_status → validation.decision (NOT_RUN → NEEDS_REVIEW). */
export const mapValidationStatusToDecision = (
  status: string,
): "PASS" | "BLOCKED" | "NEEDS_REVIEW" =>
  status === "PASSED" ? "PASS" : status === "FAILED" ? "BLOCKED" : "NEEDS_REVIEW";

/** §3.8 (D-07): canonical check status is SKIPPED; NOT_APPLICABLE maps onto it. */
export const normalizeCheckStatus = (status: string): CheckStatus =>
  status === "PASS" || status === "FAIL" || status === "SKIPPED"
    ? status
    : status === "NOT_APPLICABLE"
      ? "SKIPPED"
      : "SKIPPED";

/** §3.9: `available` ← method POST and a non-theoretical basis. */
export const mapAvailableActionToLink = (action: WireAvailableAction): HateoasLink => ({
  rel: action.rel,
  method: action.method,
  available: action.method === "POST" && action.basis !== "THEORETICAL_DOC",
  // Phase 4: LIVE_HATEOAS vs FIXTURE_SNAPSHOT must stay visible.
  basis: action.basis,
});

export const mapAvailableActionsToHateoas = (
  actions: WireAvailableAction[],
  observedAt: string,
): HateoasSnapshot => {
  const bases = new Set(actions.map((item) => item.basis));
  const source =
    actions.length === 0
      ? "Backend returned no available_actions"
      : bases.size === 1
        ? `Backend available_actions (${actions.length} links, basis ${[...bases][0]})`
        : `Backend available_actions (${actions.length} links, mixed basis)`;
  return {
    observedAt,
    source,
    frozen: actions.length > 0 && bases.size === 1 && bases.has("FIXTURE_SNAPSHOT"),
    links: actions.map(mapAvailableActionToLink),
  };
};

const EMPTY_HATEOAS: HateoasSnapshot = {
  observedAt: "",
  source: "Backend case not loaded",
  frozen: false,
  links: [],
};

/* ------------------------------------------------------------------ *
 * §2.4 payload dict ↔ PayloadField[]
 * ------------------------------------------------------------------ */

const stringifyPayloadValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyPayloadValue).join(", ");
  return JSON.stringify(value);
};

export const mapPayloadDictToFields = (payload: Record<string, unknown>): PayloadField[] =>
  Object.entries(payload).map(([key, value]) => ({
    label: PAYLOAD_FIELD_LABELS[key] ?? key,
    value: stringifyPayloadValue(value),
    confidential: false,
  }));

/* ------------------------------------------------------------------ *
 * §2.4 validation report → checks
 * ------------------------------------------------------------------ */

export const mapValidationFindingToCheck = (finding: WireValidationFinding): PolicyCheck => ({
  id: finding.validator_id,
  label: CHECK_LABELS[finding.validator_id] ?? finding.validator_id,
  status: normalizeCheckStatus(finding.status),
  detail: finding.detail,
  basis: finding.basis,
  docReference: finding.doc_reference,
});

export interface ValidationView {
  decision: "PASS" | "BLOCKED" | "NEEDS_REVIEW";
  checks: PolicyCheck[];
  summary: string;
}

/**
 * Build the UI validation view. `report` is the backend ValidationReportOut
 * (null when the proposal was never validated — NOT_RUN).
 */
export const mapValidationView = (
  status: string,
  report: WireValidationReport | null | undefined,
): ValidationView => {
  const decision = mapValidationStatusToDecision(status);
  const checks = report?.findings?.map(mapValidationFindingToCheck) ?? [];
  if (!report) {
    return {
      decision,
      checks,
      summary:
        status === "NOT_RUN"
          ? "Validation has not run for this proposal yet."
          : "No validation report was returned by the backend.",
    };
  }
  // QA-RC-08: the validator set depends on the action family. A refund is
  // checked by V13–V18, not by the dispute validators — announcing "V1–V12
  // passed" on a refund misstates which rules were applied.
  const ids = (report.findings ?? [])
    .map((finding) => finding.validator_id)
    .filter((id): id is string => typeof id === "string");
  const payment = ids.some((id) => /^V1[3-8]$/.test(id));
  const range = payment ? "V13–V18" : "V1–V12";
  const summary = report.passed
    ? `${range} passed at validation time (backend report).`
    : `Blocked: ${report.blocked_reasons.join("; ")}`;
  return { decision, checks, summary };
};

/* ------------------------------------------------------------------ *
 * §2.1 CaseRecord
 * ------------------------------------------------------------------ */

export interface CaseMapContext {
  evidence: WireEvidence[];
  analyses: WireAnalysis[];
  proposals: WireProposal[];
}

/** B-11: evidence readiness is derived from live records + open requirements. */
export const deriveEvidenceReadiness = (
  evidence: WireEvidence[],
  requirements: WireEvidenceRequirement[],
): CaseRecord["evidenceReadiness"] => {
  // Requirement placeholders (EXPECTED_EVIDENCE_REQUIREMENT) are asks, not records.
  const records = evidence.filter((item) => item.source_type !== "EXPECTED_EVIDENCE_REQUIREMENT");
  const openRequirements = requirements.filter((item) => item.open);
  const provided = records.length;
  const requested = records.length + openRequirements.length;
  const label =
    openRequirements.length === 0
      ? "No open evidence requirements on the backend"
      : `${provided} of ${requested} requested items on file`;
  return { provided, requested, label };
};

/** B-11: nextAction is a local UI hint derived from the backend workflow status. */
export const deriveNextAction = (workflowStatus: string): string => {
  switch (workflowStatus) {
    case "IMPORTED":
      return "Run AI analysis";
    case "ANALYZED":
      return "Review recommendation";
    case "PROPOSED":
      return "Submit for approval";
    case "PENDING_APPROVAL":
      return "Awaiting approval";
    case "APPROVED":
      return "Run replay revalidation";
    case "REJECTED":
      return "Re-plan response";
    case "REPLAYED":
      return "Monitor buyer response";
    case "BLOCKED":
      return "Resolve validator block";
    default:
      return "Review case";
  }
};

const pickLatestProposal = (proposals: WireProposal[]): WireProposal | undefined =>
  proposals.reduce<WireProposal | undefined>(
    (latest, item) => (!latest || item.created_at > latest.created_at ? item : latest),
    undefined,
  );

export const mapCase = (wire: WireCase, ctx: CaseMapContext): CaseRecord => {
  const buyerStatement = ctx.evidence.find((item) => item.evidence_type === "BUYER_STATEMENT");
  const latestProposal = pickLatestProposal(ctx.proposals);
  const tx = wire.transaction_reference;
  return {
    caseId: wire.case_id,
    disputeRef: wire.dispute_id,
    family: wire.family as DisputeFamily,
    reasonCode: wire.reason,
    reasonLabel: REASON_LABEL[wire.reason] ?? wire.reason,
    amountMinor: wire.amount.value_minor,
    currency: wire.amount.currency,
    // B's `status` is the observed dispute status; the workflow status gets its own field.
    status: wire.dispute_status as DisputeStatus,
    lifecycleStage: wire.lifecycle_stage as LifecycleStage,
    // The backend carries no product-name field; scenario_id is the closest stable descriptor.
    itemName: wire.scenario_id,
    // buyerClaim is derived from the BUYER_STATEMENT evidence record (FIELD_MAPPING §2.1).
    buyerClaim: buyerStatement?.content ?? "",
    sellerProtection: undefined,
    transaction: {
      orderRef: tx.order_id,
      captureRef: tx.capture_id,
      captureStatus: "UNKNOWN",
      note: UNKNOWN_TRANSACTION_NOTE,
    },
    openedAt: wire.created_at,
    updatedAt: wire.updated_at,
    evidenceReadiness: deriveEvidenceReadiness(ctx.evidence, wire.evidence_requirements),
    // B-14: status derives from the existence of an analysis record.
    aiReview: ctx.analyses.length > 0 ? "ANALYZED" : "NOT_STARTED",
    // B-11: no case-level risk on the backend; only surfaced when a proposal supplies one.
    risk: latestProposal ? (latestProposal.risk_level as RiskLevel) : undefined,
    nextAction: deriveNextAction(wire.status),
    validationLevel: wire.verification_level as ValidationLevel,
    // B-12: snapshotVersion has no backend source → case_version + snapshot_hash.
    snapshotVersion: `${wire.case_id}/v${wire.case_version}`,
    snapshotHash: wire.snapshot_hash,
    fixtureNote: BACKEND_CASE_NOTE,
    workflowStatus: wire.status,
    provenance: wire.provenance as Provenance,
    caseVersion: wire.case_version,
    liveStatusNote: wire.live_status_note,
    evidenceCount: wire.evidence_count,
    availableActions: wire.available_actions.map(mapAvailableActionToLink),
    evidenceRequirements: wire.evidence_requirements.map((item) => ({
      evidenceType: item.evidence_type,
      sourceExpected: item.source,
      status: item.open ? "OPEN" : "SATISFIED",
    })),
    fulfillmentPosture: wire.fulfillment_posture,
    sellerContacted: wire.seller_contacted,
    scenarioId: wire.scenario_id,
    actionFamily:
      wire.action_family === "PAYMENT" || wire.case_id.trim().toUpperCase().startsWith("CAP-")
        ? "PAYMENT"
        : undefined,
    captureSnapshot: normalizeCaptureSnapshot(wire.capture_snapshot),
  };
};

/* ------------------------------------------------------------------ *
 * §2.2 EvidenceRecord
 * ------------------------------------------------------------------ */

export interface EvidenceMapContext {
  facts: WireGroundedFact[];
}

export const mapEvidence = (wire: WireEvidence, ctx: EvidenceMapContext): EvidenceRecord => ({
  evidenceId: wire.evidence_id,
  caseId: wire.case_id,
  type: wire.evidence_type,
  typeLabel: EVIDENCE_TYPE_LABEL[wire.evidence_type] ?? wire.evidence_type,
  source: wire.source_reference,
  direction: mapSourceTypeToDirection(wire.source_type),
  grounding: mapProvenanceToGrounding(wire.provenance),
  provenance: wire.provenance as Provenance,
  // Backend evidence records exist by definition; "missing" lives in analysis gaps.
  available: true,
  excerpt: wire.content,
  highlight: undefined,
  // supportedFactIds is a B-side reverse lookup over grounded_facts.
  supportedFactIds: ctx.facts
    .filter((fact) => fact.evidence_ids.includes(wire.evidence_id))
    .map((fact) => fact.fact_id),
  collectedAt: wire.observed_at ?? "",
  sha256: wire.integrity_hash ?? undefined,
  note: "Displayed verbatim from the backend evidence record.",
  verificationLevel: wire.verification_level as ValidationLevel,
  sourceType: wire.source_type,
});

/* ------------------------------------------------------------------ *
 * §2.3 AIAnalysis
 * ------------------------------------------------------------------ */

export interface AnalysisMapContext {
  evidence: WireEvidence[];
  requirements: WireEvidenceRequirement[];
}

const normalizeSeverity = (severity: string | undefined): EvidenceGap["severity"] =>
  severity === "HIGH" || severity === "LOW" ? severity : "MEDIUM";

const basisForFact = (fact: WireGroundedFact, evidence: WireEvidence[]): string => {
  const first = evidence.find((item) => fact.evidence_ids.includes(item.evidence_id));
  return first?.source_reference ?? "";
};

/**
 * `plan.raw_recommendation` is optional and additionalProperties:true on the
 * backend plan. It is read defensively: a string becomes a label, an object
 * contributes its own action/label/rationale, anything else is dropped so the
 * UI can say "not provided" instead of inventing a diff.
 */
const mapRawRecommendation = (plan: WirePlan): AIAnalysis["rawRecommendation"] => {
  const readString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  const raw = plan.raw_recommendation;
  if (typeof raw === "string") {
    return readString(raw) ? { actionLabel: readString(raw) } : undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;

  const source = raw as Record<string, unknown>;
  const action = readString(source.action) ?? readString(source.action_type);
  const actionLabel =
    readString(source.action_label) ?? readString(source.label) ?? readString(source.recommendation);
  const rationale = Array.isArray(source.rationale)
    ? source.rationale.map(readString).filter((line): line is string => Boolean(line))
    : [];
  if (!action && !actionLabel && rationale.length === 0) return undefined;
  return {
    action,
    actionLabel,
    rationale: rationale.length > 0 ? rationale : undefined,
  };
};

export const mapAnalysis = (wire: WireAnalysis, ctx: AnalysisMapContext): AIAnalysis => {
  const plan: WirePlan = wire.plan ?? {};
  const action = normalizeActionKind(wire.recommendation || plan.recommended_action || "wait");
  const facts: GroundedFact[] = wire.grounded_facts.map((fact) => ({
    factId: fact.fact_id,
    statement: fact.statement,
    grounding: mapFactTypeToGrounding(fact.fact_type),
    evidenceIds: fact.evidence_ids,
    basis: basisForFact(fact, ctx.evidence),
    evidenceSpan: fact.evidence_span?.trim() ? fact.evidence_span : undefined,
  }));
  const gaps: EvidenceGap[] = (plan.gaps ?? []).map((gap, index) => ({
    gapId: `G-${wire.analysis_id}-${index + 1}`,
    severity: normalizeSeverity(gap.severity),
    title: gap.gap,
    detail: gap.gap,
    requestedType: undefined,
    remedy: undefined,
  }));
  const contradictions: Contradiction[] = wire.contradictions.map((text, index) => ({
    contradictionId: `C-${wire.analysis_id}-${index + 1}`,
    title: text,
    detail: text,
    evidenceIds: [],
  }));
  const requirements: EvidenceRequirement[] = ctx.requirements.map((item) => ({
    evidenceType: item.evidence_type,
    sourceExpected: item.source,
    status: item.open ? "OPEN" : "SATISFIED",
  }));

  return {
    analysisId: wire.analysis_id,
    caseId: wire.case_id,
    generatedAt: wire.created_at,
    status: "READY",
    summary: wire.factual_summary,
    requirements,
    facts,
    gaps,
    contradictions,
    recommendation: {
      action,
      actionLabel: ACTION_LABEL[action],
      strength: undefined,
      rationale: plan.rationale ?? [],
      alternatives: (plan.alternatives ?? []).map((text) => ({
        action: parseActionKind(text) ?? "wait",
        label: text,
        note: "",
      })),
    },
    waitRule: {
      applies: plan.wait_rule_applies ?? false,
      reason: plan.wait_rule_applies
        ? "The backend plan applies the WAIT rule (restraint)."
        : "The backend plan does not apply the WAIT rule.",
    },
    modelLabel: `${wire.model_provider} / ${wire.model_name}`,
    promptLabel: undefined,
    // B-14: analysis-level provenance removed (case/fact level only on the backend).
    provenance: undefined,
    analysisMode: wire.analysis_mode,
    safetyFlags: wire.safety_flags,
    caseSnapshotHash: wire.case_snapshot_hash,
    missingEvidence: wire.missing_evidence,
    uncertainty:
      wire.uncertainty === null || wire.uncertainty === undefined ? undefined : wire.uncertainty,
    rawRecommendation: mapRawRecommendation(plan),
    gateReason:
      typeof plan.gate_reason === "string" && plan.gate_reason.trim()
        ? plan.gate_reason.trim()
        : undefined,
  };
};

/* ------------------------------------------------------------------ *
 * §2.4 ActionProposal
 * ------------------------------------------------------------------ */

export interface ProposalMapContext {
  case?: WireCase;
  approval?: WireApproval;
  execution?: WireExecution;
  validation?: WireValidationReport | null;
}

export const mapProposal = (wire: WireProposal, ctx: ProposalMapContext): ActionProposal => {
  const validation = mapValidationView(wire.validation_status, ctx.validation);
  const approval = ctx.approval;
  const decided = approval !== undefined && approval.decision !== "PENDING";
  const execution = mapExecutionRecord(ctx.execution);
  const action = normalizeActionKind(wire.action_type);
  const payload = wire.action_payload ?? {};
  const captureSnapshot = normalizeCaptureSnapshot(
    payload.capture_snapshot ?? payload.captureSnapshot,
  );
  const rawAmount =
    typeof payload.amount === "string" || typeof payload.amount === "number"
      ? String(payload.amount)
      : undefined;
  const state = isRefundAction(action)
    ? refundProposalState(
        execution,
        {
          captureId: captureSnapshot?.captureId,
          amountMinor: rawAmount ? parseDecimalAmountToMinor(rawAmount) : undefined,
          currency: captureSnapshot?.currencyCode,
        },
        resolveProposalState(wire.state, execution),
      )
    : resolveProposalState(wire.state, execution);
  return {
    proposalId: wire.proposal_id,
    caseId: wire.case_id,
    action,
    actionLabel: ACTION_LABEL[action],
    // Refund state first (EXECUTED requires COMPLETED + matching amount /
    // currency / capture); other actions use the v1.1 execution rule.
    state,
    risk: wire.risk_level as RiskLevel,
    rationale: wire.rationale ?? [],
    evidenceIds: wire.evidence_ids ?? [],
    payload: mapPayloadDictToFields(wire.action_payload ?? {}),
    payloadNote: "Payload rendered from the backend action_payload (V7 whitelisted fields only).",
    // The protected-write discipline is a UI invariant and stays true in http mode.
    requiresApproval: true,
    validation,
    policyRefs: [],
    hateoas: ctx.case
      ? mapAvailableActionsToHateoas(ctx.case.available_actions, ctx.case.updated_at)
      : EMPTY_HATEOAS,
    snapshotVersion: ctx.case ? `${ctx.case.case_id}/v${ctx.case.case_version}` : "",
    snapshotHash: wire.snapshot_hash,
    // ApprovalOut.decided_at falls back to created_at while PENDING, which is
    // the closest available approximation of the submit time.
    submittedBy: approval?.actor_id,
    submittedAt: approval?.decided_at,
    decidedBy: decided ? approval.actor_id : undefined,
    decidedAt: decided ? approval.decided_at : undefined,
    decisionReason: decided ? approval.reason : undefined,
    executedAt: ctx.execution?.created_at,
    blockReason:
      validation.decision === "BLOCKED"
        ? ctx.validation?.blocked_reasons.join("; ") || "Blocked by the deterministic validator."
        : undefined,
    evidenceStatus:
      wire.required_evidence.length > 0
        ? wire.required_evidence.join(", ")
        : "No specific evidence required",
    backendState: wire.state,
    payloadHash: wire.payload_hash,
    policyVersion: wire.policy_version,
    executionAuthorized: wire.execution_authorized,
    validationStatus: wire.validation_status,
    expectedPreconditions: wire.expected_preconditions,
    requiredEvidence: wire.required_evidence,
    actionFamily:
      wire.action_family === "PAYMENT" || isRefundAction(action)
        ? "PAYMENT"
        : wire.action_family === "DISPUTE"
          ? "DISPUTE"
          : undefined,
    captureSnapshot,
    execution,
  };
};

/* ------------------------------------------------------------------ *
 * §2.5 Approval
 * ------------------------------------------------------------------ */

export const mapApproval = (wire: WireApproval): ApprovalRecord => ({
  approvalId: wire.approval_id,
  proposalId: wire.proposal_id,
  caseId: wire.case_id,
  decision: wire.decision,
  reason: wire.reason,
  decidedBy: wire.actor_id,
  decidedAt: wire.decided_at,
  // snapshotVersion has no backend source; case_version + snapshot_hash are used instead.
  snapshotVersion: undefined,
  actorRole: wire.actor_role,
  actionPayloadHash: wire.action_payload_hash,
  caseSnapshotHash: wire.case_snapshot_hash,
  policyVersion: wire.policy_version,
});

/* ------------------------------------------------------------------ *
 * §2.6 AuditEvent — projector by event_type over the heterogeneous payload
 * ------------------------------------------------------------------ */

/** §3.11: A's canonical event_type → B's UI action vocabulary. */
export const mapAuditAction = (eventType: string, payload: Record<string, unknown>): string => {
  switch (eventType) {
    case "CASE_IMPORTED":
      return "CASE_IMPORTED";
    case "ANALYSIS_CREATED":
      return "AI_ANALYSIS_COMPLETED";
    case "PROPOSAL_CREATED":
      return "PROPOSAL_CREATED";
    case "VALIDATION_RECORDED":
      return "VALIDATION_RECORDED";
    case "PROPOSAL_SUBMITTED":
      return "PROPOSAL_SUBMITTED";
    case "APPROVAL_DECIDED":
      return payload.decision === "REJECTED" ? "APPROVAL_REJECTED" : "APPROVAL_GRANTED";
    case "EXECUTION_REPLAYED":
      return "EXECUTION_ATTEMPT";
    case "EXECUTION_ATTEMPT":
      return "EXECUTION_ATTEMPT";
    case "EXECUTION_VERIFIED":
      return "EXECUTION_VERIFIED";
    case "EXECUTION_UNKNOWN":
      return "EXECUTION_UNKNOWN";
    case "EXECUTION_BLOCKED":
      return "REPLAY_REVALIDATION";
    case "CASE_STATE_CHANGED":
      return "CASE_STATE_CHANGED";
    default:
      return eventType;
  }
};

/** outcome has no backend field; derive it from the event type (FIELD_MAPPING §2.6). */
export const mapAuditOutcome = (
  eventType: string,
  payload: Record<string, unknown> = {},
): AuditEvent["outcome"] => {
  if (eventType === "EXECUTION_REPLAYED") return "SUCCEEDED";
  if (eventType === "EXECUTION_VERIFIED") {
    // confirmed=false is a real outcome, not a failure and not a success.
    return payload.confirmed === false ? "INFO" : "SUCCEEDED";
  }
  if (eventType === "EXECUTION_BLOCKED") return "BLOCKED";
  if (eventType === "EXECUTION_UNKNOWN") return "INFO";
  return "INFO";
};

type AuditProjection = Pick<
  AuditEvent,
  | "summary"
  | "detail"
  | "fields"
  | "httpStatus"
  | "requestId"
  | "revalidation"
  | "summaryKey"
  | "summaryParams"
  | "detailKey"
  | "detailParams"
>;

/**
 * QA-RC-08: which validator set produced this report — read from the finding
 * ids, never assumed. Refund actions are V13–V18; everything else V1–V12.
 */
const validationRangeOf = (payload: Record<string, unknown>): string => {
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const ids = findings
    .map((raw) => str((raw as Record<string, unknown>).validator_id))
    .filter((id) => id.length > 0);
  if (ids.length === 0) {
    const type = str(payload.action_type).toLowerCase();
    if (type.includes("refund")) return "V13–V18";
    return "V1–V12";
  }
  return ids.some((id) => /^V1[3-8]$/.test(id)) ? "V13–V18" : "V1–V12";
};

const projectAudit = (wire: WireAuditEvent): AuditProjection => {
  const payload = wire.payload ?? {};
  switch (wire.event_type) {
    case "CASE_IMPORTED":
      return {
        summary: "Case imported from the frozen fixture snapshot",
        summaryKey: "auditEvent.CASE_IMPORTED.summary",
        detail:
          "Import is deterministic and idempotent; the snapshot hash binds the case facts used for every later decision.",
        detailKey: "auditEvent.CASE_IMPORTED.detail",
        fields: fields(
          field("Provenance", payload.provenance),
          field("Verification level", payload.verification_level),
          field("Scenario", payload.scenario_id),
          field("Case version", payload.case_version),
          field("Snapshot hash", payload.snapshot_hash),
        ),
      };
    case "ANALYSIS_CREATED": {
      const mode = str(payload.analysis_mode) || "STUB_DETERMINISTIC";
      const isLlm = mode === "LLM" || mode === "LOCAL_LLM";
      return {
        summary: `AI analysis created (${mode})`,
        summaryKey: "auditEvent.ANALYSIS_CREATED.summary",
        summaryParams: { mode },
        detail: isLlm
          ? "Local LLM inference result. Safety flags, validation and approval fields are attached by the backend trust layer — never by the model."
          : "Deterministic stub analysis — explicitly not a real LLM inference (safety flags travel with the record).",
        detailKey: isLlm
          ? "auditEvent.ANALYSIS_CREATED.detailLlm"
          : "auditEvent.ANALYSIS_CREATED.detailStub",
        fields: fields(
          field("Analysis id", payload.analysis_id),
          field("Mode", payload.analysis_mode),
          field("Model provider", payload.model_provider),
          field("Model", payload.model_name),
          field("Recommendation", payload.recommendation),
          field("Safety flags", strArray(payload.safety_flags).join(" · ")),
          field("Snapshot hash", payload.case_snapshot_hash),
        ),
      };
    }
    case "PROPOSAL_CREATED":
      return {
        summary: `Proposal drafted: ${str(payload.action_type)}`,
        summaryKey: "auditEvent.PROPOSAL_CREATED.summary",
        summaryParams: { action: str(payload.action_type) },
        detail:
          "The proposal is a recommendation object only; nothing is executed at this point.",
        detailKey: "auditEvent.PROPOSAL_CREATED.detail",
        fields: fields(
          field("Proposal id", payload.proposal_id),
          field("Risk level", payload.risk_level),
          field("Payload hash", payload.payload_hash),
          field("Policy version", payload.policy_version),
          field("Snapshot hash", payload.snapshot_hash),
        ),
      };
    case "VALIDATION_RECORDED":
      // QA-RC-08: pick the validator range from the findings themselves — a
      // refund is V13–V18, a dispute action V1–V12.
      return {
        summary: payload.passed
          ? `Validator ${validationRangeOf(payload)} passed`
          : "Validator blocked the proposal",
        summaryKey: payload.passed
          ? validationRangeOf(payload) === "V13–V18"
            ? "auditEvent.VALIDATION_PASSED.summaryRefund"
            : "auditEvent.VALIDATION_PASSED.summary"
          : "auditEvent.VALIDATION_BLOCKED.summary",
        detail:
          "The deterministic validator runs at submit time; blocked proposals never reach PENDING_APPROVAL.",
        detailKey: "auditEvent.VALIDATION_RECORDED.detail",
        fields: fields(
          field("Passed", payload.passed),
          field("Blocked reasons", strArray(payload.blocked_reasons).join("; ")),
          field("Report id", payload.report_id),
        ),
        revalidation: {
          status: payload.passed ? "PASS" : "FAIL",
          checks: (Array.isArray(payload.findings) ? payload.findings : []).map((raw) => {
            const finding = raw as Record<string, unknown>;
            return {
              label: `${str(finding.validator_id)} — ${str(finding.status)}`,
              status: finding.status === "FAIL" ? ("FAIL" as const) : ("PASS" as const),
              note: str(finding.detail),
            };
          }),
        },
      };
    case "PROPOSAL_SUBMITTED":
      return {
        summary: "Submitted for manager approval",
        summaryKey: "auditEvent.PROPOSAL_SUBMITTED.summary",
        detail:
          "The specialist submission binds the action, payload and evidence references to the approval.",
        detailKey: "auditEvent.PROPOSAL_SUBMITTED.detail",
        fields: fields(
          field("Proposal id", payload.proposal_id),
          field("Approval id", payload.approval_id),
          field("Snapshot hash", payload.case_snapshot_hash),
        ),
      };
    case "APPROVAL_DECIDED":
      return {
        summary:
          payload.decision === "REJECTED"
            ? "Manager rejected the proposal"
            : "Manager approved the action",
        summaryKey:
          payload.decision === "REJECTED"
            ? "auditEvent.APPROVAL_REJECTED.summary"
            : "auditEvent.APPROVAL_GRANTED.summary",
        detail:
          "The approval binds the exact payload hash, decision-context hash and policy version.",
        detailKey: "auditEvent.APPROVAL_DECIDED.detail",
        fields: fields(
          field("Decision", payload.decision),
          field("Reason", payload.reason),
          field("Payload hash", payload.action_payload_hash),
          field("Snapshot hash", payload.case_snapshot_hash),
          field("Policy version", payload.policy_version),
        ),
      };
    case "EXECUTION_REPLAYED":
      return {
        summary: "Offline replay executed (simulated — not a PayPal response)",
        summaryKey: "auditEvent.EXECUTION_REPLAYED.summary",
        detail:
          "Single deterministic replay against the frozen fixture state. Revalidation ran immediately before the attempt.",
        detailKey: "auditEvent.EXECUTION_REPLAYED.detail",
        fields: fields(
          field("Execution id", payload.execution_id),
          field("Execution mode", payload.execution_mode),
          field("Simulated", payload.simulated),
          field("Gateway", payload.gateway),
          field("Artifact", payload.artifact),
        ),
        httpStatus: 200,
        requestId: str(payload.request_id) || str(payload.idempotency_key) || undefined,
        revalidation: payload.verification
          ? {
              status: "PASS",
              checks: [
                {
                  label: "Verification method",
                  // QA-RC-03: descriptive, not a verdict that passed.
                  status: "INFO",
                  note: `${str((payload.verification as Record<string, unknown>).method)} (basis: ${str(
                    (payload.verification as Record<string, unknown>).basis,
                  )})`,
                },
              ],
            }
          : undefined,
      };
    case "EXECUTION_ATTEMPT":
      return {
        summary: "Execution request recorded (single attempt)",
        summaryKey: "auditEvent.EXECUTION_ATTEMPT.summary",
        detail:
          "A single request was about to be sent. The outcome is derived from the follow-up GET, never from this event alone.",
        detailKey: "auditEvent.EXECUTION_ATTEMPT.detail",
        fields: fields(
          field("Approval id", payload.approval_id),
          field("Action type", payload.action_type),
          field("Request id", payload.request_id),
          field("Execution mode", payload.execution_mode),
          field("Simulated", payload.simulated),
          field("Precheck", payload.precheck),
        ),
        httpStatus: optionalNumber(payload.http_status),
        requestId: str(payload.request_id) || str(payload.idempotency_key) || undefined,
      };
    case "EXECUTION_VERIFIED": {
      const confirmed = payload.confirmed === true;
      return {
        summary: confirmed
          ? "Remote verification confirmed the result"
          : "Remote verification could not confirm the result",
        summaryKey: confirmed
          ? "auditEvent.EXECUTION_VERIFIED.summary"
          : "auditEvent.EXECUTION_VERIFIED.unconfirmedSummary",
        detail:
          "The GET re-read is a separate step from the request. A confirmed GET is not an adjudication.",
        detailKey: "auditEvent.EXECUTION_VERIFIED.detail",
        fields: fields(
          field("HTTP status", payload.http_status),
          field("Remote status", payload.remote_status),
          field("Confirmed", payload.confirmed),
          field("Observations", payload.observations),
          field("Uncertain reason", payload.uncertain_reason),
        ),
        httpStatus: optionalNumber(payload.http_status),
        requestId: str(payload.request_id) || undefined,
      };
    }
    case "EXECUTION_UNKNOWN":
      return {
        summary: "Execution result unknown — human review required",
        summaryKey: "auditEvent.EXECUTION_UNKNOWN.summary",
        detail:
          "The outcome could not be determined (timeout, disconnect or ambiguous response). No automatic retry was performed; a human must reconcile it.",
        detailKey: "auditEvent.EXECUTION_UNKNOWN.detail",
        fields: fields(
          field("Reason", payload.reason),
          field("HTTP status", payload.http_status),
          field("Next action", payload.next_action),
          field("Request id", payload.request_id),
        ),
        httpStatus: optionalNumber(payload.http_status),
        requestId: str(payload.request_id) || undefined,
      };
    case "EXECUTION_BLOCKED":
      return {
        summary: "Execution blocked at replay time",
        summaryKey: "auditEvent.EXECUTION_BLOCKED.summary",
        detail:
          "Revalidation refused the attempt (hash drift, state conflict or duplicate execution). No request was issued.",
        detailKey: "auditEvent.EXECUTION_BLOCKED.detail",
        fields: fields(
          field("Execution id", payload.execution_id),
          field("Reasons", strArray(payload.reasons).join("; ")),
        ),
        revalidation: {
          status: "FAIL",
          checks: strArray(payload.reasons).map((reason, index) => ({
            label: `Blocking reason ${index + 1}`,
            status: "FAIL" as const,
            note: reason,
          })),
        },
      };
    case "CASE_STATE_CHANGED":
      return {
        summary: "Case state changed (demo/test hook)",
        summaryKey: "auditEvent.CASE_STATE_CHANGED.summary",
        detail:
          "A SYSTEM-role hook simulated a PayPal-side state change; not a PayPal call.",
        detailKey: "auditEvent.CASE_STATE_CHANGED.detail",
        fields: Object.entries(payload).map(([key, value]) => ({ label: key, value: str(value) })),
      };
    default:
      return {
        summary: wire.event_type,
        detail: "Backend event without a dedicated projector; payload fields are shown verbatim.",
        detailKey: "auditEvent.GENERIC.detail",
        fields: Object.entries(payload).map(([key, value]) => ({ label: key, value: str(value) })),
      };
  }
};

/**
 * P0: EXECUTION_REPLAYED carries no `proposal_id` — only
 * `approval_id: "APR-<proposal_id>"`. Without this fallback the execution
 * event cannot be joined to its proposal, so the ledger falls back to
 * "awaiting approval" for a case that already replayed.
 */
export const proposalIdFromPayload = (
  payload: Record<string, unknown>,
): string | undefined => {
  if (typeof payload.proposal_id === "string" && payload.proposal_id) {
    return payload.proposal_id;
  }
  const approvalId = payload.approval_id;
  if (typeof approvalId === "string" && approvalId.startsWith("APR-") && approvalId.length > 4) {
    return approvalId.slice(4);
  }
  return undefined;
};

export const mapAuditEvent = (wire: WireAuditEvent): AuditEvent => {
  const payload = wire.payload ?? {};
  const projection = projectAudit(wire);
  return {
    eventId: wire.event_id,
    caseId: wire.case_id,
    proposalId: proposalIdFromPayload(payload),
    at: wire.created_at,
    actor: { type: wire.actor_type, name: wire.actor_id },
    action: mapAuditAction(wire.event_type, payload),
    environment: "backend_offline_replay",
    outcome: mapAuditOutcome(wire.event_type, payload),
    backendEventType: wire.event_type,
    executionMode: str(payload.execution_mode) || undefined,
    simulated: optionalBoolean(payload.simulated),
    executionConfirmed:
      wire.event_type === "EXECUTION_VERIFIED" ? optionalBoolean(payload.confirmed) : undefined,
    ...projection,
  };
};

/* ------------------------------------------------------------------ *
 * §2.7 ReplayResult ← ExecutionRecord
 * ------------------------------------------------------------------ */

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const optionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const mapVerification = (raw: unknown): ExecutionVerification | undefined => {
  const verification = asRecord(raw);
  if (Object.keys(verification).length === 0) return undefined;
  const observations = asRecord(verification.observations);
  const mappedObservations = Object.keys(observations).length
    ? Object.fromEntries(Object.entries(observations).map(([key, value]) => [key, str(value)]))
    : undefined;
  return {
    method: str(verification.method) || undefined,
    basis: str(verification.basis) || undefined,
    confirmed: optionalBoolean(verification.confirmed),
    // QA-RC-04: snake_case on the wire, kept verbatim — it says whether any
    // remote read-back happened at all (an offline replay performs none).
    remote_readback: optionalBoolean(verification.remote_readback),
    checkedAt: str(verification.checked_at) || undefined,
    remoteStatus: str(verification.remote_status) || undefined,
    observations: mappedObservations,
    uncertainReason: str(verification.uncertain_reason) || undefined,
  };
};

/**
 * ExecutionOut (contract §3) → UI projection. Every value is copied from the
 * backend; `simulated` is never defaulted, because true/false changes what the
 * operator is allowed to believe about the request.
 */
export const mapExecutionRecord = (wire?: WireExecution): ExecutionRecord | undefined => {
  if (!wire) return undefined;
  const response = asRecord(wire.response_snapshot);
  const request = asRecord(wire.request_snapshot);
  return {
    executionId: wire.execution_id,
    executionMode:
      str(wire.execution_mode) || str(response.execution_mode) || undefined,
    simulated:
      optionalBoolean(wire.simulated) ?? optionalBoolean(response.simulated),
    result: mapExecutionResult(str(wire.result)),
    httpStatus:
      optionalNumber(response.http_status) ??
      optionalNumber(wire.http_status),
    requestId:
      str(response.request_id) ||
      str(request.request_id) ||
      str(request.idempotency_key) ||
      undefined,
    at: wire.created_at,
    verification: mapVerification(wire.verification),
    warning: wire.warning,
    gateway: wire.gateway,
  };
};

export const mapExecutionToReplayResult = (execution: WireExecution): ReplayResult => {
  const result = execution.result ?? "";
  const snapshot = execution.response_snapshot ?? {};
  const verification = (execution.verification ?? {}) as Record<string, unknown>;
  const mappedResult = mapExecutionResult(result);
  const live =
    execution.execution_mode === "LIVE" || execution.simulated === false;
  const confirmed = verification.confirmed === true;
  // v1.1: EXECUTED is a success only for a LIVE request whose GET confirmed
  // the remote state; any other EXECUTED record is an unknown result.
  const outcome: ReplayResult["outcome"] =
    mappedResult === "REPLAYED"
      ? "SUCCEEDED"
      : mappedResult === "EXECUTED"
        ? live && confirmed
          ? "SUCCEEDED"
          : "UNVERIFIED"
        : mappedResult === "BLOCKED"
          ? "BLOCKED"
          : mappedResult === "UNVERIFIED" || mappedResult === "UNKNOWN"
            ? "UNVERIFIED"
            : "FAILED";

  // QA-RC-03: `verification.*` is metadata *about* the confirmation method —
  // it is not a validator verdict. Labelling it PASS made an offline replay
  // look like "N/N checks passed". Only the byte-exact comparison is a real
  // check, and only a mismatch is a real FAIL.
  const checks: ReplayResult["revalidation"] = [];
  if (verification.method) {
    checks.push({
      label: "Verification method",
      status: "INFO",
      note: `${str(verification.method)} (basis: ${str(verification.basis) || "unspecified"})`,
    });
  }
  if (verification.state_before) {
    checks.push({ label: "State before", status: "INFO", note: str(verification.state_before) });
  }
  if (verification.state_after_expected) {
    checks.push({
      label: "Expected transition",
      status: "INFO",
      note: str(verification.state_after_expected),
    });
  }
  if (verification.message_byte_exact === false) {
    checks.push({
      label: "Byte-exact comparison",
      status: "FAIL",
      note: "The replayed message did not match the frozen fixture byte-for-byte.",
    });
  }

  const requestId =
    str(execution.request_snapshot?.request_id) ||
    (typeof snapshot.idempotency_key === "string" ? snapshot.idempotency_key : "") ||
    undefined;

  return {
    outcome,
    httpStatus:
      optionalNumber((snapshot as Record<string, unknown>).http_status) ?? 200,
    // Keep the backend disclaimer visible: a replay success is NOT a PayPal success.
    message:
      str(snapshot.note) ||
      execution.warning ||
      `Execution finished with result ${result || "unknown"}.`,
    revalidation: checks,
    executionMode: execution.execution_mode,
    simulated: execution.simulated,
    warning: execution.warning,
    gateway: execution.gateway,
    executionId: execution.execution_id,
    requestId,
  };
};

/** Conflict / validation blocks surfaced through ReplayResult (mirrors the mock contract). */
export const blockedReplayResult = (httpStatus: number, message: string): ReplayResult => ({
  outcome: "BLOCKED",
  httpStatus,
  message,
  revalidation: [],
});
