/**
 * Live model availability (hidden demo endpoint `GET /api/v1/llm/status`).
 *
 * The offline demo can serve pre-recorded analyses (`analysis_mode =
 * FROZEN_REPLAY`) without any model. Asking for a *live* run is a different
 * action: the UI checks availability first and reports the backend's own
 * detail when no model is available, instead of starting a run that could
 * silently produce a deterministic stub.
 */

import type { AnalysisErrorInfo } from "./errors";

export interface LlmStatus {
  provider: string;
  available: boolean;
  model: string;
  detail: string;
}

export type LlmStatusOutcome =
  | { ok: true; status: LlmStatus }
  | { ok: false; error: AnalysisErrorInfo };

export const LIVE_AI_UNAVAILABLE_PREFIX = "Live AI unavailable: ";

const FALLBACK_DETAIL = "the backend did not report an available live model.";

/** The exact operator-facing sentence; the backend detail is never dropped. */
export const liveAiUnavailableMessage = (detail?: string): string => {
  const trimmed = (detail ?? "").trim();
  return `${LIVE_AI_UNAVAILABLE_PREFIX}${trimmed || FALLBACK_DETAIL}`;
};

export type LiveAiOutcome = { ok: true } | { ok: false; message: string };

/**
 * Availability gate for the "Live AI" action.
 *
 * - status read fails        → explicit error, no analysis request;
 * - status.available=false   → explicit error carrying the backend detail;
 * - available=true           → the caller's live run starts.
 *
 * It never falls back to a stub run.
 */
export const runLiveAi = async (
  fetchStatus: () => Promise<LlmStatusOutcome>,
  start: () => Promise<void> | void,
): Promise<LiveAiOutcome> => {
  const outcome = await fetchStatus();
  if (!outcome.ok) {
    return { ok: false, message: liveAiUnavailableMessage(outcome.error?.message) };
  }
  if (!outcome.status.available) {
    return {
      ok: false,
      message: liveAiUnavailableMessage(outcome.status.detail),
    };
  }
  await start();
  return { ok: true };
};

export interface WireLlmStatus {
  provider?: string;
  available?: boolean;
  model?: string;
  detail?: string;
}
