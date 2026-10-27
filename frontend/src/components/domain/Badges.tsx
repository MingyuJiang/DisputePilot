import type { ReactNode } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  CircleHelp,
  Clock,
  FileWarning,
  FlaskConical,
  ShieldQuestion,
  Sparkles,
} from "lucide-react";
import { Badge } from "../ui/Badge";
import type { BadgeTone } from "../ui/Badge";
import { useI18n, translate, type MessageKey } from "../../i18n";
import type {
  AuditOutcome,
  DisputeStatus,
  ExecutionRecord,
  ExecutionResult,
  GroundingClass,
  ProposalState,
  RiskLevel,
} from "../../api/types";
import { resolveExecutionResult } from "../../lib/executionResult";

const STATUS: Record<DisputeStatus, { key: MessageKey; tone: BadgeTone }> = {
  WAITING_FOR_SELLER_RESPONSE: { key: "badge.status.WAITING_FOR_SELLER_RESPONSE", tone: "warn" },
  WAITING_FOR_BUYER_RESPONSE: { key: "badge.status.WAITING_FOR_BUYER_RESPONSE", tone: "info" },
  UNDER_REVIEW: { key: "badge.status.UNDER_REVIEW", tone: "navy" },
  REQUIRED_ACTION: { key: "badge.status.REQUIRED_ACTION", tone: "warn" },
  RESOLVED: { key: "badge.status.RESOLVED", tone: "pass" },
  OTHER: { key: "badge.status.OTHER", tone: "neutral" },
  UNKNOWN: { key: "badge.status.UNKNOWN", tone: "neutral" },
};

export const DisputeStatusBadge = ({ status }: { status: DisputeStatus }) => {
  const { t } = useI18n();
  const meta = STATUS[status];
  return (
    <Badge tone={meta.tone} dot>
      {t(meta.key)}
    </Badge>
  );
};

const RISK: Record<RiskLevel, { key: MessageKey; tone: BadgeTone }> = {
  LOW: { key: "badge.risk.LOW", tone: "pass" },
  MEDIUM: { key: "badge.risk.MEDIUM", tone: "warn" },
  HIGH: { key: "badge.risk.HIGH", tone: "stop" },
  BLOCKED: { key: "badge.risk.BLOCKED", tone: "stop" },
};

export const RiskBadge = ({ risk }: { risk?: RiskLevel }) => {
  const { t } = useI18n();
  // http mode leaves case-level risk empty when no proposal supplies one (B-11):
  // show "not rated" instead of inventing a risk level.
  const meta = risk ? RISK[risk] : { key: "badge.risk.notRated" as MessageKey, tone: "neutral" as BadgeTone };
  return (
    <Badge tone={meta.tone} dot>
      {t(meta.key)}
    </Badge>
  );
};

const PROPOSAL: Record<ProposalState, { key: MessageKey; tone: BadgeTone }> = {
  DRAFT: { key: "badge.proposal.DRAFT", tone: "neutral" },
  AWAITING_APPROVAL: { key: "badge.proposal.AWAITING_APPROVAL", tone: "warn" },
  APPROVED: { key: "badge.proposal.APPROVED", tone: "info" },
  REJECTED: { key: "badge.proposal.REJECTED", tone: "stop" },
  EXECUTED: { key: "badge.proposal.EXECUTED", tone: "pass" },
  // Offline replay is not an execution: neutral, never the green success tone.
  REPLAYED: { key: "badge.proposal.REPLAYED", tone: "neutral" },
  UNVERIFIED: { key: "badge.proposal.UNVERIFIED", tone: "warn" },
  // Accepted, not settled: yellow, never the green success tone.
  PENDING: { key: "badge.proposal.PENDING", tone: "warn" },
  FAILED: { key: "badge.proposal.FAILED", tone: "stop" },
  CANCELLED: { key: "badge.proposal.CANCELLED", tone: "neutral" },
  BLOCKED: { key: "badge.proposal.BLOCKED", tone: "stop" },
  // Unrecognised wire value: neutral, never DRAFT and never green.
  UNKNOWN: { key: "badge.proposal.UNKNOWN", tone: "neutral" },
};

export const ProposalStateBadge = ({ state }: { state: ProposalState }) => {
  const { t } = useI18n();
  const meta = PROPOSAL[state];
  // UNVERIFIED carries the no-retry instruction with the badge (same rule as
  // the execution-result badge): the request may have landed.
  if (state === "UNVERIFIED") {
    return (
      <span title={t("execution.noAutoRetry")}>
        <Badge tone={meta.tone} dot>
          {t(meta.key)}
        </Badge>
      </span>
    );
  }
  return (
    <Badge tone={meta.tone} dot>
      {t(meta.key)}
    </Badge>
  );
};

const OUTCOME: Record<AuditOutcome, { key: MessageKey; tone: BadgeTone }> = {
  SUCCEEDED: { key: "badge.outcome.SUCCEEDED", tone: "pass" },
  FAILED: { key: "badge.outcome.FAILED", tone: "stop" },
  BLOCKED: { key: "badge.outcome.BLOCKED", tone: "warn" },
  EXPIRED: { key: "badge.outcome.EXPIRED", tone: "neutral" },
  DUPLICATE_SUPPRESSED: { key: "badge.outcome.DUPLICATE_SUPPRESSED", tone: "info" },
  INFO: { key: "badge.outcome.INFO", tone: "neutral" },
};

export const OutcomeBadge = ({ outcome }: { outcome: AuditOutcome }) => {
  const { t } = useI18n();
  const meta = OUTCOME[outcome];
  return <Badge tone={meta.tone}>{t(meta.key)}</Badge>;
};

const GROUNDING: Record<
  GroundingClass,
  { key: MessageKey; descKey: MessageKey; tone: BadgeTone; icon: ReactNode }
> = {
  VERIFIED_OBSERVATION: {
    key: "badge.grounding.VERIFIED_OBSERVATION",
    descKey: "badge.grounding.desc.VERIFIED_OBSERVATION",
    tone: "pass",
    icon: <BadgeCheck size={11} aria-hidden />,
  },
  SCENARIO_DEFINED: {
    key: "badge.grounding.SCENARIO_DEFINED",
    descKey: "badge.grounding.desc.SCENARIO_DEFINED",
    tone: "scenario",
    icon: <FlaskConical size={11} aria-hidden />,
  },
  AI_INFERENCE: {
    key: "badge.grounding.AI_INFERENCE",
    descKey: "badge.grounding.desc.AI_INFERENCE",
    tone: "infer",
    icon: <Sparkles size={11} aria-hidden />,
  },
  MISSING: {
    key: "badge.grounding.MISSING",
    descKey: "badge.grounding.desc.MISSING",
    tone: "stop",
    icon: <FileWarning size={11} aria-hidden />,
  },
  UNKNOWN: {
    key: "badge.grounding.UNKNOWN",
    descKey: "badge.grounding.desc.UNKNOWN",
    tone: "neutral",
    icon: <CircleHelp size={11} aria-hidden />,
  },
  UNVERIFIED_CLAIM: {
    key: "badge.grounding.UNVERIFIED_CLAIM",
    descKey: "badge.grounding.desc.UNVERIFIED_CLAIM",
    tone: "warn",
    icon: <FileWarning size={11} aria-hidden />,
  },
};

/** Tone + icon are language-independent; labels come from `t()`. */
export const groundingTone = (grounding: GroundingClass): BadgeTone => GROUNDING[grounding].tone;
export const groundingIcon = (grounding: GroundingClass): ReactNode => GROUNDING[grounding].icon;
export const groundingLabelKey = (grounding: GroundingClass): MessageKey => GROUNDING[grounding].key;
export const groundingDescKey = (grounding: GroundingClass): MessageKey => GROUNDING[grounding].descKey;

export const GroundingBadge = ({ grounding }: { grounding: GroundingClass }) => {
  const { t, lang } = useI18n();
  const meta = GROUNDING[grounding];
  // Technical labels keep the English original in the tooltip when the UI is
  // Chinese, so the operator can map it back to the API vocabulary.
  const title =
    lang === "zh-CN"
      ? `${translate("en", meta.key)} · ${t(meta.descKey)}`
      : t(meta.descKey);
  return (
    <span title={title}>
      <Badge tone={meta.tone}>
        {meta.icon}
        {t(meta.key)}
      </Badge>
    </span>
  );
};

/**
 * analysis_mode must never be ambiguous: a deterministic stub and a local LLM
 * run look identical unless the mode is labelled. `analysis_mode` from the
 * contract is STUB_DETERMINISTIC | LLM; the label says LOCAL_LLM for the
 * latter so the operator cannot read it as a hosted/real PayPal model.
 */
export const AnalysisModeBadge = ({ mode }: { mode?: string }) => {
  const { t } = useI18n();
  const raw = (mode ?? "").trim();
  const upper = raw.toUpperCase();

  if (!raw) {
    return (
      <span title={t("badge.analysisFixtureTitle")}>
        <Badge tone="scenario">{t("badge.analysisFixture")}</Badge>
      </span>
    );
  }
  if (upper === "LLM" || upper === "LOCAL_LLM") {
    return (
      <span title={t("badge.localLlmTitle", { mode: raw })}>
        <Badge tone="infer" dot>
          LOCAL_LLM
        </Badge>
      </span>
    );
  }
  if (upper === "STUB_DETERMINISTIC") {
    return (
      <span title={t("badge.stubTitle", { mode: raw })}>
        <Badge tone="neutral" dot>
          STUB_DETERMINISTIC
        </Badge>
      </span>
    );
  }
  /**
   * v1.3: a pre-recorded, verified analysis replayed offline. It is never a
   * live model result, so it must not borrow the LOCAL_LLM badge.
   */
  if (upper === "FROZEN_REPLAY") {
    return (
      <span title={t("badge.frozenTitle")} data-testid="analysis-mode-frozen">
        <Badge tone="scenario" dot>
          Frozen AI Output / Offline Replay
        </Badge>
      </span>
    );
  }
  return (
    <span title={`analysis_mode=${raw}`}>
      <Badge tone="neutral">MODE {raw}</Badge>
    </span>
  );
};

/** A replay result is simulated offline input — it is never a PayPal response. */
export const ReplaySimulatedBadge = () => {
  const { t } = useI18n();
  return (
    <span title={t("badge.replayTitle")}>
      <Badge tone="scenario">REPLAY_SIMULATED</Badge>
    </span>
  );
};

/**
 * Contract v1.1 result badge.
 *
 * The label comes from the *resolved* result, not the raw enum: an EXECUTED
 * record without LIVE + confirmed=true is shown as UNVERIFIED, and unknown
 * wire values become "Unknown result". REPLAYED never borrows live wording.
 */
const EXECUTION_RESULT: Record<
  ExecutionResult,
  { key: MessageKey; tone: BadgeTone; icon: ReactNode }
> = {
  EXECUTED: {
    key: "badge.executionResult.EXECUTED",
    tone: "pass",
    icon: <CheckCircle2 size={11} aria-hidden />,
  },
  UNVERIFIED: {
    key: "badge.executionResult.UNVERIFIED",
    tone: "warn",
    icon: <ShieldQuestion size={11} aria-hidden />,
  },
  PENDING: {
    key: "badge.executionResult.PENDING",
    tone: "warn",
    icon: <Clock size={11} aria-hidden />,
  },
  REPLAYED: {
    key: "badge.executionResult.REPLAYED",
    tone: "scenario",
    icon: <FlaskConical size={11} aria-hidden />,
  },
  BLOCKED: {
    key: "badge.executionResult.BLOCKED",
    tone: "stop",
    icon: <FileWarning size={11} aria-hidden />,
  },
  FAILED: {
    key: "badge.executionResult.FAILED",
    tone: "stop",
    icon: <FileWarning size={11} aria-hidden />,
  },
  UNKNOWN: {
    key: "badge.executionResult.UNKNOWN",
    tone: "neutral",
    icon: <CircleHelp size={11} aria-hidden />,
  },
};

export const executionResultLabelKey = (result: ExecutionResult): MessageKey =>
  EXECUTION_RESULT[result].key;

export const ExecutionResultBadge = ({
  execution,
  result,
}: {
  execution?: ExecutionRecord;
  result?: ExecutionResult;
}) => {
  const { t } = useI18n();
  const resolved = execution ? resolveExecutionResult(execution) : result;
  if (!resolved) return null;
  const meta = EXECUTION_RESULT[resolved];
  // Yellow UNVERIFIED / PENDING carry their instruction with them.
  const title =
    resolved === "UNVERIFIED"
      ? t("execution.noAutoRetry")
      : resolved === "PENDING"
        ? t("execution.pendingBody")
        : resolved === "UNKNOWN"
          ? t("execution.unknownResultBody")
          : undefined;
  return (
    <span title={title}>
      <Badge tone={meta.tone}>
        {meta.icon}
        {t(meta.key)}
      </Badge>
    </span>
  );
};
