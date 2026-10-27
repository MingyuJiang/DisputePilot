/**
 * Runtime connection state (health + read failures).
 *
 * Sandbox mode is a property of the *backend* (`GET /health`), not of this
 * bundle. This store only mirrors what the backend reported; when health is
 * unavailable the badge says so instead of guessing.
 *
 * Read failures are kept here so no page can render a failed request as an
 * empty list. The UI never retries on its own — `retryAfterSeconds` from a 429
 * is display-only.
 */

import { ApiError } from "./http/client";
import type { WireHealth } from "./http/types";
import { extractLastSuccessfulRead } from "../lib/sandbox";

export type ConnectionIssueKind =
  | "credentials"
  | "permission"
  | "rate_limited"
  | "remote_unavailable"
  | "remote_not_found"
  | "protocol"
  | "network"
  | "unknown";

export type ConnectionIssueSource = "health" | "cases";

export interface ConnectionIssue {
  kind: ConnectionIssueKind;
  status: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
  source: ConnectionIssueSource;
  at: string;
}

export interface RuntimeHealth {
  /** Raw backend value, upper-cased; empty when not reported. */
  executionMode: string;
  /** Raw backend value, upper-cased; empty when not reported. */
  networkAccess: string;
  note?: string;
  observedAt?: string;
  /** `health` = backend report; `local` = the offline fixture bundle. */
  source: "health" | "local";
}

export type RuntimeStatus = "idle" | "loading" | "ok" | "error";

/**
 * `remote` = a PayPal read actually happened (backend timestamp, or a remote
 * workspace read that completed); `local` = the offline fixture bundle was
 * refreshed. The two must never be labelled the same way.
 */
export type LastReadKind = "remote" | "local";

export interface RuntimeState {
  health?: RuntimeHealth;
  status: RuntimeStatus;
  issue?: ConnectionIssue;
  /** Set only when a read really happened (see `LastReadKind`). */
  lastSuccessReadAt?: string;
  /** What `lastSuccessReadAt` refers to; absent when no read is known. */
  lastReadKind?: LastReadKind;
  /** True only after a workspace load succeeded (distinguishes empty from failed). */
  casesLoaded: boolean;
}

const offlineHealth = (): RuntimeHealth => ({
  executionMode: "REPLAY",
  networkAccess: "NONE",
  note: "Local fixture store. No PayPal API is configured.",
  observedAt: new Date().toISOString(),
  source: "local",
});

const initialState = (): RuntimeState => ({
  health: offlineHealth(),
  status: "ok",
  casesLoaded: true,
});

let state: RuntimeState = initialState();
const listeners = new Set<() => void>();

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

export const getRuntime = (): RuntimeState => state;

export const subscribeRuntime = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const setState = (patch: Partial<RuntimeState>): void => {
  state = { ...state, ...patch };
  emit();
};

/** Mock mode: a known local fixture store, not a backend report. */
export const initializeOfflineRuntime = (): void => {
  state = initialState();
  emit();
};

/** HTTP mode: nothing is known until refresh()/health answers. */
export const initializeHttpRuntime = (): void => {
  state = {
    health: undefined,
    status: "idle",
    casesLoaded: false,
    lastSuccessReadAt: undefined,
    lastReadKind: undefined,
    issue: undefined,
  };
  emit();
};

export const beginRuntimeRefresh = (): void => {
  setState({ status: "loading", issue: undefined });
};

const detailsText = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
};

/**
 * Map an upstream failure onto the contract §5 vocabulary. 401 may arrive as
 * HTTP 503 DOMAIN_ERROR with an internal AUTH_FAILED detail, so the detail
 * codes are part of the signal.
 */
export const classifyConnectionError = (
  error: unknown,
  source: ConnectionIssueSource,
  at: string = new Date().toISOString(),
): ConnectionIssue => {
  const status = error instanceof ApiError ? error.status : 0;
  const code = error instanceof ApiError ? error.code : "CLIENT_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof ApiError ? error.details : undefined;
  const retryAfterSeconds = error instanceof ApiError ? error.retryAfterSeconds : undefined;
  const haystack = `${code} ${message} ${detailsText(details)}`.toUpperCase();

  if (status === 401 || /AUTH_FAILED|UNAUTHORIZED|INVALID_CREDENTIAL/.test(haystack)) {
    return { kind: "credentials", status, code, message, retryAfterSeconds, source, at };
  }
  if (status === 403 || /PERMISSION_DENIED|FORBIDDEN/.test(haystack)) {
    return { kind: "permission", status, code, message, retryAfterSeconds, source, at };
  }
  if (status === 429 || /RATE_LIMITED|TOO_MANY_REQUESTS/.test(haystack)) {
    return { kind: "rate_limited", status, code, message, retryAfterSeconds, source, at };
  }
  if (status === 404 || /REMOTE_NOT_FOUND/.test(haystack)) {
    return { kind: "remote_not_found", status, code, message, retryAfterSeconds, source, at };
  }
  if (/PROTOCOL_ERROR|INVALID_JSON/.test(haystack)) {
    return { kind: "protocol", status, code, message, retryAfterSeconds, source, at };
  }
  if (status === 0 && /NETWORK_ERROR|FAILED TO FETCH|CANNOT REACH/.test(haystack)) {
    return { kind: "network", status, code, message, retryAfterSeconds, source, at };
  }
  if (status >= 500 || /TIMEOUT|REMOTE_UNAVAILABLE|SERVICE_UNAVAILABLE/.test(haystack)) {
    return { kind: "remote_unavailable", status, code, message, retryAfterSeconds, source, at };
  }
  if (status === 0) {
    return { kind: "network", status, code, message, retryAfterSeconds, source, at };
  }
  return { kind: "unknown", status, code, message, retryAfterSeconds, source, at };
};

export const recordRuntimeIssue = (
  error: unknown,
  source: ConnectionIssueSource,
): ConnectionIssue => {
  const issue = classifyConnectionError(error, source);
  setState({ issue, status: "error" });
  return issue;
};

/** Clear only the failure raised by this source (health error survives a good /cases). */
export const clearRuntimeIssue = (source: ConnectionIssueSource): void => {
  if (state.issue?.source !== source) return;
  setState({ issue: undefined, status: state.casesLoaded ? "ok" : "idle" });
};

export const applyRuntimeHealth = (wire: WireHealth): void => {
  const rawNote = typeof wire.note === "string" ? wire.note : undefined;
  setState({
    health: {
      executionMode: String(wire.execution_mode ?? "").trim().toUpperCase(),
      networkAccess: String(wire.network_access ?? "").trim().toUpperCase(),
      note: rawNote,
      observedAt: new Date().toISOString(),
      source: "health",
    },
  });
};

/**
 * Successful workspace read. Not every successful `/cases` call is a PayPal
 * read: in Sandbox-without-credentials mode the backend serves the local
 * fixture bundle, so the frontend must not pass its own clock off as a remote
 * read time.
 *
 * Priority:
 *  1. `last_successful_read=<ISO>` in the health note — authoritative;
 *  2. remote access requested but credentials missing — no read happened, so
 *     no timestamp is set;
 *  3. offline (network_access=NONE) — keep the local refresh time, labelled
 *     as a refresh rather than a remote read;
 *  4. remote access with credentials — the read did reach PayPal, so the
 *     completion time is a truthful observation.
 */
export const markCasesLoaded = (now: string = new Date().toISOString()): void => {
  const health = state.health;
  const note = health?.note;
  const access = (health?.networkAccess ?? "").toUpperCase();
  const remoteAccess = Boolean(access && access !== "NONE");
  const backendReadAt = extractLastSuccessfulRead(note);

  let lastSuccessReadAt: string | undefined;
  let lastReadKind: LastReadKind | undefined;

  if (backendReadAt) {
    lastSuccessReadAt = backendReadAt;
    lastReadKind = "remote";
  } else if (remoteAccess && isCredentialsNotConfigured(note)) {
    lastSuccessReadAt = undefined;
    lastReadKind = undefined;
  } else if (remoteAccess) {
    lastSuccessReadAt = now;
    lastReadKind = "remote";
  } else {
    lastSuccessReadAt = now;
    lastReadKind = "local";
  }

  setState({
    status: state.issue ? "error" : "ok",
    casesLoaded: true,
    lastSuccessReadAt,
    lastReadKind,
  });
};

/** Sandbox credentials are missing; health stays reachable and offline still works. */
export const isCredentialsNotConfigured = (note?: string): boolean => {
  if (!note) return false;
  const text = note.toLowerCase();
  return (
    text.includes("not configured") ||
    text.includes("not set") ||
    text.includes("missing credential") ||
    text.includes("credentials missing") ||
    text.includes("credential absent") ||
    text.includes("credentials absent") ||
    text.includes("no credentials") ||
    text.includes("未配置")
  );
};

/** Test-only seam: force a state without touching the network. */
export const setRuntimeForTest = (patch: Partial<RuntimeState>): void => {
  state = { ...state, ...patch };
  emit();
};
