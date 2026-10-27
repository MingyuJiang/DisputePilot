import type { ApprovalRecord } from "../types";

export const approvalFixtures: ApprovalRecord[] = [
  {
    approvalId: "AP-O4-01",
    proposalId: "P-O4-01",
    caseId: "O4",
    decision: "APPROVED",
    reason: "Do not imply fulfillment; message states the record gap.",
    decidedBy: "Marcus Lindqvist",
    decidedAt: "2026-10-15T03:26:00Z",
    snapshotVersion: "O4/snap-4",
  },
  {
    approvalId: "AP-O5-01",
    proposalId: "P-O5-01",
    caseId: "O5",
    decision: "APPROVED",
    reason: "Approved. Label must remain visible in the attachment.",
    decidedBy: "Marcus Lindqvist",
    decidedAt: "2026-10-15T08:06:00Z",
    snapshotVersion: "O5/snap-5",
  },
  {
    approvalId: "AP-O11-01",
    proposalId: "P-O11-01",
    caseId: "O11",
    decision: "APPROVED",
    reason: "Single attempt only; do not retry on timeout.",
    decidedBy: "Marcus Lindqvist",
    decidedAt: "2026-10-16T05:22:00Z",
    snapshotVersion: "O11/snap-4",
  },
  {
    approvalId: "AP-O16-01",
    proposalId: "P-O16-01",
    caseId: "O16",
    decision: "REJECTED",
    reason:
      "Reconcile the duplicate against the ledger first. Do not contact the buyer before the refund status is known.",
    decidedBy: "Marcus Lindqvist",
    decidedAt: "2026-10-17T01:40:00Z",
    snapshotVersion: "O16/snap-3",
  },
];
