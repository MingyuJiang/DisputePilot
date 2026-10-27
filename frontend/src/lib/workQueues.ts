/**
 * Overview work queues (FRONTEND_REDESIGN_PLAN §3.1).
 *
 * The backend exposes no global queue endpoint: every queue is derived from
 * the currently loaded workspace snapshot. When the workspace has not loaded,
 * the count is `null` and the UI renders "—" instead of a fabricated number.
 */

import type { WorkspaceState } from "../api/store";
import type { CaseRecord } from "../api/types";
import { buildExecutionLedger } from "./executionLedger";
import { proposalState, type Tone } from "./statusModel";

export type WorkQueueKey = "analysis" | "approval" | "blocked" | "review" | "recent";

export interface WorkQueueItem {
  /** Unique key inside the queue (proposal id or case id). */
  id: string;
  caseId: string;
  label: string;
  href: string;
}

export interface WorkQueue {
  key: WorkQueueKey;
  labelEn: string;
  labelZh: string;
  descriptionEn: string;
  descriptionZh: string;
  tone: Tone;
  /** `null` = not computable from loaded data; render "—". */
  count: number | null;
  items: WorkQueueItem[];
  viewAllHref: string;
}

const dedupe = (items: WorkQueueItem[]): WorkQueueItem[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
};

const caseLabel = (record: CaseRecord | undefined, caseId: string): string =>
  record ? `${caseId} · ${record.itemName}` : caseId;

export const buildWorkQueues = (
  snapshot: WorkspaceState,
  options: { loaded: boolean },
): WorkQueue[] => {
  const casesById = new Map(snapshot.cases.map((record) => [record.caseId, record]));
  const all = (items: WorkQueueItem[]): WorkQueueItem[] => dedupe(items);
  const count = (items: WorkQueueItem[]): number | null => (options.loaded ? items.length : null);

  const needsAnalysis = all(
    snapshot.cases
      .filter((record) => record.aiReview !== "ANALYZED")
      .map((record) => ({
        id: record.caseId,
        caseId: record.caseId,
        label: caseLabel(record, record.caseId),
        href: `/cases/${record.caseId}`,
      })),
  );

  const awaitingApproval = all(
    snapshot.proposals
      .filter((proposal) => proposalState(proposal).key === "proposal.awaiting-approval")
      .map((proposal) => ({
        id: proposal.proposalId,
        caseId: proposal.caseId,
        label: `${caseLabel(casesById.get(proposal.caseId), proposal.caseId)} · ${proposal.actionLabel}`,
        href: `/approvals/${proposal.proposalId}`,
      })),
  );

  const blocked = all(
    snapshot.proposals
      .filter((proposal) => {
        const current = proposalState(proposal);
        return (
          current.key === "proposal.blocked" ||
          current.key === "proposal.failed" ||
          current.key === "execution.blocked"
        );
      })
      .map((proposal) => ({
        id: proposal.proposalId,
        caseId: proposal.caseId,
        label: caseLabel(casesById.get(proposal.caseId), proposal.caseId),
        href: `/cases/${proposal.caseId}`,
      })),
  );

  // Execution state is derived from the execution record when present, and
  // from the replay audit events otherwise (the existing ledger rule).
  const ledger = buildExecutionLedger(snapshot.proposals, snapshot.audit);

  const needsReview = all(
    ledger
      .filter((row) => row.state === "UNVERIFIED")
      .map((row) => ({
        id: row.proposal.proposalId,
        caseId: row.proposal.caseId,
        label: caseLabel(casesById.get(row.proposal.caseId), row.proposal.caseId),
        href: `/audit?case=${row.proposal.caseId}`,
      })),
  );

  const recentlyExecuted = all(
    ledger
      .filter(
        (row) => row.state === "REPLAYED" || row.state === "EXECUTED" || row.state === "VERIFIED",
      )
      .map((row) => ({
        id: row.proposal.proposalId,
        caseId: row.proposal.caseId,
        label: caseLabel(casesById.get(row.proposal.caseId), row.proposal.caseId),
        href: `/audit?case=${row.proposal.caseId}`,
      })),
  );

  return [
    {
      key: "analysis",
      labelEn: "Needs analysis",
      labelZh: "待分析",
      descriptionEn: "No AI analysis has been produced for these cases yet.",
      descriptionZh: "这些案件尚未产出 AI 分析。",
      tone: "info",
      count: count(needsAnalysis),
      items: needsAnalysis,
      viewAllHref: "/cases",
    },
    {
      key: "approval",
      labelEn: "Awaiting approval",
      labelZh: "待审批",
      descriptionEn: "A manager decision is required before any execution.",
      descriptionZh: "任何执行前都需要经理决策。",
      tone: "warn",
      count: count(awaitingApproval),
      items: awaitingApproval,
      viewAllHref: "/approvals",
    },
    {
      key: "blocked",
      labelEn: "Blocked",
      labelZh: "已阻断",
      descriptionEn: "Refused by validation or by the execution gate. Nothing was sent.",
      descriptionZh: "被校验或执行闸门拒绝，未发送任何请求。",
      tone: "stop",
      count: count(blocked),
      items: blocked,
      viewAllHref: "/cases",
    },
    {
      key: "review",
      labelEn: "Needs human review",
      labelZh: "需人工核验",
      descriptionEn: "Execution result is unknown. No automatic retry is offered.",
      descriptionZh: "执行结果未知，不提供自动重试。",
      tone: "warn",
      count: count(needsReview),
      items: needsReview,
      viewAllHref: "/audit",
    },
    {
      key: "recent",
      labelEn: "Recently executed / replayed",
      labelZh: "最近执行 / 回放",
      descriptionEn: "Offline replays and remote-verified executions, newest first.",
      descriptionZh: "离线回放与远端已核验执行，最新在前。",
      tone: "neutral",
      count: count(recentlyExecuted),
      items: recentlyExecuted,
      viewAllHref: "/audit",
    },
  ];
};
