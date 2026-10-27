/**
 * Analysis-run error model (UI level).
 *
 * The backend never adds LLM-specific ErrorCode values to the frozen contract
 * (CONTRACT_COMPATIBILITY.md): every local-model failure arrives as HTTP 503
 * with `error.code = DOMAIN_ERROR` and a finer internal code inside
 * `error.details` (`LLM_TIMEOUT`, `LLM_MODEL_UNAVAILABLE`, …). This module
 * keeps that distinction visible to the operator without weakening the
 * contract, and tags whether a manual retry is meaningful.
 *
 * Nothing here ever synthesises an analysis: an outcome is either the real
 * backend record or an error.
 */

import { ApiError } from "./http/client";
import type { AIAnalysis, ActionProposal } from "./types";

export type AnalysisErrorKind = "timeout" | "unavailable" | "network" | "server" | "request";

export interface AnalysisErrorInfo {
  /** HTTP status; 0 means the request never produced a response. */
  status: number;
  /** Contract-level code (DOMAIN_ERROR / NETWORK_ERROR / TIMEOUT / …). */
  code: string;
  /** Backend message, kept verbatim — never rewritten into a success. */
  message: string;
  /** Internal `LLM_*` codes found anywhere inside `error.details`. */
  detailCodes: string[];
  /** Raw details payload, shown only as supporting evidence. */
  details?: unknown;
  kind: AnalysisErrorKind;
  /** A manual retry may help; the UI still never retries on its own. */
  retryable: boolean;
}

export interface AnalysisRunOutcome {
  ok: boolean;
  analysis?: AIAnalysis;
  error?: AnalysisErrorInfo;
}

export interface AnalysisRequestOptions {
  /** Abort the HTTP wait after this many ms (default 120 s, see facade). */
  timeoutMs?: number;
}

const LLM_CODE = /\bLLM_[A-Z0-9_]+\b/g;

/** Recursively collect internal `LLM_*` codes from any details shape. */
export const collectLlmCodes = (value: unknown): string[] => {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(LLM_CODE)) found.add(match[0]);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(visit);
    }
  };
  visit(value);
  return [...found];
};

export const analysisErrorKind = (status: number, code: string): AnalysisErrorKind => {
  if (code === "TIMEOUT") return "timeout";
  if (code === "DOMAIN_ERROR" || status === 503 || code === "SERVICE_UNAVAILABLE") {
    return "unavailable";
  }
  if (status === 0 || code === "NETWORK_ERROR") return "network";
  if (status >= 500) return "server";
  return "request";
};

const isRetryable = (status: number, code: string, kind: AnalysisErrorKind): boolean =>
  kind !== "request" || status === 429 || code === "DOMAIN_ERROR";

/** Normalise any thrown value into the card model. */
export const normalizeAnalysisError = (error: unknown): AnalysisErrorInfo => {
  if (error instanceof ApiError) {
    const kind = analysisErrorKind(error.status, error.code);
    const detailCodes = collectLlmCodes(error.details);
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      detailCodes,
      details: error.details,
      kind,
      retryable: isRetryable(error.status, error.code, kind),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 0,
    code: "CLIENT_ERROR",
    message,
    detailCodes: [],
    kind: "server",
    retryable: true,
  };
};

/** A successful HTTP call that still carried no analysis record is a failure. */
export const emptyAnalysisError = (): AnalysisErrorInfo => ({
  status: 0,
  code: "EMPTY_RESULT",
  message:
    "The backend returned success but no analysis record. The UI does not synthesize a result.",
  detailCodes: [],
  kind: "server",
  retryable: true,
});

/**
 * Proposal generation outcome. Same shape as an analysis run: either the real
 * backend proposal or a normalised error — a proposal is never fabricated.
 */
export interface ProposalGenerationOutcome {
  ok: boolean;
  proposal?: ActionProposal;
  error?: AnalysisErrorInfo;
}

export const proposalNotGeneratedError = (): AnalysisErrorInfo => ({
  status: 0,
  code: "PROPOSAL_NOT_GENERATED",
  message:
    "The backend returned no proposal for this case. The UI does not create one locally.",
  detailCodes: [],
  kind: "server",
  retryable: true,
});

/**
 * A client-authored draft the UI refused to create (empty / too long message,
 * unavailable action, missing analysis). The message explains the rule; the
 * request is not retryable in the same form.
 */
export const proposalRejectedError = (message: string): AnalysisErrorInfo => ({
  status: 0,
  code: "PROPOSAL_REJECTED",
  message,
  detailCodes: [],
  kind: "request",
  retryable: false,
});
