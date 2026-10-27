/**
 * Send-message draft rules (UI side).
 *
 * The backend is the authority: V3 (HATEOAS link), V4 (INQUIRY stage) and V7
 * (message length) are re-checked when the proposal is submitted. This module
 * only mirrors those rules so the operator never fills in a draft that cannot
 * be submitted, and so a disabled control always carries a reason.
 *
 * Everything here is pure: no network, no store access, no fabricated content.
 */

import type {
  ActionProposal,
  CaseRecord,
  GroundedFact,
  HateoasLink,
  ProposalState,
} from "../api/types";

/** Contract limit for `action_payload.message` (V7). */
export const MESSAGE_MAX_LENGTH = 2000;

/** Count Unicode code points so a 2000-emoji message is rejected like Python's len(). */
export const countMessageChars = (text: string): number => [...text].length;

export type MessageValidation =
  | { ok: true; count: number }
  | { ok: false; reason: "empty" | "too_long"; count: number };

export const validateMessage = (text: string): MessageValidation => {
  const count = countMessageChars(text);
  // The payload keeps the text verbatim (no trim); only the emptiness check ignores whitespace.
  if (text.trim().length === 0) return { ok: false, reason: "empty", count };
  if (count > MESSAGE_MAX_LENGTH) return { ok: false, reason: "too_long", count };
  return { ok: true, count };
};

const fnv1a = (input: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/** Deterministic 16-hex content digest (mock-mode binding only; the backend hashes in http mode). */
export const stableDigest = (input: string): string => {
  const first = fnv1a(input, 0x811c9dc5).toString(16).padStart(8, "0");
  const second = fnv1a(input, 0x7f4a7c15).toString(16).padStart(8, "0");
  return `${first}${second}`;
};

/**
 * A fixed request id per (case, message). Editing the text yields a new key,
 * so the backend can never mistake a revised draft for a retry of the old one.
 * The same text yields the same key — a genuine duplicate is suppressed.
 */
export const idempotencyKeyFor = (caseId: string, message: string): string =>
  `DP-SEND-MESSAGE-${caseId}-${stableDigest(`${caseId}\u0000${message}`).slice(0, 12).toUpperCase()}`;

/** Mock-mode payload hash. Never displayed as a backend hash in http mode. */
export const localPayloadHash = (caseId: string, message: string): string =>
  stableDigest(`${caseId}\u0000send-message\u0000${message}`).toUpperCase();

export type SendMessageUnavailableReason = "stage" | "no_link" | "link_unavailable";

export type SendMessageAvailability =
  | { enabled: true; link: HateoasLink }
  | {
      enabled: false;
      reason: SendMessageUnavailableReason;
      stage: string;
      link?: HateoasLink;
    };

/**
 * A send-message action is operable only when the case is in INQUIRY and the
 * same link set exposes `send_message` as a usable POST. The link basis
 * (LIVE_HATEOAS / FIXTURE_SNAPSHOT) is surfaced separately and is never
 * upgraded: an offline fixture must not read as a live observation.
 */
export const sendMessageAvailability = (
  record: Pick<CaseRecord, "lifecycleStage" | "availableActions">,
  fallbackLinks: HateoasLink[] = [],
): SendMessageAvailability => {
  const links = record.availableActions ?? fallbackLinks;
  const link = links.find((item) => item.rel === "send_message");
  if (record.lifecycleStage !== "INQUIRY") {
    return { enabled: false, reason: "stage", stage: record.lifecycleStage, link };
  }
  if (!link) {
    return { enabled: false, reason: "no_link", stage: record.lifecycleStage };
  }
  if (!link.available) {
    return { enabled: false, reason: "link_unavailable", stage: record.lifecycleStage, link };
  }
  return { enabled: true, link };
};

/** The message body inside a proposal payload (http mapping uses "Message body"). */
export const messageBodyOf = (proposal?: ActionProposal): string =>
  proposal?.payload.find((field) => {
    const label = field.label.toLowerCase();
    return label === "message body" || label === "message";
  })?.value ?? "";

export const requestIdOf = (proposal?: ActionProposal): string =>
  proposal?.payload.find((field) => field.label.toLowerCase() === "request id")?.value ?? "";

/** Latest send-message proposal for the case (the UI keeps the last one it saw). */
export const latestSendMessageProposal = (
  proposals: ActionProposal[],
): ActionProposal | undefined => {
  const matching = proposals.filter((item) => item.action === "send-message");
  return matching[matching.length - 1];
};

/**
 * Once a manager approves, the exact text is bound and must not be rewritten
 * in place. A revision is always a NEW proposal with a NEW payload hash.
 */
export const isSendMessageLocked = (state: ProposalState | undefined): boolean =>
  state === "APPROVED" ||
  state === "EXECUTED" ||
  state === "UNVERIFIED" ||
  state === "REPLAYED" ||
  state === "FAILED" ||
  state === "CANCELLED";

/** Input the composer hands to the page (case id and actor stay with the page). */
export interface SendMessageComposerDraft {
  message: string;
  rationale: string[];
  evidenceIds: string[];
}

/**
 * Facts that actually support this draft. With a proposal, only facts backed
 * by its cited evidence are shown; without one, the analysis facts are listed
 * so the specialist can decide what is grounded enough to cite.
 */
export const draftBasis = (
  proposal: ActionProposal | undefined,
  facts: GroundedFact[],
): GroundedFact[] => {
  if (!proposal || proposal.evidenceIds.length === 0) return facts;
  const cited = new Set(proposal.evidenceIds);
  return facts.filter((fact) => fact.evidenceIds.some((id) => cited.has(id)));
};
