/**
 * Navigation — Overview is the landing page; the sidebar keeps the four
 * workspaces and the breadcrumb follows the route.
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

describe("app shell navigation", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("lands on the Overview and exposes the workspace links", async () => {
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Good to see you" })).toBeInTheDocument();

    // v2.1: the nav is the merchant's task list, not an org chart.
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: /Overview/ })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: /My disputes/ })).toHaveAttribute("href", "/cases");
    expect(within(nav).getByRole("link", { name: /Needs your confirmation/ })).toHaveAttribute(
      "href",
      "/approvals",
    );
    expect(within(nav).getByRole("link", { name: /AI assistant/ })).toHaveAttribute(
      "href",
      "/assistant",
    );
    expect(within(nav).getByRole("link", { name: /Activity/ })).toHaveAttribute("href", "/audit");
    // internal roles are gone from the UI entirely
    expect(screen.queryByRole("button", { name: "Manager" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Specialist" })).not.toBeInTheDocument();
  });

  it("navigates from Overview to the case list and updates the breadcrumb", async () => {
    const user = userEvent.setup();
    renderAt("/");

    const breadcrumb = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("Overview")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("link", { name: /My disputes/ }));

    expect(await screen.findByRole("heading", { name: "My disputes" })).toBeInTheDocument();
    expect(within(breadcrumb).queryByText("Overview")).not.toBeInTheDocument();
  });
});
