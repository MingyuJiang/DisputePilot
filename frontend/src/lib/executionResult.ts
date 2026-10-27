/**
 * Contract v1.1/v1.2 execution-result projection (pure, testable).
 *
 * The wire enum is REPLAYED / BLOCKED / FAILED / EXECUTED / UNVERIFIED / PENDING.
 * Three rules keep the UI honest:
 *   1. EXECUTED is only allowed when execution_mode=LIVE *and* the follow-up
 *      GET set verification.confirmed=true. Any other EXECUTED record is
 *      downgraded to UNVERIFIED (never shown as success).
 *   2. PENDING means accepted but not settled; it is its own state and is
 *      never upgraded to EXECUTED.
 *   3. A value the frontend does not recognise degrades to UNKNOWN ("未知结果")
 *      and is never rendered as a success state.
 */

import type { ExecutionRecord, ExecutionResult } from "../api/types";

const KNOWN_RESULTS: readonly ExecutionResult[] = [
  "REPLAYED",
  "BLOCKED",
  "FAILED",
  "EXECUTED",
  "UNVERIFIED",
  "PENDING",
];

/** Wire string → UI result. Unknown non-empty values degrade to UNKNOWN. */
export const mapExecutionResult = (raw?: string): ExecutionResult | undefined => {
  const value = (raw ?? "").trim().toUpperCase();
  if (!value) return undefined;
  return (KNOWN_RESULTS as readonly string[]).includes(value)
    ? (value as ExecutionResult)
    : "UNKNOWN";
};

/** True when the record is a real Sandbox request (never inferred from wording). */
export const isLiveExecution = (execution?: ExecutionRecord): boolean =>
  execution?.executionMode === "LIVE" || execution?.simulated === false;

/**
 * The result the UI is allowed to show. EXECUTED requires LIVE + confirmed;
 * everything contradictory or unrecognised stops at UNVERIFIED/UNKNOWN.
 */
export const resolveExecutionResult = (
  execution?: ExecutionRecord,
): ExecutionResult | undefined => {
  if (!execution?.result) return undefined;
  const result = execution.result;

  if (result === "EXECUTED") {
    return isLiveExecution(execution) && execution.verification?.confirmed === true
      ? "EXECUTED"
      : "UNVERIFIED";
  }

  // REPLAYED stays offline even if a contradictory mode was reported; it is
  // never upgraded into a live success.
  return result;
};
