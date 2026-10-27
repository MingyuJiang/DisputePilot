/**
 * Audit events → lifecycle stages for the case timeline
 * (FRONTEND_REDESIGN_PLAN §3.3.4).
 *
 * Pure and total: an action the UI does not recognise lands in "execution"
 * only if it starts with EXECUTION_, otherwise it stays in `validation`, the
 * stage where unrecognised backend events are safely visible. No event is
 * dropped and the chronological order inside a stage is preserved.
 */

import type { AuditEvent } from "../api/types";

export type AuditStage =
  | "import"
  | "analysis"
  | "proposal"
  | "validation"
  | "approval"
  | "execution"
  | "verification";

export const AUDIT_STAGES: AuditStage[] = [
  "import",
  "analysis",
  "proposal",
  "validation",
  "approval",
  "execution",
  "verification",
];

const rawActionOf = (event: AuditEvent): string =>
  (event.backendEventType ?? event.action ?? "").trim().toUpperCase();

export const auditStageOf = (event: AuditEvent): AuditStage => {
  const action = rawActionOf(event);
  if (action.startsWith("CASE_") || action === "SNAPSHOT_READ") return "import";
  if (action.startsWith("AI_") || action.startsWith("ANALYSIS_")) return "analysis";
  if (action.startsWith("PROPOSAL_")) return "proposal";
  if (action.startsWith("APPROVAL_")) return "approval";
  // VERIFIED / UNVERIFIED are the follow-up read, not the attempt.
  if (action.startsWith("EXECUTION_VERIFIED") || action.startsWith("EXECUTION_UNVERIFIED")) {
    return "verification";
  }
  if (action.startsWith("EXECUTION_")) return "execution";
  return "validation";
};

export interface AuditStageGroup {
  stage: AuditStage;
  events: AuditEvent[];
}

/** Non-empty stages in lifecycle order; empty stages are omitted. */
export const groupAuditByStage = (events: AuditEvent[]): AuditStageGroup[] =>
  AUDIT_STAGES.map((stage) => ({
    stage,
    events: events.filter((event) => auditStageOf(event) === stage),
  })).filter((group) => group.events.length > 0);
