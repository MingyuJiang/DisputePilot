/**
 * Autopilot page — the two contracts that matter:
 *  1. every status shown comes from the backend response;
 *  2. "submitted for review" is never rendered as approved or executed.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutopilotPage } from "../src/pages/AutopilotPage";
import { LanguageProvider } from "../src/i18n";
import type { AutopilotRun, AutopilotSubmitResult } from "../src/api/autopilot";

const RUN_ID = "APR-20261022T000000Z-abcd1234";

const caseResult = (overrides: Partial<AutopilotRun["results"][number]>) => ({
  case_id: "DEMO-INR-O7",
  decision: "READY_FOR_REVIEW" as const,
  decision_reasons: ["validator passed; candidate 'send-message' is ready for merchant review"],
  reason_codes: ["VALIDATOR_PASSED", "NO_EXECUTION_TRIAGE_ONLY"],
  requires_human: false,
  executed: false,
  analysis: {
    analysis_id: "ANL-1",
    analysis_mode: "FROZEN_REPLAY",
    model_provider: "frozen-replay",
    model_name: "frozen-analyses-v1",
    factual_summary: "summary",
    recommendation: "send-message",
    raw_recommendation: "send-message",
    effective_action: "send-message",
    grounded_fact_count: 3,
    missing_evidence: [],
    contradictions: [],
    safety_flags: [],
    gaps: [],
  },
  candidate_actions: [
    {
      proposal_id: "PRP-DEMO-INR-O7-send-message-1",
      action_type: "send-message",
      action_family: "DISPUTE",
      state: "VALIDATED",
      risk_level: "LOW",
      validation_status: "PASSED",
      required_evidence: [],
      evidence_ids: [],
      execution_authorized: false,
    },
  ],
  validator: {
    report_id: "VR-1",
    passed: true,
    blocked_reasons: [],
    checked: 12,
    failed: 0,
    findings: [],
  },
  evidence: { sufficient: true, missing_evidence: [], missing_facts: [] },
  policy: { blocked: false, code: null },
  business_refs: {},
  capture_facts: null,
  error: null,
  ...overrides,
});

const runFixture: AutopilotRun = {
  run_id: RUN_ID,
  mode: "TRIAGE_ONLY",
  status: "COMPLETED",
  requested_case_ids: ["DEMO-INR-O7", "DEMO-SNAD-O13", "DEMO-BLOCK-O9"],
  total_cases: 3,
  analyzed_cases: 3,
  ready_for_review_cases: 2,
  needs_human_cases: 0,
  blocked_cases: 1,
  wait_cases: 0,
  failed_cases: 0,
  executed_actions: 0,
  results: [
    caseResult({}),
    caseResult({
      case_id: "DEMO-SNAD-O13",
      candidate_actions: [
        {
          proposal_id: "PRP-DEMO-SNAD-O13-provide-evidence-1",
          action_type: "provide-evidence",
          action_family: "DISPUTE",
          state: "VALIDATED",
          risk_level: "MEDIUM",
          validation_status: "PASSED",
          required_evidence: ["PROOF_OF_FULFILLMENT"],
          evidence_ids: [],
          execution_authorized: false,
        },
      ],
    }),
    caseResult({
      case_id: "DEMO-BLOCK-O9",
      decision: "BLOCKED",
      reason_codes: ["VALIDATOR_PASSED", "EVIDENCE_INSUFFICIENT"],
      requires_human: true,
      policy: { blocked: true, code: "EVIDENCE_INSUFFICIENT" },
      evidence: {
        sufficient: false,
        missing_evidence: ["shipment record"],
        missing_facts: ["Proof of fulfillment is required and missing."],
      },
    }),
  ],
  started_at: "2026-10-22T00:00:00Z",
  finished_at: "2026-10-22T00:00:01Z",
  idempotent_replay: false,
};

const submissionFixture: AutopilotSubmitResult = {
  run_id: RUN_ID,
  mode: "TRIAGE_ONLY",
  status: "COMPLETED",
  requested_case_ids: ["DEMO-INR-O7", "DEMO-SNAD-O13"],
  total_cases: 2,
  submitted_cases: 2,
  already_submitted_cases: 0,
  skipped_cases: 0,
  blocked_cases: 0,
  failed_cases: 0,
  executed_actions: 0,
  results: [
    {
      case_id: "DEMO-INR-O7",
      run_decision: "READY_FOR_REVIEW",
      status: "SUBMITTED_FOR_REVIEW",
      reason_code: "SUBMITTED_FOR_REVIEW",
      reasons: ["proposal revalidated and submitted; the approval is pending"],
      proposal_id: "PRP-DEMO-INR-O7-send-message-1",
      approval_id: "APR-PRP-DEMO-INR-O7-send-message-1",
      proposal_state: "PENDING_APPROVAL",
      approval_decision: "PENDING",
      action_payload_hash: "a".repeat(64),
      case_snapshot_hash: "b".repeat(64),
      validation_report_id: "VR-2",
      validator: { report_id: "VR-2", passed: true },
      created_at: "2026-10-22T00:01:00Z",
      error: null,
    },
  ],
  submitted_at: "2026-10-22T00:01:00Z",
  idempotent_replay: false,
  submission_batch_id: "SUB-20261022T000001Z-aaaa1111",
  idempotency_key: null,
  request_fingerprint: "f".repeat(64),
  actor_id: "specialist-1",
};

const batchFixture = {
  submission_batch_id: "SUB-20261022T000001Z-aaaa1111",
  run_id: RUN_ID,
  idempotency_key: "submit-1",
  request_fingerprint: "f".repeat(64),
  status: "COMPLETED" as const,
  total_cases: 2,
  submitted_cases: 2,
  already_submitted_cases: 0,
  skipped_cases: 0,
  blocked_cases: 0,
  failed_cases: 0,
  actor_id: "specialist-1",
  executed_actions: 0,
  results: submissionFixture.results,
  submitted_at: "2026-10-22T00:01:00Z",
};

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const setupFetch = (options: { batches?: unknown[] } = {}) => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const batches = options.batches ?? [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (path.endsWith("/submit-for-review")) return json(submissionFixture);
    if (path.endsWith("/submission-batches")) return json(batches);
    if (path.includes("/submission-batches/")) return json(batchFixture);
    if (path.endsWith("/autopilot/runs")) return json(runFixture);
    if (method === "GET" && path.includes("/autopilot/runs/")) return json(runFixture);
    throw new Error(`unexpected request ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return calls;
};

const renderPage = () =>
  render(
    <LanguageProvider>
      <AutopilotPage />
    </LanguageProvider>,
  );

describe("Autopilot page", () => {
  beforeEach(() => {
    window.localStorage.setItem("dp.demo.lang", "en");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the backend decision, validator and policy facts per case", async () => {
    const calls = setupFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Run autopilot/ }));

    expect(await screen.findByText(RUN_ID)).toBeInTheDocument();
    expect(calls[0].body).toMatchObject({ mode: "TRIAGE_ONLY" });
    expect((calls[0].body as { case_ids: string[] }).case_ids).toHaveLength(5);

    const blocked = screen.getByText("DEMO-BLOCK-O9").closest("div") as HTMLElement;
    expect(within(blocked.parentElement as HTMLElement).getByText("Blocked")).toBeInTheDocument();
    // validator passed AND policy blocked are shown as separate facts
    expect(within(blocked.parentElement as HTMLElement).getByText(/Validator passed/)).toBeInTheDocument();
    expect(within(blocked.parentElement as HTMLElement).getByText("Policy block")).toBeInTheDocument();
    expect(screen.getAllByText("Ready for review").length).toBeGreaterThanOrEqual(2);
  });

  it("submits only after confirmation and renders the per-case status", async () => {
    const calls = setupFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Run autopilot/ }));
    await screen.findByText(RUN_ID);

    const submit = screen.getByRole("button", { name: /Submit all eligible/ });
    expect(submit).toBeEnabled();
    await user.click(submit);

    // nothing is sent before the confirmation
    expect(calls.filter((call) => call.path.endsWith("/submit-for-review"))).toHaveLength(0);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(RUN_ID)).toBeInTheDocument();
    expect(within(dialog).getByText(/2 eligible case/)).toBeInTheDocument();
    expect(within(dialog).getByText("send-message")).toBeInTheDocument();
    expect(within(dialog).getByText("provide-evidence")).toBeInTheDocument();
    expect(within(dialog).getByText(/Submitted is not approved/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Submit for review/ }));

    expect(await screen.findByText("APR-PRP-DEMO-INR-O7-send-message-1")).toBeInTheDocument();
    expect(screen.getByText("Submitted for review")).toBeInTheDocument();
    expect(screen.getByText("PENDING")).toBeInTheDocument();

    const submitCalls = calls.filter((call) => call.path.endsWith("/submit-for-review"));
    expect(submitCalls).toHaveLength(1);
    expect(submitCalls[0].body).toEqual({ case_ids: null });

    // never claim an approval or an execution
    expect(screen.queryByText("APPROVED")).not.toBeInTheDocument();
    expect(screen.queryByText("Executed")).not.toBeInTheDocument();
    expect(screen.getAllByText(/External actions executed: 0/).length).toBeGreaterThan(0);
  });

  it("loads the stored batch history and opens one batch from the API", async () => {
    const calls = setupFetch({ batches: [batchFixture] });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Run autopilot/ }));
    await screen.findByText(RUN_ID);

    // the list comes from GET /runs/{id}/submission-batches
    const batchRow = await screen.findByText("SUB-20261022T000001Z-aaaa1111");
    expect(batchRow).toBeInTheDocument();
    expect(
      calls.some(
        (call) =>
          call.method === "GET" && call.path.endsWith(`/runs/${RUN_ID}/submission-batches`),
      ),
    ).toBe(true);
    expect(screen.getByText(/2 submitted · 0 already/)).toBeInTheDocument();

    await user.click(batchRow);
    expect(await screen.findByText("SUBMITTED_FOR_REVIEW")).toBeInTheDocument();
    expect(screen.getByText(/APR-PRP-DEMO-INR-O7-send-message-1/)).toBeInTheDocument();
    expect(
      calls.some(
        (call) =>
          call.method === "GET" &&
          call.path.endsWith("/submission-batches/SUB-20261022T000001Z-aaaa1111"),
      ),
    ).toBe(true);
  });

  it("restores the last run and its batches after a refresh", async () => {
    window.localStorage.setItem("dp.autopilot.lastRunId", RUN_ID);
    const calls = setupFetch({ batches: [batchFixture] });
    renderPage();

    expect(await screen.findByText(RUN_ID)).toBeInTheDocument();
    expect(
      screen.getByText(/Restored the last run and its stored batches/),
    ).toBeInTheDocument();
    expect(await screen.findByText("SUB-20261022T000001Z-aaaa1111")).toBeInTheDocument();
    expect(
      calls.some((call) => call.method === "GET" && call.path.endsWith(`/runs/${RUN_ID}`)),
    ).toBe(true);
    window.localStorage.removeItem("dp.autopilot.lastRunId");
  });

  it("shows an empty history state before anything is submitted", async () => {
    setupFetch({ batches: [] });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Run autopilot/ }));
    await screen.findByText(RUN_ID);
    expect(await screen.findByText("No submission batch yet")).toBeInTheDocument();
  });

  it("keeps the submit action disabled when no case is eligible", async () => {
    const blockedOnly = {
      ...runFixture,
      ready_for_review_cases: 0,
      blocked_cases: 3,
      results: runFixture.results.map((item) =>
        item.case_id === "DEMO-BLOCK-O9" ? item : { ...item, decision: "BLOCKED" as const },
      ),
    };
    const blockedFetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/submission-batches")) return json([]);
      if (path.includes("/submission-batches/")) return json(batchFixture);
      return json(blockedOnly);
    });
    vi.stubGlobal("fetch", blockedFetch as unknown as typeof fetch);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Run autopilot/ }));
    await screen.findByText(RUN_ID);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Submit all eligible/ })).toBeDisabled(),
    );
    expect(screen.getByText("No case is eligible right now")).toBeInTheDocument();
  });
});
