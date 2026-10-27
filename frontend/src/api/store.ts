import type {
  AIAnalysis,
  ActionProposal,
  ApprovalRecord,
  AuditEvent,
  CaseRecord,
  EvidenceRecord,
  HateoasSnapshot,
  PolicyCheck,
  RefundDraftInput,
  ReplayResult,
  SendMessageDraftInput,
} from "./types";
import { caseFixtures } from "./mock/cases";
import { evidenceFixtures } from "./mock/evidence";
import { analysisFixtures } from "./mock/analyses";
import { proposalFixtures } from "./mock/proposals";
import { approvalFixtures } from "./mock/approvals";
import { auditFixtures } from "./mock/audit";
import { proposalRejectedError, type ProposalGenerationOutcome } from "./errors";
import { CHECK_LABELS } from "./mapping";
import {
  countMessageChars,
  idempotencyKeyFor,
  localPayloadHash,
  sendMessageAvailability,
  validateMessage,
} from "../lib/sendMessage";
import {
  captureViewOf,
  formatAmountMinor,
  isPaymentCase,
  parseDecimalAmountToMinor,
  refundIdempotencyKey,
  validateRefundDraft,
  type RefundValidationReason,
} from "../lib/refund";

/**
 * In-memory workspace state for the offline prototype.
 *
 * The state shape is deliberately contract-shaped: when Agent A freezes
 * OpenAPI v1, only this module and the adapter mapping should change.
 */

export interface WorkspaceState {
  cases: CaseRecord[];
  evidence: EvidenceRecord[];
  analyses: AIAnalysis[];
  proposals: ActionProposal[];
  approvals: ApprovalRecord[];
  audit: AuditEvent[];
  revision: number;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const buildInitialState = (): WorkspaceState => ({
  cases: clone(caseFixtures),
  evidence: clone(evidenceFixtures),
  analyses: clone(analysisFixtures),
  proposals: clone(proposalFixtures),
  approvals: clone(approvalFixtures),
  audit: clone(auditFixtures),
  revision: 1,
});

let state = buildInitialState();
const listeners = new Set<() => void>();
let localEventCounter = 0;

export const nowIso = (): string => new Date().toISOString();

const commit = (next: WorkspaceState): void => {
  state = { ...next, revision: state.revision + 1 };
  listeners.forEach((listener) => listener());
};

export const getSnapshot = (): WorkspaceState => state;

export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const patchCase = (
  next: WorkspaceState,
  caseId: string,
  patch: Partial<CaseRecord>,
): CaseRecord[] =>
  next.cases.map((item) =>
    item.caseId === caseId ? { ...item, ...patch, updatedAt: nowIso() } : item,
  );

const pushAudit = (next: WorkspaceState, event: Omit<AuditEvent, "eventId" | "environment">): AuditEvent[] => {
  localEventCounter += 1;
  const eventId = `AU-LOCAL-${String(localEventCounter).padStart(3, "0")}`;
  return [...next.audit, { ...event, eventId, environment: "local_simulation" }];
};

const requirementType = (family: CaseRecord["family"]): string => {
  if (family === "INR") return "PROOF_OF_FULFILLMENT";
  if (family === "SNAD") return "OTHER";
  return "PROOF_OF_REFUND";
};

/** Fixture-authored analysis for cases that have never been analysed. */
const buildGeneratedAnalysis = (record: CaseRecord, evidence: EvidenceRecord[]): AIAnalysis => {
  const available = evidence.filter((item) => item.available);
  const missing = evidence.filter((item) => item.grounding === "MISSING");
  const facts = available
    .filter((item) => item.grounding !== "AI_INFERENCE")
    .slice(0, 3)
    .map((item, index) => ({
      factId: `F-${record.caseId}-${index + 1}`,
      statement:
        index === 0
          ? `Buyer reports: ${record.buyerClaim.split(". ")[0]}.`
          : `${item.typeLabel} is on file and referenced by the filing.`,
      grounding: item.grounding,
      evidenceIds: [item.evidenceId],
      basis: item.source,
    }));

  if (missing.length > 0) {
    facts.push({
      factId: `F-${record.caseId}-m`,
      statement: `Required evidence is absent: ${missing.map((item) => item.typeLabel).join(", ")}.`,
      grounding: "MISSING",
      evidenceIds: missing.map((item) => item.evidenceId),
      basis: "Evidence inventory",
    });
  }

  return {
    analysisId: `AN-${record.caseId}-LIVE`,
    caseId: record.caseId,
    generatedAt: nowIso(),
    status: "READY",
    summary: `${record.reasonLabel} for ${(record.amountMinor / 100).toFixed(2)} ${record.currency}. ${
      missing.length > 0
        ? `${missing.length} evidence item${missing.length > 1 ? "s are" : " is"} missing; the recommendation is limited to what the records support.`
        : "All requested evidence is on file."
    }`,
    requirements: [{ evidenceType: requirementType(record.family), sourceExpected: "REQUESTED_FROM_SELLER", status: "OPEN" }],
    facts,
    gaps: missing.map((item, index) => ({
      gapId: `G-${record.caseId}-${index + 1}`,
      severity: "HIGH" as const,
      title: item.typeLabel,
      detail: item.note,
      requestedType: item.type,
      remedy: "Collect the artifact before proposing an action that depends on it.",
    })),
    contradictions: [],
    recommendation: {
      action: "send-message",
      actionLabel: "Send message to buyer",
      strength: "CONDITIONAL",
      rationale: [
        "The filing is internally consistent but the record set is incomplete.",
        "Contact can request the missing material without conceding the claim.",
      ],
      alternatives: [
        { action: "provide-evidence", label: "Provide evidence", note: "Requires a truthful artifact." },
        { action: "wait", label: "Wait", note: "Permitted while evidence is collected." },
      ],
    },
    waitRule: { applies: false, reason: "A legal action exists." },
    modelLabel: "analysis-fixture-v1 (demo run)",
    promptLabel: "case-understanding@0.3",
    provenance: "SCENARIO_DEFINED",
  };
};

export const actions = {
  runAnalysis(caseId: string, actor: string): AIAnalysis | undefined {
    const record = state.cases.find((item) => item.caseId === caseId);
    if (!record) return undefined;

    const existing = state.analyses.find((item) => item.caseId === caseId);
    // Deterministic fixture engine: re-running an analysed case keeps its content.
    if (existing && existing.status === "READY") {
      if (record.validationLevel === "FROZEN_SANDBOX_E1_VERIFIED") return existing;

      const at = nowIso();
      const next: WorkspaceState = {
        ...state,
        analyses: state.analyses.map((item) =>
          item.caseId === caseId ? { ...item, generatedAt: at } : item,
        ),
        cases: patchCase(state, caseId, { aiReview: "ANALYZED" }),
      };
      next.audit = pushAudit(next, {
        caseId,
        at,
        actor: { type: "AI", name: "Analysis (fixture plan)" },
        action: "AI_ANALYSIS_RERUN",
        outcome: "INFO",
        summary: `Analysis re-run by ${actor} — result unchanged`,
        detail: "The fixture engine is deterministic: the same records produce the same facts and gaps.",
        fields: [{ label: "Provenance", value: "SCENARIO_DEFINED" }],
      });
      commit(next);
      return next.analyses.find((item) => item.caseId === caseId);
    }

    const evidence = state.evidence.filter((item) => item.caseId === caseId);
    const analysis = buildGeneratedAnalysis(record, evidence);

    const next: WorkspaceState = {
      ...state,
      analyses: state.analyses
        .filter((item) => item.caseId !== caseId)
        .concat(analysis),
      cases: patchCase(state, caseId, {
        aiReview: "ANALYZED",
        nextAction: "Review recommendation",
      }),
    };

    next.audit = pushAudit(next, {
      caseId,
      at: analysis.generatedAt,
      actor: { type: "AI", name: "Analysis (fixture plan)" },
      action: "AI_ANALYSIS_COMPLETED",
      outcome: "INFO",
      summary: `Analysis run by ${actor} — ${analysis.facts.length} facts, ${analysis.gaps.length} gaps`,
      detail: "Engine output is fixture-authored for this build; no live model call was made.",
      fields: [
        { label: "Recommendation", value: analysis.recommendation.actionLabel },
        { label: "Provenance", value: "SCENARIO_DEFINED" },
      ],
    });

    commit(next);
    return analysis;
  },

  /**
   * Mock-mode send-message proposal.
   *
   * Mirrors the backend contract: a client-authored draft becomes a DRAFT
   * proposal whose id and payload hash are derived from the exact text. Editing
   * the text therefore produces a genuinely different proposal; an unchanged
   * text is idempotent. Nothing is sent here — submit + approval come later.
   */
  createSendMessageProposal(input: SendMessageDraftInput): ProposalGenerationOutcome {
    const record = state.cases.find((item) => item.caseId === input.caseId);
    if (!record) {
      return {
        ok: false,
        error: proposalRejectedError(`Unknown case ${input.caseId}.`),
      };
    }
    if (!state.analyses.some((item) => item.caseId === input.caseId)) {
      return {
        ok: false,
        error: proposalRejectedError(
          "No analysis exists for this case; the backend requires one before a proposal can be created.",
        ),
      };
    }
    const messageCheck = validateMessage(input.message);
    if (!messageCheck.ok) {
      return {
        ok: false,
        error: proposalRejectedError(
          messageCheck.reason === "empty"
            ? "The message body is empty."
            : `The message body exceeds ${2000} characters (${messageCheck.count}).`,
        ),
      };
    }

    const latest = state.proposals
      .filter((item) => item.caseId === input.caseId)
      .slice(-1)[0];
    const links = record.availableActions ?? latest?.hateoas.links ?? [];
    const availability = sendMessageAvailability(record, links);
    if (!availability.enabled) {
      return {
        ok: false,
        error: proposalRejectedError(
          availability.reason === "stage"
            ? `Lifecycle stage ${availability.stage} does not expose send_message.`
            : "send_message is not available in the current link set.",
        ),
      };
    }

    const payloadHash = localPayloadHash(input.caseId, input.message);
    const proposalId = `P-${input.caseId}-SEND-${payloadHash.slice(0, 12)}`;
    const existing = state.proposals.find((item) => item.proposalId === proposalId);
    if (existing) return { ok: true, proposal: existing };

    const checks: PolicyCheck[] = [
      { id: "V1", label: CHECK_LABELS.V1, status: "PASS", detail: "Case reference resolves to a single fixture record." },
      { id: "V2", label: CHECK_LABELS.V2, status: "PASS", detail: "send-message is in the allowed action set." },
      {
        id: "V3",
        label: CHECK_LABELS.V3,
        status: "PASS",
        detail: `send_message is present with method POST (basis ${availability.link.basis ?? "FIXTURE_SNAPSHOT"}).`,
        basis: availability.link.basis,
      },
      {
        id: "V4",
        label: CHECK_LABELS.V4,
        status: "PASS",
        detail: `Lifecycle stage ${record.lifecycleStage} permits send-message.`,
      },
      {
        id: "V5",
        label: CHECK_LABELS.V5,
        status: "SKIPPED",
        detail: "A message body carries no evidence requirement (V5 not applicable).",
      },
      {
        id: "V6",
        label: CHECK_LABELS.V6,
        status: "SKIPPED",
        detail: "No monetary amount in this payload.",
      },
      {
        id: "V7",
        label: CHECK_LABELS.V7,
        status: "PASS",
        detail: `Payload holds only message and idempotency_key; ${countMessageChars(input.message)} of 2000 characters.`,
      },
      {
        id: "V8",
        label: CHECK_LABELS.V8,
        status: "SKIPPED",
        detail: "No attachment is sent with a message; the labelling rule does not apply.",
      },
      { id: "V9", label: CHECK_LABELS.V9, status: "PASS", detail: "Snapshot is current for this draft." },
      { id: "V10", label: CHECK_LABELS.V10, status: "PASS", detail: "The proposal is a decision object only; no request was issued." },
      { id: "V11", label: CHECK_LABELS.V11, status: "PASS", detail: "A fixed idempotency key is bound to this exact text." },
      { id: "V12", label: CHECK_LABELS.V12, status: "PASS", detail: "No retry loop exists; one attempt at most after approval." },
    ];

    const hateoas: HateoasSnapshot = {
      observedAt: record.updatedAt,
      source: record.availableActions
        ? "Case available_actions (offline fixture)"
        : "Case capability snapshot (fixture)",
      frozen: true,
      links,
    };

    const proposal: ActionProposal = {
      proposalId,
      caseId: input.caseId,
      action: "send-message",
      actionLabel: "Send message to buyer",
      state: "DRAFT",
      risk: "MEDIUM",
      rationale:
        input.rationale && input.rationale.length > 0
          ? input.rationale
          : ["A factual message is the lowest-risk action while the case is in INQUIRY."],
      evidenceIds: input.evidenceIds ?? [],
      payload: [
        { label: "Message body", value: input.message },
        { label: "Request ID", value: idempotencyKeyFor(input.caseId, input.message) },
      ],
      payloadNote:
        "Message body is bound to this proposal. Manager approval covers this exact text; editing it requires a new proposal.",
      requiresApproval: true,
      validation: {
        decision: "PASS",
        checks,
        summary:
          "V3, V4 and V7 pass for the exact text. Nothing is sent until a manager approves this payload hash.",
      },
      policyRefs: [],
      hateoas,
      snapshotVersion: record.snapshotVersion,
      snapshotHash: record.snapshotHash,
      payloadHash,
      evidenceStatus:
        (input.evidenceIds ?? []).length > 0
          ? `${(input.evidenceIds ?? []).length} cited evidence record(s)`
          : "No evidence cited",
    };

    const next: WorkspaceState = {
      ...state,
      proposals: [...state.proposals, proposal],
      cases: patchCase(state, input.caseId, { nextAction: "Submit for approval" }),
    };

    next.audit = pushAudit(next, {
      caseId: input.caseId,
      proposalId,
      at: nowIso(),
      actor: { type: "HUMAN", name: input.actor },
      action: "PROPOSAL_CREATED",
      outcome: "INFO",
      summary: "send-message draft created from the specialist's exact text",
      detail:
        "The proposal is a recommendation object only; nothing has been sent to the buyer.",
      fields: [
        { label: "Action", value: "send-message" },
        { label: "Payload hash", value: payloadHash },
        { label: "Characters", value: String(countMessageChars(input.message)) },
      ],
    });

    commit(next);
    return { ok: true, proposal };
  },

  /**
   * Mock-mode refund proposal (contract v1.2, action_family=PAYMENT).
   *
   * Mirrors the server contract: the client submits only the capture reference,
   * mode, optional amount, currency, reason and idempotency key; this fixture
   * store plays the server role and validates against its capture snapshot.
   * The amount shown in the payload is always the server-side figure.
   */
  createRefundProposal(input: RefundDraftInput): ProposalGenerationOutcome {
    const record = state.cases.find((item) => item.caseId === input.caseId);
    if (!record) {
      return { ok: false, error: proposalRejectedError(`Unknown case ${input.caseId}.`) };
    }
    if (!isPaymentCase(record)) {
      return {
        ok: false,
        error: proposalRejectedError(
          `Case ${input.caseId} is not a PAYMENT case; a refund requires a capture.`,
        ),
      };
    }

    const view = captureViewOf(record);
    const captureId = (input.captureId || view.captureId).trim();
    const currency = (input.currencyCode || view.currency).trim().toUpperCase();
    if (currency !== view.currency.toUpperCase()) {
      return {
        ok: false,
        error: proposalRejectedError(
          `Currency ${currency} does not match the capture currency ${view.currency}.`,
        ),
      };
    }

    const check = validateRefundDraft({
      mode: input.mode,
      amount: input.amount,
      reason: input.reason,
      remainingMinor: view.remainingMinor,
      captureId,
    });
    if (!check.ok) {
      const messages: Record<RefundValidationReason, string> = {
        capture_unavailable: "The capture reference is unavailable.",
        amount_required: "The refund amount is required.",
        amount_format: "The refund amount must be a decimal string with exactly 2 places.",
        amount_positive: "The refund amount must be greater than 0.",
        amount_exceeds_remaining: "The refund amount exceeds the refundable remaining balance.",
        nothing_refundable: "The capture has no refundable balance left.",
        reason_required: "A refund reason is required.",
      };
      return { ok: false, error: proposalRejectedError(messages[check.reason]) };
    }

    // Server authority: a full refund is the remaining balance, never a client figure.
    if (
      input.mode === "full" &&
      input.amount &&
      parseDecimalAmountToMinor(input.amount) !== view.remainingMinor
    ) {
      return {
        ok: false,
        error: proposalRejectedError(
          "The supplied amount does not match the server capture snapshot (422).",
        ),
      };
    }

    const amountMinor = check.amountMinor;
    const amountDecimal =
      check.amountDecimal ?? (amountMinor === undefined ? "" : formatAmountMinor(amountMinor));
    const idempotencyKey =
      input.idempotencyKey ||
      refundIdempotencyKey({
        caseId: input.caseId,
        captureId,
        mode: input.mode,
        amount: amountDecimal,
        reason: input.reason,
      });
    const payloadHash = localPayloadHash(
      input.caseId,
      `${input.mode}\u0000${captureId}\u0000${amountDecimal}\u0000${currency}\u0000${input.reason.trim()}`,
    );
    const proposalId = `P-${input.caseId}-REFUND-${payloadHash.slice(0, 12)}`;
    const existing = state.proposals.find((item) => item.proposalId === proposalId);
    if (existing) return { ok: true, proposal: existing };

    const checks: PolicyCheck[] = [
      {
        id: "V13",
        label: CHECK_LABELS.V13,
        status: "PASS",
        detail: `${captureId} resolves to this case and its capture snapshot was read by the server.`,
      },
      {
        id: "V14",
        label: CHECK_LABELS.V14,
        status: "PASS",
        detail: `Capture status ${view.status ?? "UNKNOWN"} is refundable.`,
      },
      {
        id: "V15",
        label: CHECK_LABELS.V15,
        status: "PASS",
        detail: `Amount ${amountDecimal} ${currency} is greater than 0 and within the refundable remaining balance.`,
      },
      {
        id: "V16",
        label: CHECK_LABELS.V16,
        status: "PASS",
        detail: `Currency ${currency} matches the capture currency.`,
      },
      {
        id: "V17",
        label: CHECK_LABELS.V17,
        status: "PASS",
        detail: "The amount is expressed with exactly 2 decimal places.",
      },
      {
        id: "V18",
        label: CHECK_LABELS.V18,
        status: "PASS",
        detail: `Fixed idempotency key ${idempotencyKey}; no duplicate or unknown refund exists for this capture.`,
      },
    ];

    const proposal: ActionProposal = {
      proposalId,
      caseId: input.caseId,
      action: input.mode === "full" ? "full-refund" : "partial-refund",
      actionLabel: input.mode === "full" ? "Full refund" : "Partial refund",
      state: "DRAFT",
      risk: "HIGH",
      rationale: [
        `Refund ${amountDecimal} ${currency} out of capture ${captureId}.`,
        "This moves funds out of the capture. It does not resolve the dispute or close the case.",
      ],
      evidenceIds: [],
      payload: [
        { label: "Capture ID", value: captureId },
        { label: "Mode", value: input.mode === "full" ? "FULL" : "PARTIAL" },
        { label: "Amount", value: amountDecimal },
        { label: "Currency", value: currency },
        { label: "Refund reason", value: input.reason.trim() },
        ...(view.originalMinor !== undefined
          ? [{ label: "Original amount", value: formatAmountMinor(view.originalMinor) }]
          : []),
        ...(view.totalRefundedMinor !== undefined
          ? [{ label: "Total refunded", value: formatAmountMinor(view.totalRefundedMinor) }]
          : []),
        ...(view.remainingMinor !== undefined
          ? [{ label: "Refundable remaining", value: formatAmountMinor(view.remainingMinor) }]
          : []),
        { label: "Request ID", value: idempotencyKey },
      ],
      payloadNote:
        "The amount, currency and capture are bound to this proposal. Approval covers these exact values; a change requires a new proposal.",
      requiresApproval: true,
      validation: {
        decision: "PASS",
        checks,
        summary:
          "V13–V18 pass against the server capture snapshot. Nothing is refunded until a manager approves and the execution is verified.",
      },
      policyRefs: [],
      hateoas: {
        observedAt: record.updatedAt,
        source: record.availableActions
          ? "Case available_actions (offline fixture)"
          : "Case capability snapshot (fixture)",
        frozen: true,
        links: record.availableActions ?? [],
      },
      snapshotVersion: record.snapshotVersion,
      snapshotHash: record.snapshotHash,
      payloadHash,
      actionFamily: "PAYMENT",
      captureSnapshot: record.captureSnapshot,
      evidenceStatus: "No evidence is required for a capture refund",
    };

    const next: WorkspaceState = {
      ...state,
      proposals: [...state.proposals, proposal],
      cases: patchCase(state, input.caseId, { nextAction: "Submit for approval" }),
    };

    next.audit = pushAudit(next, {
      caseId: input.caseId,
      proposalId,
      at: nowIso(),
      actor: { type: "HUMAN", name: input.actor },
      action: "PROPOSAL_CREATED",
      outcome: "INFO",
      summary: `Refund draft created (${input.mode}) for capture ${captureId}`,
      detail:
        "The proposal is a decision object only. No refund request has been sent and the dispute is unchanged.",
      fields: [
        { label: "Action", value: proposal.action },
        { label: "Amount", value: `${amountDecimal} ${currency}` },
        { label: "Payload hash", value: payloadHash },
      ],
    });

    commit(next);
    return { ok: true, proposal };
  },

  submitProposal(proposalId: string, actor: string): ActionProposal | undefined {    const proposal = state.proposals.find((item) => item.proposalId === proposalId);
    if (!proposal || proposal.state !== "DRAFT") return proposal;
    // Safety invariant: a blocked validator result cannot be queued for approval.
    if (proposal.validation.decision === "BLOCKED") return proposal;

    const submittedAt = nowIso();
    const next: WorkspaceState = {
      ...state,
      proposals: state.proposals.map((item) =>
        item.proposalId === proposalId
          ? { ...item, state: "AWAITING_APPROVAL", submittedBy: actor, submittedAt }
          : item,
      ),
      cases: patchCase(state, proposal.caseId, { nextAction: "Awaiting approval" }),
    };

    next.audit = pushAudit(next, {
      caseId: proposal.caseId,
      proposalId,
      at: submittedAt,
      actor: { type: "HUMAN", name: actor },
      action: "PROPOSAL_SUBMITTED",
      outcome: "INFO",
      summary: `${proposal.actionLabel} submitted for approval`,
      detail: "Action, payload and evidence references bound to the case snapshot version.",
      fields: [
        { label: "Snapshot", value: proposal.snapshotVersion },
        { label: "Risk", value: proposal.risk },
        { label: "Policy result", value: proposal.validation.decision },
      ],
    });

    commit(next);
    return next.proposals.find((item) => item.proposalId === proposalId);
  },

  decideProposal(
    proposalId: string,
    decision: "APPROVED" | "REJECTED",
    manager: string,
    reason: string,
  ): ActionProposal | undefined {
    const proposal = state.proposals.find((item) => item.proposalId === proposalId);
    if (!proposal || (proposal.state !== "AWAITING_APPROVAL" && proposal.state !== "APPROVED")) {
      return proposal;
    }
    // Approval cannot override a deterministic block.
    if (proposal.validation.decision === "BLOCKED") return proposal;

    const decidedAt = nowIso();
    const approval: ApprovalRecord = {
      approvalId: `AP-LOCAL-${proposalId}`,
      proposalId,
      caseId: proposal.caseId,
      decision,
      reason,
      decidedBy: manager,
      decidedAt,
      snapshotVersion: proposal.snapshotVersion,
    };

    const next: WorkspaceState = {
      ...state,
      proposals: state.proposals.map((item) =>
        item.proposalId === proposalId
          ? {
              ...item,
              state: decision,
              decidedBy: manager,
              decidedAt,
              decisionReason: reason,
            }
          : item,
      ),
      approvals: state.approvals
        .filter((item) => item.proposalId !== proposalId)
        .concat(approval),
      cases: patchCase(state, proposal.caseId, {
        nextAction: decision === "APPROVED" ? "Run replay revalidation" : "Re-plan response",
      }),
    };

    next.audit = pushAudit(next, {
      caseId: proposal.caseId,
      proposalId,
      at: decidedAt,
      actor: { type: "HUMAN", name: manager },
      action: decision === "APPROVED" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
      outcome: "INFO",
      summary:
        decision === "APPROVED"
          ? "Approved for a single execution attempt"
          : "Proposal rejected — no execution attempted",
      detail:
        decision === "APPROVED"
          ? "Approval binds the payload and snapshot. It does not guarantee PayPal acceptance or a favourable outcome."
          : "The case returns to the specialist. The payload is not queued.",
      fields: [
        { label: "Decision", value: decision },
        { label: "Snapshot", value: proposal.snapshotVersion },
        { label: "Reason", value: reason },
      ],
    });

    commit(next);
    return next.proposals.find((item) => item.proposalId === proposalId);
  },

  replay(proposalId: string): ReplayResult {
    const proposal = state.proposals.find((item) => item.proposalId === proposalId);
    if (!proposal) {
      return {
        outcome: "BLOCKED",
        httpStatus: 0,
        message: "Proposal not found.",
        revalidation: [],
      };
    }

    // Hard guard: only an approved proposal may enter revalidation.
    if (proposal.state !== "APPROVED") {
      return {
        outcome: "BLOCKED",
        httpStatus: 0,
        message: "Execution requires an approved proposal. The proposal was not executed.",
        revalidation: [],
      };
    }

    const relByAction: Partial<Record<ActionProposal["action"], string>> = {
      "send-message": "send_message",
      "provide-evidence": "provide_evidence",
      "make-offer": "make_offer",
      "accept-claim": "accept_claim",
      escalate: "escalate",
    };
    const rel = relByAction[proposal.action];
    const linkAvailable =
      rel === undefined ||
      proposal.hateoas.links.some((link) => link.rel === rel && link.available);

    const revalidation = [
      {
        label: "Snapshot freshness",
        status: "PASS" as const,
        note: "Snapshot within the 30-minute replay window.",
      },
      {
        label: "Case status unchanged",
        status: "PASS" as const,
        note: "No lifecycle transition since approval.",
      },
      {
        label: "HATEOAS action still available",
        status: linkAvailable ? ("PASS" as const) : ("FAIL" as const),
        note: linkAvailable
          ? `${rel ?? "action"} present with method POST.`
          : `${rel ?? "action"} is not present in the current link set.`,
      },
      {
        label: "Idempotency key bound",
        status: "PASS" as const,
        note: "Fixed request id; one attempt, no retry.",
      },
    ];

    const at = nowIso();
    const requestId =
      proposal.payload.find((item) => item.label === "Request ID")?.value ??
      "not issued";

    if (!linkAvailable) {
      const next: WorkspaceState = {
        ...state,
        proposals: state.proposals.map((item) =>
          item.proposalId === proposalId ? { ...item, state: "BLOCKED" } : item,
        ),
        cases: patchCase(state, proposal.caseId, { nextAction: "Action unavailable" }),
      };
      next.audit = pushAudit(next, {
        caseId: proposal.caseId,
        proposalId,
        at,
        actor: { type: "SYSTEM", name: "Replay revalidation" },
        action: "REPLAY_REVALIDATION",
        outcome: "BLOCKED",
        summary: "Revalidation failed — action no longer available",
        detail: "The link set changed after approval. No request was issued.",
        fields: [{ label: "Request sent", value: "none" }],
        revalidation: { status: "FAIL", checks: revalidation },
      });
      commit(next);
      return {
        outcome: "BLOCKED",
        httpStatus: 0,
        message: "Revalidation failed: the action is no longer available in this dispute state.",
        revalidation,
      };
    }

    const successState: WorkspaceState = {
      ...state,
      proposals: state.proposals.map((item) =>
        item.proposalId === proposalId
          ? { ...item, state: "EXECUTED", executedAt: at }
          : item,
      ),
      cases: patchCase(state, proposal.caseId, {
        status: "UNDER_REVIEW",
        nextAction: "Monitor buyer response",
        evidenceReadiness:
          proposal.action === "provide-evidence"
            ? {
                ...(state.cases.find((item) => item.caseId === proposal.caseId)?.evidenceReadiness ?? {
                  provided: 0,
                  requested: 0,
                  label: "",
                }),
                provided: Math.min(
                  (state.cases.find((item) => item.caseId === proposal.caseId)?.evidenceReadiness
                    .requested ?? 1),
                  (state.cases.find((item) => item.caseId === proposal.caseId)?.evidenceReadiness
                    .provided ?? 0) + 1,
                ),
                label:
                  proposal.action === "provide-evidence"
                    ? "Evidence submitted and verified by GET re-query"
                    : state.cases.find((item) => item.caseId === proposal.caseId)?.evidenceReadiness
                        .label ?? "",
              }
            : state.cases.find((item) => item.caseId === proposal.caseId)?.evidenceReadiness,
      }),
    };

    successState.audit = pushAudit(successState, {
      caseId: proposal.caseId,
      proposalId,
      at,
      actor: { type: "SYSTEM", name: "Replay revalidation" },
      action: "REPLAY_REVALIDATION",
      outcome: "SUCCEEDED",
      summary: "Revalidation passed — execution allowed",
      detail: "Freshness, status, link availability and idempotency all checked immediately before the attempt.",
      fields: [{ label: "Revalidated", value: "4 of 4 checks" }],
      revalidation: { status: "PASS", checks: revalidation },
    });

    successState.audit = pushAudit(successState, {
      caseId: proposal.caseId,
      proposalId,
      at,
      actor: { type: "SYSTEM", name: "Replay runner" },
      action: "EXECUTION_ATTEMPT",
      outcome: "SUCCEEDED",
      summary: "Replay completed — HTTP 200",
      detail: "Single attempt against the local replay fixture. No retry was performed.",
      httpStatus: 200,
      requestId,
      fields: [
        { label: "Action", value: proposal.action },
        { label: "Attempts", value: "1 of 1" },
      ],
    });

    successState.audit = pushAudit(successState, {
      caseId: proposal.caseId,
      proposalId,
      at,
      actor: { type: "SYSTEM", name: "GET verification" },
      action: "EXECUTION_VERIFIED",
      outcome: "SUCCEEDED",
      summary: "GET re-query confirmed the write",
      detail:
        proposal.action === "provide-evidence"
          ? "The replay fixture now contains the evidence entry. Status advanced to UNDER_REVIEW."
          : "The replay fixture now contains the message. Status advanced to UNDER_REVIEW.",
      httpStatus: 200,
      fields: [{ label: "Status", value: "UNDER_REVIEW" }],
    });

    commit(successState);
    return {
      outcome: "SUCCEEDED",
      httpStatus: 200,
      message: "Revalidation passed and the replay completed. Verification confirmed the write.",
      revalidation,
    };
  },

  refreshSnapshot(caseId: string): ActionProposal | undefined {
    const proposal = state.proposals.find(
      (item) => item.caseId === caseId && item.state === "BLOCKED",
    );
    if (!proposal) return undefined;

    const at = nowIso();
    const next: WorkspaceState = {
      ...state,
      proposals: state.proposals.map((item) =>
        item.proposalId === proposal.proposalId
          ? {
              ...item,
              state: "DRAFT",
              blockReason: undefined,
              snapshotVersion: `${item.snapshotVersion.split("-")[0]}-r2`,
              hateoas: { ...item.hateoas, observedAt: at },
              validation: {
                ...item.validation,
                decision: "PASS",
                summary: "Snapshot refreshed. All checks pass; submit for approval.",
                checks: item.validation.checks.map((check) =>
                  check.id === "V9"
                    ? {
                        ...check,
                        status: "PASS",
                        detail: "Snapshot refreshed moments ago; within the freshness window.",
                      }
                    : check,
                ),
              },
            }
          : item,
      ),
      cases: patchCase(state, caseId, { nextAction: "Submit for approval" }),
    };

    next.audit = pushAudit(next, {
      caseId,
      proposalId: proposal.proposalId,
      at,
      actor: { type: "SYSTEM", name: "Capability snapshot" },
      action: "SNAPSHOT_REFRESHED",
      outcome: "INFO",
      summary: "Snapshot refreshed — block cleared",
      detail: "V9 now passes. The action must still be submitted and approved separately.",
      fields: [{ label: "New snapshot", value: `${proposal.snapshotVersion.split("-")[0]}-r2` }],
    });

    commit(next);
    return next.proposals.find((item) => item.proposalId === proposal.proposalId);
  },

  reset(): void {
    localEventCounter = 0;
    state = buildInitialState();
    listeners.forEach((listener) => listener());
  },
};

export const pendingApprovals = (snapshot: WorkspaceState): ActionProposal[] =>
  snapshot.proposals.filter((item) => item.state === "AWAITING_APPROVAL");

export const evidenceForCase = (snapshot: WorkspaceState, caseId: string): EvidenceRecord[] =>
  snapshot.evidence.filter((item) => item.caseId === caseId);

export const analysisForCase = (snapshot: WorkspaceState, caseId: string): AIAnalysis | undefined =>
  snapshot.analyses.find((item) => item.caseId === caseId);

export const proposalsForCase = (snapshot: WorkspaceState, caseId: string): ActionProposal[] =>
  snapshot.proposals.filter((item) => item.caseId === caseId);

export const latestProposal = (snapshot: WorkspaceState, caseId: string): ActionProposal | undefined => {
  const items = proposalsForCase(snapshot, caseId);
  return items[items.length - 1];
};

export const auditForCase = (snapshot: WorkspaceState, caseId: string): AuditEvent[] =>
  snapshot.audit
    .filter((item) => item.caseId === caseId)
    .sort((a, b) => a.at.localeCompare(b.at));
