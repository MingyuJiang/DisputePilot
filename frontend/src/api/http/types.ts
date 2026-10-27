/**
 * Wire-format types for the Agent A backend (snake_case, OpenAPI v1).
 *
 * Source of truth: `integration/reviews/2026-10-17/candidate/openapi.v1.yaml`
 * (+ SCHEMA_V1.md / API_EXAMPLES.md). The candidate is still DRAFT and Agent A
 * is formalising response schemas (A-2) and the error model (A-3), so every
 * field here is deliberately permissive: optional where the schema is loose
 * (`additionalProperties: true` on submit/replay responses) and tolerant of
 * extra keys. When the contract freezes, only this file and `mapping.ts`
 * change — never the UI.
 */

/** Demo actor roles accepted by the backend (X-Actor-Role). */
export type WireActorRole = "SPECIALIST" | "MANAGER" | "SYSTEM";

/**
 * GET /health (PAYPAL_INTERFACE_CONTRACT §1).
 *
 * Only `execution_mode` / `network_access` / `note` are contractual. Extra
 * keys are tolerated and ignored so a newer backend cannot break the shell.
 */
export interface WireHealth {
  execution_mode?: string;
  network_access?: string;
  note?: string;
  [key: string]: unknown;
}

export interface WireMoney {
  value_minor: number;
  currency: string;
  display?: string;
}

export interface WireTransactionReference {
  order_id: string;
  capture_id: string;
  buyer_transaction_id: string;
  dispute_id: string;
}

export interface WireAvailableAction {
  rel: string;
  method: string;
  basis: string;
}

export interface WireEvidenceRequirement {
  evidence_type: string;
  source: string;
  open: boolean;
}

export interface WireCaseSummary {
  case_id: string;
  family: string;
  reason: string;
  status: string;
  amount: WireMoney;
  fulfillment_posture: string;
  provenance: string;
  verification_level: string;
}

export interface WireCase extends WireCaseSummary {
  scenario_id: string;
  dispute_id: string;
  dispute_status: string;
  lifecycle_stage: string;
  transaction_reference: WireTransactionReference;
  seller_contacted: boolean;
  evidence_count: number;
  available_actions: WireAvailableAction[];
  evidence_requirements: WireEvidenceRequirement[];
  case_version: number;
  snapshot_hash: string;
  live_status_note?: string;
  created_at: string;
  updated_at: string;
  /** Contract v1.2 (additive): PAYMENT capture-level case. */
  action_family?: string;
  /** Contract v1.2 (additive): authoritative capture snapshot for PAYMENT cases. */
  capture_snapshot?: Record<string, unknown>;
}

export interface WireEvidence {
  evidence_id: string;
  case_id: string;
  evidence_type: string;
  content: string;
  source_type: string;
  provenance: string;
  verification_level: string;
  source_reference: string;
  observed_at?: string | null;
  integrity_hash?: string | null;
}

export interface WireGroundedFact {
  fact_id: string;
  statement: string;
  fact_type: string;
  evidence_ids: string[];
  provenance: string;
  /**
   * Phase 3 (candidate, optional): verbatim excerpt of the cited evidence.
   * When present the Evidence Drawer highlights it; absence keeps the old
   * behaviour (no highlight is invented).
   */
  evidence_span?: string;
}

export interface WirePlanGap {
  gap: string;
  severity?: string;
}

/** S7 plan schema mirror (SCHEMA_V1.md §3); `plan` is additionalProperties:true. */
export interface WirePlan {
  recommended_action?: string;
  rationale?: string[];
  gaps?: WirePlanGap[];
  alternatives?: string[];
  wait_rule_applies?: boolean;
  [key: string]: unknown;
}

export interface WireAnalysis {
  analysis_id: string;
  case_id: string;
  case_snapshot_hash: string;
  factual_summary: string;
  grounded_facts: WireGroundedFact[];
  missing_evidence: string[];
  contradictions: string[];
  recommendation: string;
  safety_flags: string[];
  model_provider: string;
  model_name: string;
  analysis_mode: string;
  /**
   * Phase 3 (candidate, optional): model-reported uncertainty. Free-form on
   * purpose — the backend may send a label ("medium") or a number. The UI
   * renders it verbatim and never treats it as a calibrated probability.
   */
  uncertainty?: string | number | null;
  created_at: string;
  plan?: WirePlan;
}

export interface WireProposal {
  proposal_id: string;
  case_id: string;
  analysis_id: string;
  action_type: string;
  /** Contract v1.2 (additive): DISPUTE | PAYMENT. */
  action_family?: string;
  action_payload: Record<string, unknown>;
  expected_preconditions: string[];
  required_evidence: string[];
  rationale: string[];
  evidence_ids: string[];
  risk_level: string;
  validation_status: string;
  state: string;
  snapshot_hash: string;
  payload_hash: string;
  policy_version: string;
  execution_authorized: boolean;
  created_at: string;
  updated_at: string;
}

export interface WireApproval {
  approval_id: string;
  proposal_id: string;
  case_id: string;
  action_payload_hash: string;
  case_snapshot_hash: string;
  policy_version: string;
  decision: "PENDING" | "APPROVED" | "REJECTED";
  reason: string;
  actor_id: string;
  actor_role: string;
  decided_at: string;
}

export interface WireValidationFinding {
  validator_id: string;
  status: string;
  detail: string;
  basis: string;
  doc_reference: string;
}

export interface WireValidationReport {
  report_id?: string;
  proposal_id?: string;
  case_id?: string;
  action_type?: string;
  passed: boolean;
  blocked_reasons: string[];
  findings: WireValidationFinding[];
  created_at?: string;
}

export interface WireAuditEvent {
  event_id: string;
  case_id: string;
  event_type: string;
  actor_type: "HUMAN" | "SYSTEM" | "AI";
  actor_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface WireAuditTimeline {
  case_id: string;
  events: WireAuditEvent[];
  append_only?: boolean;
}

/** POST /proposals/{id}/submit — double-layer response (candidate: untyped object). */
export interface WireSubmitResponse {
  proposal: WireProposal;
  approval: WireApproval;
  [key: string]: unknown;
}

/** POST /approvals/{id}/replay + GET execution endpoints (candidate: untyped object). */
export interface WireExecution {
  execution_id?: string;
  proposal_id?: string;
  case_id?: string;
  execution_mode?: string;
  simulated?: boolean;
  result?: string;
  gateway?: string;
  response_snapshot?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  request_snapshot?: Record<string, unknown>;
  warning?: string;
  created_at?: string;
  [key: string]: unknown;
}

/** Unified error envelope (candidate post-A-3); also tolerates the pre-freeze shape. */
export interface WireErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    validation_report?: WireValidationReport;
    /**
     * A-3 leaves the envelope open; Phase 3 puts the internal LLM_* code here
     * (`{"code": "LLM_TIMEOUT", …}`) under HTTP 503 + DOMAIN_ERROR.
     */
    details?: unknown;
  };
  /** FastAPI default request-validation shape: `{"detail": [{loc, msg, type}, …]}`. */
  detail?: unknown;
}
