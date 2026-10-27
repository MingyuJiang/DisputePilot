/**
 * B3 — approvals queue, executions & audit, guided demo route, responsive
 * structure and payload readability.
 *
 * Pure projections are asserted against the fixture snapshot; page tests are
 * semantic (labels, folds, navigation), not pixel tests. The 800 px check is a
 * structural assertion: neither page may use a fixed-width table or a min-width
 * that forces horizontal scrolling.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { disputePilot } from "../src/api";
import type { ActionProposal } from "../src/api/types";
import { DemoResetPanel } from "../src/components/domain/DemoResetPanel";
import { classifyResetError } from "../src/api/demoReset";
import { LanguageProvider } from "../src/i18n";
import { ToastProvider } from "../src/components/ui/Toast";
import {
  approvalActionOptions,
  buildApprovalQueue,
  filterApprovalQueue,
} from "../src/lib/approvalQueue";
import {
  executionModeOf,
  filterExecutionLedger,
  verificationOf,
  type ExecutionLedgerRow,
} from "../src/lib/executionLedger";
import { executionState, ledgerExecutionState } from "../src/lib/statusModel";
import { DEMO_SCENARIOS } from "../src/lib/demoScenarios";

const asManager = () => {
  window.localStorage.setItem("dp.demo.role", "MANAGER");
  window.localStorage.setItem("dp.demo.lang", "en");
};

const asSpecialist = () => {
  window.localStorage.setItem("dp.demo.role", "SPECIALIST");
  window.localStorage.setItem("dp.demo.lang", "en");
};

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

const renderReset = (props: Partial<Parameters<typeof DemoResetPanel>[0]> = {}) =>
  render(
    <MemoryRouter>
      <LanguageProvider initialLang="en">
        <ToastProvider>
          <DemoResetPanel mode="http" offline {...props} />
        </ToastProvider>
      </LanguageProvider>
    </MemoryRouter>,
  );

const rowFor = (proposalId: string, overrides: Partial<ActionProposal> = {}): ExecutionLedgerRow => {
  const proposal = disputePilot
    .getWorkspace()
    .proposals.find((item) => item.proposalId === proposalId)!;
  return {
    proposal: { ...proposal, ...overrides },
    state: "PENDING",
  };
};

describe("B3 — approval queue projection", () => {
  beforeEach(() => {
    asManager();
    disputePilot.reset();
  });

  it("sorts pending items before decided ones, high risk and longest wait first", () => {
    const rows = buildApprovalQueue(disputePilot.getWorkspace(), Date.parse("2026-10-22T00:00:00Z"));

    const pending = rows.filter((row) => row.pending);
    expect(pending.map((row) => row.proposal.proposalId)).toEqual(["P-O8-01", "P-O6-02"]);
    expect(pending.every((row) => row.priority === "urgent")).toBe(true);

    const firstDecided = rows.findIndex((row) => !row.pending);
    expect(firstDecided).toBe(pending.length);
    expect(rows.slice(firstDecided).every((row) => row.priority === "decided")).toBe(true);

    // Waiting desc inside the pending group: O8 was submitted earlier, so it
    // has waited longer and comes first.
    const waits = pending.map((row) => row.waitingMinutes ?? 0);
    expect(waits[0]).toBeGreaterThanOrEqual(waits[1]);
  });

  it("shows the approval record state, validator counts and risk, never the V1–V12 list", () => {
    const rows = buildApprovalQueue(disputePilot.getWorkspace(), Date.parse("2026-10-22T00:00:00Z"));
    const decided = rows.find((row) => row.proposal.proposalId === "P-O4-01")!;

    expect(decided.approvalDisplay.key).toBe("approval.approved");
    expect(decided.validator.key).toBe("validation.passed");
    expect(decided.passed).toBeGreaterThan(0);
    expect(decided.failed).toBe(0);
    expect(decided.proposal.risk).toBe("MEDIUM");
  });

  it("filters by action and risk without changing the base ordering", () => {
    const rows = buildApprovalQueue(disputePilot.getWorkspace(), Date.parse("2026-10-22T00:00:00Z"));
    const actions = approvalActionOptions(rows);
    expect(actions).toContain("send-message");
    expect(actions).toContain("provide-evidence");

    const sendOnly = filterApprovalQueue(rows, { action: "send-message", risk: "ALL", query: "" });
    expect(sendOnly.length).toBeGreaterThan(0);
    expect(sendOnly.every((row) => row.proposal.action === "send-message")).toBe(true);

    const highRisk = filterApprovalQueue(rows, { action: "ALL", risk: "HIGH", query: "" });
    expect(highRisk.every((row) => row.proposal.risk === "HIGH")).toBe(true);
    expect(filterApprovalQueue(rows, { action: "ALL", risk: "ALL", query: "O8" })).toHaveLength(1);
  });

  it("renders priority, validator counts and source, with no fixed-width table", async () => {
    renderAt("/approvals");

    expect(await screen.findByRole("heading", { name: "Needs your confirmation" })).toBeInTheDocument();
    expect(screen.getAllByText(/passed · \d+ failed/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Priority").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Source").length).toBeGreaterThan(0);
    expect(screen.queryByText(/V1–V12/)).not.toBeInTheDocument();
    expect(document.querySelector("table")).toBeNull();
  });
});

describe("B3 — execution ledger projection", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("keeps LIVE and REPLAY modes distinct and never infers LIVE from a replay row", () => {
    const live = rowFor("P-O4-01", {
      execution: {
        executionMode: "LIVE",
        simulated: false,
        result: "EXECUTED",
        verification: { method: "LIVE_GET", basis: "REMOTE_GET", confirmed: true },
      },
    });
    expect(executionModeOf(live)).toBe("LIVE");
    expect(verificationOf(live)).toBe("CONFIRMED");

    const replay = rowFor("P-O5-01", {
      execution: { executionMode: "REPLAY", simulated: true, result: "REPLAYED" },
    });
    expect(executionModeOf(replay)).toBe("REPLAY");
    expect(verificationOf(replay)).toBe("NOT_REPORTED");

    const unverified = rowFor("P-O8-01", {
      execution: {
        executionMode: "LIVE",
        simulated: false,
        result: "UNVERIFIED",
        verification: { confirmed: false },
      },
    });
    expect(verificationOf(unverified)).toBe("NOT_CONFIRMED");
  });

  it("uses different tones for REPLAYED / PENDING / EXECUTED", () => {
    expect(ledgerExecutionState("REPLAYED").tone).toBe("neutral");
    expect(ledgerExecutionState("PENDING").tone).toBe("warn");
    expect(ledgerExecutionState("UNVERIFIED").tone).toBe("warn");
    expect(ledgerExecutionState("EXECUTED").tone).toBe("pass");
    expect(executionState({ executionMode: "REPLAY", result: "REPLAYED" }).tone).toBe("neutral");
  });

  it("filters rows by mode, result and verification", () => {
    const live = {
      ...rowFor("P-O4-01", {
        execution: {
          executionMode: "LIVE",
          simulated: false,
          result: "EXECUTED",
          verification: { method: "LIVE_GET", basis: "REMOTE_GET", confirmed: true },
        },
      }),
      state: "EXECUTED" as const,
    };
    const replay = {
      ...rowFor("P-O5-01", {
        execution: { executionMode: "REPLAY", simulated: true, result: "REPLAYED" },
      }),
      state: "REPLAYED" as const,
    };
    const ledger = [live, replay];

    const replayRows = filterExecutionLedger(ledger, {
      mode: "REPLAY",
      result: "ALL",
      verification: "ALL",
      caseId: "ALL",
    });
    expect(replayRows.map((row) => row.proposal.proposalId)).toEqual(["P-O5-01"]);

    const liveRows = filterExecutionLedger(ledger, {
      mode: "LIVE",
      result: "EXECUTED",
      verification: "CONFIRMED",
      caseId: "O4",
    });
    expect(liveRows.map((row) => row.proposal.proposalId)).toEqual(["P-O4-01"]);
  });

  it("renders the audit page with mode filters, derived note and a foldable request id", async () => {
    const user = userEvent.setup();
    asManager();
    renderAt("/audit");

    expect(await screen.findByRole("heading", { name: "What happened" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by run mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by result")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by remote verification")).toBeInTheDocument();
    expect(screen.getByText(/Derived from \d+ loaded cases/)).toBeInTheDocument();
    expect(screen.getByText(/Simulated offline replay/)).toBeInTheDocument();
    expect(document.querySelector("table")).toBeNull();

    await user.click(screen.getAllByRole("button", { name: "Show details" })[0]);

    const detail = document.querySelector('[data-testid^="execution-detail-"]');
    expect(detail).not.toBeNull();
    expect(within(detail as HTMLElement).getByText("Snapshot hash")).toBeInTheDocument();
    expect(within(detail as HTMLElement).getByText("Linked audit events")).toBeInTheDocument();
  });
});

describe("B3 — guided demo route", () => {
  beforeEach(() => {
    asSpecialist();
    disputePilot.reset();
  });

  it("renders five cards with all seven fields, source labels and no-real-funds notice", async () => {
    renderAt("/demo");

    expect(
      await screen.findByRole("heading", { name: "Guided demo — five scenarios" }),
    ).toBeInTheDocument();

    for (const label of [
      "Case Type",
      "Data Source",
      "Main Problem",
      "AI Recommendation",
      "Expected User Action",
      "What This Demo Demonstrates",
      "Proof of success",
    ]) {
      expect(screen.getAllByText(label)).toHaveLength(5);
    }

    for (const scenario of DEMO_SCENARIOS) {
      const card = screen.getByTestId(`demo-card-${scenario.id}`);
      expect(within(card).getByTestId(`demo-source-${scenario.id}`)).toHaveTextContent(
        scenario.dataSource,
      );
    }
    expect(screen.getAllByText("SIMULATED_COMPOSITE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No real funds moved.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OFFLINE_REPLAY").length).toBeGreaterThan(0);
  });

  it("disables reset in mock mode and states why", async () => {
    renderAt("/demo");
    const reset = await screen.findByRole("button", { name: "Reset demo" });
    expect(reset).toBeDisabled();
    expect(screen.getByText(/Reset is disabled in mock mode/)).toBeInTheDocument();
  });

  it("requires confirmation and calls the backend once on success", async () => {
    const user = userEvent.setup();
    const reset = vi.fn(async () => ({
      ok: true as const,
      cases: 5,
      backup: "backups/demo.bak",
    }));
    const refreshed = vi.fn();
    renderReset({ reset, onResetSuccess: refreshed });

    expect(reset).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reset demo" }));
    expect(screen.getByTestId("reset-confirm")).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Yes, reset demo data" }));

    expect(await screen.findByTestId("reset-result")).toHaveTextContent(
      "Demo data reset — 5 cases restored",
    );
    expect(screen.getByTestId("reset-result")).toHaveTextContent("backups/demo.bak");
    expect(reset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
  });

  it("shows a sandbox refusal reason verbatim", async () => {
    const user = userEvent.setup();
    const reset = vi.fn(async () => ({
      ok: false as const,
      error: classifyResetError(409, "CONFLICT", "demo reset is only available in offline replay mode"),
    }));
    renderReset({ reset });

    await user.click(screen.getByRole("button", { name: "Reset demo" }));
    await user.click(screen.getByRole("button", { name: "Yes, reset demo data" }));

    const result = await screen.findByTestId("reset-result");
    expect(result).toHaveTextContent("only the offline demo database can be reset");
    expect(result).toHaveTextContent("demo reset is only available in offline replay mode");
  });

  it("keeps Guided demo as a help entry, not a core workspace item", async () => {
    const user = userEvent.setup();
    asManager();
    renderAt("/");

    // v2.1: the demo guide lives under Help, out of the merchant's task list.
    const nav = await screen.findByRole("navigation", { name: "Help" });
    const link = within(nav).getByRole("link", { name: /Guided demo/ });
    expect(link).toHaveAttribute("href", "/demo");

    await user.click(screen.getByRole("button", { name: "Demo guide" }));
    expect(
      await screen.findByRole("heading", { name: "Guided demo — five scenarios" }),
    ).toBeInTheDocument();
  });
});

describe("B3 — responsive structure and payload readability", () => {
  beforeEach(() => {
    asManager();
    disputePilot.reset();
  });

  it("keeps the full payload text wrapped and untruncated at narrow widths", async () => {
    renderAt("/approvals/P-O8-01");
    const pre = await screen.findByTestId("send-message-preview-text");

    expect(pre.className).toContain("whitespace-pre-wrap");
    expect(pre.className).toContain("break-words");
    expect(pre.className).not.toContain("truncate");
    expect(pre.textContent?.length ?? 0).toBeGreaterThan(200);
  });

  it("uses no fixed-width table or min-width container on the two dense lists", async () => {
    const approvals = renderAt("/approvals");
    await screen.findByRole("heading", { name: "Needs your confirmation" });
    expect(document.querySelector("table")).toBeNull();
    expect(document.querySelector(".overflow-x-auto")).toBeNull();

    approvals.unmount();
    renderAt("/audit");
    await screen.findByRole("heading", { name: "What happened" });
    expect(document.querySelector("table")).toBeNull();
    expect(document.querySelector(".overflow-x-auto")).toBeNull();
  });

  it("keeps next-step and decision blocks before the main column below 1280", async () => {
    renderAt("/cases/O9");
    const step = await screen.findByTestId("next-step");
    expect(step.parentElement?.className).toContain("order-1");
    expect(step.parentElement?.className).toContain("xl:order-2");
  });
});
