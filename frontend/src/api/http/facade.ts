/**
 * Synchronous facade over the async HTTP adapter.
 *
 * `DisputePilotService` (the seam every page/component depends on) is
 * synchronous: reads return UI state and writes return the updated value.
 * HTTP cannot do that, so in http mode this facade bridges the two:
 *
 *  - reads delegate to the adapter's cache (populated by `refresh()`,
 *    the mount/poll effect in AppShell, or by write responses);
 *  - writes are dispatched to the backend and return the current cached
 *    value; when the response lands, the cache is replaced and subscribers
 *    are notified, so the UI converges on the backend state;
 *  - `replay` awaits the real response and coalesces simultaneous calls for
 *    one proposal. Completed attempts are never returned as synthetic results
 *    for a new attempt; backend idempotency remains authoritative.
 *
 * The facade never calls the mock store: business state is backend-only (B-2).
 */

import type { DisputePilotService } from "../index";
import type { ReplayResult } from "../types";
import {
  emptyAnalysisError,
  normalizeAnalysisError,
  proposalNotGeneratedError,
  type AnalysisRequestOptions,
  type AnalysisRunOutcome,
  type ProposalGenerationOutcome,
} from "../errors";
import type { DemoActor } from "./client";
import { createHttpService, DEFAULT_HTTP_BASE_URL, type HttpServiceOptions } from "./service";

export interface HttpServiceHandle extends DisputePilotService {
  /** Load/reload the workspace cache from the backend. */
  refresh(): Promise<void>;
  /** Switch the demo identity used for X-Actor-Id / X-Actor-Role. */
  setActor(actor: DemoActor): void;
}

export interface HttpFacadeOptions extends HttpServiceOptions {
  baseUrl?: string;
}

/**
 * Local-model runs include a cold load (~18 s) and a ~19 s p50; the backend
 * recommends ≥120 s. The timeout is a UI wait bound only — it never retries
 * the business action, and the backend may still finish the request.
 */
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 120_000;

export const createHttpFacade = (options: HttpFacadeOptions = {}): HttpServiceHandle => {
  const service = createHttpService(options.baseUrl ?? DEFAULT_HTTP_BASE_URL, options);
  const pendingReplays = new Map<string, Promise<ReplayResult>>();

  /** Fire-and-forget write: failures are logged, never thrown into the UI. */
  const dispatch = (operation: Promise<unknown>): void => {
    operation.catch((error: unknown) => {
      console.warn(
        "[DisputePilot http] backend write failed:",
        error instanceof Error ? error.message : error,
      );
    });
  };

  return {
    mode: "http",

    getWorkspace: () => service.getWorkspace(),
    subscribe: (listener) => service.subscribe(listener),

    listCases: () => service.listCases(),
    getCase: (caseId) => service.getCase(caseId),
    listEvidence: (caseId) => service.listEvidence(caseId),
    getAnalysis: (caseId) => service.getAnalysis(caseId),
    listProposals: (caseId) => service.listProposals(caseId),
    listPendingApprovals: () => service.listPendingApprovals(),
    listApprovals: () => service.listApprovals(),
    listAudit: (caseId) => service.listAudit(caseId),

    runAnalysis: (caseId, actor) => {
      dispatch(service.runAnalysis(caseId, actor));
      return service.getAnalysis(caseId);
    },
    /**
     * Phase 3: awaitable analysis entry point. Returns the real backend
     * record or a normalised error; it never fabricates a success result and
     * never retries. A manual click is the only retry path.
     */
    runAnalysisRequest: async (
      caseId: string,
      actor: string,
      options?: AnalysisRequestOptions,
    ): Promise<AnalysisRunOutcome> => {
      try {
        const analysis = await service.runAnalysis(caseId, actor, {
          timeoutMs: options?.timeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS,
        });
        if (!analysis) return { ok: false, error: emptyAnalysisError() };
        return { ok: true, analysis };
      } catch (error) {
        return { ok: false, error: normalizeAnalysisError(error) };
      }
    },
    submitProposal: (proposalId, actor) => {
      dispatch(service.submitProposal(proposalId, actor));
      return service.listProposals().find((item) => item.proposalId === proposalId);
    },
    decideProposal: (proposalId, decision, manager, reason) => {
      dispatch(service.decideProposal(proposalId, decision, manager, reason));
      return service.listProposals().find((item) => item.proposalId === proposalId);
    },
    /**
     * RC-2 (review P1-02): wait for the backend.
     *
     * The old version fired the request and immediately returned a synthetic
     * ``outcome: "BLOCKED"`` with ``revalidation: []``. The dialog then said
     * "blocked, 0/0 checks passed" while the backend had actually succeeded,
     * inviting a duplicate attempt. Now the promise resolves only with the real
     * result (success, 403/409/422, or a transport failure mapped to
     * ``UNVERIFIED``), and the caller decides how to present it.
     */
    replay: (proposalId) => {
      const pending = pendingReplays.get(proposalId);
      if (pending) return pending;
      const operation = service.replay(proposalId).finally(() => pendingReplays.delete(proposalId));
      pendingReplays.set(proposalId, operation);
      return operation;
    },
    refreshSnapshot: (caseId) => {
      dispatch(service.refreshSnapshot(caseId));
      const proposals = service.listProposals(caseId);
      return proposals[proposals.length - 1];
    },
    /**
     * Awaitable variant used after a successful analysis run and by the
     * "Generate proposal" CTA. Unlike refreshSnapshot it surfaces the backend
     * error to the panel instead of only logging it.
     */
    generateProposal: async (caseId: string): Promise<ProposalGenerationOutcome> => {
      try {
        const proposal = await service.refreshSnapshot(caseId);
        return proposal
          ? { ok: true, proposal }
          : { ok: false, error: proposalNotGeneratedError() };
      } catch (error) {
        return { ok: false, error: normalizeAnalysisError(error) };
      }
    },
    createSendMessageProposal: (input) => service.createSendMessageProposal(input),
    createRefundProposal: (input) => service.createRefundProposal(input),
    fetchCaptureStatus: (captureId) => service.fetchCaptureStatus(captureId),
    fetchLlmStatus: () => service.fetchLlmStatus(),
    resetDemo: () => service.resetDemo(),
    reset: () => {
      // Removed in http mode (B-3): the backend DB is not a UI-resettable fixture.
    },

    refresh: () => service.refresh(),
    setActor: (actor) => service.setActor(actor),
  };
};
