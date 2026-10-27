/**
 * Single source of truth for display states (FRONTEND_STATE_MODEL.md).
 *
 * Four independent layers are modelled here and must never be inferred from
 * one another:
 *   1. case state        — dispute status / capture status
 *   2. decision workflow — proposal state + validation
 *   3. execution state   — execution record + mode + verification
 *   4. source / runtime  — /health, provenance, analysis mode, capability basis
 *
 * Pages and components render a `DisplayState`; they never build their own
 * label, tone or status string. Every function is pure.
 */

import type {
  AIAnalysis,
  AIReviewState,
  ApprovalRecord,
  CaseRecord,
  ExecutionRecord,
  ExecutionResult,
} from "../api/types";
import type { RuntimeHealth } from "../api/runtime";
import { resolveExecutionResult } from "./executionResult";
import { captureViewOf, isPaymentCase } from "./refund";

export type Tone = "neutral" | "info" | "pass" | "warn" | "stop";

export interface DisplayState {
  /** Stable identifier; also the tooltip fallback. */
  key: string;
  labelEn: string;
  labelZh: string;
  tone: Tone;
  /** Unrecognised raw wire value, kept verbatim for the tooltip. */
  raw?: string;
}

const state = (
  key: string,
  labelEn: string,
  labelZh: string,
  tone: Tone,
  raw?: string,
): DisplayState => (raw ? { key, labelEn, labelZh, tone, raw } : { key, labelEn, labelZh, tone });

const unknown = (key: string, raw: string | undefined, labelEn = "Unknown state", labelZh = "未知状态"): DisplayState =>
  state(key, labelEn, labelZh, "neutral", raw);

const normalize = (value: string | undefined): string => (value ?? "").trim().toUpperCase();

/* ------------------------------------------------------------------ *
 * 1. Case state
 * ------------------------------------------------------------------ */

const DISPUTE_CASE_STATES: Record<string, DisplayState> = {
  WAITING_FOR_SELLER_RESPONSE: state("case.waiting-seller", "Waiting for seller", "等待卖家", "neutral"),
  WAITING_FOR_BUYER_RESPONSE: state("case.waiting-buyer", "Waiting for buyer", "等待买家", "neutral"),
  UNDER_REVIEW: state("case.under-review", "Under review", "审核中", "info"),
  // The seller has to act; amber because it is an open task, not because it failed.
  REQUIRED_ACTION: state("case.required-action", "Action required", "需要处理", "warn"),
  // Never green: a resolved dispute does not state which side prevailed.
  RESOLVED: state("case.resolved", "Resolved", "已解决", "neutral"),
  OTHER: state("case.other", "Other", "其他", "neutral"),
  UNKNOWN: state("case.unknown", "Unknown", "未知", "neutral"),
};

const CAPTURE_CASE_STATES: Record<string, DisplayState> = {
  COMPLETED: state("case.capture-completed", "Capture completed", "Capture 已完成", "neutral"),
  PENDING: state("case.capture-pending", "Capture pending", "Capture 处理中", "warn"),
  // Money went back to the buyer — informative, not a merchant success.
  REFUNDED: state("case.capture-refunded", "Capture refunded", "Capture 已退款", "info"),
  PARTIALLY_REFUNDED: state(
    "case.capture-partially-refunded",
    "Capture partially refunded",
    "Capture 部分退款",
    "info",
  ),
  DECLINED: state("case.capture-declined", "Capture declined", "Capture 被拒绝", "stop"),
  FAILED: state("case.capture-failed", "Capture failed", "Capture 失败", "stop"),
  UNKNOWN: state("case.capture-unknown", "Capture status unknown", "Capture 状态未知", "neutral"),
};

/**
 * Capture status from the capture endpoint or the case snapshot. Kept separate
 * from `caseState` so a page that has just read the capture does not have to
 * splice a fake CaseRecord together.
 */
export const captureState = (status?: string): DisplayState => {
  const raw = normalize(status);
  return (
    CAPTURE_CASE_STATES[raw] ??
    unknown("case.capture-unknown", raw || undefined, "Capture status unknown", "Capture 状态未知")
  );
};

/**
 * A PAYMENT case's state is the capture status; a dispute case's state is the
 * dispute status. The two vocabularies never mix.
 */
export const caseState = (record: CaseRecord, captureStatus?: string): DisplayState => {
  if (isPaymentCase(record)) {
    return captureState(captureStatus ?? captureViewOf(record).status);
  }
  const status = normalize(record.status);
  return DISPUTE_CASE_STATES[status] ?? unknown("case.unknown", status || undefined, "Unknown", "未知");
};

/* ------------------------------------------------------------------ *
 * 2. Decision workflow (proposal)
 * ------------------------------------------------------------------ */

const PROPOSAL_STATES: Record<string, DisplayState> = {
  DRAFT: state("proposal.draft", "Draft", "草稿", "neutral"),
  VALIDATED: state("proposal.draft", "Draft", "草稿", "neutral"),
  PENDING_APPROVAL: state("proposal.awaiting-approval", "Awaiting approval", "待审批", "warn"),
  AWAITING_APPROVAL: state("proposal.awaiting-approval", "Awaiting approval", "待审批", "warn"),
  // Approving never executes: the label says so explicitly.
  APPROVED: state("proposal.approved", "Approved · not executed", "已批准 · 未执行", "info"),
  REJECTED: state("proposal.rejected", "Rejected", "已拒绝", "neutral"),
  BLOCKED: state("proposal.blocked", "Blocked", "已阻断", "stop"),
  // Distinct from BLOCKED: a failed validator/attempt was actually run.
  FAILED: state("proposal.failed", "Failed", "失败", "stop"),
  PENDING: state("proposal.pending", "Pending (not settled)", "处理中（未结算）", "warn"),
  REPLAY_EXECUTED: state("proposal.replayed", "Replayed (offline)", "已回放（离线）", "neutral"),
  REPLAYED: state("proposal.replayed", "Replayed (offline)", "已回放（离线）", "neutral"),
  CANCELLED: state("proposal.cancelled", "Cancelled", "已取消", "neutral"),
  /**
   * A bare EXECUTED without an execution record cannot be verified: only
   * LIVE + verification.confirmed may claim "Executed · Remote verified".
   */
  EXECUTED: state(
    "proposal.executed-unverified",
    "Executed · not verified",
    "已执行 · 未核验",
    "warn",
    "EXECUTED",
  ),
};

const EXECUTION_STATES: Record<ExecutionResult, DisplayState> = {
  EXECUTED: state("execution.executed-verified", "Executed · Remote verified", "已执行 · 远端已核验", "pass"),
  REPLAYED: state("execution.replayed", "Replayed (offline)", "已回放（离线）", "neutral"),
  UNVERIFIED: state("execution.unverified", "Unverified · Human review", "待核验 · 需人工", "warn"),
  PENDING: state("execution.pending", "Pending (not settled)", "处理中（未结算）", "warn"),
  BLOCKED: state("execution.blocked", "Blocked", "已阻断", "stop"),
  FAILED: state("execution.failed", "Failed", "执行失败", "stop"),
  UNKNOWN: state("execution.unknown", "Unknown result", "结果未知", "warn"),
};

export interface ProposalStateInput {
  state: string;
  /** Raw wire value, kept when the UI vocabulary differs. */
  backendState?: string;
  execution?: ExecutionRecord;
}

/**
 * Proposal display state. When an execution record exists its resolved result
 * wins (an offline replay never becomes EXECUTED, an unknown result never
 * becomes a success). Without a record the wire vocabulary decides.
 */
export const proposalState = (
  proposal: ProposalStateInput,
  execution?: ExecutionRecord,
): DisplayState => {
  const record = execution ?? proposal.execution;
  if (record?.result) {
    return executionState(record);
  }
  const raw = normalize(proposal.backendState) || normalize(proposal.state);
  const known = PROPOSAL_STATES[raw];
  if (known) return raw === "EXECUTED" ? { ...known, raw: "EXECUTED" } : known;
  return unknown("proposal.unknown", raw || undefined);
};

/* ------------------------------------------------------------------ *
 * 3. Execution state
 * ------------------------------------------------------------------ */

/**
 * The result the UI is allowed to show. `resolveExecutionResult()` remains
 * authoritative: PENDING is not success, UNVERIFIED is not a retry state, and
 * EXECUTED requires a LIVE request whose follow-up GET confirmed the result.
 */
export const executionState = (execution?: ExecutionRecord): DisplayState => {
  if (!execution) {
    return state("execution.none", "Not executed", "未执行", "neutral");
  }
  const resolved = resolveExecutionResult(execution);
  if (!resolved) {
    return state(
      "execution.none",
      "Not executed",
      "未执行",
      "neutral",
      normalize(execution.result) || undefined,
    );
  }
  const meta = EXECUTION_STATES[resolved];
  if (resolved === "UNKNOWN") {
    return { ...meta, raw: normalize(execution.result) || "UNKNOWN" };
  }
  return meta;
};

/**
 * Display projection for the execution-ledger row state. The ledger can derive
 * a state from audit events even when no execution record is loaded, so it
 * exposes its own union; this function is the only place that union becomes a
 * label/tone. REPLAYED and PENDING never borrow the green success tone.
 */
const LEDGER_STATES: Record<string, DisplayState> = {
  REPLAYED: EXECUTION_STATES.REPLAYED,
  EXECUTED: EXECUTION_STATES.EXECUTED,
  VERIFIED: state("execution.verified-event", "Verified · remote event", "已核验 · 远端事件", "info"),
  UNVERIFIED: EXECUTION_STATES.UNVERIFIED,
  PENDING: EXECUTION_STATES.PENDING,
  NOT_EXECUTED: state("execution.not-executed", "Not executed", "未执行", "neutral"),
  BLOCKED: EXECUTION_STATES.BLOCKED,
  FAILED: EXECUTION_STATES.FAILED,
  EXPIRED: state("execution.expired", "Expired", "已过期", "neutral"),
  REJECTED: state("execution.rejected", "Not attempted", "未尝试", "neutral"),
  UNKNOWN: EXECUTION_STATES.UNKNOWN,
};

export const ledgerExecutionState = (ledgerState: string): DisplayState => {
  const raw = normalize(ledgerState);
  return LEDGER_STATES[raw] ?? unknown("execution.unknown", raw || undefined);
};

/* ------------------------------------------------------------------ *
 * 4. Approval state (a separate record, never the proposal state)
 * ------------------------------------------------------------------ */

export const approvalState = (
  approval?: Pick<ApprovalRecord, "decision">,
): DisplayState => {
  if (!approval) {
    return state("approval.none", "No approval record", "无审批记录", "neutral");
  }
  const decision = normalize(approval.decision);
  if (decision === "PENDING") {
    return state("approval.pending", "Awaiting approval", "待审批", "warn");
  }
  if (decision === "APPROVED") {
    // An approval authorises a separate, gated execution step. Never executed.
    return state("approval.approved", "Approved · not executed", "已批准 · 未执行", "info");
  }
  if (decision === "REJECTED") {
    return state("approval.rejected", "Rejected", "已拒绝", "neutral");
  }
  return unknown("approval.unknown", decision || undefined);
};

/* ------------------------------------------------------------------ *
 * 5. Validation state (deterministic checks, not an execution result)
 * ------------------------------------------------------------------ */

export const validationState = (decision?: string): DisplayState => {
  switch (normalize(decision)) {
    case "PASS":
      return state("validation.passed", "Validation passed", "校验通过", "pass");
    case "BLOCKED":
      return state("validation.blocked", "Validation blocked", "校验阻断", "stop");
    case "NEEDS_REVIEW":
      return state("validation.review", "Validation needs review", "校验需复核", "warn");
    default:
      return unknown(
        "validation.unknown",
        normalize(decision) || undefined,
        "No validator report",
        "无校验报告",
      );
  }
};

/* ------------------------------------------------------------------ *
 * 6. Analysis state (AI output is never a verified success)
 * ------------------------------------------------------------------ */

export const analysisState = (value: AIReviewState | AIAnalysis | string | undefined): DisplayState => {
  const raw = normalize(typeof value === "string" ? value : value?.status);
  if (raw === "ANALYZED" || raw === "READY") {
    return state("analysis.analyzed", "Analysed", "已分析", "info");
  }
  if (raw === "RUNNING") {
    return state("analysis.running", "Running", "分析中", "info");
  }
  if (!raw || raw === "NOT_STARTED") {
    return state("analysis.not-started", "Not started", "未开始", "neutral");
  }
  return unknown("analysis.unknown", raw, "Unknown AI status", "未知 AI 状态");
};

/* ------------------------------------------------------------------ *
 * 6. Source / runtime
 * ------------------------------------------------------------------ */

const RUNTIME_SOURCES: Record<string, DisplayState> = {
  offline: state("source.offline-replay", "Offline replay", "离线回放", "neutral"),
  read_only: state("source.sandbox-read-only", "Sandbox · read-only", "Sandbox · 只读", "info"),
  write_enabled: state(
    "source.sandbox-write",
    "Sandbox · write gate open",
    "Sandbox · 写入闸门已开",
    "warn",
  ),
  unconfirmed: state(
    "source.sandbox-unconfirmed",
    "Sandbox · execution unconfirmed",
    "Sandbox · 执行状态未确认",
    "warn",
  ),
  unknown: state("source.not-reported", "Runtime not reported", "运行模式未上报", "neutral"),
};

/** Explicit "no source recorded" state — a source badge never guesses. */
export const NOT_REPORTED_SOURCE: DisplayState = state(
  "source.not-reported",
  "Source not reported",
  "来源未上报",
  "neutral",
);

type RuntimeKind = "offline" | "read_only" | "write_enabled" | "unconfirmed" | "unknown";

const PROVENANCE_SOURCES: Record<string, DisplayState> = {
  PAYPAL_API_OBSERVED: state(
    "source.provenance.paypal",
    "Official API observation",
    "官方 API 观测",
    "pass",
  ),
  HUMAN_OBSERVED_SANDBOX_UI: state(
    "source.provenance.human",
    "Human-observed Sandbox",
    "人工观测的 Sandbox",
    "info",
  ),
  SCENARIO_DEFINED: state("source.provenance.scenario", "Scenario-defined", "场景定义", "neutral"),
  AI_INFERRED: state("source.provenance.ai", "AI inference", "AI 推断", "warn"),
  SIMULATED_COMPOSITE: state(
    "source.provenance.synthetic",
    "Synthetic offline fixture",
    "合成离线固定数据",
    "neutral",
  ),
};

const ANALYSIS_MODES: Record<string, DisplayState> = {
  LLM: state("source.analysis.live-llm", "Live LLM", "实时 LLM", "info"),
  LOCAL_LLM: state("source.analysis.live-llm", "Live LLM", "实时 LLM", "info"),
  FROZEN_REPLAY: state(
    "source.analysis.frozen",
    "Frozen AI Output / Offline Replay",
    "冻结 AI 输出 / 离线回放",
    "neutral",
  ),
  STUB_DETERMINISTIC: state(
    "source.analysis.stub",
    "Deterministic stub",
    "确定性桩数据",
    "neutral",
  ),
};

const CAPABILITY_SOURCES: Record<string, DisplayState> = {
  LIVE_HATEOAS: state("source.basis.live", "Live HATEOAS", "实时 HATEOAS", "info"),
  FIXTURE_SNAPSHOT: state(
    "source.basis.fixture",
    "Fixture capability — not live HATEOAS",
    "固定能力快照 — 非实时 HATEOAS",
    "neutral",
  ),
};

const runtimeKind = (health?: RuntimeHealth): RuntimeKind => {
  const mode = normalize(health?.executionMode);
  const access = normalize(health?.networkAccess);
  if (!health || (!mode && !access)) return "unknown";
  if (mode === "REPLAY" && (!access || access === "NONE")) return "offline";
  if (mode === "REPLAY" && access === "PAYPAL_SANDBOX_READ_ONLY") return "read_only";
  if (mode === "LIVE" && access === "PAYPAL_SANDBOX_WRITE_ENABLED") return "write_enabled";
  if (mode === "LIVE") return "unconfirmed";
  return "unconfirmed";
};

export interface SourceInput {
  health?: RuntimeHealth;
  /** Case / evidence provenance (`PAYPAL_API_OBSERVED`, `SCENARIO_DEFINED`, …). */
  provenance?: string;
  /** Analysis `analysis_mode` (`LLM`, `FROZEN_REPLAY`, `STUB_DETERMINISTIC`). */
  analysisMode?: string;
  /** Capability link `basis` (`LIVE_HATEOAS`, `FIXTURE_SNAPSHOT`). */
  basis?: string;
  /** Capture endpoint source (`SYNTHETIC_OFFLINE_FIXTURE`, …). */
  capture?: { source?: string };
}

/**
 * Every source label in scope, in a stable order: runtime, capture,
 * provenance, analysis mode, capability basis. Nothing is inferred: absent
 * inputs produce no badge at all.
 */
export const sourceOf = (input: SourceInput): DisplayState[] => {
  const sources: DisplayState[] = [];

  if (input.health) {
    sources.push(RUNTIME_SOURCES[runtimeKind(input.health)]);
  }

  const captureSource = normalize(input.capture?.source);
  if (captureSource === "SYNTHETIC_OFFLINE_FIXTURE") {
    sources.push(
      state("source.capture.synthetic", "Synthetic offline fixture", "合成离线固定数据", "neutral"),
    );
  } else if (captureSource === "PAYPAL_API_OBSERVED") {
    sources.push(
      state("source.capture.observed", "Official capture observation", "官方 capture 观测", "pass"),
    );
  } else if (captureSource) {
    sources.push(unknown("source.capture.unknown", captureSource, "Capture source", "Capture 来源"));
  }

  const provenance = normalize(input.provenance);
  if (provenance) {
    sources.push(PROVENANCE_SOURCES[provenance] ?? unknown("source.provenance.unknown", provenance));
  }

  const analysisMode = normalize(input.analysisMode);
  if (analysisMode) {
    sources.push(
      ANALYSIS_MODES[analysisMode] ?? unknown("source.analysis.unknown", analysisMode),
    );
  }

  const basis = normalize(input.basis);
  if (basis) {
    sources.push(CAPABILITY_SOURCES[basis] ?? unknown("source.basis.unknown", basis));
  }

  return sources;
};
