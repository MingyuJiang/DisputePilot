import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { disputePilot } from "../src/api";

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

describe("DisputePilot workspace", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("renders the case queue from the fixture adapter", async () => {
    renderAt("/cases");

    expect(await screen.findByRole("heading", { name: "My disputes" })).toBeInTheDocument();
    expect(screen.getByText("Mechanical Gaming Keyboard (RGB)")).toBeInTheDocument();
    expect(screen.getByText("$22.00")).toBeInTheDocument();
    expect(screen.getAllByText("O10").length).toBeGreaterThan(0);
  });

  it("filters cases by search query", async () => {
    const user = userEvent.setup();
    renderAt("/cases");

    const search = await screen.findByLabelText("Search cases");
    await user.type(search, "laptop sleeve");

    expect(screen.getByText("Laptop Sleeve (Grey, 13-inch)")).toBeInTheDocument();
    expect(screen.queryByText("Mechanical Gaming Keyboard (RGB)")).not.toBeInTheDocument();
  });

  it("exposes every workspace item to the single merchant identity", async () => {
    const user = userEvent.setup();
    renderAt("/cases");

    await screen.findByRole("heading", { name: "My disputes" });
    // v2.1: no role switch. The merchant reaches the confirmation list directly.
    const confirmLink = await screen.findByRole("link", { name: /Needs your confirmation/ });
    expect(confirmLink).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manager" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Specialist" })).not.toBeInTheDocument();

    await user.click(confirmLink);
    expect(await screen.findByRole("heading", { name: "Needs your confirmation" })).toBeInTheDocument();
  });

  it("opens a grounded evidence record from an AI fact", async () => {
    const user = userEvent.setup();
    renderAt("/cases/O10");

    const chips = await screen.findAllByRole("button", { name: /E-O10-01/ });
    await user.click(chips[0]);

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(/The buyer paid 22.00 USD/)).toBeInTheDocument();
    expect(within(drawer).getAllByText("Scenario-defined").length).toBeGreaterThan(0);
    expect(within(drawer).getByText(/Supported claims/i)).toBeInTheDocument();
  });

  it("keeps a blocked action visible with its reason and a disabled CTA", async () => {
    renderAt("/cases/O14");

    expect(await screen.findByText("This action cannot proceed")).toBeInTheDocument();
    expect(screen.getByText(/No verifiable evidence available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Blocked — cannot submit/ })).toBeDisabled();
  });

  it("shows a missing evidence record as missing, not as a verified fact", async () => {
    const user = userEvent.setup();
    renderAt("/cases/O10");

    const chips = await screen.findAllByRole("button", { name: /E-O10-04/ });
    await user.click(chips[0]);

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("No record exists")).toBeInTheDocument();
  });

  it("opens the confirmation list for the merchant", async () => {
    renderAt("/approvals");

    expect(await screen.findByRole("heading", { name: "Needs your confirmation" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Manager approval required" }),
    ).not.toBeInTheDocument();
  });

  it("records a manager approval without executing it", async () => {
    const user = userEvent.setup();
    renderAt("/approvals/P-O8-01");

    expect(
      await screen.findByRole("heading", { name: /O8 · Send message to buyer/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Approve action/ }));
    expect(screen.getByRole("dialog", { name: /Approve this action/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Record approval/ }));

    // Approving is a decision, not an execution.
    expect(
      (await screen.findAllByText("Approved. Nothing was executed on this page.")).length,
    ).toBeGreaterThan(0);
    expect(disputePilot.listProposals("O8")[0].state).toBe("APPROVED");
    expect(screen.queryByText("Replay verified")).not.toBeInTheDocument();
    // The execution step lives elsewhere and is linked, not triggered here.
    expect(screen.getByRole("link", { name: /Execution step/ })).toHaveAttribute(
      "href",
      "/cases/O8",
    );
  }, 10000);

  it("renders the execution ledger and expands audit events", async () => {
    const user = userEvent.setup();
    renderAt("/audit");

    expect(await screen.findByRole("heading", { name: "What happened" })).toBeInTheDocument();
    expect(screen.getByText("Execution ledger")).toBeInTheDocument();

    const duplicates = await screen.findAllByText("Duplicate submission from a stale tab suppressed");
    await user.click(duplicates[duplicates.length - 1]);
    expect(screen.getByText(/Accepted attempts/)).toBeInTheDocument();
  });

  it("aligns the guided demo with the five RC scenarios", async () => {
    const user = userEvent.setup();
    renderAt("/cases?guide=1");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("DEMO-INR-O7")).toBeInTheDocument();
    expect(within(dialog).getByText("DEMO-SNAD-O13")).toBeInTheDocument();
    expect(within(dialog).getByText("DEMO-BLOCK-O9")).toBeInTheDocument();
    expect(within(dialog).getByText("CAP-DEMO-9001")).toBeInTheDocument();
    expect(within(dialog).getByText("DEMO-BILL-O16")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Case O10|Case O14|Case O17/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be edited by hand/)).toBeInTheDocument();

    await user.click(within(dialog).getAllByRole("button", { name: "Open case" })[0]);

    expect(await screen.findByText("Portable Bluetooth Speaker")).toBeInTheDocument();
  });
});
