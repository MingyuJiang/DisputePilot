/**
 * Provisional frontend domain types.
 *
 * These types are a UI-side projection, NOT the frozen contract.
 * Agent A owns OpenAPI v1 (`contracts/v1`); the http adapter in
 * `src/api/http/` maps the backend wire format onto these types.
 * Everything here is accessed through `src/api/index.ts` so the
 * mapping can be replaced without touching page components.
 *
 * Money is always minor units + ISO-4217, per schema.sql.
 *
 * Additive fields marked `optional` exist so the HTTP adapter can carry
 * backend-only values (provenance, hashes, execution marks) without the
 * mock fixtures having to invent them.
 */

export type DisputeFamily = "INR" | "SNAD" | "BILLING";

export type ValidationLevel =
  | "FROZEN_SANDBOX_E1_VERIFIED"
  | "SCENARIO_DEFINED_OFFLINE_CONTENT"
  | "NEGATIVE_CONTROL_REJECTION_TEST_ONLY"
  /** A's ValidationLevel adds UNKNOWN as the default value (FIELD_MAPPING §3.4). */
  | "UNKNOWN";

/**
 * Provenance labels are mutually exclusive and must never be blended
 * (README_WORKSPACE §5).
 */
export type Provenance =
  | "PAYPAL_API_OBSERVED"
  | "HUMAN_OBSERVED_SANDBOX_UI"
  | "SCENARIO_DEFINED"
  | "AI_INFERRED"
  | "SIMULATED_COMPOSITE";

/** What the UI is allowed to claim about a piece of information. */
export type GroundingClass =
  | "VERIFIED_OBSERVATION"
  | "SCENARIO_DEFINED"
  | "AI_INFERENCE"
  | "MISSING"
  | "UNKNOWN"
  /**
   * D-05: A's UNVERIFIED_CLAIM has no B equivalent; the http adapter maps
   * GroundedFactType.UNVERIFIED_CLAIM here so the claim stays visible as
   * unverified instead of being silently upgraded.
   */
  | "UNVERIFIED_CLAIM";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export type DisputeStatus =
  | "WAITING_FOR_SELLER_RESPONSE"
  | "WAITING_FOR_BUYER_RESPONSE"
  | "UNDER_REVIEW"
  | "REQUIRED_ACTION"
  | "RESOLVED"
  /** A's observed vocabulary also contains OTHER / UNKNOWN (FIELD_MAPPING §3.2). */
  | "OTHER"
  | "UNKNOWN";

export type LifecycleStage =
  | "INQUIRY"
  | "CHARGEBACK"
  | "PRE_ARBITRATION"
  /** A's lifecycle vocabulary (FIELD_MAPPING §3.3); B's legacy values stay for mock fixtures. */
  | "UNDER_PAYPAL_REVIEW"
  | "APPEAL"
  | "RESOLVED"
  | "UNKNOWN";

export type AIReviewState = "NOT_STARTED" | "RUNNING" | "ANALYZED";

export type ActionKind =
  | "provide-evidence"
  | "send-message"
  | "make-offer"
  | "accept-claim"
  | "escalate"
  | "provide-supporting-info"
  | "wait"
  /** Contract v1.2 PAYMENT actions: capture-level money movement. */
  | "partial-refund"
  | "full-refund";

/** Contract v1.2 `action_family`: a refund never resolves the dispute. */
export type ActionFamily = "DISPUTE" | "PAYMENT";

export type ProposalState =
  | "DRAFT"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  /** A LIVE execution whose follow-up GET confirmed the remote state. */
  | "EXECUTED"
  /** Offline replay (simulated) — never a PayPal execution. */
  | "REPLAYED"
  /** A LIVE attempt whose result could not be confirmed (no auto-retry). */
  | "UNVERIFIED"
  /** A payment accepted but not yet settled — never a success state. */
  | "PENDING"
  /** A LIVE attempt the backend reported as failed. */
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED"
  /**
   * A wire value the UI does not recognise. It is preserved verbatim in
   * `backendState` and must never be normalised into DRAFT or a success state.
   */
  | "UNKNOWN";

export type CheckStatus = "PASS" | "FAIL" | "NOT_APPLICABLE" | "SKIPPED";

export interface TransactionRef {
  orderRef: string;
  captureRef: string;
  captureStatus: string;
  note: string;
}

export interface EvidenceReadiness {
  /** Items on file that actually exist as records. */
  provided: number;
  /** Items the current evidence requirement asks for. */
  requested: number;
  label: string;
}

export interface CaseRecord {
  caseId: string;
  disputeRef: string;
  family: DisputeFamily;
  reasonCode: string;
  reasonLabel: string;
  amountMinor: number;
  currency: string;
  status: DisputeStatus;
  lifecycleStage: LifecycleStage;
  itemName: string;
  buyerClaim: string;
  sellerProtection?: string;
  transaction: TransactionRef;
  openedAt: string;
  updatedAt: string;
  evidenceReadiness: EvidenceReadiness;
  aiReview: AIReviewState;
  /**
   * B-11: no backend source at case level. In http mode this stays empty
   * unless a proposal supplies a risk level; it is never fabricated.
   */
  risk?: RiskLevel;
  nextAction: string;
  validationLevel: ValidationLevel;
  snapshotVersion: string;
  snapshotHash: string;
  fixtureNote: string;

  // ---- Backend-only fields (http adapter; optional so mock fixtures stay as-is) ----
  /** A's offline workflow status (IMPORTED/ANALYZED/…/REPLAYED/BLOCKED). */
  workflowStatus?: string;
  /** Five-layer provenance label of the case content (A: `provenance`). */
  provenance?: Provenance;
  /** A's `case_version` (import = 1); rendered with snapshotHash instead of snapshotVersion. */
  caseVersion?: number;
  /** A's `live_status_note` (Sol owns live status). */
  liveStatusNote?: string;
  /** A's `evidence_count` (record count, not a readiness ratio). */
  evidenceCount?: number;
  /** Case-level available actions (A: `available_actions`). */
  availableActions?: HateoasLink[];
  /** Case-level evidence requirements (A: `evidence_requirements`). */
  evidenceRequirements?: EvidenceRequirement[];
  /** A's `fulfillment_posture`. */
  fulfillmentPosture?: string;
  /** A's `seller_contacted` (conservative mapping of the buyer form). */
  sellerContacted?: boolean;
  /** A's `scenario_id`; http mode surfaces it as itemName (no product-name field exists). */
  scenarioId?: string;
  /** Contract v1.2: PAYMENT marks capture-level cases (`CAP-<capture_id>`). */
  actionFamily?: ActionFamily;
  /** Authoritative capture snapshot when the backend / fixture supplies one. */
  captureSnapshot?: CaptureSnapshot;
}

export interface EvidenceRecord {
  evidenceId: string;
  caseId: string;
  type: string;
  typeLabel: string;
  source: string;
  direction:
    | "FROM_BUYER"
    | "FROM_PAYPAL"
    | "FROM_MERCHANT"
    | "REQUESTED_FROM_SELLER"
    /** A's CASE_SNAPSHOT source has no B equivalent (FIELD_MAPPING §2.2). */
    | "FROM_CASE_SNAPSHOT";
  grounding: GroundingClass;
  provenance: Provenance;
  available: boolean;
  excerpt: string;
  /** Substring inside `excerpt` that supports the selected claim. */
  highlight?: string;
  supportedFactIds: string[];
  collectedAt: string;
  sha256?: string;
  note: string;
  /** A's `verification_level` (evidence-level; may differ from the case level). */
  verificationLevel?: ValidationLevel;
  /** A's raw `source_type` before the direction mapping. */
  sourceType?: string;
}

export interface GroundedFact {
  factId: string;
  statement: string;
  grounding: GroundingClass;
  evidenceIds: string[];
  basis: string;
  /**
   * Phase 3: verbatim excerpt of the cited evidence (`evidence_span`). Used by
   * the Evidence Drawer to highlight the supporting sentence; absent when the
   * backend did not supply one.
   */
  evidenceSpan?: string;
}

export interface EvidenceGap {
  gapId: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  detail: string;
  /** A's plan.gaps carry no requestedType/remedy; both stay empty in http mode. */
  requestedType?: string;
  remedy?: string;
}

export interface Contradiction {
  contradictionId: string;
  title: string;
  detail: string;
  evidenceIds: string[];
}

export interface EvidenceRequirement {
  evidenceType: string;
  sourceExpected: string;
  status: "OPEN" | "SATISFIED";
}

export interface RecommendedAction {
  action: ActionKind;
  actionLabel: string;
  /** No backend source (A's plan has no strength); http mode leaves it empty. */
  strength?: "STRONG" | "CONDITIONAL" | "WEAK";
  rationale: string[];
  alternatives: { action: ActionKind; label: string; note: string }[];
}

export interface AIAnalysis {
  analysisId: string;
  caseId: string;
  generatedAt: string;
  status: "READY" | "RUNNING" | "NOT_STARTED";
  summary: string;
  requirements: EvidenceRequirement[];
  facts: GroundedFact[];
  gaps: EvidenceGap[];
  contradictions: Contradiction[];
  recommendation: RecommendedAction;
  waitRule: { applies: boolean; reason: string };
  modelLabel: string;
  promptLabel?: string;
  /**
   * B-14: analysis-level provenance is removed in http mode (A sets provenance
   * on the case and on each fact, not on the analysis).
   */
  provenance?: Provenance;

  // ---- Backend-only fields (http adapter) ----
  /**
   * A's `analysis_mode` (v1.3: STUB_DETERMINISTIC | LLM | FROZEN_REPLAY); must
   * stay visible (S7 §3). FROZEN_REPLAY is a pre-recorded analysis replayed
   * offline — it is never a live model result.
   */
  analysisMode?: string;
  /** A's `safety_flags` (includes the "not a real LLM" declaration). */
  safetyFlags?: string[];
  /** A's `case_snapshot_hash` — the decision-context hash approvals bind to. */
  caseSnapshotHash?: string;
  /** A's `missing_evidence` (verbatim snapshot gaps; supplementary to `gaps`). */
  missingEvidence?: string[];
  /**
   * Phase 3 (optional): model-reported uncertainty, rendered verbatim.
   * Never presented as a calibrated probability or a policy signal.
   */
  uncertainty?: string | number;
  /**
   * The model's recommendation before the deterministic gate rewrote it.
   * Optional and only mapped when the backend actually sends `plan.raw_recommendation`;
   * the UI never reconstructs it, and shows "not provided" when absent.
   */
  rawRecommendation?: RawRecommendation;
  /** Why the effective recommendation differs from the raw one (`plan.gate_reason`). */
  gateReason?: string;
}

/** Raw model recommendation (pre-gate), kept verbatim for the diff view. */
export interface RawRecommendation {
  action?: string;
  actionLabel?: string;
  rationale?: string[];
}

export interface PolicyCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** A's finding `basis` (FIXTURE_SNAPSHOT / …); preserved for display. */
  basis?: string;
  /** A's finding `doc_reference` (policy document anchor). */
  docReference?: string;
}

export interface HateoasLink {
  rel: string;
  method: string;
  available: boolean;
  /**
   * A's `available_actions[].basis` (LIVE_HATEOAS | FIXTURE_SNAPSHOT | …).
   * Kept verbatim so the UI can say whether the link set came from the current
   * remote response or a frozen snapshot — and never claims the wrong one.
   */
  basis?: string;
}

/**
 * Contract v1.1 `ExecutionResult`.
 *
 * EXECUTED applies to LIVE mode only and requires a later GET to confirm the
 * remote state; UNVERIFIED means the request may have landed but the result is
 * unknown (human review, no automatic retry). REPLAYED is offline only and is
 * never a PayPal response. `UNKNOWN` is the UI-side downgrade for any value the
 * frontend does not recognise: it must never be treated as success.
 */
export type ExecutionResult =
  | "REPLAYED"
  | "BLOCKED"
  | "FAILED"
  | "EXECUTED"
  | "UNVERIFIED"
  /** Accepted by the gateway but not settled yet — must never count as success. */
  | "PENDING"
  | "UNKNOWN";

/**
 * ExecutionOut projection (PAYPAL_INTERFACE_CONTRACT §3).
 *
 * `execution_mode` and `simulated` are rendered as separate facts; the UI
 * must never collapse request + verification into one "success".
 */
export interface ExecutionVerification {
  /** LIVE_GET for a Sandbox execution; FIXTURE_SNAPSHOT for offline replay. */
  method?: string;
  /** LIVE_HATEOAS | REMOTE_GET | FIXTURE_SNAPSHOT (contract v1.1). */
  basis?: string;
  /** true = the GET re-read confirmed the remote state; false = unknown. */
  confirmed?: boolean;
  /** QA-RC-04: false = this run never read the remote state back at all. */
  remote_readback?: boolean;
  checkedAt?: string;
  remoteStatus?: string;
  observations?: Record<string, string>;
  uncertainReason?: string;
}

export interface ExecutionRecord {
  executionId?: string;
  /** REPLAY | LIVE (raw backend value; never inferred). */
  executionMode?: string;
  /** true only for offline replay; false is a real Sandbox request. */
  simulated?: boolean;
  /** EXECUTED | UNVERIFIED | BLOCKED | FAILED | REPLAYED; unknown wire values map to UNKNOWN. */
  result?: ExecutionResult;
  httpStatus?: number;
  requestId?: string;
  at?: string;
  verification?: ExecutionVerification;
  warning?: string;
  gateway?: string;
}

export interface HateoasSnapshot {
  observedAt: string;
  source: string;
  /** true when the link set comes from a frozen fixture, not a live GET. */
  frozen: boolean;
  links: HateoasLink[];
}

export interface PayloadField {
  label: string;
  value: string;
  confidential?: boolean;
}

/**
 * Contract v1.2 authoritative capture snapshot.
 *
 * The client never computes these values: the backend reads the capture after
 * the draft request and back-fills the snapshot it used for validation and
 * hashing. Amounts stay decimal strings so no minor-unit rounding can drift.
 */
export interface CaptureSnapshot {
  captureId: string;
  originalAmount: string;
  totalRefunded: string;
  refundableRemaining: string;
  currencyCode: string;
  status: string;
}

/**
 * Draft input for a client-authored refund proposal (action_family=PAYMENT).
 *
 * Only the fields the contract accepts are sent: `{capture_id, mode, amount?,
 * currency_code, reason, idempotency_key}`. The backend reads the capture and
 * owns the authoritative snapshot, amount bounds and payload hash.
 */
export interface RefundDraftInput {
  caseId: string;
  captureId: string;
  mode: "partial" | "full";
  /** Required for `partial`; omitted for `full` (the server refunds the remainder). */
  amount?: string;
  currencyCode: string;
  reason: string;
  /** Demo identity recorded on the proposal / approval. */
  actor: string;
  /** Fixed key derived from case + capture + mode + amount + reason. */
  idempotencyKey: string;
  /** Latest analysis id; required by the backend, resolved from the case when omitted. */
  analysisId?: string;
}

export interface ActionProposal {
  proposalId: string;
  caseId: string;
  action: ActionKind;
  actionLabel: string;
  state: ProposalState;
  risk: RiskLevel;
  rationale: string[];
  evidenceIds: string[];
  payload: PayloadField[];
  payloadNote: string;
  requiresApproval: boolean;
  validation: {
    decision: "PASS" | "BLOCKED" | "NEEDS_REVIEW";
    checks: PolicyCheck[];
    summary: string;
  };
  policyRefs: { id: string; text: string }[];
  hateoas: HateoasSnapshot;
  snapshotVersion: string;
  snapshotHash: string;
  submittedBy?: string;
  submittedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionReason?: string;
  executedAt?: string;
  blockReason?: string;
  evidenceStatus: string;

  // ---- Backend-only fields (http adapter) ----
  /** A's raw ProposalState before the UI-vocabulary mapping (FIELD_MAPPING §3.1). */
  backendState?: string;
  /** A's `payload_hash` (approval binding core). */
  payloadHash?: string;
  /** A's `policy_version` at proposal time. */
  policyVersion?: string;
  /** A's `execution_authorized` (false until a manager approves). */
  executionAuthorized?: boolean;
  /** A's raw `validation_status` (NOT_RUN/PASSED/FAILED). */
  validationStatus?: string;
  /** A's `expected_preconditions`. */
  expectedPreconditions?: string[];
  /** A's `required_evidence` (evidence type names). */
  requiredEvidence?: string[];

  // ---- Contract v1.2: payment (refund) proposals ----
  /** PAYMENT actions are capture-level money movement, never dispute resolution. */
  actionFamily?: ActionFamily;
  /** Server back-filled capture snapshot (authoritative bounds for the amount). */
  captureSnapshot?: CaptureSnapshot;

  // ---- Phase 4: execution / verification separation ----
  /** ExecutionOut projection; absent until the proposal has an execution record. */
  execution?: ExecutionRecord;
}

/**
 * Draft input for a client-authored `send-message` proposal.
 *
 * The UI never builds the wire body itself: the adapter maps this onto
 * `POST /cases/{id}/proposals` with `action_payload = {message, idempotency_key}`.
 */
export interface SendMessageDraftInput {
  caseId: string;
  message: string;
  /** Demo identity recorded on the proposal / approval. */
  actor: string;
  /** Latest analysis id; the backend requires one. */
  analysisId?: string;
  rationale?: string[];
  evidenceIds?: string[];
  expectedPreconditions?: string[];
}

export interface ApprovalRecord {
  approvalId: string;
  proposalId: string;
  caseId: string;
  /** A's ApprovalDecision includes PENDING (the approval-queue data source, B-8). */
  decision: "APPROVED" | "REJECTED" | "PENDING";
  reason: string;
  decidedBy: string;
  decidedAt: string;
  /** No backend source in http mode (case_version + snapshot_hash are used instead). */
  snapshotVersion?: string;
  /** A's `actor_role` (MANAGER decides; SPECIALIST submits). */
  actorRole?: string;
  /** M4: approval binds the exact payload / decision context / policy version. */
  actionPayloadHash?: string;
  caseSnapshotHash?: string;
  policyVersion?: string;
}

export type AuditOutcome =
  | "SUCCEEDED"
  | "FAILED"
  | "BLOCKED"
  | "EXPIRED"
  | "DUPLICATE_SUPPRESSED"
  | "INFO";

export interface AuditEvent {
  eventId: string;
  caseId: string;
  proposalId?: string;
  at: string;
  actor: { type: "HUMAN" | "SYSTEM" | "AI"; name: string };
  action: string;
  /** http mode marks events as backend-sourced instead of local_simulation. */
  environment: "local_simulation" | "backend_offline_replay";
  outcome: AuditOutcome;
  summary: string;
  detail: string;
  /**
   * Presentation metadata for adapter-built events. The English `summary` /
   * `detail` stay as the canonical fallback (search, legacy fixtures); when
   * present these keys are rendered through `t()` so the title follows the UI
   * language while the technical event name stays visible in `action`.
   */
  summaryKey?: string;
  summaryParams?: Record<string, string | number>;
  detailKey?: string;
  detailParams?: Record<string, string | number>;
  fields: { label: string; value: string }[];
  httpStatus?: number;
  requestId?: string;
  revalidation?: {
    status: "PASS" | "FAIL";
    /** INFO = descriptive metadata, not a validator verdict. */
    checks: { label: string; status: "PASS" | "FAIL" | "INFO" | "SKIPPED"; note: string }[];
  };
  /** A's raw event_type before the UI-vocabulary mapping (FIELD_MAPPING §3.11). */
  backendEventType?: string;
  /** Phase 4: execution metadata projected from the audit payload. */
  executionMode?: string;
  simulated?: boolean;
  /** EXECUTION_VERIFIED payload `confirmed`; absent when not reported. */
  executionConfirmed?: boolean;
}

export interface ReplayResult {
  /** UNVERIFIED = the request may have landed but the GET could not confirm it. */
  outcome: "SUCCEEDED" | "FAILED" | "BLOCKED" | "EXPIRED" | "UNVERIFIED";
  httpStatus: number;
  message: string;
  revalidation: {
    label: string;
    /**
     * PASS / FAIL are validator verdicts. INFO is descriptive metadata the
     * backend reported alongside the run (verification method, expected
     * transition) — it is NOT a check that passed.
     */
    status: "PASS" | "FAIL" | "INFO" | "SKIPPED";
    note: string;
  }[];

  // ---- Backend-only fields (http adapter; S7 §3 / M-display discipline) ----
  /** A's `execution_mode` (always REPLAY in the offline backend). */
  executionMode?: string;
  /** A's `simulated` — always true; a replay success is NOT a PayPal success. */
  simulated?: boolean;
  /** A's `warning` ("OFFLINE REPLAY result — not a PayPal API response"). */
  warning?: string;
  /** A's `gateway` (ReplayExecutionGateway). */
  gateway?: string;
  /** A's `execution_id`. */
  executionId?: string;
  /** Request id echoed by the replay (request_snapshot / payload). */
  requestId?: string;
}
