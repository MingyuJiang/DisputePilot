/**
 * Phase 3.5 UX acceptance tests — proposal generation wiring, empty-state CTA,
 * persisted role/language, bilingual badges and the http-mode reset control.
 *
 * No network, no browser: components render in jsdom and the HTTP boundary is
 * mocked where needed.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { disputePilot } from "../src/api";
import { createHttpFacade } from "../src/api/http";
import type { WireCase, WireProposal } from "../src/api/http/types";
import type { AnalysisErrorInfo } from "../src/api/errors";
import { ActionSafetyPanel } from "../src/components/domain/ActionSafetyPanel";
import { GroundingBadge, ProposalStateBadge } from "../src/components/domain/Badges";
import { ResetDemoControl } from "../src/components/layout/Sidebar";
import { RoleProvider, useRole } from "../src/hooks/useRole";
import { LanguageProvider } from "../src/i18n";

const noop = (): void => undefined;

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

const errorInfo: AnalysisErrorInfo = {
  status: 422,
  code: "VALIDATION_FAILED",
  message: "V3: the payload cites evidence that is not on file.",
  detailCodes: [],
  kind: "request",
  retryable: true,
};

describe("phase 3.5 — proposal generation", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the backend to generate a proposal after a successful analysis run", async () => {
    const user = userEvent.setup();
    const proposal = disputePilot.listProposals("O10")[0];
    const originalMode = disputePilot.mode;
    // The auto-generation path is http-only (mock fixtures are pre-seeded).
    (disputePilot as { mode: "mock" | "http" }).mode = "http";
    const generate = vi
      .spyOn(disputePilot, "generateProposal")
      .mockResolvedValue({ ok: true, proposal });

    try {
      renderAt("/cases/O10");
      await screen.findByRole("heading", { name: /Mechanical Gaming Keyboard/ });

      await user.click(screen.getByRole("button", { name: "Re-run" }));

      await waitFor(() => expect(generate).toHaveBeenCalledWith("O10"));
      // The DRAFT proposal is rendered by the Action safety panel.
      expect(await screen.findByText("Draft")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Submit for approval" })).toBeInTheDocument();
    } finally {
      generate.mockRestore();
      (disputePilot as { mode: "mock" | "http" }).mode = originalMode;
    }
  });

  it("offers a Generate proposal CTA in the empty state and surfaces backend errors", async () => {
    const user = userEvent.setup();
    const record = disputePilot.getCase("O10")!;
    const onGenerate = vi.fn();
    const panel = (overrides: {
      generating?: boolean;
      generateError?: AnalysisErrorInfo;
    } = {}) => (
      <LanguageProvider initialLang="en">
        <ActionSafetyPanel
          record={record}
          evidence={[]}
          role="SPECIALIST"
          proposal={undefined}
          hasAnalysis
          canGenerate
          onGenerate={onGenerate}
          generating={overrides.generating}
          generateError={overrides.generateError}
          onOpenEvidence={noop}
          onSubmit={noop}
          onReview={noop}
          onRefresh={noop}
          onRunAnalysis={noop}
        />
      </LanguageProvider>
    );

    const { rerender } = render(panel());
    expect(screen.getByText(/backend has not generated a proposal/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Generate proposal" }));
    expect(onGenerate).toHaveBeenCalledTimes(1);

    rerender(panel({ generateError: errorInfo }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not generate a proposal");
    expect(alert).toHaveTextContent(
      "The backend rejected the request because one or more deterministic checks failed.",
    );
    // The original backend message is kept verbatim, not rewritten.
    expect(alert).toHaveTextContent("V3: the payload cites evidence that is not on file.");
  });

  it("renders the DRAFT proposal returned by the backend with a submit CTA", () => {
    const record = disputePilot.getCase("O10")!;
    const proposal = disputePilot.listProposals("O10")[0];
    render(
      <LanguageProvider initialLang="en">
        <ActionSafetyPanel
          record={record}
          evidence={[]}
          role="SPECIALIST"
          proposal={proposal}
          hasAnalysis
          canGenerate
          onGenerate={noop}
          onOpenEvidence={noop}
          onSubmit={noop}
          onReview={noop}
          onRefresh={noop}
          onRunAnalysis={noop}
        />
      </LanguageProvider>,
    );

    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for approval" })).toBeInTheDocument();
  });

  it("POSTs to the generate endpoint and maps the returned proposal as DRAFT", async () => {
    const caseId = "O6";
    const wireCase: WireCase = {
      case_id: caseId,
      scenario_id: "LEVEL_C_WEB_DISPUTE_FROZEN",
      dispute_id: "DSP-O6",
      family: "INR",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      status: "IMPORTED",
      dispute_status: "WAITING_FOR_SELLER_RESPONSE",
      lifecycle_stage: "INQUIRY",
      amount: { value_minor: 2200, currency: "USD", display: "22.00 USD" },
      transaction_reference: {
        order_id: "ORD-O6",
        capture_id: "CAP-O6",
        buyer_transaction_id: "BT-O6",
        dispute_id: "DSP-O6",
      },
      fulfillment_posture: "NONE",
      seller_contacted: false,
      evidence_count: 0,
      available_actions: [{ rel: "self", method: "GET", basis: "FIXTURE_SNAPSHOT" }],
      evidence_requirements: [],
      case_version: 1,
      snapshot_hash: "a".repeat(64),
      created_at: "2026-10-18T08:00:00Z",
      updated_at: "2026-10-18T09:00:00Z",
      provenance: "PAYPAL_API_OBSERVED",
      verification_level: "FROZEN_SANDBOX_E1_VERIFIED",
    };

    const generated: WireProposal = {
      proposal_id: "PRP-O6-generated-01",
      case_id: caseId,
      analysis_id: "ANL-O6-01",
      action_type: "send-message",
      action_payload: { message: "Request the missing tracking number." },
      expected_preconditions: [],
      required_evidence: [],
      rationale: ["The analysis recommends asking the buyer for the tracking number."],
      evidence_ids: [],
      risk_level: "LOW",
      // NOT_RUN keeps the facade from fetching a validation report.
      validation_status: "NOT_RUN",
      state: "DRAFT",
      snapshot_hash: "a".repeat(64),
      payload_hash: "c".repeat(64),
      policy_version: "policy-v1.0",
      execution_authorized: false,
      created_at: "2026-10-18T10:00:00Z",
      updated_at: "2026-10-18T10:00:00Z",
    };

    const calls: string[] = [];
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/v1", "");
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push(`${method} ${path}`);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });

      if (method === "GET" && path === "/cases") return json([{ case_id: caseId }]);
      if (method === "GET" && path === `/cases/${caseId}`) return json(wireCase);
      if (method === "GET" && path === `/cases/${caseId}/evidence`) return json([]);
      if (method === "GET" && path === `/cases/${caseId}/analyses`) return json([]);
      if (method === "GET" && path === `/cases/${caseId}/proposals`) return json([]);
      if (method === "GET" && path === `/cases/${caseId}/audit`) {
        return json({ case_id: caseId, events: [] });
      }
      if (method === "GET" && path === "/approvals") return json([]);
      if (method === "POST" && path === `/cases/${caseId}/proposals/generate`) {
        return json([generated]);
      }
      return json({ error: { code: "NOT_FOUND", message: `unexpected ${method} ${path}` } }, 404);
    }) as unknown as typeof fetch;

    const facade = createHttpFacade({
      baseUrl: "http://dp.test/api/v1",
      fetch: fetchMock,
    });
    await facade.refresh();

    const outcome = await facade.generateProposal(caseId);

    expect(outcome.ok).toBe(true);
    expect(outcome.proposal?.state).toBe("DRAFT");
    expect(outcome.proposal?.proposalId).toBe("PRP-O6-generated-01");
    expect(calls.filter((entry) => entry === `POST /cases/${caseId}/proposals/generate`)).toHaveLength(1);
  });
});

describe("phase 3.5 — persisted demo preferences", () => {
  it("keeps the demo role after a remount", async () => {
    const user = userEvent.setup();

    function Probe() {
      const { role, setRole } = useRole();
      return (
        <div>
          <span data-testid="role">{role}</span>
          <button type="button" onClick={() => setRole("MANAGER")}>
            promote
          </button>
        </div>
      );
    }

    const first = render(
      <RoleProvider>
        <Probe />
      </RoleProvider>,
    );
    expect(screen.getByTestId("role")).toHaveTextContent("SPECIALIST");
    await user.click(screen.getByRole("button", { name: "promote" }));

    expect(screen.getByTestId("role")).toHaveTextContent("MANAGER");
    expect(window.localStorage.getItem("dp.demo.role")).toBe("MANAGER");

    first.unmount();
    render(
      <RoleProvider>
        <Probe />
      </RoleProvider>,
    );
    expect(screen.getByTestId("role")).toHaveTextContent("MANAGER");
  });

  it("defaults to zh-CN, switches to EN and persists the choice", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem("dp.demo.lang");

    const first = renderAt("/cases");
    expect(await screen.findByRole("heading", { name: "我的争议" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换语言为中文" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "切换语言为EN" }));

    expect(await screen.findByRole("heading", { name: "My disputes" })).toBeInTheDocument();
    expect(window.localStorage.getItem("dp.demo.lang")).toBe("en");
    expect(screen.getAllByText("Cases").length).toBeGreaterThan(0);

    first.unmount();
    renderAt("/cases");
    expect(await screen.findByRole("heading", { name: "My disputes" })).toBeInTheDocument();
  });

  it("renders workspace chrome in Chinese while keeping fixture data verbatim", async () => {
    window.localStorage.setItem("dp.demo.lang", "zh-CN");
    renderAt("/cases/O10");

    expect(await screen.findByText("下一步")).toBeInTheDocument();
    expect(screen.getByText("证据审阅")).toBeInTheDocument();
    expect(screen.getAllByText("已核实事实").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "提交审批" })).toBeInTheDocument();

    // Data content is never translated.
    expect(screen.getByText("Mechanical Gaming Keyboard (RGB)")).toBeInTheDocument();
    expect(screen.queryByText("Next step")).not.toBeInTheDocument();
  });

  it("localises enum badges without touching the underlying value", () => {
    const zh = render(
      <LanguageProvider initialLang="zh-CN">
        <ProposalStateBadge state="DRAFT" />
        <GroundingBadge grounding="VERIFIED_OBSERVATION" />
      </LanguageProvider>,
    );
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(screen.getByText("已核验观察")).toBeInTheDocument();
    zh.unmount();

    render(
      <LanguageProvider initialLang="en">
        <ProposalStateBadge state="DRAFT" />
        <GroundingBadge grounding="VERIFIED_OBSERVATION" />
      </LanguageProvider>,
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Verified observation")).toBeInTheDocument();
  });

  it("hides Reset demo data in http mode and explains why", () => {
    const http = render(
      <LanguageProvider initialLang="en">
        <ResetDemoControl mode="http" />
      </LanguageProvider>,
    );
    expect(screen.queryByRole("button", { name: "Reset demo data" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Demo reset lives in the guided demo and only works against the offline replay backend.",
      ),
    ).toBeInTheDocument();
    http.unmount();

    render(
      <LanguageProvider initialLang="en">
        <ResetDemoControl mode="mock" onReset={noop} />
      </LanguageProvider>,
    );
    expect(screen.getByRole("button", { name: "Reset demo data" })).toBeInTheDocument();
  });
});
