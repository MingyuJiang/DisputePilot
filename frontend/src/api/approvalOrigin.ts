/**
 * Approval provenance client (MVP-1.2).
 *
 * Read-only: it answers "where did this approval come from?" from the stored
 * batch items. It never changes the approval and never executes anything.
 */

import { createHttpClient, type DemoActor, type HttpClient } from "./http/client";
import { DEFAULT_HTTP_BASE_URL } from "./http/service";
import type { WireActorRole } from "./http/types";

export type SubmissionOriginType =
  | "AUTOPILOT_BATCH"
  | "SINGLE_SUBMISSION"
  | "LEGACY_OR_UNKNOWN";

export interface ApprovalSubmissionOrigin {
  approval_id: string;
  source_type: SubmissionOriginType;
  proposal_id: string;
  case_id: string | null;
  submission_batch_id: string | null;
  run_id: string | null;
  validation_report_id: string | null;
  validation_passed: boolean | null;
  reason_code: string | null;
  submission_status: string | null;
  submitted_at: string | null;
  /** Persisted approval creation time; null when it could not be recovered. */
  approval_created_at: string | null;
  approval_created_at_source: string | null;
  approval_decision: string;
  approval_actor_id: string;
  proposal_state: string | null;
  notes: string[];
}

export interface ApprovalOriginApi {
  getOrigin(approvalId: string): Promise<ApprovalSubmissionOrigin>;
}

const defaultActor = (): DemoActor => ({
  id: import.meta.env.VITE_DP_ACTOR_ID ?? "demo-specialist",
  role: (import.meta.env.VITE_DP_ACTOR_ROLE as WireActorRole | undefined) ?? "SPECIALIST",
});

export const createApprovalOriginApi = (options: {
  baseUrl?: string;
  actor?: DemoActor;
  fetch?: typeof fetch;
} = {}): ApprovalOriginApi => {
  const client: HttpClient = createHttpClient({
    baseUrl: options.baseUrl ?? import.meta.env.VITE_DP_API_BASE ?? DEFAULT_HTTP_BASE_URL,
    actor: options.actor ?? defaultActor(),
    fetch: options.fetch,
  });

  return {
    getOrigin: (approvalId) =>
      client.get<ApprovalSubmissionOrigin>(
        `/approvals/${approvalId}/submission-origin`,
      ),
  };
};
