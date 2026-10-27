/**
 * Localisation of B-local display vocabulary (evidence types, action labels,
 * next-action hints).
 *
 * These are UI label tables, not backend data: the same enums are rendered in
 * both languages. Free-text data (evidence excerpts, model output, validator
 * details) must never pass through this module.
 */

import type { MessageKey, TranslateParams } from "./messages";

type Translator = (key: MessageKey, params?: TranslateParams) => string;

/** A's evidence_type (and the mock fixtures' wider vocabulary). */
const EVIDENCE_TYPE_KEYS: Record<string, MessageKey> = {
  PROOF_OF_FULFILLMENT: "evidenceType.PROOF_OF_FULFILLMENT",
  PROOF_OF_REFUND: "evidenceType.PROOF_OF_REFUND",
  OTHER: "evidenceType.OTHER",
  BUYER_STATEMENT: "evidenceType.BUYER_STATEMENT",
  ORDER_RECORD: "evidenceType.ORDER_RECORD",
  CAPTURE_RECORD: "evidenceType.CAPTURE_RECORD",
  SELLER_COMMUNICATION: "evidenceType.SELLER_COMMUNICATION",
  CASE_NOTE: "evidenceType.CASE_NOTE",
  BUYER_MESSAGE: "evidenceType.BUYER_MESSAGE",
  TRANSACTION_RECORD: "evidenceType.TRANSACTION_RECORD",
  FULFILLMENT_RECORD: "evidenceType.FULFILLMENT_RECORD",
  MERCHANT_POLICY: "evidenceType.MERCHANT_POLICY",
  DERIVED_SIGNAL: "evidenceType.DERIVED_SIGNAL",
  BUYER_RECEIPT: "evidenceType.BUYER_RECEIPT",
  CANCELLATION_REFERENCE: "evidenceType.CANCELLATION_REFERENCE",
};

/** Exact fixture/adaptor labels that carry a branch hint beyond the action enum. */
const ACTION_LABEL_KEYS: Record<string, MessageKey> = {
  "Send message": "actionLabel.sendMessage",
  "Send message to buyer": "actionKind.send-message",
  "Provide evidence": "actionKind.provide-evidence",
  "Provide evidence (notes branch)": "actionLabel.provideEvidenceNotes",
  "Provide evidence (photos)": "actionLabel.provideEvidencePhotos",
  "Provide evidence (requires fresh snapshot)": "actionLabel.provideEvidenceFreshSnapshot",
  "Make offer": "actionKind.make-offer",
  "Accept claim": "actionKind.accept-claim",
  Escalate: "actionKind.escalate",
  "Provide supporting info": "actionKind.provide-supporting-info",
  Wait: "actionKind.wait",
  "Partial refund": "actionKind.partial-refund",
  "Full refund": "actionKind.full-refund",
  "Wait for buyer response": "actionLabel.waitForBuyerResponse",
  "Request receipt documents": "actionLabel.requestReceiptDocuments",
  "Not analysed": "actionLabel.notAnalysed",
};

const ACTION_KIND_KEYS: Record<string, MessageKey> = {
  "send-message": "actionKind.send-message",
  "provide-evidence": "actionKind.provide-evidence",
  "make-offer": "actionKind.make-offer",
  "accept-claim": "actionKind.accept-claim",
  escalate: "actionKind.escalate",
  "provide-supporting-info": "actionKind.provide-supporting-info",
  wait: "actionKind.wait",
  "partial-refund": "actionKind.partial-refund",
  "full-refund": "actionKind.full-refund",
};

/** `deriveNextAction` output and the mock fixtures' local hints. */
const NEXT_ACTION_KEYS: Record<string, MessageKey> = {
  "Run AI analysis": "nextAction.runAiAnalysis",
  "Start AI review": "nextAction.startAiReview",
  "Review recommendation": "nextAction.reviewRecommendation",
  "Submit for approval": "nextAction.submitForApproval",
  "Awaiting approval": "nextAction.awaitingApproval",
  "Run replay revalidation": "nextAction.runReplayRevalidation",
  "Re-plan response": "nextAction.replanResponse",
  "Monitor buyer response": "nextAction.monitorBuyerResponse",
  "Resolve validator block": "nextAction.resolveValidatorBlock",
  "Resolve evidence gap": "nextAction.resolveEvidenceGap",
  "Action unavailable": "nextAction.actionUnavailable",
  "Refresh case snapshot": "nextAction.refreshCaseSnapshot",
  "Review case": "nextAction.reviewCase",
};

export const evidenceTypeLabel = (
  type: string,
  fallback: string,
  t: Translator,
): string => {
  const key = EVIDENCE_TYPE_KEYS[type];
  return key ? t(key) : fallback;
};

/** Prefer the exact label (branch hints survive); fall back to the action enum. */
export const actionLabel = (
  label: string,
  action: string | undefined,
  t: Translator,
): string => {
  const exact = ACTION_LABEL_KEYS[label];
  if (exact) return t(exact);
  const kind = action ? ACTION_KIND_KEYS[action] : undefined;
  return kind ? t(kind) : label;
};

export const nextActionLabel = (nextAction: string, t: Translator): string => {
  const key = NEXT_ACTION_KEYS[nextAction];
  return key ? t(key) : nextAction;
};

/** Text polarity uses the stable English hint, independent of display language. */
export const nextActionTone = (nextAction: string): "stop" | "warn" | "default" => {
  if (nextAction === "Action unavailable" || nextAction === "Resolve evidence gap") return "stop";
  if (nextAction === "Awaiting approval" || nextAction === "Submit for approval") return "warn";
  return "default";
};
