/**
 * Autopilot API client (MVP-1).
 *
 * Kept outside the synchronous `DisputePilotService` facade on purpose: the
 * autopilot is a batch report, not a cache-mutating workspace action, and the
 * facade's optimistic-cache model would blur "submitted for review" into the
 * approval state. This client returns exactly what the backend answered.
 */

import { createHttpClient, type DemoActor, type HttpClient } from "./http/client";
import { DEFAULT_HTTP_BASE_URL } from "./http/service";
import type { WireActorRole } from "./http/types";

export type TriageDecision =
  | "READY_FOR_REVIEW"
  | "NEEDS_HUMAN"
  | "BLOCKED"
  | "WAIT"
  | "FAILED";

export type ReviewSubmissionStatus =
  | "SUBMITTED_FOR_REVIEW"
  | "ALREADY_SUBMITTED"
  | "SKIPPED_NOT_ELIGIBLE"
  | "BLOCKED_VALIDATION"
  | "BLOCKED_STALE"
  | "FAILED";

export interface AutopilotAnalysis {
  analysis_id: string;
  analysis_mode: string;
  model_provider: string;
  model_name: string;
  factual_summary: string;
  recommendation: string;
  raw_recommendation: string | null;
  effective_action: string | null;
  grounded_fact_count: number;
  missing_evidence: string[];
  contradictions: string[];
  safety_flags: string[];
  gaps: string[];
}

export interface AutopilotCandidate {
  proposal_id: string;
  action_type: string;
  action_family: string;
  state: string;
  risk_level: string;
  validation_status: string;
  required_evidence: string[];
  evidence_ids: string[];
  execution_authorized: boolean;
  payload_hash?: string | null;
  snapshot_hash?: string | null;
}

export interface AutopilotFinding {
  validator_id: string;
  status: string;
  detail: string;
}

export interface AutopilotValidation {
  report_id: string;
  passed: boolean;
  blocked_reasons: string[];
  checked: number;
  failed: number;
  findings: AutopilotFinding[];
}

export interface AutopilotEvidence {
  sufficient: boolean;
  missing_evidence: string[];
  missing_facts: string[];
}

export interface AutopilotPolicy {
  blocked: boolean;
  code: string | null;
}

export interface AutopilotCaseResult {
  case_id: string;
  decision: TriageDecision;
  decision_reasons: string[];
  reason_codes: string[];
  requires_human: boolean;
  executed: boolean;
  analysis: AutopilotAnalysis | null;
  candidate_actions: AutopilotCandidate[];
  validator: AutopilotValidation | null;
  evidence: AutopilotEvidence | null;
  policy: AutopilotPolicy;
  business_refs: Record<string, unknown>;
  capture_facts: Record<string, unknown> | null;
  error: { type: string; message: string } | null;
}

export interface AutopilotRun {
  run_id: string;
  mode: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  requested_case_ids: string[];
  total_cases: number;
  analyzed_cases: number;
  ready_for_review_cases: number;
  needs_human_cases: number;
  blocked_cases: number;
  wait_cases: number;
  failed_cases: number;
  executed_actions: number;
  results: AutopilotCaseResult[];
  started_at: string;
  finished_at: string;
  idempotent_replay: boolean;
}

export interface AutopilotSubmitCase {
  case_id: string;
  run_decision: TriageDecision | null;
  status: ReviewSubmissionStatus;
  reason_code: string | null;
  reasons: string[];
  proposal_id: string | null;
  approval_id: string | null;
  proposal_state: string | null;
  approval_decision: string | null;
  action_payload_hash: string | null;
  case_snapshot_hash: string | null;
  validation_report_id: string | null;
  validator: { report_id: string; passed: boolean } | null;
  created_at: string | null;
  error: { type: string; message: string } | null;
}

export interface AutopilotSubmitResult {
  run_id: string;
  mode: string | null;
  status: "COMPLETED" | "PARTIAL" | "NOTHING_SUBMITTED" | "FAILED";
  requested_case_ids: string[];
  total_cases: number;
  /** QA-RC-07: how many cases the run covered, including non-candidates. */
  run_case_count?: number;
  /** Cases of the run that were never submission candidates. */
  excluded_cases?: number;
  submitted_cases: number;
  already_submitted_cases: number;
  skipped_cases: number;
  blocked_cases: number;
  failed_cases: number;
  executed_actions: number;
  results: AutopilotSubmitCase[];
  submitted_at: string;
  idempotent_replay: boolean;
  submission_batch_id: string | null;
  idempotency_key: string | null;
  request_fingerprint: string | null;
  actor_id: string | null;
}

/** A stored batch, read from the database through the query endpoints. */
export interface AutopilotSubmissionBatch {
  submission_batch_id: string;
  run_id: string;
  idempotency_key: string | null;
  request_fingerprint: string;
  status: "COMPLETED" | "PARTIAL" | "NOTHING_SUBMITTED" | "FAILED";
  total_cases: number;
  run_case_count?: number;
  excluded_cases?: number;
  submitted_cases: number;
  already_submitted_cases: number;
  skipped_cases: number;
  blocked_cases: number;
  failed_cases: number;
  actor_id: string;
  executed_actions: number;
  results: AutopilotSubmitCase[];
  submitted_at: string;
}

export interface AutopilotApi {
  readonly actor: DemoActor;
  createRun(caseIds: string[]): Promise<AutopilotRun>;
  getRun(runId: string): Promise<AutopilotRun>;
  submitForReview(runId: string, caseIds?: string[]): Promise<AutopilotSubmitResult>;
  listSubmissionBatches(runId: string): Promise<AutopilotSubmissionBatch[]>;
  getSubmissionBatch(batchId: string): Promise<AutopilotSubmissionBatch>;
}

const TARGET: "offline-demo" | "sandbox" | "unknown" =
  (import.meta.env.VITE_DP_API_TARGET as "offline-demo" | "sandbox" | undefined) ?? "unknown";

export { TARGET as AUTOPILOT_TARGET };

/**
 * The five offline demo cases are a convenience default for the input field,
 * not a decision table: every outcome still comes from the backend.
 */
export const DEMO_CASE_IDS = [
  "DEMO-INR-O7",
  "DEMO-SNAD-O13",
  "DEMO-BILL-O16",
  "DEMO-BLOCK-O9",
  "CAP-DEMO-9001",
] as const;

const defaultActor = (): DemoActor => ({
  id: import.meta.env.VITE_DP_ACTOR_ID ?? "demo-specialist",
  role: (import.meta.env.VITE_DP_ACTOR_ROLE as WireActorRole | undefined) ?? "SPECIALIST",
});

export const createAutopilotApi = (options: {
  baseUrl?: string;
  actor?: DemoActor;
  fetch?: typeof fetch;
} = {}): AutopilotApi => {
  const client: HttpClient = createHttpClient({
    baseUrl: options.baseUrl ?? import.meta.env.VITE_DP_API_BASE ?? DEFAULT_HTTP_BASE_URL,
    actor: options.actor ?? defaultActor(),
    fetch: options.fetch,
  });

  return {
    get actor() {
      return client.actor;
    },
    createRun: (caseIds) =>
      client.post<AutopilotRun>("/autopilot/runs", {
        case_ids: caseIds,
        mode: "TRIAGE_ONLY",
      }),
    getRun: (runId) => client.get<AutopilotRun>(`/autopilot/runs/${runId}`),
    submitForReview: (runId, caseIds) =>
      client.post<AutopilotSubmitResult>(
        `/autopilot/runs/${runId}/submit-for-review`,
        { case_ids: caseIds ?? null },
      ),
    listSubmissionBatches: (runId) =>
      client.get<AutopilotSubmissionBatch[]>(
        `/autopilot/runs/${runId}/submission-batches`,
      ),
    getSubmissionBatch: (batchId) =>
      client.get<AutopilotSubmissionBatch>(
        `/autopilot/submission-batches/${batchId}`,
      ),
  };
};
