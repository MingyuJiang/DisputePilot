/**
 * Execution ledger projection (pure, testable).
 *
 * The backend's offline replay path emits EXECUTION_REPLAYED (UI action
 * EXECUTION_ATTEMPT) and never EXECUTION_VERIFIED — there is no GET
 * verification in offline mode. A successful replay must therefore be counted
 * as REPLAYED, not as VERIFIED and never as PENDING.
 */

import type { ActionProposal, AuditEvent, AuditOutcome } from "../api/types";
import { resolveExecutionResult } from "./executionResult";

export type ExecutionState =
  | "REPLAYED"
  /** LIVE request accepted AND the follow-up GET confirmed the remote state. */
  | "EXECUTED"
  /** Legacy event-only GET confirmation (no live execution record loaded). */
  | "VERIFIED"
  | "UNVERIFIED"
  | "FAILED"
  | "BLOCKED"
  | "EXPIRED"
  | "REJECTED"
  | "PENDING"
  /** A proposal that has no execution attempt yet; never "pending settlement". */
  | "NOT_EXECUTED";

interface LedgerEvent {
  action: string;
  outcome: AuditOutcome;
  at?: string;
  /** Phase 4: LIVE vs REPLAY must not collapse into the same row state. */
  executionMode?: string;
  simulated?: boolean;
  executionConfirmed?: boolean;
}

export function executionStateOf(
  proposal: ActionProposal,
  events: LedgerEvent[],
): ExecutionState {
  if (proposal.state === "REJECTED") return "REJECTED";

  const execution = proposal.execution;
  // resolveExecutionResult enforces the v1.1 rule: EXECUTED is only possible
  // when execution_mode=LIVE and verification.confirmed=true.
  const resolved = resolveExecutionResult(execution);

  // An explicit unknown result is authoritative and is never upgraded.
  if (resolved === "UNVERIFIED" || resolved === "UNKNOWN") return "UNVERIFIED";

  // A confirmed LIVE execution is its own row state (not "replayed").
  if (resolved === "EXECUTED") return "EXECUTED";
  if (resolved === "FAILED") return "FAILED";
  if (resolved === "BLOCKED") return "BLOCKED";
  // Offline replay stays replay even if an audit event also exists.
  if (resolved === "REPLAYED") return "REPLAYED";
  if (resolved === "PENDING") return "PENDING";

  // GET-verified execution: only an explicit EXECUTION_VERIFIED event counts.
  const verified = events.find(
    (event) => event.action === "EXECUTION_VERIFIED" && event.outcome === "SUCCEEDED",
  );
  if (verified) {
    if (verified.executionConfirmed === false) return "UNVERIFIED";
    const liveSignal =
      execution?.simulated === false ||
      execution?.executionMode === "LIVE" ||
      verified.executionMode === "LIVE" ||
      verified.simulated === false;
    return liveSignal ? "EXECUTED" : "VERIFIED";
  }

  const unknown = events.some((event) => event.action === "EXECUTION_UNKNOWN");
  const liveAttempt = events.some(
    (event) =>
      event.action === "EXECUTION_ATTEMPT" &&
      (event.simulated === false || event.executionMode === "LIVE"),
  );

  if (unknown || liveAttempt) return "UNVERIFIED";

  // Offline replay success. Join is by proposalId; the proposal state is the
  // second independent signal (REPLAY_EXECUTED / REPLAYED — never EXECUTED).
  const replayEvent = events.some(
    (event) =>
      event.action === "EXECUTION_ATTEMPT" &&
      event.outcome === "SUCCEEDED" &&
      event.simulated !== false &&
      event.executionMode !== "LIVE",
  );
  if (
    replayEvent ||
    proposal.state === "EXECUTED" ||
    proposal.state === "REPLAYED" ||
    proposal.backendState === "REPLAY_EXECUTED"
  ) {
    return "REPLAYED";
  }

  if (events.some((event) => event.outcome === "FAILED")) return "FAILED";
  if (events.some((event) => event.outcome === "EXPIRED")) return "EXPIRED";
  if (
    proposal.state === "BLOCKED" ||
    events.some((event) => event.outcome === "BLOCKED") ||
    events.some((event) => event.action === "EXECUTION_BLOCKED")
  ) {
    return "BLOCKED";
  }
  return "NOT_EXECUTED";
}

export interface ExecutionLedgerRow {
  proposal: ActionProposal;
  state: ExecutionState;
  last?: AuditEvent;
}

export const buildExecutionLedger = (
  proposals: ActionProposal[],
  audit: AuditEvent[],
): ExecutionLedgerRow[] =>
  proposals
    .filter((proposal) => proposal.state !== "DRAFT")
    .map((proposal) => {
      const events = audit
        .filter((item) => item.proposalId === proposal.proposalId)
        .sort((a, b) => b.at.localeCompare(a.at));
      // LIVE attempts / unknown results are recorded with outcome=INFO, so an
      // outcome-only filter would hide the very event that explains the row.
      const last =
        events.find((item) => item.action.startsWith("EXECUTION_")) ??
        events.find((item) => item.outcome !== "INFO");
      return {
        proposal,
        state: executionStateOf(proposal, events),
        last,
      };
    })
    .sort((a, b) => (b.last?.at ?? "").localeCompare(a.last?.at ?? ""));

export interface ExecutionCounts {
  replayed: number;
  /** LIVE executions confirmed by a follow-up GET (v1.1). */
  executed: number;
  /** Legacy event-only GET confirmations. */
  verified: number;
  /** Result unknown — deliberately NOT part of the success counts. */
  unverified: number;
  blocked: number;
  failed: number;
  duplicates: number;
}

export const countExecutionStates = (
  ledger: ExecutionLedgerRow[],
  audit: AuditEvent[],
): ExecutionCounts => ({
  replayed: ledger.filter((row) => row.state === "REPLAYED").length,
  executed: ledger.filter((row) => row.state === "EXECUTED").length,
  verified: ledger.filter((row) => row.state === "VERIFIED").length,
  // UNVERIFIED never rolls into `executed` or `verified`.
  unverified: ledger.filter((row) => row.state === "UNVERIFIED").length,
  blocked: ledger.filter((row) => row.state === "BLOCKED").length,
  failed: ledger.filter((row) => row.state === "FAILED" || row.state === "EXPIRED").length,
  duplicates: audit.filter((event) => event.outcome === "DUPLICATE_SUPPRESSED").length,
});

/* ------------------------------------------------------------------ *
 * Phase B3: mode + verification projections for the ledger table
 * ------------------------------------------------------------------ */

export type ExecutionMode = "LIVE" | "REPLAY" | "NOT_REPORTED";
export type VerificationFilter = "CONFIRMED" | "NOT_CONFIRMED" | "NOT_REPORTED";

/**
 * Mode is read from the execution record first, then from the audit event that
 * produced the row. A replay success is never allowed to become LIVE because
 * the page lacked a record.
 */
export const executionModeOf = (row: ExecutionLedgerRow): ExecutionMode => {
  const record = row.proposal.execution;
  const raw = (record?.executionMode ?? row.last?.executionMode ?? "").trim().toUpperCase();
  if (raw === "LIVE") return "LIVE";
  if (raw === "REPLAY") return "REPLAY";
  if (record?.simulated === true || row.last?.simulated === true) return "REPLAY";
  if (record?.simulated === false || row.last?.simulated === false) return "LIVE";
  // A state derived purely from an offline replay event is still a replay.
  if (row.state === "REPLAYED") return "REPLAY";
  return "NOT_REPORTED";
};

export const verificationOf = (row: ExecutionLedgerRow): VerificationFilter => {
  const confirmed = row.proposal.execution?.verification?.confirmed ?? row.last?.executionConfirmed;
  if (confirmed === true) return "CONFIRMED";
  if (confirmed === false) return "NOT_CONFIRMED";
  return "NOT_REPORTED";
};

export interface LedgerFilters {
  mode: "ALL" | ExecutionMode;
  result: "ALL" | ExecutionState;
  verification: "ALL" | VerificationFilter;
  caseId: string;
  query?: string;
}

export const filterExecutionLedger = (
  ledger: ExecutionLedgerRow[],
  filters: LedgerFilters,
): ExecutionLedgerRow[] =>
  ledger.filter((row) => {
    if (filters.caseId !== "ALL" && row.proposal.caseId !== filters.caseId) return false;
    if (filters.mode !== "ALL" && executionModeOf(row) !== filters.mode) return false;
    if (filters.result !== "ALL" && row.state !== filters.result) return false;
    if (
      filters.verification !== "ALL" &&
      verificationOf(row) !== filters.verification
    ) {
      return false;
    }
    const query = (filters.query ?? "").trim().toLowerCase();
    if (!query) return true;
    return (
      row.proposal.caseId.toLowerCase().includes(query) ||
      row.proposal.proposalId.toLowerCase().includes(query) ||
      row.proposal.actionLabel.toLowerCase().includes(query) ||
      (row.last?.requestId?.toLowerCase().includes(query) ?? false)
    );
  });
