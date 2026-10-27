/**
 * Merchant language mapping (v2.1).
 *
 * The product must never show an internal state as the only label, and must
 * never imply a result the backend did not report. These tests pin both rules.
 */

import { describe, expect, it } from "vitest";
import { messages } from "../src/i18n/messages";
import {
  batchStatus,
  executionStatus,
  originStatus,
  reasonKey,
  submissionStatus,
  triageStatus,
} from "../src/lib/merchantLanguage";

const en = (key: string): string => {
  const entry = (messages as Record<string, { en: string; zh: string }>)[key];
  return entry ? entry.en : "";
};

describe("merchant language", () => {
  it("translates every triage decision into merchant wording", () => {
    for (const decision of ["READY_FOR_REVIEW", "WAIT", "BLOCKED", "NEEDS_HUMAN", "FAILED"]) {
      const status = triageStatus(decision);
      expect(status.labelKey).not.toBe("merchant.status.unknown");
      expect(en(status.labelKey).length).toBeGreaterThan(0);
      expect(en(status.meaningKey).length).toBeGreaterThan(0);
    }
  });

  it("never calls a validator pass a PayPal acceptance", () => {
    const ready = en(triageStatus("READY_FOR_REVIEW").labelKey);
    const meaning = en(triageStatus("READY_FOR_REVIEW").meaningKey);
    expect(ready.toLowerCase()).not.toContain("paypal");
    expect(meaning.toLowerCase()).toContain("nothing has been sent");
  });

  it("keeps an offline replay explicitly simulated", () => {
    const replayed = executionStatus("REPLAYED");
    expect(en(replayed.labelKey).toLowerCase()).toContain("no money moved");
    expect(en(replayed.meaningKey).toLowerCase()).toContain("no real paypal action");
  });

  it("keeps an unverified result unknown, not successful", () => {
    const unverified = executionStatus("UNVERIFIED");
    expect(en(unverified.labelKey).toLowerCase()).toContain("not confirmed");
    expect(unverified.tone).toBe("warn");
  });

  it("maps every submission outcome and batch status", () => {
    for (const status of [
      "SUBMITTED_FOR_REVIEW",
      "ALREADY_SUBMITTED",
      "SKIPPED_NOT_ELIGIBLE",
      "BLOCKED_VALIDATION",
      "BLOCKED_STALE",
      "FAILED",
    ]) {
      expect(en(submissionStatus(status).labelKey).length).toBeGreaterThan(0);
    }
    for (const status of ["COMPLETED", "PARTIAL", "NOTHING_SUBMITTED", "FAILED"]) {
      expect(en(batchStatus(status).labelKey).length).toBeGreaterThan(0);
    }
  });

  it("describes a missing batch origin without inventing one", () => {
    const single = originStatus("SINGLE_SUBMISSION");
    expect(en(single.labelKey).toLowerCase()).toContain("prepared for this dispute");
    const batch = originStatus("AUTOPILOT_BATCH");
    expect(en(batch.labelKey).toLowerCase()).toContain("ai assistant run");
  });

  it("falls back to the raw code for an unknown reason", () => {
    expect(reasonKey("SOMETHING_NEW")).toBe("merchant.reason.unknown");
    expect(reasonKey("EVIDENCE_INSUFFICIENT")).toBe("merchant.reason.evidenceInsufficient");
  });

  it("returns the unknown status for an unrecognised value", () => {
    expect(triageStatus("NOT_A_STATE").labelKey).toBe("merchant.status.unknown");
    expect(executionStatus(undefined).labelKey).toBe("merchant.status.unknown");
  });
});
