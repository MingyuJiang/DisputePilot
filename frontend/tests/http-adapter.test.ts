import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpFacade, createHttpService } from "../src/api/http";
import { ApiError } from "../src/api/http/client";
import { mapProposalState } from "../src/api/mapping";
import { actions } from "../src/api/store";
import { disputePilot, resolveServiceMode, SERVICE_MODE } from "../src/api";
import type {
  WireAnalysis,
  WireApproval,
  WireAuditTimeline,
  WireCase,
  WireEvidence,
  WireExecution,
  WireProposal,
  WireValidationReport,
} from "../src/api/http/types";

/**
 * HTTP adapter tests — vitest + fetch mock only. No real backend, no network,
 * no dev server, no PayPal calls.
 *
 * Wire fixtures mirror the candidate contract examples (API_EXAMPLES.md A3–A10).
 */

const BASE = "http://dp.test/api/v1";
const CASE_ID = "O4";
const PROPOSAL_ID = "PRP-O4-send-message-b796c617cc";
const REFUND_PROPOSAL_ID = "PRP-O4-refund-00refund";
const APPROVAL_ID = "APR-PRP-O4-send-message-b796c617cc";
const ANALYSIS_ID = "ANL-O4-20261017-ab12cd";
const SNAPSHOT_HASH = "a".repeat(64);
const PAYLOAD_HASH = "c".repeat(64);
const DECISION_HASH = "b".repeat(64);

const wireCase: WireCase = {
  case_id: CASE_ID,
  scenario_id: "LEVEL_C_WEB_DISPUTE_FROZEN",
  dispute_id: "UNKNOWN",
  family: "INR",
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  status: "IMPORTED",
  dispute_status: "WAITING_FOR_SELLER_RESPONSE",
  lifecycle_stage: "INQUIRY",
  amount: { value_minor: 1500, currency: "USD", display: "15.00 USD" },
  transaction_reference: {
    order_id: "UNKNOWN",
    capture_id: "UNKNOWN",
    buyer_transaction_id: "UNKNOWN",
    dispute_id: "UNKNOWN",
  },
  fulfillment_posture: "NONE",
  seller_contacted: false,
  evidence_count: 3,
  available_actions: [
    { rel: "self", method: "GET", basis: "FIXTURE_SNAPSHOT" },
    { rel: "accept_claim", method: "POST", basis: "FIXTURE_SNAPSHOT" },
    { rel: "send_message", method: "POST", basis: "FIXTURE_SNAPSHOT" },
    { rel: "adjudicate", method: "POST", basis: "THEORETICAL_DOC" },
  ],
  evidence_requirements: [
    { evidence_type: "PROOF_OF_FULFILLMENT", source: "REQUESTED_FROM_SELLER", open: true },
  ],
  provenance: "PAYPAL_API_OBSERVED",
  verification_level: "FROZEN_SANDBOX_E1_VERIFIED",
  case_version: 1,
  snapshot_hash: SNAPSHOT_HASH,
  live_status_note: "live execution status is owned by the Sol environment",
  created_at: "2026-10-17T02:58:00Z",
  updated_at: "2026-10-17T06:20:00Z",
};

const caseSummary = {
  case_id: CASE_ID,
  family: "INR",
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  status: "IMPORTED",
  amount: wireCase.amount,
  fulfillment_posture: "NONE",
  provenance: "PAYPAL_API_OBSERVED",
  verification_level: "FROZEN_SANDBOX_E1_VERIFIED",
};

const wireEvidence: WireEvidence[] = [
  {
    evidence_id: "EV-O4-BUYER-001",
    case_id: CASE_ID,
    evidence_type: "BUYER_STATEMENT",
    content: "This is a simulated item-not-received scenario for the PayPal Sandbox environment.",
    source_type: "DISPUTE_BUYER_MESSAGE",
    provenance: "HUMAN_OBSERVED_SANDBOX_UI",
    verification_level: "FROZEN_SANDBOX_E1_VERIFIED",
    source_reference: "dispute detail fixture",
    observed_at: null,
    integrity_hash: null,
  },
  {
    evidence_id: "EV-O4-AV-002",
    case_id: CASE_ID,
    evidence_type: "ORDER_RECORD",
    content: "Order record for the disputed payment.",
    source_type: "CASE_SNAPSHOT",
    provenance: "PAYPAL_API_OBSERVED",
    verification_level: "FROZEN_SANDBOX_E1_VERIFIED",
    source_reference: "case snapshot §order",
    observed_at: "2026-10-17T02:58:00Z",
    integrity_hash: null,
  },
  {
    evidence_id: "EV-O4-REQ-001",
    case_id: CASE_ID,
    evidence_type: "PROOF_OF_FULFILLMENT",
    content: "Open requirement: proof of fulfillment requested from the seller.",
    source_type: "EXPECTED_EVIDENCE_REQUIREMENT",
    provenance: "PAYPAL_API_OBSERVED",
    verification_level: "FROZEN_SANDBOX_E1_VERIFIED",
    source_reference: "evidences[] requirement",
    observed_at: null,
    integrity_hash: null,
  },
];

const wireAnalysis: WireAnalysis = {
  analysis_id: ANALYSIS_ID,
  case_id: CASE_ID,
  case_snapshot_hash: DECISION_HASH,
  factual_summary:
    "INR dispute (MERCHANDISE_OR_SERVICE_NOT_RECEIVED), 15.00 USD, fulfillment posture NONE, status WAITING_FOR_SELLER_RESPONSE/INQUIRY (fixture snapshot).",
  grounded_facts: [
    {
      fact_id: "GF-O4-BUYER",
      statement: "Buyer filed an INR dispute for 15.00 USD.",
      fact_type: "OBSERVED_FACT",
      evidence_ids: ["EV-O4-BUYER-001"],
      provenance: "HUMAN_OBSERVED_SANDBOX_UI",
    },
    {
      fact_id: "GF-O4-REQ",
      statement: "Open evidence requirement: PROOF_OF_FULFILLMENT requested from the seller.",
      fact_type: "SUPPORTED_INFERENCE",
      evidence_ids: ["EV-O4-REQ-001"],
      provenance: "PAYPAL_API_OBSERVED",
    },
  ],
  missing_evidence: ["real proof of fulfillment (deliberately NOT fabricated)"],
  contradictions: [],
  recommendation: "send-message",
  safety_flags: ["AI output is STUB_DETERMINISTIC — not a real LLM inference"],
  model_provider: "deterministic-stub",
  model_name: "evidence-planner-v1",
  analysis_mode: "STUB_DETERMINISTIC",
  created_at: "2026-10-17T07:00:00Z",
  plan: {
    recommended_action: "send-message",
    rationale: ["open requirement PROOF_OF_FULFILLMENT but posture NONE has no truthful material"],
    gaps: [
      {
        gap: "open requirement PROOF_OF_FULFILLMENT — posture NONE provides no truthful material",
        severity: "HIGH",
      },
    ],
    alternatives: ["WAIT (restraint)"],
    wait_rule_applies: false,
  },
};

const passedReport: WireValidationReport = {
  report_id: `VR-${PROPOSAL_ID}`,
  proposal_id: PROPOSAL_ID,
  case_id: CASE_ID,
  action_type: "send-message",
  passed: true,
  blocked_reasons: [],
  findings: [
    {
      validator_id: "V1",
      status: "PASS",
      detail: "Case reference resolves to a single fixture record.",
      basis: "FIXTURE_SNAPSHOT",
      doc_reference: "S6_1_AI_ACTION_PLAN.md D3",
    },
    {
      validator_id: "V6",
      status: "SKIPPED",
      detail: "No monetary amount in this payload.",
      basis: "FIXTURE_SNAPSHOT",
      doc_reference: "",
    },
    {
      validator_id: "V11",
      status: "PASS",
      detail: "A fixed idempotency key is attached for a single attempt.",
      basis: "FIXTURE_SNAPSHOT",
      doc_reference: "S6_1_AI_ACTION_PLAN.md D5",
    },
  ],
  created_at: "2026-10-17T07:06:00Z",
};

const blockedReport: WireValidationReport = {
  report_id: `VR-${REFUND_PROPOSAL_ID}`,
  proposal_id: REFUND_PROPOSAL_ID,
  case_id: CASE_ID,
  action_type: "refund",
  passed: false,
  blocked_reasons: [
    "V2: refund not in whitelist ['accept-claim', 'escalate', 'make-offer', 'provide-evidence', 'provide-supporting-info', 'send-message', 'wait']",
    "V7: no offline payload schema for 'refund' (see V2)",
  ],
  findings: [
    {
      validator_id: "V2",
      status: "FAIL",
      detail: "refund not in whitelist ['accept-claim', 'escalate', 'make-offer', 'provide-evidence', 'provide-supporting-info', 'send-message', 'wait']",
      basis: "FIXTURE_SNAPSHOT",
      doc_reference: "S6_1_AI_ACTION_PLAN.md D3",
    },
    {
      validator_id: "V7",
      status: "FAIL",
      detail: "no offline payload schema for 'refund' (see V2)",
      basis: "FIXTURE_SNAPSHOT",
      doc_reference: "S6_1_AI_ACTION_PLAN.md D6",
    },
  ],
  created_at: "2026-10-17T07:06:00Z",
};

const mainProposal: WireProposal = {
  proposal_id: PROPOSAL_ID,
  case_id: CASE_ID,
  analysis_id: ANALYSIS_ID,
  action_type: "send-message",
  action_payload: {
    message: "SCENARIO_DEFINED sandbox test correspondence (offline replay draft) — case O4.",
    idempotency_key: "DP-REPLAY-O4-SEND_MESSAGE-001",
  },
  expected_preconditions: ["dispute state allows send_message (FIXTURE_SNAPSHOT)"],
  required_evidence: [],
  rationale: ["open requirement PROOF_OF_FULFILLMENT but posture NONE has no truthful material"],
  evidence_ids: ["EV-O4-BUYER-001", "EV-O4-AV-002", "EV-O4-REQ-001"],
  risk_level: "LOW",
  validation_status: "PASSED",
  state: "PENDING_APPROVAL",
  snapshot_hash: SNAPSHOT_HASH,
  payload_hash: PAYLOAD_HASH,
  policy_version: "policy-v1.0",
  execution_authorized: false,
  created_at: "2026-10-17T07:05:00Z",
  updated_at: "2026-10-17T07:05:00Z",
};

const refundProposal: WireProposal = {
  ...mainProposal,
  proposal_id: REFUND_PROPOSAL_ID,
  action_type: "refund",
  action_payload: { idempotency_key: "DP-REPLAY-O4-REFUND-001" },
  validation_status: "NOT_RUN",
  state: "DRAFT",
};

const pendingApproval: WireApproval = {
  approval_id: APPROVAL_ID,
  proposal_id: PROPOSAL_ID,
  case_id: CASE_ID,
  action_payload_hash: PAYLOAD_HASH,
  case_snapshot_hash: SNAPSHOT_HASH,
  policy_version: "policy-v1.0",
  decision: "PENDING",
  reason: "",
  actor_id: "specialist-1",
  actor_role: "SPECIALIST",
  decided_at: "2026-10-17T07:10:00Z",
};

const auditTimeline: WireAuditTimeline = {
  case_id: CASE_ID,
  append_only: true,
  events: [
    {
      event_id: "AUD-IMPORT-O4",
      case_id: CASE_ID,
      event_type: "CASE_IMPORTED",
      actor_type: "SYSTEM",
      actor_id: "fixture-loader",
      payload: {
        provenance: "PAYPAL_API_OBSERVED",
        verification_level: "FROZEN_SANDBOX_E1_VERIFIED",
        scenario_id: "LEVEL_C_WEB_DISPUTE_FROZEN",
        case_version: 1,
        snapshot_hash: SNAPSHOT_HASH,
      },
      created_at: "2026-10-17T02:58:00Z",
    },
    {
      event_id: "AUD-EXE-O4",
      case_id: CASE_ID,
      event_type: "EXECUTION_REPLAYED",
      actor_type: "SYSTEM",
      actor_id: "replay-runner",
      payload: {
        execution_id: "EXE-abc123",
        execution_mode: "REPLAY",
        simulated: true,
        proposal_id: PROPOSAL_ID,
        gateway: "ReplayExecutionGateway",
        artifact: "replay_EXE-abc123.json",
        request_id: "DP-REPLAY-O4-SEND_MESSAGE-001",
        verification: {
          method: "byte-exact message comparison (O4 pattern)",
          basis: "FIXTURE_SNAPSHOT",
        },
      },
      created_at: "2026-10-17T08:00:00Z",
    },
  ],
};

const wireExecution: WireExecution = {
  execution_id: "EXE-abc123",
  proposal_id: PROPOSAL_ID,
  case_id: CASE_ID,
  execution_mode: "REPLAY",
  simulated: true,
  result: "REPLAYED",
  gateway: "ReplayExecutionGateway",
  response_snapshot: {
    simulated: true,
    execution_mode: "REPLAY",
    gateway: "ReplayExecutionGateway",
    action: "send-message",
    note: "This is a deterministic OFFLINE REPLAY result against a frozen fixture state. It is NOT a PayPal API response and must not be recorded or reported as one.",
    message_recorded: true,
    message_sha256: "d".repeat(64),
    expected_state_transition: { dispute_status: "UNDER_REVIEW", links: ["self"] },
  },
  verification: {
    method: "byte-exact message comparison (O4 pattern)",
    basis: "FIXTURE_SNAPSHOT",
    message_byte_exact: true,
    state_before: { dispute_status: "WAITING_FOR_SELLER_RESPONSE", links: ["self", "send_message"] },
    state_after_expected: { dispute_status: "UNDER_REVIEW", links: ["self"] },
    four_layer_note: "API acceptance != evidence recorded != evidence sufficiency != adjudication",
  },
  request_snapshot: { request_id: "DP-REPLAY-O4-SEND_MESSAGE-001" },
  warning: "OFFLINE REPLAY result — not a PayPal API response",
  created_at: "2026-10-17T08:00:00Z",
};

/* ------------------------------------------------------------------ *
 * Fetch mock
 * ------------------------------------------------------------------ */

type Handler = () => { status: number; body: unknown };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface BackendOptions {
  /** Override a route by "METHOD /path" (e.g. "POST /proposals/x/submit"). */
  overrides?: Record<string, Handler>;
  /** Successful replys before the backend starts answering 409. */
  replaysBeforeConflict?: number;
}

interface Backend {
  fetchMock: typeof fetch;
  calls: { method: string; path: string; body?: unknown; headers?: Record<string, string> }[];
  replayCount: number;
}

const createBackend = (options: BackendOptions = {}): Backend => {
  const calls: Backend["calls"] = [];
  const state = { replayCount: 0, approvalDecision: "PENDING", replayed: false };
  const overrides = options.overrides ?? {};
  const replaysBeforeConflict = options.replaysBeforeConflict ?? Number.POSITIVE_INFINITY;

  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, path, body, headers });

    const override = overrides[`${method} ${path}`];
    if (override) {
      const { status, body: responseBody } = override();
      return json(status, responseBody);
    }

    if (method === "GET" && path === "/cases") return json(200, [caseSummary]);
    if (method === "GET" && path === `/cases/${CASE_ID}`) return json(200, wireCase);
    if (method === "GET" && path === `/cases/${CASE_ID}/evidence`) return json(200, wireEvidence);
    if (method === "GET" && path === `/cases/${CASE_ID}/analyses`) return json(200, [wireAnalysis]);
    if (method === "GET" && path === `/cases/${CASE_ID}/proposals`) {
      return json(200, [mainProposal, refundProposal]);
    }
    if (method === "GET" && path === `/cases/${CASE_ID}/audit`) return json(200, auditTimeline);
    if (method === "GET" && path === "/approvals") return json(200, [pendingApproval]);
    if (method === "GET" && path === `/proposals/${PROPOSAL_ID}/validation`) {
      return json(200, passedReport);
    }
    if (method === "GET" && path === `/proposals/${PROPOSAL_ID}/execution`) {
      // A proposal only has an execution record once it was actually replayed;
      // the fixture proposal sits in PENDING_APPROVAL before that.
      return state.replayed
        ? json(200, wireExecution)
        : json(404, { error: { code: "NOT_FOUND", message: "no execution record" } });
    }

    if (method === "POST" && path === `/cases/${CASE_ID}/analyses`) {
      return json(200, { ...wireAnalysis, analysis_id: "ANL-O4-rerun-0001" });
    }
    if (method === "POST" && path === `/proposals/${PROPOSAL_ID}/submit`) {
      return json(200, {
        proposal: { ...mainProposal, state: "PENDING_APPROVAL", validation_status: "PASSED" },
        approval: pendingApproval,
      });
    }
    if (method === "POST" && path === `/approvals/${APPROVAL_ID}/decision`) {
      state.approvalDecision = (body as { decision: string }).decision;
      return json(200, {
        ...pendingApproval,
        decision: (body as { decision: string }).decision,
        reason: (body as { reason: string }).reason,
        // The real backend echoes the demo identity from the request headers.
        actor_id: headers["X-Actor-Id"] ?? "manager-1",
        actor_role: "MANAGER",
        decided_at: "2026-10-17T09:00:00Z",
      });
    }
    if (method === "POST" && path === `/approvals/${APPROVAL_ID}/replay`) {
      state.replayCount += 1;
      // The backend refuses execution unless the approval is APPROVED (state machine).
      if (state.approvalDecision !== "APPROVED") {
        return json(409, {
          error: {
            code: "CONFLICT",
            message:
              "proposal state PENDING_APPROVAL is not executable; only APPROVED proposals may replay",
          },
        });
      }
      if (state.replayCount > replaysBeforeConflict) {
        return json(409, {
          error: {
            code: "CONFLICT",
            message: "proposal already replayed; duplicate execution refused",
          },
        });
      }
      state.replayed = true;
      return json(200, wireExecution);
    }
    if (method === "POST" && path === `/cases/${CASE_ID}/proposals/generate`) {
      return json(200, [
        {
          ...mainProposal,
          proposal_id: "PRP-O4-send-message-regen01",
          state: "DRAFT",
          validation_status: "NOT_RUN",
        },
      ]);
    }

    return json(404, {
      error: { code: "NOT_FOUND", message: `no mock route for ${method} ${path}` },
    });
  }) as unknown as typeof fetch;

  return {
    fetchMock,
    calls,
    get replayCount() {
      return state.replayCount;
    },
  };
};

describe('release HTTP regressions', () => {
  it('binds the existing analysis to a client-authored partial refund', async () => {
    const backend = createBackend({overrides:{[`POST /cases/${CASE_ID}/proposals`]:()=>({status:200,body:{...mainProposal,action_type:'partial-refund',action_family:'PAYMENT',action_payload:{capture_id:'DEMO-CAP-9001',amount:'10.00',currency_code:'USD',idempotency_key:'release-refund'},state:'DRAFT'}})}});
    const service = createHttpService(BASE,{fetch:backend.fetchMock});
    await service.refresh();
    const result = await service.createRefundProposal({caseId:CASE_ID,captureId:'DEMO-CAP-9001',mode:'partial',amount:'10.00',currencyCode:'USD',reason:'Synthetic refund',actor:'merchant',idempotencyKey:'release-refund'});
    expect(result.ok).toBe(true);
    const request = backend.calls.find(c=>c.method==='POST' && c.path===`/cases/${CASE_ID}/proposals`);
    expect(request?.body).toMatchObject({analysis_id:ANALYSIS_ID,action_type:'partial-refund',action_family:'PAYMENT',action_payload:{amount:'10.00',currency_code:'USD'}});
  });
  it('does not send an unbound refund when no analysis exists', async () => {
    const backend=createBackend({overrides:{[`GET /cases/${CASE_ID}/analyses`]:()=>({status:200,body:[]})}});
    const service=createHttpService(BASE,{fetch:backend.fetchMock});await service.refresh();
    const result=await service.createRefundProposal({caseId:CASE_ID,captureId:'DEMO-CAP-9001',mode:'partial',amount:'10.00',currencyCode:'USD',reason:'Synthetic refund',actor:'merchant',idempotencyKey:'no-analysis'});
    expect(result.ok).toBe(false);
    expect(backend.calls.filter(c=>c.method==='POST' && c.path===`/cases/${CASE_ID}/proposals`)).toHaveLength(0);
  });
  it('coalesces simultaneous replay clicks and returns the actual response', async()=>{
    const backend=createBackend();const facade=createHttpFacade({baseUrl:BASE,fetch:backend.fetchMock});
    await facade.refresh();await facade.submitProposal(PROPOSAL_ID,'merchant');await flush();
    await facade.decideProposal(PROPOSAL_ID,'APPROVED','merchant','Approved synthetic request');await flush();
    const first=facade.replay(PROPOSAL_ID);const second=facade.replay(PROPOSAL_ID);
    expect(first).toBe(second);
    const [one,two]=await Promise.all([first,second]);
    expect(one).toBe(two);expect(one.outcome).toBe('SUCCEEDED');
    expect(backend.calls.filter(c=>c.method==='POST' && c.path.endsWith('/replay'))).toHaveLength(1);
  });
  it('retains actual validator findings and their skipped state on HTTP 422', async()=>{
    const backend=createBackend({overrides:{[`POST /approvals/${APPROVAL_ID}/replay`]:()=>({status:422,body:{error:{code:'VALIDATION_FAILED',message:'Missing proof',validation_report:{...blockedReport,findings:[...blockedReport.findings,passedReport.findings[1]]}}}})}});
    const service=createHttpService(BASE,{fetch:backend.fetchMock});await service.refresh();
    await service.decideProposal(PROPOSAL_ID,'APPROVED','merchant','Approved synthetic request');
    const result=await service.replay(PROPOSAL_ID);
    expect(result.httpStatus).toBe(422);expect(result.outcome).toBe('BLOCKED');
    expect(result.revalidation.some(x=>x.status==='FAIL')).toBe(true);
    expect(result.revalidation.find(x=>x.label.startsWith('V6'))?.status).toBe('SKIPPED');
  });
});

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("http adapter — five core model mappings (FIELD_MAPPING §2)", () => {
  it("maps case, evidence, analysis, proposal and approval from the wire format", async () => {
    const backend = createBackend();
    const service = createHttpService(BASE, { fetch: backend.fetchMock });

    await service.refresh();

    // ---- CaseRecord (§2.1) ----
    const record = service.getCase(CASE_ID);
    expect(record).toBeDefined();
    expect(record?.amountMinor).toBe(1500);
    expect(record?.currency).toBe("USD");
    expect(record?.status).toBe("WAITING_FOR_SELLER_RESPONSE"); // ← dispute_status
    expect(record?.workflowStatus).toBe("IMPORTED"); // ← workflow status
    expect(record?.lifecycleStage).toBe("INQUIRY");
    expect(record?.provenance).toBe("PAYPAL_API_OBSERVED");
    expect(record?.validationLevel).toBe("FROZEN_SANDBOX_E1_VERIFIED");
    // B-12: case_version + snapshot_hash replace the mock's snapshotVersion string.
    expect(record?.snapshotVersion).toBe("O4/v1");
    expect(record?.snapshotHash).toBe(SNAPSHOT_HASH);
    expect(record?.caseVersion).toBe(1);
    // B-10: transaction identifiers stay UNKNOWN and say so.
    expect(record?.transaction.orderRef).toBe("UNKNOWN");
    expect(record?.transaction.captureRef).toBe("UNKNOWN");
    expect(record?.transaction.captureStatus).toBe("UNKNOWN");
    expect(record?.transaction.note).toContain("脱敏");
    // Local demo state is derived, never fabricated.
    expect(record?.itemName).toBe("LEVEL_C_WEB_DISPUTE_FROZEN"); // ← scenario_id
    expect(record?.buyerClaim).toContain("simulated item-not-received");
    expect(record?.evidenceReadiness).toEqual({
      provided: 2,
      requested: 3,
      label: "2 of 3 requested items on file",
    });
    expect(record?.aiReview).toBe("ANALYZED");
    expect(record?.nextAction).toBe("Run AI analysis");
    expect(record?.risk).toBe("LOW"); // ← latest proposal risk_level
    // §3.9: available ← POST && basis != THEORETICAL_DOC
    expect(record?.availableActions).toHaveLength(4);
    expect(record?.availableActions?.find((link) => link.rel === "send_message")?.available).toBe(true);
    expect(record?.availableActions?.find((link) => link.rel === "self")?.available).toBe(false);
    expect(record?.availableActions?.find((link) => link.rel === "adjudicate")?.available).toBe(false);
    expect(record?.evidenceRequirements?.[0]).toEqual({
      evidenceType: "PROOF_OF_FULFILLMENT",
      sourceExpected: "REQUESTED_FROM_SELLER",
      status: "OPEN",
    });

    // ---- EvidenceRecord (§2.2) ----
    const evidence = service.listEvidence(CASE_ID);
    expect(evidence).toHaveLength(3);
    const buyerStatement = evidence[0];
    expect(buyerStatement.type).toBe("BUYER_STATEMENT");
    expect(buyerStatement.typeLabel).toBe("Buyer statement");
    expect(buyerStatement.direction).toBe("FROM_BUYER");
    expect(buyerStatement.grounding).toBe("VERIFIED_OBSERVATION");
    expect(buyerStatement.collectedAt).toBe(""); // observed_at is null
    expect(evidence[1].direction).toBe("FROM_CASE_SNAPSHOT");
    expect(evidence[2].direction).toBe("REQUESTED_FROM_SELLER");
    expect(evidence[2].supportedFactIds).toEqual(["GF-O4-REQ"]);

    // ---- AIAnalysis (§2.3) ----
    const analysis = service.getAnalysis(CASE_ID);
    expect(analysis?.status).toBe("READY");
    expect(analysis?.summary).toContain("INR dispute");
    expect(analysis?.facts[0]?.grounding).toBe("VERIFIED_OBSERVATION"); // OBSERVED_FACT
    expect(analysis?.facts[1]?.grounding).toBe("AI_INFERENCE"); // SUPPORTED_INFERENCE
    expect(analysis?.facts[0]?.basis).toBe("dispute detail fixture");
    expect(analysis?.gaps).toHaveLength(1);
    expect(analysis?.gaps[0]?.severity).toBe("HIGH");
    expect(analysis?.gaps[0]?.title).toContain("PROOF_OF_FULFILLMENT");
    expect(analysis?.recommendation.action).toBe("send-message");
    expect(analysis?.recommendation.actionLabel).toBe("Send message to buyer");
    expect(analysis?.recommendation.strength).toBeUndefined(); // no backend source
    expect(analysis?.recommendation.rationale).toEqual([
      "open requirement PROOF_OF_FULFILLMENT but posture NONE has no truthful material",
    ]);
    expect(analysis?.waitRule.applies).toBe(false);
    expect(analysis?.modelLabel).toBe("deterministic-stub / evidence-planner-v1");
    expect(analysis?.analysisMode).toBe("STUB_DETERMINISTIC");
    expect(analysis?.safetyFlags?.[0]).toContain("STUB_DETERMINISTIC");
    expect(analysis?.caseSnapshotHash).toBe(DECISION_HASH);
    expect(analysis?.missingEvidence?.[0]).toContain("proof of fulfillment");
    expect(analysis?.requirements).toEqual([
      {
        evidenceType: "PROOF_OF_FULFILLMENT",
        sourceExpected: "REQUESTED_FROM_SELLER",
        status: "OPEN",
      },
    ]);
    expect(analysis?.provenance).toBeUndefined(); // B-14: analysis-level provenance removed

    // ---- ActionProposal (§2.4) ----
    const proposal = service.listProposals(CASE_ID)[0];
    expect(proposal.proposalId).toBe(PROPOSAL_ID);
    expect(proposal.state).toBe("AWAITING_APPROVAL"); // ← PENDING_APPROVAL
    expect(proposal.backendState).toBe("PENDING_APPROVAL");
    expect(proposal.action).toBe("send-message");
    expect(proposal.payload).toEqual([
      {
        label: "Message body",
        value: "SCENARIO_DEFINED sandbox test correspondence (offline replay draft) — case O4.",
        confidential: false,
      },
      {
        label: "Request ID",
        value: "DP-REPLAY-O4-SEND_MESSAGE-001",
        confidential: false,
      },
    ]);
    expect(proposal.validation.decision).toBe("PASS"); // ← PASSED
    expect(proposal.validationStatus).toBe("PASSED");
    expect(proposal.validation.checks.map((check) => [check.id, check.status])).toEqual([
      ["V1", "PASS"],
      ["V6", "SKIPPED"],
      ["V11", "PASS"],
    ]);
    expect(proposal.validation.checks[0]?.label).toBe("Dispute identity");
    expect(proposal.validation.checks[0]?.basis).toBe("FIXTURE_SNAPSHOT");
    expect(proposal.validation.checks[0]?.docReference).toBe("S6_1_AI_ACTION_PLAN.md D3");
    expect(proposal.payloadHash).toBe(PAYLOAD_HASH);
    expect(proposal.policyVersion).toBe("policy-v1.0");
    expect(proposal.executionAuthorized).toBe(false);
    expect(proposal.requiresApproval).toBe(true);
    expect(proposal.hateoas.frozen).toBe(false); // one THEORETICAL_DOC link → mixed basis
    expect(proposal.hateoas.source).toContain("mixed");
    expect(proposal.hateoas.links.find((link) => link.rel === "send_message")?.available).toBe(true);
    expect(proposal.submittedBy).toBe("specialist-1");
    expect(proposal.submittedAt).toBe("2026-10-17T07:10:00Z");
    expect(proposal.evidenceStatus).toBe("No specific evidence required");

    // ---- ApprovalRecord (§2.5) ----
    const approval = service.listApprovals()[0];
    expect(approval.approvalId).toBe(APPROVAL_ID);
    expect(approval.decision).toBe("PENDING");
    expect(approval.actorRole).toBe("SPECIALIST");
    expect(approval.actionPayloadHash).toBe(PAYLOAD_HASH);
    expect(approval.caseSnapshotHash).toBe(SNAPSHOT_HASH);
    expect(approval.policyVersion).toBe("policy-v1.0");
    expect(approval.snapshotVersion).toBeUndefined();

    // ---- AuditEvent (§2.6) ----
    const audit = service.listAudit(CASE_ID);
    const imported = audit.find((event) => event.backendEventType === "CASE_IMPORTED");
    expect(imported?.action).toBe("CASE_IMPORTED");
    expect(imported?.outcome).toBe("INFO");
    expect(imported?.environment).toBe("backend_offline_replay");
    expect(imported?.fields).toEqual(
      expect.arrayContaining([{ label: "Provenance", value: "PAYPAL_API_OBSERVED" }]),
    );
    const executed = audit.find((event) => event.backendEventType === "EXECUTION_REPLAYED");
    expect(executed?.action).toBe("EXECUTION_ATTEMPT"); // UI vocabulary
    expect(executed?.outcome).toBe("SUCCEEDED");
    expect(executed?.httpStatus).toBe(200);
    expect(executed?.summary).toContain("not a PayPal response");
    expect(executed?.revalidation?.status).toBe("PASS");
    expect(executed?.revalidation?.checks[0]?.note).toContain("FIXTURE_SNAPSHOT");

    // ---- B-8: the queue is approval-driven ----
    expect(service.listPendingApprovals().map((item) => item.proposalId)).toEqual([PROPOSAL_ID]);
  });

  it("maps A's full ProposalState vocabulary onto the UI vocabulary (§3.1)", () => {
    expect(mapProposalState("DRAFT")).toBe("DRAFT");
    expect(mapProposalState("VALIDATED")).toBe("DRAFT");
    expect(mapProposalState("PENDING_APPROVAL")).toBe("AWAITING_APPROVAL");
    expect(mapProposalState("APPROVED")).toBe("APPROVED");
    expect(mapProposalState("REJECTED")).toBe("REJECTED");
    expect(mapProposalState("BLOCKED")).toBe("BLOCKED");
    // An offline replay is never a live execution…
    expect(mapProposalState("REPLAY_EXECUTED")).toBe("REPLAYED");
    // …and a failed attempt is not a block (nothing was sent when blocked).
    expect(mapProposalState("FAILED")).toBe("FAILED");
    // An unrecognised value is preserved as UNKNOWN, never normalised to DRAFT.
    expect(mapProposalState("SOMETHING_NEW")).toBe("UNKNOWN");
  });
});

describe("http adapter — submit → approval → replay state flow", () => {
  it("carries the full protected-write chain through the backend", async () => {
    const backend = createBackend();
    const service = createHttpService(BASE, { fetch: backend.fetchMock });
    await service.refresh();

    // Submit (specialist).
    const submitted = await service.submitProposal(PROPOSAL_ID, "Dana Whitfield");
    expect(submitted?.state).toBe("AWAITING_APPROVAL");
    expect(submitted?.backendState).toBe("PENDING_APPROVAL");
    expect(service.listPendingApprovals()).toHaveLength(1);
    expect(service.listPendingApprovals()[0]?.submittedBy).toBe("specialist-1");

    // Approve (manager) — the adapter resolves proposalId → approvalId by itself.
    const approved = await service.decideProposal(
      PROPOSAL_ID,
      "APPROVED",
      "Marcus Lindqvist",
      "Evidence reviewed against the open requirement.",
    );
    expect(approved?.state).toBe("APPROVED");
    expect(approved?.decidedBy).toBe("Marcus Lindqvist");
    expect(approved?.decisionReason).toBe("Evidence reviewed against the open requirement.");
    expect(service.listPendingApprovals()).toHaveLength(0);

    // The decision request went out as MANAGER with the required body.
    const decisionCall = backend.calls.find(
      (call) => call.method === "POST" && call.path === `/approvals/${APPROVAL_ID}/decision`,
    );
    expect(decisionCall).toBeDefined();
    expect(decisionCall?.headers?.["X-Actor-Role"]).toBe("MANAGER");
    expect(decisionCall?.headers?.["X-Actor-Id"]).toBe("Marcus Lindqvist");
    expect(decisionCall?.headers?.["Idempotency-Key"]).toBeTruthy();
    expect(decisionCall?.body).toEqual({
      decision: "APPROVED",
      reason: "Evidence reviewed against the open requirement.",
    });

    // Replay (manager) — simulated execution marks must travel to the UI.
    const result = await service.replay(PROPOSAL_ID);
    expect(result.outcome).toBe("SUCCEEDED");
    expect(result.httpStatus).toBe(200);
    expect(result.simulated).toBe(true);
    expect(result.executionMode).toBe("REPLAY");
    expect(result.warning).toBe("OFFLINE REPLAY result — not a PayPal API response");
    expect(result.message).toContain("NOT a PayPal API response");
    expect(result.revalidation.map((check) => check.label)).toEqual([
      "Verification method",
      "State before",
      "Expected transition",
    ]);
    expect(result.requestId).toBe("DP-REPLAY-O4-SEND_MESSAGE-001");

    const executed = service.listProposals(CASE_ID)[0];
    // The offline replay record outranks REPLAY_EXECUTED: this is a replay,
    // not a confirmed live execution.
    expect(executed.state).toBe("REPLAYED");
    expect(executed.backendState).toBe("REPLAY_EXECUTED");
    expect(executed.executedAt).toBe("2026-10-17T08:00:00Z");
  });

  it("refuses a duplicate replay with the backend's 409 (B-16)", async () => {
    const backend = createBackend({ replaysBeforeConflict: 1 });
    const service = createHttpService(BASE, { fetch: backend.fetchMock });
    await service.refresh();
    await service.submitProposal(PROPOSAL_ID, "Dana Whitfield");
    await service.decideProposal(PROPOSAL_ID, "APPROVED", "Marcus Lindqvist", "reason is long enough");

    const first = await service.replay(PROPOSAL_ID);
    expect(first.outcome).toBe("SUCCEEDED");

    const second = await service.replay(PROPOSAL_ID);
    expect(second.outcome).toBe("BLOCKED");
    expect(second.httpStatus).toBe(409);
    expect(second.message).toContain("already replayed");
    expect(backend.replayCount).toBe(2);
  });

  it("refuses a replay before the manager approval (backend state machine)", async () => {
    const backend = createBackend();
    const service = createHttpService(BASE, { fetch: backend.fetchMock });
    await service.refresh();
    // The fixture proposal sits in PENDING_APPROVAL; nobody has decided yet.
    expect(service.listPendingApprovals()).toHaveLength(1);

    const premature = await service.replay(PROPOSAL_ID);
    expect(premature.outcome).toBe("BLOCKED");
    expect(premature.httpStatus).toBe(409);
    expect(premature.message).toContain("not executable");
  });

  it("surfaces a replay-time validation block (stale decision) as BLOCKED", async () => {
    const backend = createBackend({
      overrides: {
        [`POST /approvals/${APPROVAL_ID}/replay`]: () => ({
          status: 422,
          body: {
            error: {
              code: "VALIDATION_FAILED",
              message:
                'execution blocked: ["V9: decision snapshot hash drift (case or runtime state changed) — stale decision, re-run"]',
            },
          },
        }),
      },
    });
    const service = createHttpService(BASE, { fetch: backend.fetchMock });
    await service.refresh();
    await service.submitProposal(PROPOSAL_ID, "Dana Whitfield");
    await service.decideProposal(PROPOSAL_ID, "APPROVED", "Marcus Lindqvist", "reason is long enough");

    const blocked = await service.replay(PROPOSAL_ID);
    expect(blocked.outcome).toBe("BLOCKED");
    expect(blocked.httpStatus).toBe(422);
    expect(blocked.message).toContain("hash drift");
  });
});

describe("http adapter — case_id-less write summaries (D-2)", () => {
  it("merges a ProposalSubmitSummaryOut submit response onto the cached proposal", async () => {
    const backend = createBackend({
      overrides: {
        // Pre-submit backend state: the proposal is still a DRAFT, so the
        // approval queue is empty until the submit response lands.
        [`GET /cases/${CASE_ID}/proposals`]: () => ({
          status: 200,
          body: [{ ...mainProposal, state: "DRAFT", validation_status: "NOT_RUN" }, refundProposal],
        }),
        // Real backend behaviour (frozen contract ProposalSubmitSummaryOut):
        // the submit response's proposal carries ONLY these three fields —
        // no case_id, no other proposal fields.
        [`POST /proposals/${PROPOSAL_ID}/submit`]: () => ({
          status: 200,
          body: {
            proposal: {
              proposal_id: PROPOSAL_ID,
              state: "PENDING_APPROVAL",
              validation_status: "PASSED",
            },
            approval: pendingApproval,
          },
        }),
      },
    });
    const service = createHttpService(BASE, { fetch: backend.fetchMock });
    await service.refresh();
    expect(service.listPendingApprovals()).toHaveLength(0);

    const submitted = await service.submitProposal(PROPOSAL_ID, "Dana Whitfield");

    // The summary is reflected immediately — not the stale DRAFT copy.
    expect(submitted?.state).toBe("AWAITING_APPROVAL");
    expect(submitted?.backendState).toBe("PENDING_APPROVAL");
    expect(submitted?.validationStatus).toBe("PASSED");

    // The approval queue sees the proposal right after the submit (B-8).
    expect(service.listPendingApprovals().map((item) => item.proposalId)).toEqual([PROPOSAL_ID]);

    // No orphan residue: the summary merged onto the cached case-bucket entry —
    // same proposal count, correct case, exactly one entry for the id.
    const proposals = service.listProposals(CASE_ID);
    expect(proposals).toHaveLength(2);
    expect(proposals.find((item) => item.proposalId === PROPOSAL_ID)?.state).toBe(
      "AWAITING_APPROVAL",
    );
    expect(proposals.find((item) => item.proposalId === PROPOSAL_ID)?.caseId).toBe(CASE_ID);
    const workspace = service.getWorkspace();
    expect(workspace.proposals).toHaveLength(2);
    expect(workspace.proposals.filter((item) => item.proposalId === PROPOSAL_ID)).toHaveLength(1);
    expect(workspace.proposals.every((item) => item.caseId === CASE_ID)).toBe(true);

    // The rest of the protected-write chain keeps reflecting locally too.
    const approved = await service.decideProposal(
      PROPOSAL_ID,
      "APPROVED",
      "Marcus Lindqvist",
      "Evidence reviewed against the open requirement.",
    );
    expect(approved?.state).toBe("APPROVED");
    expect(service.listPendingApprovals()).toHaveLength(0);

    const result = await service.replay(PROPOSAL_ID);
    expect(result.outcome).toBe("SUCCEEDED");
    const executed = service.listProposals(CASE_ID).find((item) => item.proposalId === PROPOSAL_ID);
    expect(executed?.state).toBe("REPLAYED");
    expect(service.getWorkspace().proposals.every((item) => item.caseId === CASE_ID)).toBe(true);
  });
});

describe("http adapter — error handling", () => {
  it("projects a 422 business block (validation_report) onto the proposal", async () => {
    const backend = createBackend({
      overrides: {
        [`POST /proposals/${REFUND_PROPOSAL_ID}/submit`]: () => ({
          status: 422,
          body: {
            error: {
              code: "VALIDATION_FAILED",
              message: "proposal blocked by deterministic validator",
              validation_report: blockedReport,
            },
          },
        }),
      },
    });
    const service = createHttpService(BASE, { fetch: backend.fetchMock });
    await service.refresh();

    const blocked = await service.submitProposal(REFUND_PROPOSAL_ID, "Dana Whitfield");
    expect(blocked?.state).toBe("BLOCKED");
    expect(blocked?.validation.decision).toBe("BLOCKED");
    expect(blocked?.blockReason).toContain("V2: refund not in whitelist");

    const v2 = blocked?.validation.checks.find((check) => check.id === "V2");
    expect(v2?.status).toBe("FAIL");
    expect(v2?.label).toBe("Action whitelist");
    expect(v2?.detail).toContain("not in whitelist");
    expect(v2?.basis).toBe("FIXTURE_SNAPSHOT");
    expect(v2?.docReference).toBe("S6_1_AI_ACTION_PLAN.md D3");
    expect(blocked?.validation.checks.find((check) => check.id === "V7")?.status).toBe("FAIL");
  });

  it("surfaces 401 and 403 as explicit ApiErrors", async () => {
    const backend = createBackend({
      overrides: {
        [`POST /cases/${CASE_ID}/analyses`]: () => ({
          status: 401,
          body: { detail: "missing X-Actor-Id (demo identity)" },
        }),
      },
    });
    const service = createHttpService(BASE, { fetch: backend.fetchMock });

    await expect(service.runAnalysis(CASE_ID, "Dana Whitfield")).rejects.toThrow(ApiError);
    await service.runAnalysis(CASE_ID, "Dana Whitfield").catch((error: ApiError) => {
      expect(error.status).toBe(401);
      expect(error.code).toBe("UNAUTHORIZED");
      expect(error.message).toContain("missing X-Actor-Id");
    });

    const forbidden = createBackend({
      overrides: {
        [`POST /approvals/${APPROVAL_ID}/decision`]: () => ({
          status: 403,
          body: { detail: "role SPECIALIST is not permitted here; required: ['MANAGER']" },
        }),
      },
    });
    const forbiddenService = createHttpService(BASE, { fetch: forbidden.fetchMock });
    await forbiddenService
      .decideProposal(PROPOSAL_ID, "APPROVED", "specialist-1", "attempting manager work")
      .catch((error: ApiError) => {
        expect(error.status).toBe(403);
        expect(error.code).toBe("FORBIDDEN");
        expect(error.message).toContain("required: ['MANAGER']");
      });
  });

  it("tolerates both 422 request-validation shapes (pre- and post-A-3)", async () => {
    const legacyShape = createBackend({
      overrides: {
        [`POST /cases/${CASE_ID}/analyses`]: () => ({
          status: 422,
          body: { detail: [{ loc: ["body", "note"], msg: "Field required", type: "missing" }] },
        }),
      },
    });
    const legacyService = createHttpService(BASE, { fetch: legacyShape.fetchMock });
    await legacyService.runAnalysis(CASE_ID, "Dana Whitfield").catch((error: ApiError) => {
      expect(error.status).toBe(422);
      expect(error.code).toBe("REQUEST_INVALID");
      expect(error.message).toContain("Field required");
    });

    const envelopeShape = createBackend({
      overrides: {
        [`POST /cases/${CASE_ID}/analyses`]: () => ({
          status: 422,
          body: { error: { code: "REQUEST_INVALID", message: "note must be a string" } },
        }),
      },
    });
    const envelopeService = createHttpService(BASE, { fetch: envelopeShape.fetchMock });
    await envelopeService.runAnalysis(CASE_ID, "Dana Whitfield").catch((error: ApiError) => {
      expect(error.status).toBe(422);
      expect(error.code).toBe("REQUEST_INVALID"); // code field wins
      expect(error.message).toBe("note must be a string");
    });
  });

  it("keeps the mock's httpStatus:0 semantics for network failures", async () => {
    const failingFetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const service = createHttpService(BASE, { fetch: failingFetch });
    await service.refresh().catch((error: ApiError) => {
      expect(error.status).toBe(0);
      expect(error.code).toBe("NETWORK_ERROR");
    });
  });
});

describe("http adapter — store isolation (B-2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("never reaches the mock store's business write actions", async () => {
    const spies = [
      vi.spyOn(actions, "runAnalysis"),
      vi.spyOn(actions, "submitProposal"),
      vi.spyOn(actions, "decideProposal"),
      vi.spyOn(actions, "replay"),
      vi.spyOn(actions, "refreshSnapshot"),
      vi.spyOn(actions, "reset"),
    ];

    const backend = createBackend();
    const service = createHttpService(BASE, { fetch: backend.fetchMock });
    await service.refresh();
    await service.submitProposal(PROPOSAL_ID, "Dana Whitfield");
    await service.decideProposal(PROPOSAL_ID, "APPROVED", "Marcus Lindqvist", "reason is long enough");
    await service.replay(PROPOSAL_ID);
    await service.refreshSnapshot(CASE_ID);
    service.reset();

    // Same guarantee through the synchronous facade used by the pages.
    const facade = createHttpFacade({ baseUrl: BASE, fetch: backend.fetchMock });
    await facade.refresh();
    facade.runAnalysis(CASE_ID, "Dana Whitfield");
    facade.submitProposal(PROPOSAL_ID, "Dana Whitfield");
    facade.decideProposal(PROPOSAL_ID, "APPROVED", "Marcus Lindqvist", "reason is long enough");
    facade.replay(PROPOSAL_ID);
    facade.refreshSnapshot(CASE_ID);
    facade.reset();
    await flush();

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("bridges async writes into the synchronous service interface", async () => {
    const backend = createBackend();
    const facade = createHttpFacade({ baseUrl: BASE, fetch: backend.fetchMock });

    expect(facade.mode).toBe("http");
    expect(facade.listCases()).toEqual([]); // empty until refresh()

    await facade.refresh();
    expect(facade.listCases()).toHaveLength(1);
    expect(facade.getCase(CASE_ID)?.caseId).toBe(CASE_ID);

    // The promise waits for the real HTTP result; no placeholder is fabricated.
    await facade.submitProposal(PROPOSAL_ID, "Dana Whitfield");
    await facade.decideProposal(PROPOSAL_ID, "APPROVED", "Marcus Lindqvist", "reason is long enough");
    await flush();
    expect(facade.listProposals(CASE_ID)[0]?.state).toBe("APPROVED");

    const result = await facade.replay(PROPOSAL_ID);
    expect(result.outcome).toBe("SUCCEEDED");
    expect(result.httpStatus).toBe(200);
    expect(result.simulated).toBe(true);
    expect(result.message).not.toContain("dispatched");
    expect(facade.listProposals(CASE_ID)[0]?.state).toBe("REPLAYED");

    // reset is a documented no-op in http mode.
    expect(() => facade.reset()).not.toThrow();
  });
});

describe("service mode switch", () => {
  it("defaults to mock and honours VITE_DP_API_MODE", () => {
    expect(resolveServiceMode({})).toBe("mock");
    expect(resolveServiceMode({ VITE_DP_API_MODE: "mock" })).toBe("mock");
    expect(resolveServiceMode({ VITE_DP_API_MODE: "http" })).toBe("http");
    expect(resolveServiceMode({ VITE_DP_API_MODE: "anything-else" })).toBe("mock");

    // The test environment does not set VITE_DP_API_MODE, so the default export
    // stays the mock implementation (13 existing tests rely on this).
    expect(SERVICE_MODE).toBe("mock");
    expect(disputePilot.mode).toBe("mock");
  });
});
