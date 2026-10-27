/**
 * nextStep — one role-aware action, derived purely from state.
 *
 * The list must never tell a specialist to approve, a manager to analyse, or
 * anyone that an approved proposal is already executed.
 */

import { describe, expect, it } from "vitest";
import type { ActionProposal, CaseRecord } from "../src/api/types";
import { nextStep } from "../src/lib/nextStep";

const record = (overrides: Partial<CaseRecord> = {}): CaseRecord => ({
  caseId: "O18",
  disputeRef: "D-18",
  family: "INR",
  reasonCode: "OTHER",
  reasonLabel: "Other",
  amountMinor: 1000,
  currency: "USD",
  status: "WAITING_FOR_SELLER_RESPONSE",
  lifecycleStage: "INQUIRY",
  itemName: "Item",
  buyerClaim: "",
  transaction: { orderRef: "", captureRef: "", captureStatus: "", note: "" },
  openedAt: "",
  updatedAt: "",
  evidenceReadiness: { provided: 0, requested: 0, label: "" },
  aiReview: "ANALYZED",
  nextAction: "",
  validationLevel: "UNKNOWN",
  snapshotVersion: "",
  snapshotHash: "",
  fixtureNote: "",
  ...overrides,
});

const proposal = (overrides: Partial<ActionProposal> = {}): ActionProposal => ({
  proposalId: "P-O18-01",
  caseId: "O18",
  action: "send-message",
  actionLabel: "Send message to buyer",
  state: "DRAFT",
  risk: "LOW",
  rationale: [],
  evidenceIds: [],
  payload: [],
  payloadNote: "",
  requiresApproval: true,
  validation: { decision: "PASS", checks: [], summary: "" },
  policyRefs: [],
  hateoas: { observedAt: "", source: "", frozen: true, links: [] },
  snapshotVersion: "",
  snapshotHash: "",
  evidenceStatus: "",
  ...overrides,
});

describe("nextStep — role-aware routing", () => {
  it("asks a specialist to analyse a case with no analysis", () => {
    const step = nextStep({ role: "SPECIALIST", record: record({ aiReview: "NOT_STARTED" }) });
    expect(step.key).toBe("next.analyze");
    expect(step.href).toBe("/cases/O18");
  });

  it("makes a manager wait for that analysis instead of analysing it", () => {
    const step = nextStep({ role: "MANAGER", record: record({ aiReview: "NOT_STARTED" }) });
    expect(step.key).toBe("next.awaiting-analysis");
    expect(step.key).not.toBe("next.analyze");
  });

  it("sends a manager to the approval, and a specialist to waiting", () => {
    const pending = proposal({ state: "AWAITING_APPROVAL" });

    expect(nextStep({ role: "MANAGER", record: record(), proposal: pending })).toMatchObject({
      key: "next.review-approval",
      href: "/approvals/P-O18-01",
    });

    expect(nextStep({ role: "SPECIALIST", record: record(), proposal: pending })).toMatchObject({
      key: "next.awaiting-approval",
    });
  });

  it("keeps execution a separate gated step after approval", () => {
    const approved = proposal({ state: "APPROVED" });
    const step = nextStep({ role: "MANAGER", record: record(), proposal: approved });
    expect(step.key).toBe("next.execute-gated");
    expect(step.labelEn).not.toMatch(/Executed · Remote verified/);
  });

  it("asks a specialist to submit a draft and a manager to wait", () => {
    const draft = proposal({ state: "DRAFT" });
    expect(nextStep({ role: "SPECIALIST", record: record(), proposal: draft }).key).toBe(
      "next.submit",
    );
    expect(nextStep({ role: "MANAGER", record: record(), proposal: draft }).key).toBe(
      "next.awaiting-submission",
    );
  });
});
