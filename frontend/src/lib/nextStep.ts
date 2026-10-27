/**
 * Role + state → exactly one next action (FRONTEND_COMPONENT_ARCHITECTURE §1).
 *
 * Pure. Components render the returned object and never inspect role/state
 * themselves. Execution is always a separate, gated step: an approval never
 * produces an "executed" next step, and an unverified result never produces a
 * retry.
 */

import type { AIAnalysis, ActionProposal, ApprovalRecord, CaseRecord, ExecutionRecord } from "../api/types";
import { resolveExecutionResult } from "./executionResult";
import { proposalState, type Tone } from "./statusModel";

/**
 * v2.1: the merchant is the single decision maker, so `MERCHANT` may authorize
 * exactly what `MANAGER` could. `SPECIALIST` remains for read-only contexts.
 */
export type NextStepRole = "SPECIALIST" | "MANAGER" | "MERCHANT";

/**
 * RC-3 (review P1-03): capabilities, not job titles.
 *
 * The old cards asked `role !== "SPECIALIST"` and then disabled every input for
 * anyone who was not a specialist — so the single merchant could only approve,
 * never draft. These two helpers are the only place that decision is made.
 */
export const canPrepare = (role: NextStepRole): boolean =>
  role === "SPECIALIST" || role === "MERCHANT";

export const canAuthorize = (role: NextStepRole): boolean =>
  role === "MANAGER" || role === "MERCHANT";

export interface NextStep {
  key: string;
  labelEn: string;
  labelZh: string;
  tone: Tone;
  /** Where the user goes to perform it; absent when the step is "wait". */
  href?: string;
}

export interface NextStepInput {
  role: NextStepRole;
  record?: CaseRecord;
  analysis?: AIAnalysis;
  proposal?: ActionProposal;
  approval?: ApprovalRecord;
  execution?: ExecutionRecord;
}

const step = (
  key: string,
  labelEn: string,
  labelZh: string,
  tone: Tone,
  href?: string,
): NextStep => (href ? { key, labelEn, labelZh, tone, href } : { key, labelEn, labelZh, tone });

export const nextStep = ({
  role,
  record,
  analysis,
  proposal,
  approval,
  execution,
}: NextStepInput): NextStep => {
  const caseHref = record ? `/cases/${record.caseId}` : undefined;
  // Two independent capabilities, because the merchant holds both:
  //   mayAuthorize — approve / execute            (MANAGER, MERCHANT)
  //   mayPrepare   — analyse / draft / submit     (SPECIALIST, MERCHANT)
  // The backend still checks the role per call; these flags only decide which
  // label and destination the UI shows.
  const mayAuthorize = role === "MANAGER" || role === "MERCHANT";
  const mayPrepare = role === "SPECIALIST" || role === "MERCHANT";

  // 1. The request may have landed. Human review only — never a retry.
  const resolvedExecution = resolveExecutionResult(execution ?? proposal?.execution);
  if (resolvedExecution === "UNVERIFIED" || resolvedExecution === "UNKNOWN") {
    return step(
      "next.review-unverified",
      "Review unverified execution",
      "核验未确认的执行",
      "warn",
      record ? `/audit?case=${record.caseId}` : "/audit",
    );
  }

  // 2. Blocked / failed validation: no execution path exists until it is fixed.
  if (proposal) {
    const current = proposalState(proposal, execution);
    if (
      current.key === "proposal.blocked" ||
      current.key === "proposal.failed" ||
      current.key === "execution.blocked"
    ) {
      return step(
        "next.resolve-block",
        "Resolve validator block",
        "解决校验阻断",
        "stop",
        caseHref,
      );
    }

    // A backend-reported execution failure is its own outcome, not a block.
    if (current.key === "execution.failed") {
      return step(
        "next.review-failed",
        "Review failed execution",
        "复核执行失败",
        "stop",
        record ? `/audit?case=${record.caseId}` : "/audit",
      );
    }

    // 3. Awaiting a manager decision.
    if (current.key === "proposal.awaiting-approval") {
      return mayAuthorize
        ? step(
            "next.review-approval",
            "Review approval",
            "审核审批",
            "warn",
            `/approvals/${proposal.proposalId}`,
          )
        : step(
            "next.awaiting-approval",
            "Awaiting manager approval",
            "等待经理审批",
            "neutral",
            caseHref,
          );
    }

    // 4. Approved is not executed. Execution stays a separate gated step.
    if (current.key === "proposal.approved") {
      return step(
        "next.execute-gated",
        "Execute · separate gated step",
        "执行 · 独立受控步骤",
        "warn",
        caseHref,
      );
    }

    if (current.key === "proposal.rejected") {
      return mayPrepare
        ? step("next.replan", "Re-plan response", "重新制定方案", "warn", caseHref)
        : step("next.awaiting-replan", "Awaiting specialist re-plan", "等待专员重新制定", "neutral", caseHref);
    }

    if (current.key === "proposal.draft") {
      return mayPrepare
        ? step("next.submit", "Submit for approval", "提交审批", "warn", caseHref)
        : step("next.awaiting-submission", "Awaiting specialist submission", "等待专员提交", "neutral", caseHref);
    }

    if (current.key === "proposal.pending") {
      return step("next.monitor-pending", "Monitor settlement", "跟踪结算", "warn", caseHref);
    }

    if (
      current.key === "proposal.replayed" ||
      current.key === "proposal.executed-verified" ||
      current.key === "proposal.executed-unverified" ||
      current.key === "execution.replayed" ||
      current.key === "execution.executed-verified"
    ) {
      return step(
        "next.monitor-buyer",
        "Monitor buyer response",
        "跟踪买家回复",
        "neutral",
        caseHref,
      );
    }
  }

  // 5. No analysis yet: a specialist runs it; a manager waits.
  const analysed = analysis?.status === "READY" || record?.aiReview === "ANALYZED";
  if (!analysed) {
    return mayPrepare
      ? step("next.analyze", "Analyse case", "分析案件", "info", caseHref)
      : step("next.awaiting-analysis", "Awaiting analysis", "等待分析", "neutral", caseHref);
  }

  // 6. Analysis exists but no proposal: propose (specialist) / wait (manager).
  if (!proposal) {
    return mayPrepare
      ? step("next.propose", "Draft a proposal", "起草处理建议", "info", caseHref)
      : step("next.awaiting-proposal", "Awaiting proposal", "等待处理建议", "neutral", caseHref);
  }

  // A rejected approval without a proposal state change still needs a decision.
  if (approval?.decision === "REJECTED") {
    return step("next.replan", "Re-plan response", "重新制定方案", "warn", caseHref);
  }

  return step("next.review", "Review case", "审核案件", "neutral", caseHref);
};
