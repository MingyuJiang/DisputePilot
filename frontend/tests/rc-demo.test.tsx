/**
 * RC demo acceptance tests — five scenarios, reset, capture status, frozen AI.
 *
 * Zero network: fetch is injected for the http adapter paths and everything
 * else runs on the local fixture store.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { DemoGuideDialog } from "../src/components/domain/DemoGuideDialog";
import { CaptureStatusPanel } from "../src/components/domain/CaptureStatusPanel";
import { CaseContextPanel } from "../src/components/domain/CaseContextPanel";
import { AIIntelligencePanel } from "../src/components/domain/AIIntelligencePanel";
import { AnalysisModeBadge, ProposalStateBadge } from "../src/components/domain/Badges";
import { disputePilot } from "../src/api";
import { createHttpFacade } from "../src/api/http";
import type { CaptureStatus } from "../src/api/capture";
import { classifyResetError, resetErrorMessage } from "../src/api/demoReset";
import { liveAiUnavailableMessage, runLiveAi } from "../src/api/llm";
import type { AIAnalysis } from "../src/api/types";
import { DEMO_SCENARIOS, demoCaseIdFor } from "../src/lib/demoScenarios";

const noop = (): void => undefined;

const renderGuide = (props: Partial<Parameters<typeof DemoGuideDialog>[0]> = {}) =>
  render(
    <MemoryRouter>
      <DemoGuideDialog open onClose={noop} {...props} />
    </MemoryRouter>,
  );

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const syntheticCapture: CaptureStatus = {
  captureId: "DEMO-CAP-9001",
  status: "COMPLETED",
  originalAmount: "42.00",
  totalRefunded: "12.00",
  refundableRemaining: "30.00",
  currencyCode: "USD",
  source: "SYNTHETIC_OFFLINE_FIXTURE",
};

const frozenAnalysis = (): AIAnalysis => ({
  analysisId: "ANL-FROZEN-01",
  caseId: "O10",
  generatedAt: "2026-10-21T04:00:00Z",
  status: "READY",
  summary: "Pre-recorded analysis replayed offline.",
  requirements: [],
  facts: [],
  gaps: [],
  contradictions: [],
  recommendation: {
    action: "send-message",
    actionLabel: "Send message to buyer",
    rationale: ["Bound to the recorded snapshot."],
    alternatives: [],
  },
  waitRule: { applies: false, reason: "A permitted action exists." },
  modelLabel: "frozen / DEMO-O7",
  analysisMode: "FROZEN_REPLAY",
});

describe("RC demo — five scenario entries", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("shows all six fields on each of the five scenario cards", () => {
    renderGuide({ mode: "http", offline: true });

    for (const label of [
      "Case Type",
      "Data Source",
      "Main Problem",
      "AI Recommendation",
      "Expected User Action",
      "What This Demo Demonstrates",
    ]) {
      expect(screen.getAllByText(label)).toHaveLength(5);
    }
    for (const scenario of DEMO_SCENARIOS) {
      expect(screen.getByTestId(`demo-card-${scenario.id}`)).toBeInTheDocument();
    }
  });

  it("labels every offline card OFFLINE_REPLAY and the refund card SIMULATED_COMPOSITE", () => {
    renderGuide({ mode: "http", offline: true });

    for (const scenario of DEMO_SCENARIOS) {
      const card = screen.getByTestId(`demo-card-${scenario.id}`);
      const source = within(card).getByTestId(`demo-source-${scenario.id}`);
      expect(source).toHaveTextContent(scenario.dataSource);
    }

    const refundCard = screen.getByTestId("demo-card-CAP-DEMO-9001");
    expect(within(refundCard).getByText("SIMULATED_COMPOSITE")).toBeInTheDocument();
    expect(within(refundCard).getByText("No real funds moved.")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("demo-card-DEMO-INR-O7")).queryByText("No real funds moved."),
    ).not.toBeInTheDocument();
  });

  it("keeps the demo ids in http mode and uses the paired fixture in mock mode", () => {
    const send = DEMO_SCENARIOS[0];
    expect(demoCaseIdFor(send, "http")).toBe("DEMO-INR-O7");
    expect(demoCaseIdFor(send, "mock")).toBe("O7");
    // The blocked scenario's local fixture is the genuinely blocked case.
    expect(demoCaseIdFor(DEMO_SCENARIOS[2], "mock")).toBe("O14");
  });
});

describe("RC demo — reset", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("disables reset in mock mode and states why", () => {
    renderGuide({ mode: "mock" });

    expect(screen.getByRole("button", { name: "Reset demo" })).toBeDisabled();
    expect(
      screen.getByText(/Reset is disabled in mock mode/),
    ).toBeInTheDocument();
  });

  it("requires a second confirmation before calling the backend", async () => {
    const user = userEvent.setup();
    const reset = vi.fn(async () => ({ ok: true as const, cases: 5, backup: "backups/demo.bak" }));
    renderGuide({ mode: "http", offline: true, reset });

    await user.click(screen.getByRole("button", { name: "Reset demo" }));
    expect(screen.getByTestId("reset-confirm")).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Yes, reset demo data" }));

    expect(await screen.findByText("Demo data reset — 5 cases restored")).toBeInTheDocument();
    expect(screen.getByTestId("reset-result")).toHaveTextContent("backups/demo.bak");
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows the sandbox refusal reason verbatim", async () => {
    const user = userEvent.setup();
    const reset = vi.fn(async () => ({
      ok: false as const,
      error: classifyResetError(409, "CONFLICT", "demo reset is only available in offline replay mode"),
    }));
    renderGuide({ mode: "http", offline: true, reset });

    await user.click(screen.getByRole("button", { name: "Reset demo" }));
    await user.click(screen.getByRole("button", { name: "Yes, reset demo data" }));

    const result = await screen.findByTestId("reset-result");
    expect(result).toHaveTextContent("only the offline demo database can be reset");
    expect(result).toHaveTextContent("demo reset is only available in offline replay mode");
  });

  it("distinguishes a golden-dataset refusal from a database-path failure", () => {
    const golden = classifyResetError(500, "DOMAIN_ERROR", "golden dataset is read-only");
    expect(golden.reason).toBe("golden");
    expect(resetErrorMessage(golden)).toContain("golden dataset is protected");

    const path = classifyResetError(500, "DOMAIN_ERROR", "demo database path is unreadable");
    expect(path.reason).toBe("path");
    expect(resetErrorMessage(path)).toContain("demo database path is not usable");
  });
});

describe("RC demo — capture status", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("renders backend amount strings and the synthetic fixture mark", () => {
    render(<CaptureStatusPanel captureId="DEMO-CAP-9001" outcome={{ ok: true, capture: syntheticCapture }} />);

    expect(screen.getByTestId("capture-status")).toHaveTextContent("COMPLETED");
    expect(screen.getByText("42.00 USD")).toBeInTheDocument();
    expect(screen.getByText("12.00 USD")).toBeInTheDocument();
    expect(screen.getByText("30.00 USD")).toBeInTheDocument();
    expect(screen.getByText("Synthetic Offline Fixture")).toBeInTheDocument();
    expect(screen.getByTestId("capture-no-real-funds")).toHaveTextContent("No real funds moved.");
    expect(screen.getByTestId("capture-source")).toHaveTextContent("SYNTHETIC_OFFLINE_FIXTURE");
  });

  it("never recomputes a backend amount", () => {
    render(
      <CaptureStatusPanel
        captureId="CAP-PRECISION"
        outcome={{
          ok: true,
          capture: {
            ...syntheticCapture,
            captureId: "CAP-PRECISION",
            originalAmount: "0.10",
            totalRefunded: "0.00",
            refundableRemaining: "0.10",
          },
        }}
      />,
    );

    // Original amount and refundable remaining are both 0.10 — shown twice, verbatim.
    expect(screen.getAllByText("0.10 USD")).toHaveLength(2);
    expect(screen.getByText("0.00 USD")).toBeInTheDocument();
    expect(screen.queryByText(/0\.0999|0\.300000/)).not.toBeInTheDocument();
  });

  it("shows the capture status as the transaction status of a payment case", async () => {
    window.history.pushState({}, "", "/cases/CAP-DEMO-9001");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId("transaction-status")).toHaveTextContent("COMPLETED"),
    );
    expect(screen.getByTestId("transaction-status")).not.toHaveTextContent("UNKNOWN");
    // The header badge for a capture case is the capture status, not the
    // (UNKNOWN) dispute status.
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("capture-panel")).toBeInTheDocument());
    expect(await screen.findByTestId("capture-status")).toHaveTextContent("COMPLETED");
  });

  it("keeps a capture status distinct from a refund status", () => {
    const record = disputePilot.getCase("CAP-DEMO-9001");
    expect(record).toBeDefined();
    render(
      <MemoryRouter>
        <CaseContextPanel
          record={record!}
          evidence={[]}
          audit={[]}
          payment
          captureStatus="PARTIALLY_REFUNDED"
          onOpenEvidence={noop}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("transaction-status")).toHaveTextContent("PARTIALLY_REFUNDED");
    expect(screen.getByTestId("context-capture-status")).toHaveTextContent("PARTIALLY_REFUNDED");
    expect(screen.getByTestId("transaction-status")).not.toHaveTextContent("COMPLETED");
    expect(screen.getByTestId("transaction-status")).not.toHaveTextContent("UNKNOWN");
  });
});

describe("RC demo — frozen AI output", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("labels FROZEN_REPLAY as Frozen AI Output / Offline Replay", () => {
    render(<AnalysisModeBadge mode="FROZEN_REPLAY" />);
    expect(screen.getByText("Frozen AI Output / Offline Replay")).toBeInTheDocument();
    expect(screen.queryByText("LOCAL_LLM")).not.toBeInTheDocument();
  });

  it("does not present a frozen analysis as live inference", () => {
    const record = disputePilot.getCase("O10")!;
    render(
      <AIIntelligencePanel
        record={record}
        analysis={frozenAnalysis()}
        evidence={[]}
        requesting={false}
        onRunAnalysis={noop}
        onOpenEvidence={noop}
      />,
    );

    expect(screen.getByText("Frozen AI Output / Offline Replay")).toBeInTheDocument();
    expect(screen.getByText(/Frozen AI output/)).toBeInTheDocument();
    expect(screen.queryByText(/local model inference/i)).not.toBeInTheDocument();
    expect(screen.queryByText("LOCAL_LLM")).not.toBeInTheDocument();
  });

  it("refuses a live run with the backend detail instead of starting a stub", async () => {
    const start = vi.fn(async () => undefined);
    const outcome = await runLiveAi(
      async () => ({
        ok: true,
        status: {
          provider: "ollama-local",
          available: false,
          model: "qwen3",
          detail: "model server is not running",
        },
      }),
      start,
    );

    expect(start).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: false,
      message: "Live AI unavailable: model server is not running",
    });
    expect(liveAiUnavailableMessage(undefined)).toBe(
      "Live AI unavailable: the backend did not report an available live model.",
    );
  });

  it("shows the live-AI refusal in the analysis panel", () => {
    const record = disputePilot.getCase("O10")!;
    render(
      <AIIntelligencePanel
        record={record}
        analysis={frozenAnalysis()}
        evidence={[]}
        requesting={false}
        onRunAnalysis={noop}
        onRunLive={noop}
        liveError="Live AI unavailable: model server is not running"
        onOpenEvidence={noop}
      />,
    );

    expect(screen.getByTestId("live-ai-error")).toHaveTextContent(
      "Live AI unavailable: model server is not running",
    );
  });
});

describe("RC demo — hidden endpoints through the http adapter", () => {
  const BASE = "http://127.0.0.1:8100/api/v1";

  it("reads the capture record without touching the amount strings", async () => {
    const calls: string[] = [];
    const facade = createHttpFacade({
      baseUrl: BASE,
      fetch: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return json(200, {
          capture_id: "DEMO-CAP-9001",
          status: "COMPLETED",
          original_amount: "42.00",
          total_refunded: "12.00",
          refundable_remaining: "30.00",
          currency_code: "USD",
          source: "SYNTHETIC_OFFLINE_FIXTURE",
        });
      }) as typeof fetch,
    });

    const outcome = await facade.fetchCaptureStatus("DEMO-CAP-9001");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.capture.originalAmount).toBe("42.00");
    expect(outcome.capture.totalRefunded).toBe("12.00");
    expect(outcome.capture.refundableRemaining).toBe("30.00");
    expect(outcome.capture.source).toBe("SYNTHETIC_OFFLINE_FIXTURE");
    expect(calls[0]).toContain("/payments/captures/DEMO-CAP-9001");
  });

  it("reports an unavailable live model and blocks the run", async () => {
    const facade = createHttpFacade({
      baseUrl: BASE,
      fetch: (async () =>
        json(200, {
          provider: "ollama-local",
          available: false,
          model: "qwen3",
          detail: "LLM server unreachable at 127.0.0.1:11434",
        })) as typeof fetch,
    });

    const start = vi.fn(async () => undefined);
    const outcome = await runLiveAi(() => facade.fetchLlmStatus(), start);

    expect(outcome).toEqual({
      ok: false,
      message: "Live AI unavailable: LLM server unreachable at 127.0.0.1:11434",
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("resets as SYSTEM and reports the restored case count", async () => {
    const seen: { path: string; role?: string; method?: string }[] = [];
    const facade = createHttpFacade({
      baseUrl: BASE,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seen.push({ path, role: headers["X-Actor-Role"], method: init?.method });
        if (path.endsWith("/demo/reset")) {
          return json(200, { reset: true, cases: 5, backup: "backups/demo.golden.sqlite3" });
        }
        if (path.endsWith("/cases")) return json(200, []);
        if (path.endsWith("/health")) {
          return json(200, { execution_mode: "REPLAY", network_access: "NONE" });
        }
        if (path.endsWith("/approvals")) return json(200, []);
        return json(404, { error: { code: "NOT_FOUND", message: "not found" } });
      }) as typeof fetch,
    });

    const outcome = await facade.resetDemo();
    expect(outcome).toEqual({
      ok: true,
      cases: 5,
      backup: "backups/demo.golden.sqlite3",
    });
    const resetCall = seen.find((entry) => entry.path.endsWith("/demo/reset"));
    expect(resetCall?.method).toBe("POST");
    expect(resetCall?.role).toBe("SYSTEM");
    // The workspace is reloaded from the backend after a reset.
    expect(seen.some((entry) => entry.path.endsWith("/cases") && entry.method === "GET")).toBe(true);
  });

  it("passes a sandbox reset refusal through as a readable reason", async () => {
    const facade = createHttpFacade({
      baseUrl: BASE,
      fetch: (async () =>
        json(409, {
          error: {
            code: "CONFLICT",
            message: "demo reset is only available in offline replay mode",
          },
        })) as typeof fetch,
    });

    const outcome = await facade.resetDemo();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("sandbox");
    expect(resetErrorMessage(outcome.error)).toContain("only the offline demo database can be reset");
  });
});

describe("RC demo — English status vocabulary", () => {
  it("keeps approved, executed, replayed, blocked, unverified and pending distinct", () => {
    render(
      <>
        <ProposalStateBadge state="APPROVED" />
        <ProposalStateBadge state="EXECUTED" />
        <ProposalStateBadge state="REPLAYED" />
        <ProposalStateBadge state="BLOCKED" />
        <ProposalStateBadge state="UNVERIFIED" />
        <ProposalStateBadge state="PENDING" />
      </>,
    );

    for (const label of [
      "Approved",
      "Executed (remote confirmed)",
      "Replayed (offline)",
      "Blocked",
      "Unverified (result unknown)",
      "Pending (not settled)",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
