/**
 * Internal state → merchant language (v2.1).
 *
 * The backend vocabulary is a safety vocabulary: READY_FOR_REVIEW,
 * BLOCKED_VALIDATION, NEEDS_HUMAN, REPLAYED… A merchant must never have to
 * learn it to use the product. This module is the single mapping layer:
 *
 *   - machine-readable state is preserved everywhere (badges keep the raw
 *     value in `title`/`data-*`, advanced panels still print it);
 *   - what the merchant reads is a sentence about their dispute.
 *
 * Rules encoded here:
 *   - "Validator passed" NEVER reads as "PayPal accepted" or "dispute won".
 *   - REPLAYED always says the money did not move.
 *   - UNVERIFIED says the result is unknown, not successful.
 */

import type { MessageKey } from "../i18n";

export type MerchantTone = "neutral" | "info" | "pass" | "warn" | "stop";

export interface MerchantStatus {
  /** i18n key for the short label (badge). */
  labelKey: MessageKey;
  /** i18n key for the one-line explanation (what it means for the merchant). */
  meaningKey: MessageKey;
  tone: MerchantTone;
}

/** Triage decisions produced by the autopilot run. */
const TRIAGE: Record<string, MerchantStatus> = {
  READY_FOR_REVIEW: {
    labelKey: "merchant.status.ready",
    meaningKey: "merchant.status.readyMeaning",
    tone: "info",
  },
  WAIT: {
    labelKey: "merchant.status.wait",
    meaningKey: "merchant.status.waitMeaning",
    tone: "neutral",
  },
  BLOCKED: {
    labelKey: "merchant.status.blocked",
    meaningKey: "merchant.status.blockedMeaning",
    tone: "stop",
  },
  NEEDS_HUMAN: {
    labelKey: "merchant.status.needsHuman",
    meaningKey: "merchant.status.needsHumanMeaning",
    tone: "warn",
  },
  FAILED: {
    labelKey: "merchant.status.failed",
    meaningKey: "merchant.status.failedMeaning",
    tone: "stop",
  },
};

/** Per-case outcomes of a submission batch. */
const SUBMISSION: Record<string, MerchantStatus> = {
  SUBMITTED_FOR_REVIEW: {
    labelKey: "merchant.submit.submitted",
    meaningKey: "merchant.submit.submittedMeaning",
    tone: "info",
  },
  ALREADY_SUBMITTED: {
    labelKey: "merchant.submit.already",
    meaningKey: "merchant.submit.alreadyMeaning",
    tone: "neutral",
  },
  SKIPPED_NOT_ELIGIBLE: {
    labelKey: "merchant.submit.skipped",
    meaningKey: "merchant.submit.skippedMeaning",
    tone: "neutral",
  },
  BLOCKED_VALIDATION: {
    labelKey: "merchant.submit.blocked",
    meaningKey: "merchant.submit.blockedMeaning",
    tone: "stop",
  },
  BLOCKED_STALE: {
    labelKey: "merchant.submit.stale",
    meaningKey: "merchant.submit.staleMeaning",
    tone: "warn",
  },
  FAILED: {
    labelKey: "merchant.submit.failed",
    meaningKey: "merchant.submit.failedMeaning",
    tone: "stop",
  },
};

/** Batch-level aggregate status. */
const BATCH: Record<string, MerchantStatus> = {
  COMPLETED: {
    labelKey: "merchant.batch.completed",
    meaningKey: "merchant.batch.completedMeaning",
    tone: "pass",
  },
  PARTIAL: {
    labelKey: "merchant.batch.partial",
    meaningKey: "merchant.batch.partialMeaning",
    tone: "warn",
  },
  NOTHING_SUBMITTED: {
    labelKey: "merchant.batch.nothing",
    meaningKey: "merchant.batch.nothingMeaning",
    tone: "neutral",
  },
  FAILED: {
    labelKey: "merchant.batch.failed",
    meaningKey: "merchant.batch.failedMeaning",
    tone: "stop",
  },
};

/** Execution outcomes. */
const EXECUTION: Record<string, MerchantStatus> = {
  EXECUTED: {
    labelKey: "merchant.exec.executed",
    meaningKey: "merchant.exec.executedMeaning",
    tone: "pass",
  },
  REPLAYED: {
    labelKey: "merchant.exec.replayed",
    meaningKey: "merchant.exec.replayedMeaning",
    tone: "info",
  },
  UNVERIFIED: {
    labelKey: "merchant.exec.unverified",
    meaningKey: "merchant.exec.unverifiedMeaning",
    tone: "warn",
  },
  BLOCKED: {
    labelKey: "merchant.exec.blocked",
    meaningKey: "merchant.exec.blockedMeaning",
    tone: "stop",
  },
  FAILED: {
    labelKey: "merchant.exec.failed",
    meaningKey: "merchant.exec.failedMeaning",
    tone: "stop",
  },
  PENDING: {
    labelKey: "merchant.exec.pending",
    meaningKey: "merchant.exec.pendingMeaning",
    tone: "neutral",
  },
};

const UNKNOWN: MerchantStatus = {
  labelKey: "merchant.status.unknown",
  meaningKey: "merchant.status.unknownMeaning",
  tone: "neutral",
};

const lookup = (table: Record<string, MerchantStatus>, value: string | undefined | null): MerchantStatus =>
  (value && table[value]) || UNKNOWN;

export const triageStatus = (decision: string | undefined | null): MerchantStatus =>
  lookup(TRIAGE, decision);

export const submissionStatus = (status: string | undefined | null): MerchantStatus =>
  lookup(SUBMISSION, status);

export const batchStatus = (status: string | undefined | null): MerchantStatus =>
  lookup(BATCH, status);

export const executionStatus = (status: string | undefined | null): MerchantStatus =>
  lookup(EXECUTION, status);

/**
 * Where an approval came from, in merchant words. `SINGLE_SUBMISSION` is the
 * honest answer for an approval with no batch record — never a fabricated
 * batch id.
 */
export const originStatus = (
  sourceType: string | undefined | null,
): MerchantStatus =>
  sourceType === "AUTOPILOT_BATCH"
    ? {
        labelKey: "merchant.origin.batch",
        meaningKey: "merchant.origin.batchMeaning",
        tone: "info",
      }
    : {
        labelKey: "merchant.origin.single",
        meaningKey: "merchant.origin.singleMeaning",
        tone: "neutral",
      };

/** Machine-readable reason codes → merchant explanation. */
const REASONS: Record<string, MessageKey> = {
  VALIDATOR_PASSED: "merchant.reason.validatorPassed",
  EVIDENCE_INSUFFICIENT: "merchant.reason.evidenceInsufficient",
  WAIT_NO_LEGAL_ACTION: "merchant.reason.noSafeAction",
  PAYMENT_REQUIRES_APPROVAL: "merchant.reason.paymentNeedsYou",
  NO_CANDIDATE_ACTION: "merchant.reason.noCandidate",
  VALIDATION_NOT_RUN: "merchant.reason.validationNotRun",
  VALIDATOR_BLOCKED: "merchant.reason.validatorBlocked",
  TECHNICAL_ERROR: "merchant.reason.technicalError",
  NO_EXECUTION_TRIAGE_ONLY: "merchant.reason.triageOnly",
  SUBMITTED_FOR_REVIEW: "merchant.reason.submittedForReview",
  ALREADY_PENDING_APPROVAL: "merchant.reason.alreadyPending",
  CASE_NOT_IN_RUN: "merchant.reason.caseNotInRun",
  RUN_DECISION_NOT_REVIEWABLE: "merchant.reason.notReviewable",
  NO_CANDIDATE_PROPOSAL: "merchant.reason.noCandidateProposal",
  PROPOSAL_MISSING: "merchant.reason.proposalMissing",
  PAYLOAD_CHANGED: "merchant.reason.payloadChanged",
  PROPOSAL_STATE_INELIGIBLE: "merchant.reason.stateIneligible",
  VALIDATOR_REJECTED: "merchant.reason.validatorRejected",
};

/** Falls back to the raw code so nothing is silently swallowed. */
export const reasonKey = (code: string | undefined | null): MessageKey =>
  (code && REASONS[code]) || "merchant.reason.unknown";
