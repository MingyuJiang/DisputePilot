/**
 * Thin HTTP client for the Agent A offline-replay backend.
 *
 * Responsibilities:
 *  - attach the demo actor headers (X-Actor-Id / X-Actor-Role) to every request;
 *  - attach an Idempotency-Key to every state-changing POST;
 *  - normalise every error response into one ApiError shape.
 *
 * Error tolerance (candidate contract is pre-freeze; Agent A is shipping A-3,
 * the unified error model):
 *  - unified envelope  {"error": {"code": "CONFLICT", "message": "…"}}   → code wins
 *  - FastAPI default  {"detail": [{loc, msg, type}, …]}                 → REQUEST_INVALID
 *  - legacy detail    {"detail": "role … not permitted here"}           → code by status
 * Network failures keep the mock's `httpStatus: 0` semantics (status 0).
 */

import type { WireActorRole, WireErrorEnvelope, WireValidationReport } from "./types";

export class ApiError extends Error {
  /** HTTP status code; 0 means the request never reached the backend. */
  readonly status: number;
  /** Normalised machine code (CONFLICT / VALIDATION_FAILED / FORBIDDEN / …). */
  readonly code: string;
  /** Present when the backend attached a validation_report to a 422. */
  readonly validationReport?: WireValidationReport;
  /** Raw `error.details` (Phase 3: carries internal LLM_* codes). */
  readonly details?: unknown;
  /**
   * Phase 4: `Retry-After` from a 429, in seconds. Display only — the UI never
   * retries automatically.
   */
  readonly retryAfterSeconds?: number;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    validationReport?: WireValidationReport;
    details?: unknown;
    retryAfterSeconds?: number;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.validationReport = options.validationReport;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface DemoActor {
  id: string;
  role: WireActorRole;
}

export interface HttpClientOptions {
  baseUrl: string;
  actor: DemoActor;
  /** Injectable for tests (vitest fetch mock); defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

/** Optional per-request controls. Only the analysis POST uses a timeout today. */
export interface HttpRequestOptions {
  /**
   * Abort the wait after this many milliseconds. A long local-model run
   * (cold load ~18 s) needs a generous budget; see DEFAULT_ANALYSIS_TIMEOUT_MS.
   */
  timeoutMs?: number;
  /**
   * Business idempotency key bound to the payload (send-message). When absent
   * a per-request key is generated, which preserves the old behaviour.
   */
  idempotencyKey?: string;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE",
  500: "INTERNAL_ERROR",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
};

let idempotencyCounter = 0;

const nextIdempotencyKey = (path: string): string => {
  idempotencyCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `dp-ui-${idempotencyCounter}-${random}-${path.replace(/\W+/g, "-")}`;
};

const codeFromStatus = (status: number): string => CODE_BY_STATUS[status] ?? `HTTP_${status}`;

/** Normalise any error body into {code, message, validationReport}. */
export const normalizeError = (
  status: number,
  body: unknown,
): { code: string; message: string; validationReport?: WireValidationReport; details?: unknown } => {
  const envelope = (body ?? {}) as WireErrorEnvelope;

  // 1. Unified envelope wins whenever a code is present (post-A-3 shape).
  if (envelope.error && typeof envelope.error === "object") {
    return {
      code: envelope.error.code ?? codeFromStatus(status),
      message: envelope.error.message ?? `Request failed with HTTP ${status}.`,
      validationReport: envelope.error.validation_report,
      details: envelope.error.details,
    };
  }

  // 2. FastAPI request-validation shape (pre-freeze 422): {"detail": [{loc, msg, type}]}.
  if (Array.isArray(envelope.detail)) {
    const first = envelope.detail[0] as { msg?: string; loc?: unknown[] } | undefined;
    const location = first?.loc?.length ? ` (${first.loc.join(".")})` : "";
    return {
      code: "REQUEST_INVALID",
      message: `${first?.msg ?? "Request body failed validation"}${location}`,
    };
  }

  // 3. Legacy string detail (401 missing actor / 403 role mismatch today).
  if (typeof envelope.detail === "string") {
    return { code: codeFromStatus(status), message: envelope.detail };
  }

  return { code: codeFromStatus(status), message: `Request failed with HTTP ${status}.` };
};

export interface HttpClient {
  get<T>(path: string, options?: HttpRequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: HttpRequestOptions): Promise<T>;
  readonly actor: DemoActor;
  setActor(actor: DemoActor): void;
  readonly baseUrl: string;
}

export const createHttpClient = (options: HttpClientOptions): HttpClient => {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  let actor = options.actor;
  const doFetch: typeof fetch =
    options.fetch ??
    (typeof globalThis.fetch === "function"
      ? (input, init) => globalThis.fetch(input, init)
      : () =>
          Promise.reject(
            new ApiError({
              status: 0,
              code: "NETWORK_ERROR",
              message: "No fetch implementation is available in this environment.",
            }),
          ));

  const request = async <T>(
    path: string,
    init: RequestInit,
    options: HttpRequestOptions = {},
  ): Promise<T> => {
    const url = `${baseUrl}${path}`;
    let response: Response;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const requestInit: RequestInit = { ...init };
    let timeoutPromise: Promise<never> | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      const controller = new AbortController();
      requestInit.signal = controller.signal;
      // Promise.race makes the timeout authoritative even when the fetch
      // implementation ignores AbortSignal (jsdom mocks in tests).
      timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error("__DP_REQUEST_TIMEOUT__"));
        }, options.timeoutMs);
      });
    }

    try {
      const pending = doFetch(url, requestInit);
      response = await (timeoutPromise ? Promise.race([pending, timeoutPromise]) : pending);
    } catch (error) {
      if (timedOut) {
        throw new ApiError({
          status: 0,
          code: "TIMEOUT",
          message: `The backend did not answer within ${options.timeoutMs} ms. The request was not retried automatically.`,
        });
      }
      // Network-level failure: keep the mock's httpStatus:0 semantics.
      throw new ApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: `Cannot reach the DisputePilot backend at ${baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const normalized = normalizeError(response.status, body);
      const retryAfter = response.headers.get("retry-after");
      const retryAfterSeconds =
        retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : undefined;
      throw new ApiError({ status: response.status, ...normalized, retryAfterSeconds });
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };

  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    "X-Actor-Id": actor.id,
    "X-Actor-Role": actor.role,
    ...extra,
  });

  return {
    get baseUrl() {
      return baseUrl;
    },
    get actor() {
      return actor;
    },
    setActor(next: DemoActor) {
      actor = next;
    },
    get<T>(path: string, options?: HttpRequestOptions): Promise<T> {
      return request<T>(path, { method: "GET", headers: headers() }, options);
    },
    post<T>(path: string, body?: unknown, options?: HttpRequestOptions): Promise<T> {
      const extra: Record<string, string> = {
        "Idempotency-Key": options?.idempotencyKey ?? nextIdempotencyKey(path),
      };
      if (body !== undefined) extra["Content-Type"] = "application/json";
      return request<T>(
        path,
        {
          method: "POST",
          headers: headers(extra),
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        options,
      );
    },
  };
};
