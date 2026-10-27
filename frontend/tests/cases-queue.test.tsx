/**
 * Cases list — filters, role-aware next step, and no technical fields.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { disputePilot } from "../src/api";

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

const rowFor = (caseId: string): HTMLElement => {
  const rows = screen
    .getAllByRole("link")
    .filter((element) => element.getAttribute("href") === `/cases/${caseId}`);
  if (rows.length === 0) throw new Error(`No row for ${caseId}`);
  return rows[0];
};

describe("cases — task list", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("keeps case, family, amount, state, AI status, next step and source in the row", async () => {
    renderAt("/cases");
    await screen.findByRole("heading", { name: "My disputes" });

    const row = rowFor("O10");
    expect(within(row).getByText("O10")).toBeInTheDocument();
    expect(within(row).getByText("Mechanical Gaming Keyboard (RGB)")).toBeInTheDocument();
    expect(within(row).getByText("$22.00")).toBeInTheDocument();
    expect(within(row).getByText("Waiting for seller")).toBeInTheDocument();
    expect(within(row).getByText("Analysed")).toBeInTheDocument();
    expect(within(row).getByText("Submit for approval")).toBeInTheDocument();
    expect(within(row).getByText("Scenario-defined")).toBeInTheDocument();

    // Technical fields stay out of the row (they live in the case detail).
    expect(within(row).queryByText(/snap-/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/sha256/)).not.toBeInTheDocument();
  });

  it("filters by case state", async () => {
    const user = userEvent.setup();
    renderAt("/cases");
    await screen.findByRole("heading", { name: "My disputes" });

    await user.selectOptions(screen.getByLabelText("Filter by case state"), "case.under-review");

    expect(screen.getByText("DisputePilot Phase3 LevelC Web Dispute Test")).toBeInTheDocument();
    expect(screen.queryByText("Mechanical Gaming Keyboard (RGB)")).not.toBeInTheDocument();
    expect(screen.getByText("3 of 16 cases")).toBeInTheDocument();
  });

  it("searches by id or title and shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderAt("/cases");
    await screen.findByRole("heading", { name: "My disputes" });

    const search = screen.getByLabelText("Search cases");
    await user.type(search, "laptop sleeve");
    expect(screen.getByText("Laptop Sleeve (Grey, 13-inch)")).toBeInTheDocument();
    expect(screen.queryByText("Mechanical Gaming Keyboard (RGB)")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "no such case");
    expect(await screen.findByText("No cases match these filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("gives the merchant both the analysis and the review step", async () => {
    renderAt("/cases");
    await screen.findByRole("heading", { name: "My disputes" });

    // v2.1: one identity, both capabilities. No role switch is offered at all.
    expect(screen.queryByRole("button", { name: "Manager" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Specialist" })).not.toBeInTheDocument();
    expect(within(rowFor("O18")).getByText("Analyse case")).toBeInTheDocument();
    expect(within(rowFor("O8")).getByText("Review approval")).toBeInTheDocument();
  });
});
