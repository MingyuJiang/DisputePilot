/**
 * Demo reset (`POST /api/v1/demo/reset`, hidden, SYSTEM role).
 *
 * Only the offline demo database may be reset. A sandbox/live backend refuses
 * (403/409); the UI must show that reason instead of a generic failure, and
 * must never retry automatically.
 */

export type DemoResetFailureReason = "sandbox" | "golden" | "path" | "network" | "http" | "mock";

export interface DemoResetError {
  status: number;
  code: string;
  message: string;
  reason: DemoResetFailureReason;
}

export type DemoResetOutcome =
  | { ok: true; cases: number; backup: string }
  | { ok: false; error: DemoResetError };

const GOLDEN_RE = /\bgolden\b/i;
const PATH_RE = /\b(path|database|sqlite|unreadable|missing file|fixture file|no such file)\b/i;

export const classifyResetError = (
  status: number,
  code: string,
  message: string,
): DemoResetError => {
  const reason: DemoResetFailureReason =
    status === 0
      ? "network"
      : status === 403 || status === 409
        ? "sandbox"
        : GOLDEN_RE.test(message)
          ? "golden"
          : PATH_RE.test(message)
            ? "path"
            : "http";
  return { status, code, message, reason };
};

/** Explicit English sentence per failure class (sandbox / golden / path). */
export const resetErrorMessage = (error: DemoResetError): string => {
  switch (error.reason) {
    case "network":
      return `Reset failed: the offline backend could not be reached. ${error.message}`;
    case "sandbox":
      return `Reset refused: only the offline demo database can be reset (HTTP ${error.status}). ${error.message}`;
    case "golden":
      return `Reset refused: the golden dataset is protected and was not modified. ${error.message}`;
    case "path":
      return `Reset failed: the demo database path is not usable. ${error.message}`;
    case "mock":
      return `Reset is disabled in mock mode: the fixtures live in memory. ${error.message}`;
    default:
      return `Reset failed (HTTP ${error.status}): ${error.message}`;
  }
};

export interface WireDemoReset {
  reset?: boolean;
  cases?: number;
  backup?: string;
}
