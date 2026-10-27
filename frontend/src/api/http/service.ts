/**
 * HTTP adapter for the Agent A offline-replay backend.
 *
 * `createHttpService` implements the read side of `DisputePilotService`
 * synchronously from a cache (populated by `refresh()` or by write responses)
 * and the write side asynchronously, because HTTP is asynchronous. It never
 * touches the mock store — business state comes from the backend only (B-2).
 *
 * Endpoint mapping follows FIELD_MAPPING_A_TO_B.md §4:
 *   listCases            GET  /cases
 *   getCase              GET  /cases/{id}
 *   listEvidence         GET  /cases/{id}/evidence
 *   getAnalysis          GET  /cases/{id}/analyses            (latest)
 *   runAnalysis          POST /cases/{id}/analyses            (+Idempotency-Key)
 *   listProposals        GET  /cases/{id}/proposals | GET /proposals/{id}
 *   listPendingApprovals GET  /approvals → decision == PENDING (B-8)
 *   listApprovals        GET  /approvals
 *   submitProposal       POST /proposals/{id}/submit          ({proposal, approval})
 *   decideProposal       POST /approvals/{approvalId}/decision
 *   replay               POST /approvals/{approvalId}/replay
 *   listAudit            GET  /cases/{id}/audit
 *   refreshSnapshot      POST /cases/{id}/proposals/generate  (B-3: re-generate)
 *   reset                removed in http mode (no-op, see below)
 *   subscribe/workspace  cache + refresh()/polling; `revision` is a cache generation
 */

import type {
  AIAnalysis,
  ActionProposal,
  ApprovalRecord,
  AuditEvent,
  CaseRecord,
  EvidenceRecord,
  ReplayResult,
  RefundDraftInput,
  SendMessageDraftInput,
} from "../types";
import type { WorkspaceState } from "../store";
import {
  blockedReplayResult,
  mapAnalysis,
  mapApproval,
  mapAuditEvent,
  mapCase,
  mapEvidence,
  mapExecutionToReplayResult,
  mapProposal,
  proposalIdFromPayload,
} from "../mapping";
import { ApiError, createHttpClient, type DemoActor, type HttpClient, type HttpRequestOptions } from "./client";
import {
  mapCaptureStatus,
  type CaptureStatusError,
  type CaptureStatusOutcome,
  type WireCaptureStatus,
} from "../capture";
import { type LlmStatusOutcome, type WireLlmStatus } from "../llm";
import {
  classifyResetError,
  type DemoResetOutcome,
  type WireDemoReset,
} from "../demoReset";
import {
  applyRuntimeHealth,
  beginRuntimeRefresh,
  clearRuntimeIssue,
  markCasesLoaded,
  recordRuntimeIssue,
} from "../runtime";
import { normalizeAnalysisError, proposalNotGeneratedError, proposalRejectedError, type ProposalGenerationOutcome } from "../errors";import { idempotencyKeyFor, validateMessage } from "../../lib/sendMessage";
import type {
  WireAnalysis,
  WireApproval,
  WireAuditEvent,
  WireAuditTimeline,
  WireCase,
  WireCaseSummary,
  WireEvidence,
  WireExecution,
  WireHealth,
  WireProposal,
  WireSubmitResponse,
  WireValidationReport,
} from "./types";

export const DEFAULT_HTTP_BASE_URL = "http://127.0.0.1:8100/api/v1";

export interface HttpServiceOptions {
  /** Demo identity sent as X-Actor-Id / X-Actor-Role. */
  actor?: DemoActor;
  /** Injectable fetch for tests (no real network, no dev server). */
  fetch?: typeof fetch;
}

export interface HttpDisputePilotService {
  mode: "http";
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
  runAnalysis(
    caseId: string,
    actor: string,
    options?: HttpRequestOptions,
  ): Promise<AIAnalysis | undefined>;
  submitProposal(proposalId: string, actor: string): Promise<ActionProposal | undefined>;
  decideProposal(
    proposalId: string,
    decision: "APPROVED" | "REJECTED",
    manager: string,
    reason: string,
  ): Promise<ActionProposal | undefined>;
  replay(proposalId: string): Promise<ReplayResult>;
  refreshSnapshot(caseId: string): Promise<ActionProposal | undefined>;
  /** Create a client-authored send-message draft (POST /cases/{id}/proposals). */
  createSendMessageProposal(input: SendMessageDraftInput): Promise<ProposalGenerationOutcome>;
  /**
   * Create a client-authored refund draft (action_family=PAYMENT). The client
   * sends only capture_id / mode / amount? / currency_code / reason /
   * idempotency_key; the server reads the capture and back-fills the snapshot.
   */
  createRefundProposal(input: RefundDraftInput): Promise<ProposalGenerationOutcome>;
  /** Hidden demo endpoint: authoritative capture snapshot for a `CAP-…` case. */
  fetchCaptureStatus(captureId: string): Promise<CaptureStatusOutcome>;
  /** Hidden demo endpoint: live-model availability, checked before any live run. */
  fetchLlmStatus(): Promise<LlmStatusOutcome>;
  /** Hidden demo endpoint: restore the five seeded offline demo cases. */
  resetDemo(): Promise<DemoResetOutcome>;
  /** No-op: http mode has no demo reset (DB reset belongs to ops). */
  reset(): void;
  /** Load/reload the whole workspace cache from the backend. */
  refresh(): Promise<void>;
  setActor(actor: DemoActor): void;
}

const emptyWorkspace = (): WorkspaceState => ({
  cases: [],
  evidence: [],
  analyses: [],
  proposals: [],
  approvals: [],
  audit: [],
  revision: 0,
});

const latestByCreatedAt = <T extends { created_at: string }>(items: T[]): T | undefined =>
  items.reduce<T | undefined>(
    (latest, item) => (!latest || item.created_at > latest.created_at ? item : latest),
    undefined,
  );

export const createHttpService = (
  baseUrl: string = DEFAULT_HTTP_BASE_URL,
  options: HttpServiceOptions = {},
): HttpDisputePilotService => {
  const client: HttpClient = createHttpClient({
    baseUrl,
    actor: options.actor ?? { id: "demo-specialist", role: "SPECIALIST" },
    fetch: options.fetch,
  });

  /* ---------------- wire cache (backend is the source of truth) ---------------- */

  const wire = {
    cases: [] as WireCase[],
    evidence: new Map<string, WireEvidence[]>(),
    analyses: new Map<string, WireAnalysis[]>(),
    proposals: new Map<string, WireProposal[]>(),
    validations: new Map<string, WireValidationReport | null>(),
    approvals: [] as WireApproval[],
    audit: [] as WireAuditEvent[],
    executions: new Map<string, WireExecution>(),
  };
  /** proposalId → approvalId, learned from submit responses / GET /approvals. */
  const approvalIds = new Map<string, string>();

  let workspace: WorkspaceState = emptyWorkspace();
  const listeners = new Set<() => void>();
  let refreshInFlight: Promise<void> | null = null;

  /* ---------------- helpers ---------------- */

  const notify = (): void => {
    listeners.forEach((listener) => listener());
  };

  const rebuild = (): void => {
    const cases: CaseRecord[] = [];
    const evidence: EvidenceRecord[] = [];
    const analyses: AIAnalysis[] = [];
    const proposals: ActionProposal[] = [];
    const audit: AuditEvent[] = [];

    for (const item of wire.cases) {
      const caseEvidence = wire.evidence.get(item.case_id) ?? [];
      const caseAnalyses = wire.analyses.get(item.case_id) ?? [];
      const caseProposals = wire.proposals.get(item.case_id) ?? [];
      const latestAnalysis = latestByCreatedAt(caseAnalyses);
      const latestFacts = latestAnalysis?.grounded_facts ?? [];

      cases.push(
        mapCase(item, { evidence: caseEvidence, analyses: caseAnalyses, proposals: caseProposals }),
      );
      evidence.push(...caseEvidence.map((entry) => mapEvidence(entry, { facts: latestFacts })));
      if (latestAnalysis) {
        analyses.push(
          mapAnalysis(latestAnalysis, {
            evidence: caseEvidence,
            requirements: item.evidence_requirements,
          }),
        );
      }
      for (const proposal of caseProposals) {
        proposals.push(
          mapProposal(proposal, {
            case: item,
            approval: wire.approvals.find((entry) => entry.proposal_id === proposal.proposal_id),
            execution: wire.executions.get(proposal.proposal_id),
            validation: wire.validations.get(proposal.proposal_id) ?? null,
          }),
        );
      }
      audit.push(
        ...wire.audit
          .filter((event) => event.case_id === item.case_id)
          .map((event) => mapAuditEvent(event)),
      );
    }

    workspace = {
      cases,
      evidence,
      analyses,
      proposals,
      approvals: wire.approvals.map((entry) => mapApproval(entry)),
      audit: audit.sort((a, b) => a.at.localeCompare(b.at)),
      revision: workspace.revision + 1,
    };
    notify();
  };

  const safeGet = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      return await client.get<T>(path);
    } catch {
      return fallback;
    }
  };

  /**
   * D-2: write responses may carry only a proposal *summary* — the frozen
   * contract's ProposalSubmitSummaryOut is exactly
   * `{proposal_id, state, validation_status}`, with no case_id. Bucketing by
   * `proposal.case_id` parked such a summary in an `undefined`-keyed orphan
   * bucket that rebuild() (which walks case buckets only) never merged, so the
   * UI kept rendering the stale cached copy until a full refresh().
   *
   * Locate the cached entry by proposal_id across every bucket and merge onto
   * it — response values win, the cached case_id is preserved. A summary for a
   * proposal that is not cached yet is completed from GET /proposals/{id}
   * before bucketing, so no new orphan bucket can be created.
   */
  const storeProposal = async (proposal: WireProposal): Promise<void> => {
    for (const [caseId, bucket] of wire.proposals) {
      const index = bucket.findIndex((item) => item.proposal_id === proposal.proposal_id);
      if (index !== -1) {
        bucket[index] = { ...bucket[index], ...proposal, case_id: caseId };
        return;
      }
    }
    let record = proposal;
    if (!record.case_id) {
      record =
        (await safeGet<WireProposal | null>(`/proposals/${record.proposal_id}`, null)) ?? record;
    }
    const bucket = wire.proposals.get(record.case_id) ?? [];
    wire.proposals.set(record.case_id, [...bucket, record]);
  };

  const findWireProposal = (proposalId: string): WireProposal | undefined => {
    for (const bucket of wire.proposals.values()) {
      const found = bucket.find((item) => item.proposal_id === proposalId);
      if (found) return found;
    }
    return undefined;
  };

  const findProposal = (proposalId: string): ActionProposal | undefined =>
    workspace.proposals.find((item) => item.proposalId === proposalId);

  /** Any thrown request failure as a readable, status-carrying error. */
  const toError = (error: unknown): CaptureStatusError => {
    if (error instanceof ApiError) {
      return { status: error.status, code: error.code, message: error.message };
    }
    return {
      status: 0,
      code: "CLIENT_ERROR",
      message: error instanceof Error ? error.message : String(error),
    };
  };

  /** Fetch the validation report once per proposal (NOT_RUN proposals have none). */
  const hydrateProposal = async (proposal: WireProposal): Promise<void> => {
    if (proposal.validation_status === "NOT_RUN" || wire.validations.has(proposal.proposal_id)) {
      return;
    }
    const report = await safeGet<WireValidationReport | null>(
      `/proposals/${proposal.proposal_id}/validation`,
      null,
    );
    wire.validations.set(proposal.proposal_id, report);
  };

  /** Run a write as the given demo identity, then restore the previous one. */
  const withActor = async <T>(actor: DemoActor, operation: () => Promise<T>): Promise<T> => {
    const previous = client.actor;
    client.setActor(actor);
    try {
      return await operation();
    } finally {
      client.setActor(previous);
    }
  };

  /**
   * decideProposal/replay take an approvalId, the UI holds a proposalId.
   * Learn the mapping from the submit response or GET /approvals (B-8 source).
   */
  const resolveApprovalId = async (
    proposalId: string,
    decision: "PENDING" | "APPROVED",
  ): Promise<string | undefined> => {
    const cached = approvalIds.get(proposalId);
    if (cached) return cached;
    const approvals = await client.get<WireApproval[]>("/approvals");
    wire.approvals = approvals;
    for (const approval of approvals) approvalIds.set(approval.proposal_id, approval.approval_id);
    return approvals.find(
      (approval) => approval.proposal_id === proposalId && approval.decision === decision,
    )?.approval_id;
  };

  /* ---------------- refresh (full workspace load) ---------------- */

  /**
   * Health is informational: an unreachable /health must not hide cases that
   * load fine. A 404 means an older backend with no health route, so the badge
   * stays "not reported" instead of claiming a mode.
   */
  const loadHealth = async (): Promise<void> => {
    try {
      const health = await client.get<WireHealth>("/health");
      applyRuntimeHealth(health);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return;
      recordRuntimeIssue(error, "health");
    }
  };

  const refresh = async (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      beginRuntimeRefresh();
      await loadHealth();

      let summaries: WireCaseSummary[];
      try {
        summaries = await client.get<WireCaseSummary[]>("/cases");
      } catch (error) {
        // Never let a failed read look like an empty workspace.
        recordRuntimeIssue(error, "cases");
        throw error;
      }
      clearRuntimeIssue("cases");
      markCasesLoaded();

      const details = await Promise.all(
        summaries.map((summary) =>
          safeGet<WireCase | null>(`/cases/${summary.case_id}`, null),
        ),
      );
      wire.cases = details.filter((item): item is WireCase => item !== null);

      await Promise.all(
        wire.cases.map(async (item) => {
          const [evidence, analyses, proposals, timeline] = await Promise.all([
            safeGet<WireEvidence[]>(`/cases/${item.case_id}/evidence`, []),
            safeGet<WireAnalysis[]>(`/cases/${item.case_id}/analyses`, []),
            safeGet<WireProposal[]>(`/cases/${item.case_id}/proposals`, []),
            safeGet<WireAuditTimeline>(`/cases/${item.case_id}/audit`, {
              case_id: item.case_id,
              events: [],
            }),
          ]);
          wire.evidence.set(item.case_id, evidence);
          wire.analyses.set(item.case_id, analyses);
          wire.proposals.set(item.case_id, proposals);
          wire.audit = [...wire.audit.filter((event) => event.case_id !== item.case_id), ...timeline.events];
        }),
      );

      wire.approvals = await client.get<WireApproval[]>("/approvals");
      for (const approval of wire.approvals) {
        approvalIds.set(approval.proposal_id, approval.approval_id);
      }

      const allProposals = [...wire.proposals.values()].flat();
      await Promise.all(allProposals.map((proposal) => hydrateProposal(proposal)));

      /**
       * Phase 4: an execution record must load for every proposal the audit
       * trail says was attempted — not only REPLAY_EXECUTED. A Sandbox attempt
       * can be EXECUTED / UNVERIFIED / FAILED.
       */
      const attempted = new Set(
        allProposals
          .filter((proposal) =>
            ["REPLAY_EXECUTED", "EXECUTED", "UNVERIFIED", "FAILED"].includes(proposal.state),
          )
          .map((proposal) => proposal.proposal_id),
      );
      for (const event of wire.audit) {
        if (!event.event_type.startsWith("EXECUTION_")) continue;
        if (event.event_type === "EXECUTION_BLOCKED") continue;
        const proposalId = proposalIdFromPayload(event.payload ?? {});
        if (proposalId) attempted.add(proposalId);
      }
      await Promise.all(
        [...attempted].map(async (proposalId) => {
          const execution = await safeGet<WireExecution | null>(
            `/proposals/${proposalId}/execution`,
            null,
          );
          if (execution) wire.executions.set(proposalId, execution);
        }),
      );

      rebuild();
    })();
    try {
      await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  };

  /* ---------------- service ---------------- */

  /**
   * Q1: `analysis_id` is a required field of `POST /cases/{id}/proposals`
   * (contracts/v1). Both client-authored drafts (send-message *and* refund)
   * must send it, otherwise the backend answers 422 and the action silently
   * fails from the UI.
   *
   * Resolution order: explicit input → newest cached analysis for the case →
   * `GET /cases/{id}/analyses`. `null` means "the backend really has no
   * analysis yet", which the callers turn into an explicit error instead of a
   * request that is known to fail.
   */
  const resolveAnalysisId = async (
    caseId: string,
    explicit?: string,
  ): Promise<string | null> => {
    if (explicit) return explicit;
    const cached = workspace.analyses.filter((item) => item.caseId === caseId).slice(-1)[0];
    if (cached?.analysisId) return cached.analysisId;
    const wireList = await safeGet<WireAnalysis[]>(`/cases/${caseId}/analyses`, []);
    const newest = (wireList ?? []).slice(-1)[0];
    return newest?.analysis_id ?? null;
  };

  const noAnalysisError = () =>
    proposalRejectedError(
      "No analysis exists for this case yet. Run the AI assessment first — the backend requires an analysis before a proposal can be created.",
    );

  const service: HttpDisputePilotService = {
    mode: "http",

    getWorkspace: () => workspace,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    listCases: () => workspace.cases,
    getCase: (caseId) => workspace.cases.find((item) => item.caseId === caseId),
    listEvidence: (caseId) => workspace.evidence.filter((item) => item.caseId === caseId),
    getAnalysis: (caseId) => workspace.analyses.find((item) => item.caseId === caseId),
    listProposals: (caseId) =>
      caseId ? workspace.proposals.filter((item) => item.caseId === caseId) : workspace.proposals,
    // B-8: the queue is driven by approvals with decision == PENDING, not by proposal state.
    // The mapped-state conjunction is a UI guard: a PENDING approval always implies a
    // PENDING_APPROVAL proposal on the backend, so both conditions hold in practice.
    listPendingApprovals: () => {
      const pending = new Set(
        wire.approvals
          .filter((approval) => approval.decision === "PENDING")
          .map((approval) => approval.proposal_id),
      );
      return workspace.proposals.filter(
        (item) => pending.has(item.proposalId) && item.state === "AWAITING_APPROVAL",
      );
    },
    listApprovals: () => workspace.approvals,
    listAudit: (caseId) =>
      caseId ? workspace.audit.filter((item) => item.caseId === caseId) : workspace.audit,

    runAnalysis: async (caseId, actor, options) => {
      const analysis = await withActor({ id: actor, role: "SPECIALIST" }, () =>
        client.post<WireAnalysis>(`/cases/${caseId}/analyses`, undefined, options),
      );
      const existing = wire.analyses.get(caseId) ?? [];
      wire.analyses.set(
        caseId,
        [...existing.filter((item) => item.analysis_id !== analysis.analysis_id), analysis],
      );
      // Map the response directly: the analysis POST can be the first write
      // before a case refresh, and the UI must still receive the real record
      // (never a synthesized or stale one).
      const requirements =
        wire.cases.find((item) => item.case_id === caseId)?.evidence_requirements ?? [];
      const mapped = mapAnalysis(analysis, {
        evidence: wire.evidence.get(caseId) ?? [],
        requirements,
      });
      rebuild();
      return mapped;
    },

    submitProposal: async (proposalId, actor) => {
      try {
        const response = await withActor({ id: actor, role: "SPECIALIST" }, () =>
          client.post<WireSubmitResponse>(`/proposals/${proposalId}/submit`),
        );
        const { proposal, approval } = response;
        if (approval) {
          approvalIds.set(proposalId, approval.approval_id);
          wire.approvals = [
            ...wire.approvals.filter((item) => item.approval_id !== approval.approval_id),
            approval,
          ];
        }
        await storeProposal(proposal);
        await hydrateProposal(proposal);
        rebuild();
        return findProposal(proposalId);
      } catch (error) {
        // 422 business block: project the validator report onto the proposal so the
        // UI keeps showing the checks and the block reason (mock-compatible behaviour).
        if (
          error instanceof ApiError &&
          error.status === 422 &&
          error.code === "VALIDATION_FAILED" &&
          error.validationReport
        ) {
          let base = findWireProposal(proposalId);
          if (!base) {
            base = await safeGet<WireProposal | null>(`/proposals/${proposalId}`, null) ?? undefined;
          }
          if (base) {
            await storeProposal({ ...base, state: "BLOCKED", validation_status: "FAILED" });
            wire.validations.set(proposalId, error.validationReport);
            rebuild();
            return findProposal(proposalId);
          }
        }
        throw error;
      }
    },

    decideProposal: async (proposalId, decision, manager, reason) => {
      const approvalId = await resolveApprovalId(proposalId, "PENDING");
      if (!approvalId) {
        // No PENDING approval for this proposal — nothing changes (mirrors the mock).
        return findProposal(proposalId);
      }
      const approval = await withActor({ id: manager, role: "MANAGER" }, () =>
        client.post<WireApproval>(`/approvals/${approvalId}/decision`, { decision, reason }),
      );
      wire.approvals = [
        ...wire.approvals.filter((item) => item.approval_id !== approval.approval_id),
        approval,
      ];
      // The decision response carries no proposal; reflect it locally from the approval.
      const proposal = findWireProposal(proposalId);
      if (proposal) await storeProposal({ ...proposal, state: decision });
      rebuild();
      return findProposal(proposalId);
    },

    replay: async (proposalId) => {
      const approvalId = await resolveApprovalId(proposalId, "APPROVED");
      if (!approvalId) {
        return blockedReplayResult(
          0,
          "No approved approval exists for this proposal; a manager must approve it before replay.",
        );
      }
      try {
        const execution = await withActor({ id: client.actor.id, role: "MANAGER" }, () =>
          client.post<WireExecution>(`/approvals/${approvalId}/replay`),
        );
        wire.executions.set(proposalId, execution);
        if (execution.execution_mode === "LIVE") {
          // The execution record itself is authoritative for this attempt. A
          // follow-up refresh is best-effort: if polling fails, the request
          // result must still be returned (and shown) rather than swallowed.
          rebuild();
          await refresh().catch(() => undefined);
        } else {
          const proposal = findWireProposal(proposalId);
          if (proposal) await storeProposal({ ...proposal, state: "REPLAY_EXECUTED" });
          rebuild();
        }
        return mapExecutionToReplayResult(execution);
      } catch (error) {
        // 409 duplicate execution / already rejected / state conflict and 422 business
        // blocks surface as a BLOCKED result with the backend's message (B-16).
        if (
          error instanceof ApiError &&
          (error.status === 409 ||
            (error.status === 422 && error.code === "VALIDATION_FAILED"))
        ) {
          // QA-RC-03: a 422 carries the validator report. Keep the findings —
          // dropping them is what made a block look like "no checks reported".
          const report = error.validationReport;
          const findings = (report?.findings ?? []).map((finding) => ({
            label: `${finding.validator_id ?? "VALIDATOR"} — ${finding.status ?? "FAIL"}`,
            status: (["PASS", "FAIL", "SKIPPED"].includes(finding.status) ? finding.status : "INFO") as ReplayResult["revalidation"][number]["status"],
            note: finding.detail ?? "",
          }));
          const reasons = report?.blocked_reasons?.length
            ? ` ${report.blocked_reasons.join("; ")}`
            : "";
          if (findings.length > 0) {
            const blocked: ReplayResult = {
              outcome: "BLOCKED",
              httpStatus: error.status,
              message: `${error.message}${reasons}`,
              revalidation: findings,
            };
            return blocked;
          }
          return blockedReplayResult(error.status, error.message);
        }
        throw error;
      }
    },

    refreshSnapshot: async (caseId) => {
      // B-3: http mode has no snapshot-refresh concept; the closest backend action is
      // "regenerate proposals" (POST generate). The local 30-minute V9 window and the
      // EXPIRED outcome do not exist here — a backend finding is the only block (B-6).
      const generated = await client.post<WireProposal[]>(
        `/cases/${caseId}/proposals/generate`,
      );
      for (const proposal of generated) {
        await storeProposal(proposal);
        await hydrateProposal(proposal);
      }
      rebuild();
      return generated.length > 0 ? findProposal(generated[0].proposal_id) : undefined;
    },

    /**
     * Client-authored send-message draft.
     *
     * The request body follows the frozen contract: `action_payload` carries
     * only `message` and `idempotency_key` (V7). The key is derived from the
     * exact text, so an edited draft is a new proposal rather than a replay of
     * the previous one. The UI never fabricates the response: the proposal is
     * taken from the backend and the workspace cache is refreshed from it.
     */
    createSendMessageProposal: async (input) => {
      const messageCheck = validateMessage(input.message);
      if (!messageCheck.ok) {
        return {
          ok: false,
          error: proposalRejectedError(
            messageCheck.reason === "empty"
              ? "The message body is empty."
              : `The message body exceeds 2000 characters (${messageCheck.count}).`,
          ),
        };
      }
      const analysisId = await resolveAnalysisId(input.caseId, input.analysisId);
      if (!analysisId) {
        return { ok: false, error: noAnalysisError() };
      }

      const idempotencyKey = idempotencyKeyFor(input.caseId, input.message);
      try {
        const proposal = await withActor({ id: input.actor, role: "SPECIALIST" }, () =>
          client.post<WireProposal>(
            `/cases/${input.caseId}/proposals`,
            {
              case_id: input.caseId,
              analysis_id: analysisId,
              action_type: "send-message",
              action_payload: {
                message: input.message,
                idempotency_key: idempotencyKey,
              },
              rationale: input.rationale ?? [],
              required_evidence: [],
              expected_preconditions: input.expectedPreconditions ?? [
                "dispute_life_cycle_stage=INQUIRY",
                "send_message link present in the case snapshot",
              ],
              evidence_ids: input.evidenceIds ?? [],
            },
            { idempotencyKey },
          ),
        );
        await storeProposal(proposal);
        await hydrateProposal(proposal);
        rebuild();
        const mapped = findProposal(proposal.proposal_id);
        return mapped ? { ok: true, proposal: mapped } : { ok: false, error: proposalNotGeneratedError() };
      } catch (error) {
        return { ok: false, error: normalizeAnalysisError(error) };
      }
    },

    /**
     * Client-authored refund draft (contract v1.2, action_family=PAYMENT).
     *
     * The body carries only the fields the contract accepts. `action_family`
     * is PAYMENT, so V13–V18 apply instead of the dispute validators; the
     * backend reads the capture, back-fills `capture_snapshot`, checks the
     * amount/currency and computes the payload hash. A client-supplied amount
     * that disagrees with the server snapshot is a 422, surfaced verbatim.
     */
    createRefundProposal: async (input) => {
      // Q1: `analysis_id` is required by the frozen contract. Supplying it here
      // is what makes a refund draft reachable from the web UI at all.
      const analysisId = await resolveAnalysisId(input.caseId, input.analysisId);
      if (!analysisId) {
        return { ok: false, error: noAnalysisError() };
      }
      try {
        const proposal = await withActor({ id: input.actor, role: "SPECIALIST" }, () =>
          client.post<WireProposal>(
            `/cases/${input.caseId}/proposals`,
            {
              case_id: input.caseId,
              analysis_id: analysisId,
              action_type: input.mode === "full" ? "full-refund" : "partial-refund",
              action_family: "PAYMENT",
              action_payload: {
                capture_id: input.captureId,
                mode: input.mode,
                ...(input.mode === "partial" ? { amount: input.amount } : {}),
                currency_code: input.currencyCode,
                reason: input.reason,
                idempotency_key: input.idempotencyKey,
              },
            },
            { idempotencyKey: input.idempotencyKey },
          ),
        );
        await storeProposal(proposal);
        await hydrateProposal(proposal);
        rebuild();
        const mapped = findProposal(proposal.proposal_id);
        return mapped
          ? { ok: true, proposal: mapped }
          : { ok: false, error: proposalNotGeneratedError() };
      } catch (error) {
        return { ok: false, error: normalizeAnalysisError(error) };
      }
    },

    /**
     * Capture status (hidden demo endpoint).
     *
     * The body is the backend's own snapshot; the UI renders the decimal
     * strings verbatim. A malformed body is an explicit error — never a
     * synthesized capture.
     */
    fetchCaptureStatus: async (captureId) => {
      try {
        const wire = await client.get<WireCaptureStatus>(
          `/payments/captures/${encodeURIComponent(captureId)}`,
        );
        const capture = mapCaptureStatus(wire ?? {});
        if (!capture) {
          return {
            ok: false,
            error: {
              status: 200,
              code: "EMPTY_RESULT",
              message:
                "The backend returned no usable capture record. The UI does not synthesize one.",
            },
          };
        }
        return { ok: true, capture };
      } catch (error) {
        return { ok: false, error: toError(error) };
      }
    },

    /** Live-model availability (hidden demo endpoint). */
    fetchLlmStatus: async () => {
      try {
        const wire = await client.get<WireLlmStatus>("/llm/status");
        if (typeof wire?.available !== "boolean") {
          return {
            ok: false,
            error: normalizeAnalysisError(
              new ApiError({
                status: 200,
                code: "EMPTY_RESULT",
                message: "The backend did not report model availability.",
              }),
            ),
          };
        }
        return {
          ok: true,
          status: {
            provider: wire.provider ?? "",
            available: wire.available,
            model: wire.model ?? "",
            detail: wire.detail ?? "",
          },
        };
      } catch (error) {
        return { ok: false, error: normalizeAnalysisError(error) };
      }
    },

    /**
     * Demo reset (hidden demo endpoint, SYSTEM role).
     *
     * Only the offline demo database accepts it. The workspace cache is
     * reloaded from the backend afterwards, so the case list shows what the
     * backend actually restored — not a locally assumed five.
     */
    resetDemo: async () => {
      try {
        const body = await withActor({ id: "demo-reset", role: "SYSTEM" }, () =>
          client.post<WireDemoReset>("/demo/reset"),
        );
        await refresh().catch(() => undefined);
        return {
          ok: true,
          cases: typeof body?.cases === "number" ? body.cases : 0,
          backup: body?.backup ?? "",
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return { ok: false, error: classifyResetError(error.status, error.code, error.message) };
        }
        return {
          ok: false,
          error: classifyResetError(
            0,
            "CLIENT_ERROR",
            error instanceof Error ? error.message : String(error),
          ),
        };
      }
    },

    reset: () => {
      // Removed in http mode: resetting the backend DB is a coordinator/ops action,
      // never a UI action (B-3). Intentionally a no-op so the shell stays usable.
    },
    refresh,
    setActor: (actor) => {
      client.setActor(actor);
    },
  };

  return service;
};
