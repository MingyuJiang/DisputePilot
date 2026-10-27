/**
 * Approval provenance UI (MVP-1.2).
 *
 * The queue and the detail page must read the origin from the API — never
 * infer it from ids — and must not let provenance change the approval state.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { disputePilot } from "../src/api";
import type { ApprovalSubmissionOrigin } from "../src/api/approvalOrigin";
import { buildApprovalQueue } from "../src/lib/approvalQueue";

const BATCH_ID = "SUB-20261022T111136Z-efda63b5";
const RUN_ID = "APR-20261022T111135Z-c003a14b";

const HOURS_AGO = new Date(Date.now() - 3 * 3600 * 1000).toISOString();

const batchOrigin = (approvalId: string, proposalId: string): ApprovalSubmissionOrigin => ({
  approval_id: approvalId,
  source_type: "AUTOPILOT_BATCH",
  proposal_id: proposalId,
  case_id: "DEMO-INR-O7",
  submission_batch_id: BATCH_ID,
  run_id: RUN_ID,
  validation_report_id: "VR-PRP-DEMO-INR-O7-send-message-20261022T111136",
  validation_passed: true,
  reason_code: "SUBMITTED_FOR_REVIEW",
  submission_status: "SUBMITTED_FOR_REVIEW",
  submitted_at: "2026-10-22T11:11:36.122161+00:00",
  approval_decision: "PENDING",
  approval_actor_id: "specialist-1",
  approval_created_at: HOURS_AGO,
  approval_created_at_source: "CREATED",
  proposal_state: "PENDING_APPROVAL",
  notes: ["proposal revalidated and submitted; the approval is pending a manager decision"],
});

const singleOrigin = (approvalId: string, proposalId: string): ApprovalSubmissionOrigin => ({
  approval_id: approvalId,
  source_type: "SINGLE_SUBMISSION",
  proposal_id: proposalId,
  case_id: "O4",
  submission_batch_id: null,
  run_id: null,
  validation_report_id: null,
  validation_passed: null,
  reason_code: null,
  submission_status: null,
  submitted_at: null,
  approval_decision: "APPROVED",
  approval_actor_id: "specialist-1",
  approval_created_at: "2026-10-15T03:00:00+00:00",
  approval_created_at_source: "AUDIT:AUD-AP-O4-01-SUBMITTED",
  proposal_state: "APPROVED",
  notes: ["no submission batch records this approval"],
});

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const stubOriginApi = (
  resolve: (approvalId: string) => ApprovalSubmissionOrigin,
  options: { fail?: boolean } = {},
) => {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const match = path.match(/\/approvals\/([^/]+)\/submission-origin$/);
    if (!match) throw new Error(`unexpected request ${path}`);
    const approvalId = decodeURIComponent(match[1]);
    calls.push(approvalId);
    if (options.fail) {
      return new Response(
        JSON.stringify({ error: { code: "NOT_FOUND", message: "approval not found" } }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    return json(resolve(approvalId));
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return calls;
};

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

describe("approval provenance", () => {
  beforeEach(() => {
    disputePilot.reset();
    window.localStorage.setItem("dp.demo.lang", "en");
    window.localStorage.setItem("dp.demo.role", "MANAGER");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a short origin hint per approval in the queue", async () => {
    const calls = stubOriginApi((approvalId) =>
      approvalId === "AP-O4-01"
        ? batchOrigin(approvalId, "P-O4-01")
        : singleOrigin(approvalId, `P-${approvalId}`),
    );
    renderAt("/approvals");

    await screen.findByRole("heading", { name: "Needs your confirmation" });
    expect(await screen.findByText(/Autopilot · /)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Single submission").length).toBeGreaterThan(0));
    // provenance is fetched for the approvals on screen, not invented locally
    expect(calls).toContain("AP-O4-01");
    expect(calls.length).toBeGreaterThan(1);
  });

  it("renders the stored batch, run and submit-time validation in the detail", async () => {
    stubOriginApi((approvalId) => batchOrigin(approvalId, "P-O4-01"));
    renderAt("/approvals/P-O4-01");

    await screen.findByText("Autopilot batch");
    const section = screen.getByRole("heading", { name: "Submission origin" });
    const scope = section.closest("section") as HTMLElement;

    expect(within(scope).getByText("Autopilot batch")).toBeInTheDocument();
    expect(within(scope).getByText(BATCH_ID)).toBeInTheDocument();
    expect(within(scope).getByText(RUN_ID)).toBeInTheDocument();
    expect(within(scope).getByText("VR-PRP-DEMO-INR-O7-send-message-20261022T111136")).toBeInTheDocument();
    expect(within(scope).getByText("Submit-time validation passed")).toBeInTheDocument();
    expect(within(scope).getByText("SUBMITTED_FOR_REVIEW")).toBeInTheDocument();

    const link = within(scope).getByRole("link", { name: /View submission batch/ });
    expect(link).toHaveAttribute("href", `/autopilot?batch=${BATCH_ID}`);
    // provenance never promotes the approval
    expect(within(scope).queryByText("APPROVED")).not.toBeInTheDocument();
    expect(within(scope).queryByText("EXECUTED")).not.toBeInTheDocument();
  });

  it("shows an honest no-batch state for a single submission", async () => {
    stubOriginApi((approvalId) => singleOrigin(approvalId, "P-O4-01"));
    renderAt("/approvals/P-O4-01");

    await screen.findByText("Single submission — no batch");
    const section = screen.getByRole("heading", { name: "Submission origin" });
    const scope = section.closest("section") as HTMLElement;

    expect(within(scope).getByText("Single submission — no batch")).toBeInTheDocument();
    expect(within(scope).queryByText(BATCH_ID)).not.toBeInTheDocument();
    expect(within(scope).queryByRole("link", { name: /View submission batch/ })).toBeNull();
    expect(within(scope).getByText(/no submission batch records this approval/)).toBeInTheDocument();
  });

  it("shows an explicit error instead of a cached origin when the lookup fails", async () => {
    stubOriginApi(() => singleOrigin("AP-O4-01", "P-O4-01"), { fail: true });
    renderAt("/approvals/P-O4-01");

    expect(
      await screen.findByText(/Could not load the submission origin/),
    ).toBeInTheDocument();
    expect(screen.queryByText(BATCH_ID)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("reloads provenance from the API on every mount", async () => {
    const calls = stubOriginApi((approvalId) => batchOrigin(approvalId, "P-O4-01"));
    const first = renderAt("/approvals/P-O4-01");
    await screen.findByText("Autopilot batch");
    first.unmount();

    renderAt("/approvals/P-O4-01");
    await screen.findByText("Autopilot batch");
    expect(calls.filter((id) => id === "AP-O4-01").length).toBeGreaterThanOrEqual(2);
  });

  it("opens the linked batch through the autopilot deep link", async () => {
    const user = userEvent.setup();
    const batch = {
      submission_batch_id: BATCH_ID,
      run_id: RUN_ID,
      idempotency_key: "submit-1",
      request_fingerprint: "f".repeat(64),
      status: "COMPLETED",
      requested_case_ids: ["DEMO-INR-O7"],
      total_cases: 1,
      submitted_cases: 1,
      already_submitted_cases: 0,
      skipped_cases: 0,
      blocked_cases: 0,
      failed_cases: 0,
      actor_id: "specialist-1",
      executed_actions: 0,
      results: [],
      submitted_at: "2026-10-22T11:11:36+00:00",
    };
    const run = {
      run_id: RUN_ID,
      mode: "TRIAGE_ONLY",
      status: "COMPLETED",
      requested_case_ids: ["DEMO-INR-O7"],
      total_cases: 1,
      analyzed_cases: 1,
      ready_for_review_cases: 1,
      needs_human_cases: 0,
      blocked_cases: 0,
      wait_cases: 0,
      failed_cases: 0,
      executed_actions: 0,
      results: [],
      started_at: "2026-10-22T11:11:35+00:00",
      finished_at: "2026-10-22T11:11:36+00:00",
      idempotent_replay: false,
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/submission-origin")) return json(batchOrigin("AP-O4-01", "P-O4-01"));
      // the run-scoped list must be matched before the generic suffix below
      if (path.endsWith(`/runs/${RUN_ID}/submission-batches`)) return json([batch]);
      if (path.includes(`/submission-batches/${BATCH_ID}`)) return json(batch);
      if (path.endsWith(`/runs/${RUN_ID}`)) return json(run);
      throw new Error(`unexpected request ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    renderAt("/approvals/P-O4-01");
    const link = await screen.findByRole("link", { name: /View submission batch/ });
    await user.click(link);

    expect(await screen.findByText("Submission history")).toBeInTheDocument();
    expect(await screen.findAllByText(BATCH_ID)).not.toHaveLength(0);
  });
  it("computes the queue waiting time from the persisted creation time", async () => {
    stubOriginApi((approvalId) => batchOrigin(approvalId, "P-O4-01"));
    renderAt("/approvals");

    await screen.findByRole("heading", { name: "Needs your confirmation" });
    // a creation time 3h ago must render as a real waiting duration
    expect((await screen.findAllByText(/^3 ?h$/)).length).toBeGreaterThan(0);
  });

  it("states that the creation time is unavailable when the value is null", async () => {
    stubOriginApi((approvalId) => ({
      ...singleOrigin(approvalId, "P-O4-01"),
      approval_created_at: null,
    }));
    renderAt("/approvals");

    await screen.findByRole("heading", { name: "Needs your confirmation" });
    expect(
      (await screen.findAllByText("Creation time unavailable")).length,
    ).toBeGreaterThan(0);
  });

  it("separates created, decided and submitted times in the detail", async () => {
    stubOriginApi((approvalId) => batchOrigin(approvalId, "P-O4-01"));
    renderAt("/approvals/P-O4-01");

    await screen.findByText("Autopilot batch");
    const scope = screen
      .getByRole("heading", { name: "Submission origin" })
      .closest("section") as HTMLElement;
    expect(within(scope).getByText("Approval created")).toBeInTheDocument();
    expect(within(scope).getByText("Decision")).toBeInTheDocument();
    expect(within(scope).getByText(/PENDING · awaiting manager/)).toBeInTheDocument();
    expect(within(scope).getByText("Submitted at")).toBeInTheDocument();
  });
});

describe("approval queue ordering (MVP-1.3.1)", () => {
  const NOW = Date.parse("2026-10-22T12:00:00Z");

  const row = (
    proposalId: string,
    approvalId: string,
    submittedAt: string,
    createdAt: string | null,
  ) => ({
    approvalId,
    proposalId,
    submittedAt,
    createdAt,
  });

  const rows = [
    // proposal submit time says A is oldest, but its approval was created last
    row("P-A", "AP-A", "2026-10-20T00:00:00Z", "2026-10-22T11:00:00Z"),
    row("P-B", "AP-B", "2026-10-22T10:00:00Z", "2026-10-22T08:00:00Z"),
    row("P-C", "AP-C", "2026-10-22T09:00:00Z", null),
  ];

  const orderOf = (input: typeof rows) => {
    const snapshot = {
      proposals: input.map((item) => ({
        proposalId: item.proposalId,
        caseId: item.proposalId,
        action: "send-message",
        risk: "MEDIUM" as const,
        state: "AWAITING_APPROVAL",
        submittedAt: item.submittedAt,
        validation: { decision: "PASSED", checks: [] },
        hateoas: { observedAt: item.submittedAt },
      })),
      approvals: input.map((item) => ({
        approvalId: item.approvalId,
        proposalId: item.proposalId,
        caseId: item.proposalId,
        decision: "PENDING" as const,
        reason: "",
        decidedBy: "specialist-1",
        decidedAt: item.submittedAt,
      })),
      cases: [],
    };
    const times = new Map<string, string | null>(
      input.map((item) => [item.approvalId, item.createdAt]),
    );
    return buildApprovalQueue(snapshot as never, NOW, times).map((r) => r.proposal.proposalId);
  };

  it("sorts by the persisted approval creation time, not the proposal submit time", () => {
    // B was created 3h before A, so B must come first even though A's proposal
    // is two days older.
    expect(orderOf(rows)).toEqual(["P-B", "P-A", "P-C"]);
  });

  it("keeps the order stable for identical creation times", () => {
    const same = rows.map((item) => ({ ...item, createdAt: "2026-10-22T09:00:00Z" }));
    const first = orderOf(same);
    const second = orderOf(same);
    expect(first).toEqual(second);
    expect(first).toEqual(["P-A", "P-B", "P-C"]);
  });

  it("places unknown creation times last without fabricating a duration", () => {
    const ordered = orderOf(rows);
    expect(ordered[ordered.length - 1]).toBe("P-C");

    const snapshot = {
      proposals: rows.map((item) => ({
        proposalId: item.proposalId,
        caseId: item.proposalId,
        action: "send-message",
        risk: "MEDIUM" as const,
        state: "AWAITING_APPROVAL",
        submittedAt: item.submittedAt,
        validation: { decision: "PASSED", checks: [] },
        hateoas: { observedAt: item.submittedAt },
      })),
      approvals: rows.map((item) => ({
        approvalId: item.approvalId,
        proposalId: item.proposalId,
        caseId: item.proposalId,
        decision: "PENDING" as const,
        reason: "",
        decidedBy: "specialist-1",
        decidedAt: item.submittedAt,
      })),
      cases: [],
    };
    const built = buildApprovalQueue(snapshot as never, NOW);
    expect(built.every((r) => r.waitingMinutes === null)).toBe(true);
  });
});
