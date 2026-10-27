/**
 * statusModel — the single display-state source (FRONTEND_STATE_MODEL.md).
 *
 * These are business invariants, not cosmetics: an approval is not an
 * execution, an offline replay is not a live execution, a failure is not a
 * block, and an unrecognised value is never quietly normalised.
 */

import { describe, expect, it } from "vitest";
import type { CaseRecord, ExecutionRecord } from "../src/api/types";
import { nextStep } from "../src/lib/nextStep";
import {
  approvalState,
  captureState,
  caseState,
  executionState,
  proposalState,
  sourceOf,
  validationState,
} from "../src/lib/statusModel";

const record = (overrides: Partial<CaseRecord> = {}): CaseRecord => ({
  caseId: "C-1",
  disputeRef: "D-1",
  family: "INR",
  reasonCode: "OTHER",
  reasonLabel: "Other",
  amountMinor: 2200,
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

const execution = (overrides: Partial<ExecutionRecord> = {}): ExecutionRecord => ({
  executionMode: "LIVE",
  simulated: false,
  result: "EXECUTED",
  verification: { method: "LIVE_GET", confirmed: true },
  ...overrides,
});

describe("statusModel — proposal invariants", () => {
  it("never shows APPROVED as executed", () => {
    const shown = proposalState({ state: "APPROVED" });
    expect(shown.key).toBe("proposal.approved");
    expect(shown.labelEn).toBe("Approved · not executed");
    expect(shown.labelEn).not.toMatch(/^Executed/);
    expect(shown.tone).toBe("info");
  });

  it("shows REPLAY_EXECUTED as Replayed (offline), never EXECUTED", () => {
    const shown = proposalState({ state: "REPLAY_EXECUTED" });
    expect(shown.key).toBe("proposal.replayed");
    expect(shown.labelEn).toBe("Replayed (offline)");
    // A replay is neither a success nor a failure.
    expect(shown.tone).toBe("neutral");
  });

  it("keeps FAILED distinct from BLOCKED", () => {
    const failed = proposalState({ state: "FAILED" });
    const blocked = proposalState({ state: "BLOCKED" });
    expect(failed.key).toBe("proposal.failed");
    expect(blocked.key).toBe("proposal.blocked");
    expect(failed.key).not.toBe(blocked.key);
    expect(failed.tone).toBe("stop");
    expect(blocked.tone).toBe("stop");
  });

  it("preserves an unknown wire value instead of falling back to DRAFT", () => {
    const shown = proposalState({ state: "SOMETHING_NEW" });
    expect(shown.key).toBe("proposal.unknown");
    expect(shown.raw).toBe("SOMETHING_NEW");
    expect(shown.tone).toBe("neutral");
    expect(shown.labelEn).not.toBe("Draft");
  });

  it("lets an execution record outrank the proposal state", () => {
    const shown = proposalState(
      { state: "APPROVED" },
      execution({ executionMode: "REPLAY", simulated: true, result: "REPLAYED", verification: {} }),
    );
    expect(shown.key).toBe("execution.replayed");
    expect(shown.tone).toBe("neutral");
  });
});

describe("statusModel — execution invariants", () => {
  it("only allows 'Executed · Remote verified' for LIVE + confirmed", () => {
    expect(executionState(execution())).toMatchObject({
      key: "execution.executed-verified",
      tone: "pass",
    });

    // REPLAY mode reporting EXECUTED is not a live success.
    expect(
      executionState(execution({ executionMode: "REPLAY", simulated: true })),
    ).toMatchObject({ key: "execution.unverified", tone: "warn" });

    // A LIVE request without a confirmed GET is unverified.
    expect(
      executionState(execution({ verification: { method: "LIVE_GET", confirmed: false } })),
    ).toMatchObject({ key: "execution.unverified", tone: "warn" });
  });

  it("never counts PENDING as a success", () => {
    const shown = executionState(execution({ result: "PENDING", verification: {} }));
    expect(shown.key).toBe("execution.pending");
    expect(shown.tone).toBe("warn");
    expect(shown.tone).not.toBe("pass");
  });

  it("reports no record as not executed, with a neutral tone", () => {
    expect(executionState(undefined)).toMatchObject({
      key: "execution.none",
      tone: "neutral",
    });
  });

  it("offers no retry entry point for an unverified execution", () => {
    const step = nextStep({
      role: "SPECIALIST",
      record: record(),
      execution: execution({ result: "UNVERIFIED", verification: { confirmed: false } }),
    });
    expect(step.key).toBe("next.review-unverified");
    expect(step.tone).toBe("warn");
    expect(step.key).not.toMatch(/retry/);
    expect(step.href).toBe("/audit?case=C-1");
  });
});

describe("statusModel — approval and case state", () => {
  it("reads approval state from the approval record, and approve ≠ execute", () => {
    expect(approvalState(undefined).key).toBe("approval.none");
    expect(approvalState({ decision: "PENDING" })).toMatchObject({
      key: "approval.pending",
      tone: "warn",
    });
    expect(approvalState({ decision: "APPROVED" })).toMatchObject({
      key: "approval.approved",
      labelEn: "Approved · not executed",
      tone: "info",
    });
  });

  it("uses the capture status for a payment case, never the dispute status", () => {
    const payment = record({
      caseId: "CAP-DEMO-1",
      actionFamily: "PAYMENT",
      status: "UNDER_REVIEW",
      captureSnapshot: {
        captureId: "CAP-DEMO-1",
        originalAmount: "22.00",
        totalRefunded: "0.00",
        refundableRemaining: "22.00",
        currencyCode: "USD",
        status: "COMPLETED",
      },
    });
    expect(caseState(payment).key).toBe("case.capture-completed");

    const unknownStatus = record({ status: "BRAND_NEW_STATUS" as CaseRecord["status"] });
    const shown = caseState(unknownStatus);
    expect(shown.key).toBe("case.unknown");
    expect(shown.raw).toBe("BRAND_NEW_STATUS");
    expect(shown.tone).toBe("neutral");
  });
});

describe("statusModel — source vocabulary", () => {
  it("labels runtime, frozen AI, fixture capability and synthetic capture honestly", () => {
    expect(
      sourceOf({ health: { executionMode: "REPLAY", networkAccess: "NONE", source: "local" } })[0],
    ).toMatchObject({ key: "source.offline-replay", tone: "neutral" });

    const frozen = sourceOf({ analysisMode: "FROZEN_REPLAY" });
    expect(frozen.map((item) => item.key)).toContain("source.analysis.frozen");
    expect(frozen.some((item) => item.key === "source.analysis.live-llm")).toBe(false);

    expect(sourceOf({ analysisMode: "LLM" })[0].key).toBe("source.analysis.live-llm");
    expect(sourceOf({ basis: "FIXTURE_SNAPSHOT" })[0].key).toBe("source.basis.fixture");
    expect(sourceOf({ capture: { source: "SYNTHETIC_OFFLINE_FIXTURE" } })[0].key).toBe(
      "source.capture.synthetic",
    );
    expect(sourceOf({})).toEqual([]);
  });
});

describe("statusModel — validation and capture states", () => {
  it("maps validator decisions without inventing a report", () => {
    expect(validationState("PASS")).toMatchObject({ key: "validation.passed", tone: "pass" });
    expect(validationState("BLOCKED")).toMatchObject({ key: "validation.blocked", tone: "stop" });
    expect(validationState("NEEDS_REVIEW")).toMatchObject({
      key: "validation.review",
      tone: "warn",
    });
    expect(validationState(undefined).key).toBe("validation.unknown");
  });

  it("keeps capture states separate from dispute states", () => {
    expect(captureState("COMPLETED")).toMatchObject({
      key: "case.capture-completed",
      tone: "neutral",
    });
    expect(captureState("PARTIALLY_REFUNDED").tone).toBe("info");
    expect(captureState("NOT_A_STATUS").raw).toBe("NOT_A_STATUS");
    // A dispute value is never a capture state.
    expect(captureState("UNDER_REVIEW").key).toBe("case.capture-unknown");
  });
});

describe("statusModel — capture header", () => {
  it("uses the normalized capture status, not the dispute UNKNOWN", () => {
    const shown = caseState(
      record({ caseId: "CAP-1", actionFamily: "PAYMENT", status: "UNKNOWN" }),
      "COMPLETED",
    );
    expect(shown.labelEn).toBe("Capture completed");
    expect(shown.tone).not.toBe("pass");
    expect(shown.labelEn).not.toMatch(/Unknown/i);
  });
});
