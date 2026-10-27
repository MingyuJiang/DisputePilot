import type { ActionProposal, HateoasLink, PolicyCheck } from "../types";

/**
 * Proposal fixtures.
 *
 * Policy checks mirror the V1–V12 validator design in
 * reference/docs/S6_1_AI_ACTION_PLAN.md. The validator is recommendation-only:
 * PASS means "legal to attempt after approval", never "executed".
 */

const CHECK_LABELS: Record<string, string> = {
  V1: "Dispute identity",
  V2: "Action whitelist",
  V3: "HATEOAS permission",
  V4: "Stage / status compatibility",
  V5: "Evidence requirement match",
  V6: "Amount / type bounds",
  V7: "Payload whitelist",
  V8: "Evidence labelling",
  V9: "Snapshot freshness",
  V10: "No-execution invariant",
  V11: "Idempotency readiness",
  V12: "Retry prohibition",
};

type CheckOverride = { status?: PolicyCheck["status"]; detail?: string };

const standardChecks = (overrides: Record<string, CheckOverride> = {}): PolicyCheck[] => {
  const defaults: Record<string, PolicyCheck> = {
    V1: { id: "V1", label: CHECK_LABELS.V1, status: "PASS", detail: "Case reference resolves to a single fixture record." },
    V2: { id: "V2", label: CHECK_LABELS.V2, status: "PASS", detail: "Action is in the allowed action set." },
    V3: { id: "V3", label: CHECK_LABELS.V3, status: "PASS", detail: "Required rel link is present with method POST in the snapshot." },
    V4: { id: "V4", label: CHECK_LABELS.V4, status: "PASS", detail: "Lifecycle stage and status permit this action." },
    V5: { id: "V5", label: CHECK_LABELS.V5, status: "PASS", detail: "Open requirement matches the proposed evidence type." },
    V6: { id: "V6", label: CHECK_LABELS.V6, status: "NOT_APPLICABLE", detail: "No monetary amount in this payload." },
    V7: { id: "V7", label: CHECK_LABELS.V7, status: "PASS", detail: "Official payload fields only; no internal metadata fields." },
    V8: { id: "V8", label: CHECK_LABELS.V8, status: "PASS", detail: "Content carries an explicit SCENARIO_DEFINED label." },
    V9: { id: "V9", label: CHECK_LABELS.V9, status: "PASS", detail: "Snapshot is 6 minutes old; the freshness window is 30 minutes." },
    V10: { id: "V10", label: CHECK_LABELS.V10, status: "PASS", detail: "Validator emits a decision object only; it cannot POST." },
    V11: { id: "V11", label: CHECK_LABELS.V11, status: "PASS", detail: "A fixed PayPal-Request-Id is attached for a single attempt." },
    V12: { id: "V12", label: CHECK_LABELS.V12, status: "PASS", detail: "No retry loop or backoff exists in the replay path." },
  };

  return Object.values(defaults).map((item) => ({
    ...item,
    ...(overrides[item.id] ?? {}),
  }));
};

const link = (rel: string, method: string, available = true): HateoasLink => ({
  rel,
  method,
  available,
});

const inquiryLinks = (): HateoasLink[] => [
  link("self", "GET"),
  link("provide_evidence", "POST"),
  link("send_message", "POST"),
  link("make_offer", "POST"),
  link("accept_claim", "POST"),
  link("escalate", "POST"),
  link("require_evidence", "POST", false),
  link("adjudicate", "POST", false),
];

const base = {
  requiresApproval: true,
  snapshotHash: "not hashed — demo fixture",
};

const policyRefs = [
  { id: "V3", text: "An action is legal only if its rel link is present with method POST in the same snapshot used for the recommendation." },
  { id: "V9", text: "A decision older than the freshness window must be revalidated before execution." },
  { id: "V10", text: "The validator produces a decision object; execution is a separate, separately approved step." },
];

export const proposalFixtures: ActionProposal[] = [
  {
    ...base,
    proposalId: "P-O4-01",
    caseId: "O4",
    action: "send-message",
    actionLabel: "Send message to buyer",
    state: "EXECUTED",
    risk: "MEDIUM",
    rationale: [
      "No truthful fulfillment record exists; a factual message is the lowest-risk action.",
      "The requirement stays open and is not misrepresented as satisfied.",
    ],
    evidenceIds: ["E-O4-01", "E-O4-02"],
    payload: [
      { label: "Message body", value: "Thank you for your patience. The merchant is reviewing the delivery status of this order and has no shipment record to share at this time. Could you confirm whether you received any notification about this order, or share any detail that may help us locate it? We will follow up as soon as the review is complete." },
      { label: "Request ID", value: "DP-DEMO-O4-SEND-MESSAGE-001" },
      { label: "Template", value: "no-fulfillment-record / factual" },
    ],
    payloadNote: "Message body is frozen E1 content, replayed. No live send occurred in this prototype.",
    validation: {
      decision: "PASS",
      checks: standardChecks(),
      summary: "V1–V12 passed at decision time; execution followed a separate human approval.",
    },
    policyRefs,
    hateoas: { observedAt: "2026-10-15T03:05:00Z", source: "Frozen GET response (E1)", frozen: true, links: inquiryLinks() },
    snapshotVersion: "O4/snap-4",
    submittedBy: "Dana Whitfield",
    submittedAt: "2026-10-15T03:14:00Z",
    decidedBy: "Marcus Lindqvist",
    decidedAt: "2026-10-15T03:26:00Z",
    decisionReason: "Approved. Do not imply fulfillment; message states the record gap.",
    executedAt: "2026-10-15T03:31:00Z",
    evidenceStatus: "2 of 3 items on file",
  },
  {
    ...base,
    proposalId: "P-O5-01",
    caseId: "O5",
    action: "provide-evidence",
    actionLabel: "Provide evidence (notes branch)",
    state: "EXECUTED",
    risk: "MEDIUM",
    rationale: [
      "The open PROOF_OF_FULFILLMENT requirement matches the prepared note.",
      "The attachment states its simulated nature, satisfying the labelling rule.",
    ],
    evidenceIds: ["E-O5-03", "E-O5-02"],
    payload: [
      { label: "Evidence type", value: "PROOF_OF_FULFILLMENT" },
      { label: "File", value: "sandbox-fulfillment-note-O5.txt" },
      { label: "Content label", value: "SCENARIO_DEFINED — sandbox test material" },
      { label: "Request ID", value: "DP-DEMO-O5-PROVIDE-EVIDENCE-001" },
    ],
    payloadNote: "Single attempt, frozen replay. The original E1 fixture stays outside this workspace.",
    validation: {
      decision: "PASS",
      checks: standardChecks(),
      summary: "V1–V12 passed; the write was verified by a GET re-query.",
    },
    policyRefs,
    hateoas: { observedAt: "2026-10-15T07:48:00Z", source: "Frozen GET response (E1)", frozen: true, links: inquiryLinks() },
    snapshotVersion: "O5/snap-5",
    submittedBy: "Dana Whitfield",
    submittedAt: "2026-10-15T07:58:00Z",
    decidedBy: "Marcus Lindqvist",
    decidedAt: "2026-10-15T08:06:00Z",
    decisionReason: "Approved. Label must remain visible in the attachment.",
    executedAt: "2026-10-15T08:12:00Z",
    evidenceStatus: "3 of 3 items on file",
  },
  {
    ...base,
    proposalId: "P-O6-01",
    caseId: "O6",
    action: "send-message",
    actionLabel: "Send message to buyer",
    state: "CANCELLED",
    risk: "HIGH",
    rationale: [
      "First version of the reply, drafted before the case changed state.",
      "Approved once, but replay revalidation detected a status transition.",
    ],
    evidenceIds: ["E-O6-01"],
    payload: [
      { label: "Message body", value: "Thank you for reporting the mismatch. We are reviewing the listing and will follow up shortly." },
      { label: "Request ID", value: "DP-DEMO-O6-SEND-MESSAGE-001" },
    ],
    payloadNote: "Superseded. No request was sent: revalidation failed before the attempt.",
    validation: {
      decision: "PASS",
      checks: standardChecks(),
      summary: "Passed at approval time. The case then moved to WAITING_FOR_BUYER_RESPONSE, so replay was refused.",
    },
    policyRefs,
    hateoas: { observedAt: "2026-10-16T02:08:00Z", source: "Superseded snapshot snap-1 (demo fixture)", frozen: true, links: inquiryLinks() },
    snapshotVersion: "O6/snap-1",
    submittedBy: "Dana Whitfield",
    submittedAt: "2026-10-16T02:10:00Z",
    decidedBy: "Marcus Lindqvist",
    decidedAt: "2026-10-16T02:25:00Z",
    decisionReason: "Superseded after revalidation failed (STATE_CHANGED). No message was sent.",
    evidenceStatus: "1 of 4 items on file",
  },
  {
    ...base,
    proposalId: "P-O6-02",
    caseId: "O6",
    action: "send-message",
    actionLabel: "Send message to buyer",
    state: "AWAITING_APPROVAL",
    risk: "HIGH",
    rationale: [
      "The mismatch claim is statement-only; photos and model identifiers are required.",
      "The message must not concede a refund before the item is identified.",
      "A prior approval failed replay when the case state changed; this is a re-planned proposal.",
    ],
    evidenceIds: ["E-O6-01", "E-O6-03"],
    payload: [
      { label: "Message body", value: "Thank you for reporting this. We are checking the model you received against the listing. Could you send photos of the item and its packaging, plus the model number printed on the box? Once we have those, we can confirm the next step." },
      { label: "Request ID", value: "DP-DEMO-O6-SEND-MESSAGE-002" },
      { label: "Template", value: "request-evidence / mismatch" },
    ],
    payloadNote: "Second proposal for this case. The first (P-O6-01) was approved but failed replay revalidation.",
    validation: {
      decision: "NEEDS_REVIEW",
      checks: standardChecks({
        V3: { detail: "send_message link present with method POST in snapshot snap-3." },
        V9: { detail: "Snapshot refreshed after the failed replay; 12 minutes old." },
      }),
      summary:
        "Legality checks pass, but two evidence gaps remain. Manager review is required and the reply must not admit liability.",
    },
    policyRefs,
    hateoas: { observedAt: "2026-10-17T02:28:00Z", source: "Case capability snapshot snap-3 (demo fixture)", frozen: true, links: inquiryLinks() },
    snapshotVersion: "O6/snap-3",
    submittedBy: "Dana Whitfield",
    submittedAt: "2026-10-17T02:40:00Z",
    evidenceStatus: "2 gaps: photos, tracking",
  },
  {
    ...base,
    proposalId: "P-O8-01",
    caseId: "O8",
    action: "send-message",
    actionLabel: "Send message to buyer",
    state: "AWAITING_APPROVAL",
    risk: "HIGH",
    rationale: [
      "The buyer cites a dispatch message the merchant cannot produce.",
      "The reply must request that message without confirming a shipment.",
      "No tracking number exists and none may be implied.",
    ],
    evidenceIds: ["E-O8-01", "E-O8-03"],
    payload: [
      { label: "Message body", value: "Thank you for following up. Our records do not show a shipment or tracking number for this order, and we cannot confirm a dispatch date. Could you share the message you received so we can trace it? We will review the order as soon as we hear from you." },
      { label: "Request ID", value: "DP-DEMO-O8-SEND-MESSAGE-001" },
      { label: "Template", value: "contradiction-clarification / no-admission" },
    ],
    payloadNote: "Draft avoids confirming the buyer-cited message until a record is found.",
    validation: {
      decision: "NEEDS_REVIEW",
      checks: standardChecks({
        V8: { detail: "No attachment; the labelling rule does not apply to a message body." },
      }),
      summary: "Legal to send, but a contradiction is open. High risk because the reply could be read as an admission.",
    },
    policyRefs,
    hateoas: { observedAt: "2026-10-17T01:05:00Z", source: "Case capability snapshot snap-3 (demo fixture)", frozen: true, links: inquiryLinks() },
    snapshotVersion: "O8/snap-3",
    submittedBy: "Dana Whitfield",
    submittedAt: "2026-10-17T01:15:00Z",
    evidenceStatus: "2 of 3 items on file · 1 contradiction",
  },
  {
    ...base,
    proposalId: "P-O10-01",
    caseId: "O10",
    action: "provide-evidence",
    actionLabel: "Provide evidence (notes branch)",
    state: "DRAFT",
    risk: "MEDIUM",
    rationale: [
      "PayPal requested PROOF_OF_FULFILLMENT; the evidence window is open.",
      "provide_evidence is present with method POST in the current snapshot.",
      "The attachment is explicitly labelled sandbox test material — no tracking is invented.",
    ],
    evidenceIds: ["E-O10-03", "E-O10-02"],
    payload: [
      { label: "Evidence type", value: "PROOF_OF_FULFILLMENT" },
      { label: "File", value: "sandbox-fulfillment-note-O10.txt" },
      { label: "Content label", value: "SCENARIO_DEFINED — sandbox test material" },
      { label: "Size", value: "1.8 KB (limit 10 MB per file)" },
      { label: "Request ID", value: "DP-DEMO-O10-PROVIDE-EVIDENCE-001" },
    ],
    payloadNote:
      "The note states its own simulated nature. If a real carrier record existed, it would replace this payload entirely.",
    validation: {
      decision: "PASS",
      checks: standardChecks({
        V9: { detail: "Snapshot is 8 minutes old; the freshness window is 30 minutes." },
      }),
      summary: "V1–V12 pass. Legal to attempt once approved; approval does not guarantee PayPal acceptance.",
    },
    policyRefs,
    hateoas: { observedAt: "2026-10-17T02:55:00Z", source: "Case capability snapshot snap-3 (demo fixture)", frozen: true, links: inquiryLinks() },
    snapshotVersion: "O10/snap-3",
    evidenceStatus: "3 of 3 items on file",
  },
  {
    ...base,
    proposalId: "P-O11-01",
    caseId: "O11",
    action: "provide-evidence",
    actionLabel: "Provide evidence (notes branch)",
    state: "EXECUTED",
    risk: "MEDIUM",
    rationale: [
      "Open requirement matched the prepared simulated note.",
      "A single attempt was made with a fixed request id.",
    ],
    evidenceIds: ["E-O11-03", "E-O11-02"],
    payload: [
      { label: "Evidence type", value: "PROOF_OF_FULFILLMENT" },
      { label: "File", value: "sandbox-fulfillment-note-O11.txt" },
      { label: "Content label", value: "SCENARIO_DEFINED — sandbox test material" },
      { label: "Request ID", value: "DP-DEMO-O11-PROVIDE-EVIDENCE-001" },
    ],
    payloadNote: "Replay succeeded; a duplicate submission from a stale tab was suppressed.",
    validation: {
      decision: "PASS",
      checks: standardChecks(),
      summary: "V1–V12 passed. GET re-query confirmed the new evidence entry.",
    },
    policyRefs,
    hateoas: { observedAt: "2026-10-16T05:02:00Z", source: "Case capability snapshot snap-4 (demo fixture)", frozen: true, links: inquiryLinks() },
    snapshotVersion: "O11/snap-4",
    submittedBy: "Priya Raman",
    submittedAt: "2026-10-16T05:12:00Z",
    decidedBy: "Marcus Lindqvist",
    decidedAt: "2026-10-16T05:22:00Z",
    decisionReason: "Approved. Single attempt only; do not retry on timeout.",
    executedAt: "2026-10-16T05:31:00Z",
    evidenceStatus: "3 of 3 items on file",
  },
  {
    ...base,
    proposalId: "P-O12-01",
    caseId: "O12",
    action: "provide-evidence",
    actionLabel: "Provide evidence (notes branch)",
    state: "BLOCKED",
    risk: "HIGH",
    rationale: [
      "The evidence requirement is open and an artifact exists.",
      "The capability snapshot is older than the freshness window, so availability cannot be asserted.",
    ],
    evidenceIds: ["E-O12-03"],
    payload: [
      { label: "Evidence type", value: "PROOF_OF_FULFILLMENT" },
      { label: "File", value: "sandbox-fulfillment-note-O12.txt" },
      { label: "Request ID", value: "not issued — validation failed" },
    ],
    payloadNote: "No request id is issued while validation fails; the action cannot be queued.",
    validation: {
      decision: "BLOCKED",
      checks: standardChecks({
        V9: {
          status: "FAIL",
          detail: "Snapshot observed 55 minutes ago; the freshness window is 30 minutes. Re-read the case before proceeding.",
        },
      }),
      summary: "Blocked by V9. Refresh the case snapshot and re-run the analysis; the evidence itself is ready.",
    },
    policyRefs,
    hateoas: { observedAt: "2026-10-16T11:05:00Z", source: "Stale capability snapshot snap-2 (demo fixture)", frozen: true, links: inquiryLinks() },
    snapshotVersion: "O12/snap-2",
    blockReason: "Snapshot expired (V9). Action availability must be re-read before execution.",
    evidenceStatus: "3 of 3 items on file",
  },
  {
    ...base,
    proposalId: "P-O14-01",
    caseId: "O14",
    action: "provide-evidence",
    actionLabel: "Provide evidence (photos)",
    state: "BLOCKED",
    risk: "HIGH",
    rationale: [
      "The requirement is OTHER and the evidence window is open.",
      "The only candidate artifact — photos of the delivered sleeve — does not exist.",
    ],
    evidenceIds: ["E-O14-03"],
    payload: [
      { label: "Evidence type", value: "OTHER" },
      { label: "File", value: "— none available —" },
      { label: "Request ID", value: "not issued — validation failed" },
    ],
    payloadNote: "An empty or fabricated attachment is not an acceptable payload. The action stays blocked.",
    validation: {
      decision: "BLOCKED",
      checks: standardChecks({
        V5: { detail: "Requirement OTHER is open, but no matching artifact exists." },
        V7: { status: "FAIL", detail: "Payload would contain no file; submitting an empty form is not a valid request." },
        V8: { status: "FAIL", detail: "No content to label. Fabricating a photo is prohibited." },
      }),
      summary:
        "Blocked by V7 and V8: there is no truthful artifact to attach. Request photos from the buyer first.",
    },
    policyRefs,
    hateoas: { observedAt: "2026-10-17T00:50:00Z", source: "Case capability snapshot snap-3 (demo fixture)", frozen: true, links: inquiryLinks() },
    snapshotVersion: "O14/snap-3",
    blockReason: "No verifiable evidence available. Request photos or wait; do not fabricate an attachment.",
    evidenceStatus: "1 of 4 items on file · 2 gaps",
  },
  {
    ...base,
    proposalId: "P-O16-01",
    caseId: "O16",
    action: "send-message",
    actionLabel: "Send message to buyer",
    state: "REJECTED",
    risk: "HIGH",
    rationale: [
      "Two buyer-cited receipts suggest a duplicate charge.",
      "The merchant ledger has not been reconciled.",
    ],
    evidenceIds: ["E-O16-01", "E-O16-02"],
    payload: [
      { label: "Message body", value: "We have received your report of a duplicate charge. Please share both receipts so we can compare them with our records and correct any duplicate billing." },
      { label: "Request ID", value: "DP-DEMO-O16-SEND-MESSAGE-001" },
    ],
    payloadNote: "Rejected before execution; no request id was issued to the replay runner.",
    validation: {
      decision: "PASS",
      checks: standardChecks(),
      summary: "Legal to send, but the manager rejected the proposal on completeness grounds.",
    },
    policyRefs,
    hateoas: { observedAt: "2026-10-17T01:30:00Z", source: "Case capability snapshot snap-3 (demo fixture)", frozen: true, links: inquiryLinks() },
    snapshotVersion: "O16/snap-3",
    submittedBy: "Dana Whitfield",
    submittedAt: "2026-10-17T01:34:00Z",
    decidedBy: "Marcus Lindqvist",
    decidedAt: "2026-10-17T01:40:00Z",
    decisionReason: "Rejected — reconcile the duplicate against the ledger first. Do not contact the buyer before the refund status is known.",
    evidenceStatus: "2 of 3 items on file",
  },
  {
    ...base,
    proposalId: "P-O17-01",
    caseId: "O17",
    action: "send-message",
    actionLabel: "Send message to buyer",
    state: "BLOCKED",
    risk: "BLOCKED",
    rationale: [
      "The buyer's account is internally consistent and contact would normally be appropriate.",
      "The case is in CHARGEBACK and the snapshot exposes no send_message link.",
    ],
    evidenceIds: ["E-O17-01", "E-O17-02"],
    payload: [
      { label: "Message body", value: "We are reviewing the renewal that followed your cancellation. Please share the cancellation confirmation so we can match it to our billing records." },
      { label: "Request ID", value: "not issued — action unavailable" },
    ],
    payloadNote: "The message cannot be sent: the action is not in the current link set.",
    validation: {
      decision: "BLOCKED",
      checks: standardChecks({
        V3: { status: "FAIL", detail: "send_message is absent from the CHARGEBACK link set. Only self and provide_evidence are present." },
        V4: { status: "FAIL", detail: "CHARGEBACK stage does not expose the seller messaging action in this snapshot." },
      }),
      summary:
        "Blocked by V3 and V4. AI understanding is not permission: the action is unavailable in this dispute state.",
    },
    policyRefs,
    hateoas: {
      observedAt: "2026-10-16T12:20:00Z",
      source: "Case capability snapshot snap-4 — CHARGEBACK (demo fixture)",
      frozen: true,
      links: [
        link("self", "GET"),
        link("provide_evidence", "POST"),
        link("send_message", "POST", false),
        link("make_offer", "POST", false),
        link("escalate", "POST", false),
        link("accept_claim", "POST", false),
      ],
    },
    snapshotVersion: "O17/snap-4",
    blockReason:
      "Action unavailable: send-message is not supported in the current dispute state (CHARGEBACK).",
    evidenceStatus: "1 of 2 items on file",
  },
];

export const proposalById = (proposalId: string): ActionProposal | undefined =>
  proposalFixtures.find((item) => item.proposalId === proposalId);

export const proposalsByCase = (caseId: string): ActionProposal[] =>
  proposalFixtures.filter((item) => item.caseId === caseId);

/** Latest proposal per case, which is what the workspace surfaces. */
export const latestProposalByCase = (caseId: string): ActionProposal | undefined => {
  const items = proposalsByCase(caseId);
  return items[items.length - 1];
};
