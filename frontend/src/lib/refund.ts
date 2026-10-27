/**
 * Refund draft rules (UI side, pure).
 *
 * Contract v1.2 makes the backend the authority for everything that moves
 * money: it reads the capture, back-fills `capture_snapshot`, validates
 * V13–V18 and computes the payload hash. This module only mirrors the shape of
 * those rules so the operator never fills a draft that cannot be submitted,
 * and so every disabled control carries a reason. Nothing here sends a request.
 *
 * A refund moves funds out of a capture. It is NOT dispute resolution: this
 * module never produces "resolved" / "buyer accepted" wording.
 */

import type {
  ActionProposal,
  CaptureSnapshot,
  CaseRecord,
  ExecutionRecord,
  ExecutionResult,
} from "../api/types";
import { resolveExecutionResult } from "./executionResult";
import { stableDigest } from "./sendMessage";

export type RefundMode = "partial" | "full";

export const REFUND_ACTION_KINDS = ["partial-refund", "full-refund"] as const;

export const isRefundAction = (action?: string): boolean =>
  action === "partial-refund" || action === "full-refund";

export const refundModeOf = (action?: string): RefundMode | undefined =>
  action === "full-refund" ? "full" : action === "partial-refund" ? "partial" : undefined;

/**
 * Contract v1.2: `action_family=PAYMENT`, or the case id form `CAP-<capture_id>`.
 * Both signals are only ever used to SHOW the refund card; neither authorises
 * an execution.
 */
export const isPaymentCase = (
  record: Pick<CaseRecord, "caseId" | "actionFamily">,
  proposals: ActionProposal[] = [],
): boolean =>
  record.actionFamily === "PAYMENT" ||
  record.caseId.trim().toUpperCase().startsWith("CAP-") ||
  proposals.some(
    (proposal) => proposal.actionFamily === "PAYMENT" || isRefundAction(proposal.action),
  );

/** Strict decimal string: digits + exactly two fraction digits (no separators). */
export const parseDecimalAmountToMinor = (value: string): number | undefined => {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(text)) return undefined;
  const [whole, fraction] = text.split(".");
  return Number(whole) * 100 + Number(fraction);
};

export const formatAmountMinor = (minor: number): string => (minor / 100).toFixed(2);

const parseSnapshotAmount = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value !== "string") return undefined;
  return parseDecimalAmountToMinor(value);
};

/**
 * Tolerant reader for the backend snapshot (snake_case) or a fixture
 * (camelCase). Unknown / malformed values stay undefined — never guessed.
 */
export const normalizeCaptureSnapshot = (raw: unknown): CaptureSnapshot | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const read = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
    }
    return undefined;
  };
  const captureId = read("captureId", "capture_id");
  const originalAmount = read("originalAmount", "original_amount");
  const totalRefunded = read("totalRefunded", "total_refunded");
  const refundableRemaining = read("refundableRemaining", "refundable_remaining");
  const currencyCode = read("currencyCode", "currency_code", "currency");
  const status = read("status");
  if (!captureId || !originalAmount || !totalRefunded || !refundableRemaining || !currencyCode) {
    return undefined;
  }
  return {
    captureId,
    originalAmount,
    totalRefunded,
    refundableRemaining,
    currencyCode,
    status: status ?? "UNKNOWN",
  };
};

/** Everything the card may display before / after a draft exists. */
export interface RefundCaptureView {
  captureId: string;
  currency: string;
  originalMinor?: number;
  totalRefundedMinor?: number;
  remainingMinor?: number;
  status?: string;
  /** `proposal` = server back-filled snapshot; `case` = case-level values only. */
  source: "proposal" | "case";
}

export const latestRefundProposal = (proposals: ActionProposal[]): ActionProposal | undefined => {
  const matching = proposals.filter((proposal) => isRefundAction(proposal.action));
  return matching[matching.length - 1];
};

/** Refund amount carried by a proposal payload (`amount` → label "Amount"). */
export const refundAmountMinorOf = (proposal?: ActionProposal): number | undefined => {
  const field = proposal?.payload.find(
    (entry) => entry.label === "Amount" || entry.label === "Refund amount",
  );
  return field ? parseDecimalAmountToMinor(field.value) : undefined;
};

export const refundReasonOf = (proposal?: ActionProposal): string =>
  proposal?.payload.find((entry) => entry.label === "Refund reason")?.value ?? "";

export const refundIdempotencyKey = (input: {
  caseId: string;
  captureId: string;
  mode: RefundMode;
  amount?: string;
  reason: string;
}): string =>
  `DP-REFUND-${input.captureId.trim().toUpperCase()}-${stableDigest(
    `${input.caseId}\u0000${input.captureId}\u0000${input.mode}\u0000${input.amount ?? "FULL"}\u0000${input.reason}`,
  )
    .slice(0, 12)
    .toUpperCase()}`;

/**
 * The capture view for the card. The server snapshot (on the proposal) wins;
 * a case-level amount / capture reference is only a display fallback, never an
 * authority for the refundable remaining.
 */
export const captureViewOf = (
  record: Pick<
    CaseRecord,
    "caseId" | "amountMinor" | "currency" | "transaction" | "captureSnapshot"
  >,
  proposal?: ActionProposal,
): RefundCaptureView => {
  const snapshot = proposal?.captureSnapshot ?? record.captureSnapshot;
  if (snapshot) {
    return {
      captureId: snapshot.captureId,
      currency: snapshot.currencyCode,
      originalMinor: parseSnapshotAmount(snapshot.originalAmount),
      totalRefundedMinor: parseSnapshotAmount(snapshot.totalRefunded),
      remainingMinor: parseSnapshotAmount(snapshot.refundableRemaining),
      status: snapshot.status,
      // Only a snapshot carried by the proposal was back-filled by the server.
      source: proposal?.captureSnapshot ? "proposal" : "case",
    };
  }
  // `CAP-<capture_id>` is the contract's payment case form; the transaction
  // reference may still be UNKNOWN before the capture is read, so the case id
  // is the honest capture reference here (never a guessed value).
  const captureFromCase = record.caseId.trim().toUpperCase().startsWith("CAP-")
    ? record.caseId.trim()
    : "";
  const captureRef = record.transaction.captureRef;
  return {
    captureId:
      captureFromCase ||
      (captureRef && captureRef.toUpperCase() !== "UNKNOWN" ? captureRef : ""),
    currency: record.currency,
    originalMinor: record.amountMinor,
    source: "case",
  };
};

export type RefundValidationReason =
  | "capture_unavailable"
  | "amount_required"
  | "amount_format"
  | "amount_positive"
  | "amount_exceeds_remaining"
  | "nothing_refundable"
  | "reason_required";

export type RefundValidation =
  | { ok: true; amountMinor?: number; amountDecimal?: string }
  | { ok: false; reason: RefundValidationReason };

/**
 * UI mirror of V13–V18. `remainingMinor` may be unknown before the server has
 * read the capture; the upper bound is then skipped (the backend re-checks it,
 * and a full refund is still expressed as "the server-defined remainder").
 */
export const validateRefundDraft = (input: {
  mode: RefundMode;
  amount?: string;
  reason: string;
  remainingMinor?: number;
  captureId?: string;
}): RefundValidation => {
  if (!input.captureId || !input.captureId.trim()) return { ok: false, reason: "capture_unavailable" };

  if (input.mode === "full") {
    if (input.remainingMinor !== undefined && input.remainingMinor <= 0) {
      return { ok: false, reason: "nothing_refundable" };
    }
    if (input.reason.trim().length === 0) return { ok: false, reason: "reason_required" };
    return input.remainingMinor === undefined
      ? { ok: true }
      : {
          ok: true,
          amountMinor: input.remainingMinor,
          amountDecimal: formatAmountMinor(input.remainingMinor),
        };
  }

  const raw = (input.amount ?? "").trim();
  if (!raw) return { ok: false, reason: "amount_required" };
  const minor = parseDecimalAmountToMinor(raw);
  if (minor === undefined) return { ok: false, reason: "amount_format" };
  if (minor <= 0) return { ok: false, reason: "amount_positive" };
  if (input.remainingMinor !== undefined && minor > input.remainingMinor) {
    return { ok: false, reason: "amount_exceeds_remaining" };
  }
  if (input.reason.trim().length === 0) return { ok: false, reason: "reason_required" };
  return { ok: true, amountMinor: minor, amountDecimal: formatAmountMinor(minor) };
};

/** Once submitted or approved, the exact amount is bound; a change is a NEW proposal. */
export const isRefundLocked = (state?: ActionProposal["state"]): boolean =>
  state === "AWAITING_APPROVAL" ||
  state === "APPROVED" ||
  state === "EXECUTED" ||
  state === "PENDING" ||
  state === "UNVERIFIED" ||
  state === "REPLAYED" ||
  state === "FAILED" ||
  state === "CANCELLED";

export interface RefundExpectation {
  captureId?: string;
  amountMinor?: number;
  currency?: string;
}

/**
 * What the UI may claim about a refund execution.
 *
 * EXECUTED requires ALL of: LIVE + confirmed verification (the v1.1 rule), a
 * remote status of COMPLETED, and an amount / currency / capture that match
 * the proposal. Anything short of that is PENDING (accepted, not settled) or
 * UNVERIFIED — never success.
 */
export const refundOutcome = (
  execution?: ExecutionRecord,
  expected?: RefundExpectation,
  base: ExecutionResult | undefined = undefined,
): ExecutionResult | undefined => {
  const resolved = base ?? resolveExecutionResult(execution);
  if (!resolved) return undefined;

  if (resolved !== "EXECUTED") return resolved;

  const verification = execution?.verification;
  const live = execution?.executionMode === "LIVE" || execution?.simulated === false;
  if (!live || verification?.confirmed !== true) return "UNVERIFIED";

  const remote = (verification.remoteStatus ?? "").trim().toUpperCase();
  if (remote === "PENDING" || remote === "PROCESSING" || remote === "ACCEPTED") return "PENDING";
  if (remote !== "COMPLETED") return "UNVERIFIED";

  const observations = verification.observations ?? {};
  // EXECUTED requires the proposal's own amount to compare against.
  if (expected && expected.amountMinor === undefined) return "UNVERIFIED";
  const currency = (observations.currency_code ?? observations.currency ?? "").toUpperCase();
  const capture = observations.capture_id ?? observations.captureId ?? "";
  const amountRaw = observations.amount ?? observations.refund_amount ?? observations.value ?? "";
  const amountMinor = parseDecimalAmountToMinor(String(amountRaw));

  if (expected?.currency && currency !== expected.currency.toUpperCase()) return "UNVERIFIED";
  if (!currency) return "UNVERIFIED";
  if (expected?.captureId && capture.toUpperCase() !== expected.captureId.toUpperCase()) {
    return "UNVERIFIED";
  }
  if (expected?.amountMinor !== undefined && amountMinor !== expected.amountMinor) {
    return "UNVERIFIED";
  }
  if (expected?.amountMinor !== undefined && amountMinor === undefined) return "UNVERIFIED";

  return "EXECUTED";
};

/**
 * Proposal display state for a refund, derived from the vetted refund outcome.
 * A mismatched EXECUTED record stops at UNVERIFIED; a PENDING one stays PENDING.
 */
export const refundProposalState = (
  execution: ExecutionRecord | undefined,
  expected: RefundExpectation | undefined,
  fallback: ActionProposal["state"],
): ActionProposal["state"] => {
  const outcome = refundOutcome(execution, expected);
  switch (outcome) {
    case "PENDING":
      return "PENDING";
    case "EXECUTED":
      return "EXECUTED";
    case "UNVERIFIED":
    case "UNKNOWN":
      return "UNVERIFIED";
    case "FAILED":
      return "FAILED";
    case "BLOCKED":
      return "BLOCKED";
    case "REPLAYED":
      return "REPLAYED";
    default:
      return fallback;
  }
};
