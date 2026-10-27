/**
 * Overview — five work queues derived from the loaded workspace.
 *
 * Counts are asserted against the fixture snapshot (16 cases) and must stay
 * "derived", never presented as a backend aggregate.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { disputePilot } from "../src/api";
import { buildWorkQueues } from "../src/lib/workQueues";

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

const counts = () => {
  const queues = buildWorkQueues(disputePilot.getWorkspace(), { loaded: true });
  return Object.fromEntries(queues.map((queue) => [queue.key, queue.count]));
};

describe("overview — work queue derivation", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("counts the five queues from the loaded cases", () => {
    // O18 + CAP-DEMO-9001 have no analysis; P-O6-02 / P-O8-01 await a manager;
    // P-O12-01 / P-O14-01 / P-O17-01 are blocked; no unverified execution is
    // loaded; O4 / O5 / O11 carry a replay row.
    expect(counts()).toEqual({
      analysis: 2,
      approval: 2,
      blocked: 3,
      review: 0,
      recent: 3,
    });
  });

  it("reports no count at all when the workspace has not loaded", () => {
    const queues = buildWorkQueues(
      { cases: [], evidence: [], analyses: [], proposals: [], approvals: [], audit: [], revision: 1 },
      { loaded: false },
    );
    expect(queues.every((queue) => queue.count === null)).toBe(true);
  });

  it("answers the four merchant questions from loaded data", async () => {
    renderAt("/");

    // v2.1: the first screen is four questions + a task list, not five internal
    // work queues. Counts still come from the workspace (never hardcoded).
    expect(await screen.findByRole("heading", { name: "Good to see you" })).toBeInTheDocument();

    expect(screen.getByText("Awaiting analysis")).toBeInTheDocument();
    expect(screen.getByText("Waiting for your confirmation")).toBeInTheDocument();
    expect(screen.getByText("Blocked or need more information")).toBeInTheDocument();
    expect(screen.getByText("Analysed by AI")).toBeInTheDocument();

    // each question shows a number derived from the loaded workspace
    const questionCards = screen.getAllByText(/^\d+$/);
    expect(questionCards.length).toBeGreaterThanOrEqual(4);

    expect(
      screen.getByText("Derived from 16 loaded cases. Not a backend aggregate."),
    ).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /AI assistant/ }).length).toBeGreaterThan(0);
  });

  it("lists actionable tasks that link straight into the dispute", async () => {
    renderAt("/");
    await screen.findByRole("heading", { name: "Good to see you" });

    // tasks link to the case workspace, never to an internal management page
    const links = screen.getAllByRole("link").filter((link) =>
      /\/cases\/O\d+/.test(link.getAttribute("href") ?? ""),
    );
    expect(links.length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /View all/ })).not.toBeInTheDocument();
  });
});
