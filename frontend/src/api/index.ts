import type {
  AIAnalysis,
  ActionProposal,
  ApprovalRecord,
  AuditEvent,
  CaseRecord,
  EvidenceRecord,
  RefundDraftInput,
  ReplayResult,
  SendMessageDraftInput,
} from "./types";
import {
  actions,
  analysisForCase,
  auditForCase,
  getSnapshot,
  pendingApprovals,
  proposalsForCase,
  subscribe,
  type WorkspaceState,
} from "./store";
import type { DemoActor } from "./http/client";
import type { WireActorRole } from "./http/types";
import type { CaptureStatusOutcome } from "./capture";
import type { LlmStatusOutcome } from "./llm";
import type { DemoResetOutcome } from "./demoReset";
import { createHttpFacade, type HttpServiceHandle } from "./http/facade";
import { DEFAULT_HTTP_BASE_URL } from "./http/service";
import { initializeHttpRuntime, initializeOfflineRuntime } from "./runtime";
import {
  emptyAnalysisError,
  proposalNotGeneratedError,
  type AnalysisRequestOptions,
  type AnalysisRunOutcome,
  type ProposalGenerationOutcome,
} from "./errors";

/**
 * The single data access point for the UI.
 *
 * Two implementations satisfy this interface:
 *  - the in-memory fixture store (mock mode, the default);
 *  - `createHttpFacade` → the Agent A FastAPI adapter (http mode).
 *
 * The mode is selected by `VITE_DP_API_MODE=mock|http` (default mock, so the
 * prototype behaviour is unchanged); `VITE_DP_API_BASE` overrides the backend
 * base URL (default http://127.0.0.1:8100/api/v1) and `VITE_DP_ACTOR_ID` /
 * `VITE_DP_ACTOR_ROLE` set the demo identity headers.
 */
export interface DisputePilotService {
  mode: "mock" | "http";
  getWorkspace(): WorkspaceState;
  subscribe(listener: () => void): () => void;
  listCases(): CaseRecord[];
  getCase(caseId: string): CaseRecord | undefined;
  listEvidence(caseId: string): EvidenceRecord[];
  getAnalysis(caseId: string): AIAnalysis | undefined;
  listProposals(caseId?: string): ActionProposal[];
  listPendingApprovals(): ActionProposal[];
  listApprovals(): ApprovalRecord[];
  listAudit(caseId?: string): AuditEvent[];
  runAnalysis(caseId: string, actor: string): AIAnalysis | undefined;
  /**
   * Awaitable analysis run used by the processing/error UI. Resolves to the
   * real record or a normalised error (never a fabricated analysis).
   */
  runAnalysisRequest(
    caseId: string,
    actor: string,
    options?: AnalysisRequestOptions,
  ): Promise<AnalysisRunOutcome>;
  submitProposal(proposalId: string, actor: string): ActionProposal | undefined;
  decideProposal(
    proposalId: string,
    decision: "APPROVED" | "REJECTED",
    manager: string,
    reason: string,
  ): ActionProposal | undefined;
  /** Resolves with the backend result; never a placeholder. */
  replay(proposalId: string): Promise<ReplayResult>;
  refreshSnapshot(caseId: string): ActionProposal | undefined;
  /**
   * Ask the backend to (re)generate the proposal for a case. Mock mode returns
   * the pre-seeded fixture proposal when one exists; it never invents one.
   */
  generateProposal(caseId: string): Promise<ProposalGenerationOutcome>;
  /**
   * Create a client-authored `send-message` draft (the specialist's exact
   * text). Returns the real proposal or a normalised error; it never sends.
   */
  createSendMessageProposal(input: SendMessageDraftInput): Promise<ProposalGenerationOutcome>;
  /**
   * Create a client-authored refund draft (PAYMENT). The server owns the
   * capture snapshot, amount bounds and payload hash; the client sends only
   * the contract fields.
   */
  createRefundProposal(input: RefundDraftInput): Promise<ProposalGenerationOutcome>;
  /**
   * Capture snapshot for a `CAP-…` case (hidden demo endpoint). Mock mode
   * answers from the fixture's `captureSnapshot`; it never invents values.
   */
  fetchCaptureStatus(captureId: string): Promise<CaptureStatusOutcome>;
  /** Live-model availability, checked before any "Live AI" run. */
  fetchLlmStatus(): Promise<LlmStatusOutcome>;
  /** Restore the five seeded offline demo cases (offline replay only). */
  resetDemo(): Promise<DemoResetOutcome>;
  reset(): void;
}

export type ServiceMode = "mock" | "http";

/** Pure mode resolver (env-injectable for tests). */
export const resolveServiceMode = (env: Record<string, string | undefined>): ServiceMode =>
  env.VITE_DP_API_MODE === "http" ? "http" : "mock";

export const SERVICE_MODE: ServiceMode = resolveServiceMode(import.meta.env);

// Mock mode is a known offline fixture store; http mode knows nothing until
// GET /health answers. Neither path is inferred from case data.
if (SERVICE_MODE === "mock") initializeOfflineRuntime();
else initializeHttpRuntime();

const mockService: DisputePilotService = {  mode: "mock",
  getWorkspace: getSnapshot,
  subscribe,
  listCases: () => getSnapshot().cases,
  getCase: (caseId) => getSnapshot().cases.find((item) => item.caseId === caseId),
  listEvidence: (caseId) => getSnapshot().evidence.filter((item) => item.caseId === caseId),
  getAnalysis: (caseId) => analysisForCase(getSnapshot(), caseId),
  listProposals: (caseId) =>
    caseId ? proposalsForCase(getSnapshot(), caseId) : getSnapshot().proposals,
  listPendingApprovals: () => pendingApprovals(getSnapshot()),
  listApprovals: () => getSnapshot().approvals,
  listAudit: (caseId) => (caseId ? auditForCase(getSnapshot(), caseId) : getSnapshot().audit),
  runAnalysis: (caseId, actor) => actions.runAnalysis(caseId, actor),
  runAnalysisRequest: async (caseId, actor) => {
    // Fixture mode is deterministic and synchronous; the promise still lets
    // the shared loading/error UI run unchanged.
    const analysis = actions.runAnalysis(caseId, actor);
    return analysis ? { ok: true, analysis } : { ok: false, error: emptyAnalysisError() };
  },
  submitProposal: (proposalId, actor) => actions.submitProposal(proposalId, actor),
  decideProposal: (proposalId, decision, manager, reason) =>
    actions.decideProposal(proposalId, decision, manager, reason),
  replay: async (proposalId) => actions.replay(proposalId),
  refreshSnapshot: (caseId) => actions.refreshSnapshot(caseId),
  generateProposal: async (caseId) => {
    // Fixtures are pre-seeded; refreshSnapshot only clears a stale block. If
    // neither yields a proposal, report it instead of fabricating one.
    const existing = proposalsForCase(getSnapshot(), caseId);
    const current = existing[existing.length - 1];
    if (current) return { ok: true, proposal: current };
    const refreshed = actions.refreshSnapshot(caseId);
    return refreshed
      ? { ok: true, proposal: refreshed }
      : { ok: false, error: proposalNotGeneratedError() };
  },
  createSendMessageProposal: async (input) => actions.createSendMessageProposal(input),
  createRefundProposal: async (input) => actions.createRefundProposal(input),
  fetchCaptureStatus: async (captureId) => {
    // The fixture snapshot is the only capture source in mock mode; a case
    // without one reports the read as failed instead of inventing amounts.
    const record = getSnapshot().cases.find(
      (item) =>
        item.caseId === captureId ||
        item.transaction.captureRef === captureId ||
        item.captureSnapshot?.captureId === captureId,
    );
    const snapshot = record?.captureSnapshot;
    if (!snapshot) {
      return {
        ok: false,
        error: {
          status: 404,
          code: "NOT_FOUND",
          message: `No fixture capture record exists for ${captureId}.`,
        },
      };
    }
    return {
      ok: true,
      capture: {
        captureId: snapshot.captureId,
        status: snapshot.status,
        originalAmount: snapshot.originalAmount,
        totalRefunded: snapshot.totalRefunded,
        refundableRemaining: snapshot.refundableRemaining,
        currencyCode: snapshot.currencyCode,
        source: "SCENARIO_DEFINED_FIXTURE",
      },
    };
  },
  fetchLlmStatus: async () => ({
    ok: true,
    status: {
      provider: "fixture",
      available: false,
      model: "",
      detail: "Mock mode has no live model backend; only pre-recorded fixtures are available.",
    },
  }),
  resetDemo: async () => ({
    ok: false,
    error: {
      status: 0,
      code: "MOCK_MODE",
      message: "the fixture store is rebuilt in memory by a page reload.",
      reason: "mock",
    },
  }),
  reset: () => actions.reset(),
};

const mockHandle: HttpServiceHandle = {
  ...mockService,
  // No backend to talk to in mock mode; refresh/setActor stay inert.
  refresh: async () => undefined,
  setActor: () => undefined,
};

const httpHandle: HttpServiceHandle = createHttpFacade({
  baseUrl: import.meta.env.VITE_DP_API_BASE ?? DEFAULT_HTTP_BASE_URL,
  actor: {
    id: import.meta.env.VITE_DP_ACTOR_ID ?? "demo-specialist",
    role: (import.meta.env.VITE_DP_ACTOR_ROLE as WireActorRole | undefined) ?? "SPECIALIST",
  } satisfies DemoActor,
});

/**
 * The active service. Pages/components keep importing `disputePilot`; the
 * handle additionally exposes `refresh()`/`setActor()` for http mode.
 */
export const serviceHandle: HttpServiceHandle =
  SERVICE_MODE === "http" ? httpHandle : mockHandle;

export const disputePilot: DisputePilotService = serviceHandle;
