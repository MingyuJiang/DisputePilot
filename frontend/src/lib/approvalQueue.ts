/**
 * Approval queue projection (FRONTEND_REDESIGN_PLAN §3.5).
 *
 * The backend exposes no priority endpoint: priority, age and risk are derived
 * from the proposal + approval records that are already loaded. Pending items
 * always sort before decided ones; high risk and a capability snapshot at or
 * past its freshness window raise an item inside the pending group.
 *
 * The queue never renders V1–V12/V13–V18 check rows: it shows the validator
 * decision and pass/fail counts only. Details live on `/approvals/:id`.
 */

import type { ActionProposal, ApprovalRecord, CaseRecord, RiskLevel } from "../api/types";
import { approvalState, validationState, type DisplayState } from "./statusModel";

/** V9 freshness window used by the validator. */
export const SNAPSHOT_FRESHNESS_MINUTES = 30;
/** Warn before expiry so a manager can decide while the snapshot is still valid. */
export const SNAPSHOT_NEAR_EXPIRY_MINUTES = 20;

export type ApprovalPriority = "urgent" | "pending" | "decided";

export interface ApprovalQueueRow {
  proposal: ActionProposal;
  case?: CaseRecord;
  approval?: ApprovalRecord;
  approvalDisplay: DisplayState;
  validator: DisplayState;
  passed: number;
  failed: number;
  waitingMinutes: number | null;
  /**
   * Ordering-only fallback for rows whose approval creation time is unknown.
   * Never rendered as a creation time; see buildApprovalQueue.
   */
  fallbackWaitingMinutes: number | null;
  snapshotAgeMinutes: number | null;
  nearExpiry: boolean;
  priority: ApprovalPriority;
  pending: boolean;
}

export interface ApprovalQueueSnapshot {
  proposals: ActionProposal[];
  approvals: ApprovalRecord[];
  cases: CaseRecord[];
}

const RISK_RANK: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  BLOCKED: 3,
};

const minutesSince = (iso: string | undefined, now: number): number | null => {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now - at) / 60_000));
};

const isPending = (proposal: ActionProposal): boolean =>
  proposal.state === "AWAITING_APPROVAL";

/**
 * A pending proposal without an approval record still displays "Awaiting
 * approval": the decision status is derived from the explicit proposal state,
 * never silently rendered as "no record".
 */
const displayApproval = (
  approval: ApprovalRecord | undefined,
  pending: boolean,
): DisplayState =>
  approval
    ? approvalState(approval)
    : pending
      ? approvalState({ decision: "PENDING" })
      : approvalState(undefined);

/**
 * Approval-creation times keyed by approval id.
 *
 * The only persisted source is the submission-origin endpoint
 * (`approval_created_at`); a `null` value means "not recorded" (a legacy
 * approval that could not be matched to an audit event). The map is supplied by
 * the page because it is fetched asynchronously — this function never invents a
 * time, and never falls back to `decided_at`.
 */
export type ApprovalCreatedTimes = Map<string, string | null>;

export const buildApprovalQueue = (
  snapshot: ApprovalQueueSnapshot,
  now: number = Date.now(),
  approvalCreatedTimes: ApprovalCreatedTimes = new Map(),
): ApprovalQueueRow[] => {
  const casesById = new Map(snapshot.cases.map((record) => [record.caseId, record]));
  const approvalByProposal = new Map(
    snapshot.approvals.map((approval) => [approval.proposalId, approval]),
  );

  const rows = snapshot.proposals
    .filter((proposal) => isPending(proposal) || approvalByProposal.has(proposal.proposalId))
    .map<ApprovalQueueRow>((proposal) => {
      const approval = approvalByProposal.get(proposal.proposalId);
      const pending = isPending(proposal);
      const passed = proposal.validation.checks.filter((check) => check.status === "PASS").length;
      const failed = proposal.validation.checks.filter((check) => check.status === "FAIL").length;
      const snapshotAgeMinutes = minutesSince(proposal.hateoas.observedAt, now);
      const nearExpiry =
        pending &&
        snapshotAgeMinutes !== null &&
        snapshotAgeMinutes >= SNAPSHOT_NEAR_EXPIRY_MINUTES;
      const risky = proposal.risk === "HIGH" || proposal.risk === "BLOCKED";
      // Waiting time starts at the persisted approval creation time. When it is
      // unknown (legacy row) the value stays null: the UI says so instead of
      // showing a duration that was never recorded.
      const createdAt = approval
        ? approvalCreatedTimes.get(approval.approvalId) ?? null
        : null;
      // Ordering-only fallback for rows without a persisted creation time.
      // This is the proposal's submit time, NOT an approval creation time, and
      // it is never shown to the user as one.
      const fallbackWaitingMinutes = minutesSince(proposal.submittedAt, now);

      return {
        proposal,
        case: casesById.get(proposal.caseId),
        approval,
        approvalDisplay: displayApproval(approval, pending),
        validator: validationState(proposal.validation.decision),
        passed,
        failed,
        waitingMinutes: createdAt ? minutesSince(createdAt, now) : null,
        fallbackWaitingMinutes,
        snapshotAgeMinutes,
        nearExpiry,
        pending,
        priority: pending ? (risky || nearExpiry ? "urgent" : "pending") : "decided",
      };
    });

  const priorityRank: Record<ApprovalPriority, number> = { urgent: 0, pending: 1, decided: 2 };

  return rows.sort((a, b) => {
    if (priorityRank[a.priority] !== priorityRank[b.priority]) {
      return priorityRank[a.priority] - priorityRank[b.priority];
    }
    if (a.proposal.risk !== b.proposal.risk) {
      return RISK_RANK[b.proposal.risk] - RISK_RANK[a.proposal.risk];
    }
    // Rows with a persisted creation time sort first (longest wait first, the
    // existing direction); rows without one go last, ordered by the documented
    // fallback key and finally by proposal id so the order is always stable.
    const aKnown = a.waitingMinutes !== null;
    const bKnown = b.waitingMinutes !== null;
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    const aKey = a.waitingMinutes ?? a.fallbackWaitingMinutes ?? -1;
    const bKey = b.waitingMinutes ?? b.fallbackWaitingMinutes ?? -1;
    if (aKey !== bKey) return bKey - aKey;
    return a.proposal.proposalId.localeCompare(b.proposal.proposalId);
  });
};

export const approvalActionOptions = (rows: ApprovalQueueRow[]): string[] => {
  const seen = new Set<string>();
  rows.forEach((row) => seen.add(row.proposal.action));
  return [...seen].sort();
};

export const filterApprovalQueue = (
  rows: ApprovalQueueRow[],
  filters: { action: string; risk: string; query: string },
): ApprovalQueueRow[] => {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.action !== "ALL" && row.proposal.action !== filters.action) return false;
    if (filters.risk !== "ALL" && row.proposal.risk !== filters.risk) return false;
    if (!query) return true;
    return (
      row.proposal.caseId.toLowerCase().includes(query) ||
      row.proposal.proposalId.toLowerCase().includes(query) ||
      row.proposal.actionLabel.toLowerCase().includes(query) ||
      (row.case?.itemName.toLowerCase().includes(query) ?? false)
    );
  });
};
