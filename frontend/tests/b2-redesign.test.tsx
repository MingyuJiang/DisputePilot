/**
 * B2 — payload-first approval page and fact → gap → next-step case page.
 *
 * These assertions are semantic, not layout-only: payload precedes policy in
 * the DOM, failures are visible while details stay collapsed, a specialist has
 * no decision control, approving never executes, and only one next step exists.
 */

import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { disputePilot } from "../src/api";
import type { AIAnalysis, ActionProposal } from "../src/api/types";
import { AIAssessment } from "../src/components/domain/AIAssessment";
import { ApprovalDecisionBar } from "../src/components/domain/ApprovalDecisionBar";
import { RoleProvider } from "../src/hooks/useRole";
import { LanguageProvider } from "../src/i18n";
import { messageBodyOf } from "../src/lib/sendMessage";

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

const asManager = () => window.localStorage.setItem("dp.demo.role", "MANAGER");

const isBefore = (first: Element, second: Element): boolean =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

const noop = (): void => undefined;

const unverifiedProposal = (): ActionProposal => ({
  proposalId: "P-UNVERIFIED-TEST",
  caseId: "O8",
  action: "send-message",
  actionLabel: "Send message to buyer",
  state: "APPROVED",
  risk: "HIGH",
  rationale: [],
  evidenceIds: [],
  payload: [],
  payloadNote: "",
  requiresApproval: true,
  validation: { decision: "PASS", checks: [], summary: "V1–V12 passed." },
  policyRefs: [],
  hateoas: { observedAt: "2026-10-20T09:00:00Z", source: "test", frozen: true, links: [] },
  snapshotVersion: "O8/snap-3",
  snapshotHash: "hash",
  evidenceStatus: "2 of 3 items on file",
  execution: {
    executionMode: "LIVE",
    simulated: false,
    result: "UNVERIFIED",
    httpStatus: 202,
    verification: {
      method: "LIVE_GET",
      confirmed: false,
      checkedAt: "2026-10-20T09:00:03Z",
      uncertainReason: "messages[] did not contain the exact text",
    },
  },
});

const frozenAnalysis = (): AIAnalysis => ({
  analysisId: "ANL-FROZEN-B2",
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

describe("B2 — approval detail is payload first", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("renders the exact payload before the policy summary", async () => {
    asManager();
    renderAt("/approvals/P-O8-01");

    const payload = await screen.findByTestId("payload-preview");
    const policy = await screen.findByTestId("policy-summary");
    expect(isBefore(payload, policy)).toBe(true);
  });

  it("keeps failures visible while the per-check details stay collapsed", async () => {
    renderAt("/approvals/P-O14-01");

    const failures = await screen.findByTestId("policy-failures");
    expect(within(failures).getByText(/V7/)).toBeInTheDocument();
    expect(within(failures).getByText(/V8/)).toBeInTheDocument();
    expect(within(failures).getByText(/submitting an empty form is not a valid request/i)).toBeInTheDocument();

    const details = screen.getByText(/All checks/).closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });

  it("lets the merchant decide directly, with no role switch", async () => {
    renderAt("/approvals/P-O8-01");

    // v2.1: the merchant is the decision maker — the approve/reject controls are
    // available without switching identity, and the switch prompt is gone.
    expect(await screen.findByTestId("payload-preview")).toBeInTheDocument();
    expect(screen.queryByText("Switch to Manager to decide")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve action/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject with reason/ })).toBeInTheDocument();
  });

  it("states that approving does not execute", async () => {
    asManager();
    renderAt("/approvals/P-O8-01");

    expect(await screen.findByTestId("decision-execution-note")).toHaveTextContent(
      "Approving does not execute. Execution is a separate gated step.",
    );
  });

  it("shows the approval record next to an executed proposal, never as its state", async () => {
    asManager();
    renderAt("/approvals/P-O4-01");

    const summary = await screen.findByTestId("approval-summary");
    // The approval record says APPROVED; the proposal row says EXECUTED.
    expect(within(summary).getByText("Approved · not executed")).toBeInTheDocument();
    const badge = summary.querySelector('[data-state="approval.approved"]');
    expect(badge).not.toBeNull();
    // Green is reserved for a remote-verified execution.
    expect(badge?.innerHTML).not.toMatch(/pass/);
  });

  it("renders the full message body without truncation and folds the hash", async () => {
    asManager();
    renderAt("/approvals/P-O8-01");

    const preview = await screen.findByTestId("send-message-preview-text");
    const proposal = disputePilot.listProposals("O8")[0];
    expect(preview.textContent).toBe(messageBodyOf(proposal));
    expect(window.getComputedStyle(preview).maxHeight).not.toBe("120px");

    const hashDetails = screen.getByText("Payload hash").closest("details");
    expect(hashDetails).not.toHaveAttribute("open");
  });

  it("renders a provide-evidence payload as type + notes + attachment", async () => {
    asManager();
    renderAt("/approvals/P-O10-01");

    const payload = await screen.findByTestId("payload-preview");
    expect(within(payload).getAllByText("PROOF_OF_FULFILLMENT").length).toBeGreaterThan(0);
    expect(screen.getByTestId("payload-evidence-notes")).toHaveTextContent(
      "SCENARIO_DEFINED — sandbox test material",
    );
    expect(screen.getByTestId("payload-attachment")).toHaveTextContent(
      "Present: sandbox-fulfillment-note-O10.txt",
    );
  });

  it("offers no retry for an UNVERIFIED execution", () => {
    asManager();
    render(
      <MemoryRouter>
        <LanguageProvider initialLang="en">
          <RoleProvider>
            <ApprovalDecisionBar
              proposal={unverifiedProposal()}
              approval={{
                approvalId: "AP-TEST",
                proposalId: "P-UNVERIFIED-TEST",
                caseId: "O8",
                decision: "APPROVED",
                reason: "Approved once.",
                decidedBy: "Marcus Lindqvist",
                decidedAt: "2026-10-20T08:59:00Z",
              }}
              caseId="O8"
              onDecide={noop}
            />
          </RoleProvider>
        </LanguageProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("decision-unverified")).toHaveTextContent(
      "no retry is offered",
    );
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve action" })).not.toBeInTheDocument();
  });
});

describe("B2 — case detail: facts, gaps, one next step", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("renders exactly one next step and no competing action card", async () => {
    renderAt("/cases/O9");

    expect(await screen.findAllByTestId("next-step")).toHaveLength(1);
    expect(screen.getByTestId("next-step")).toHaveAttribute("data-next-step", "next.propose");
    // The editors stay collapsed: their CTAs cannot compete with the next step.
    expect(screen.queryByTestId("send-message-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("refund-card")).not.toBeInTheDocument();
  });

  it("surfaces the O9 blocking gap in the next-step card", async () => {
    renderAt("/cases/O9");

    const blockers = await screen.findByTestId("next-step-blockers");
    expect(blockers).toHaveTextContent("Proof of fulfillment");
    expect(blockers).toHaveTextContent("No shipment exists.");
  });

  it("does not fabricate a raw AI recommendation when the backend omits it (O16)", async () => {
    renderAt("/cases/O16");

    expect(
      await screen.findByText(
        "The backend did not provide a raw recommendation; no difference is inferred.",
      ),
    ).toBeInTheDocument();
    // The effective recommendation is still shown.
    expect(screen.getByText("Send message to buyer")).toBeInTheDocument();
  });

  it("shows capture, refund and dispute as three separate states with backend amount strings", async () => {
    renderAt("/cases/CAP-DEMO-9001");

    const panel = await screen.findByTestId("capture-panel");
    expect(within(panel).getByTestId("transaction-status")).toHaveTextContent("COMPLETED");
    expect(within(panel).getByText("42.00 USD")).toBeInTheDocument();
    expect(within(panel).getByText("12.00 USD")).toBeInTheDocument();
    expect(within(panel).getByText("30.00 USD")).toBeInTheDocument();
    expect(within(panel).getByText("No refund proposal for this capture.")).toBeInTheDocument();
    expect(
      within(panel).getByText(
        "Not reported for a capture case. A capture status is never a dispute status.",
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByTestId("capture-no-real-funds")).toHaveTextContent(
      "No real funds moved.",
    );
  });

  it("groups evidence into on file / required / assessment", async () => {
    renderAt("/cases/O10");

    const review = await screen.findByTestId("evidence-review");
    expect(within(review).getByRole("heading", { name: "On file" })).toBeInTheDocument();
    expect(
      within(review).getByRole("heading", { name: "Required for this action" }),
    ).toBeInTheDocument();
    expect(within(review).getByRole("heading", { name: "Assessment" })).toBeInTheDocument();
    // Fixture provenance travels with the record; counts are not sufficiency.
    expect(within(review).getAllByText("Fixture record").length).toBeGreaterThan(0);
    expect(within(review).getAllByText(/Counts describe records only/).length).toBeGreaterThan(0);
  });

  it("labels a frozen AI analysis as frozen, never as live output", () => {
    const record = disputePilot.getCase("O10")!;
    render(
      <LanguageProvider initialLang="en">
        <AIAssessment
          record={record}
          analysis={frozenAnalysis()}
          evidence={[]}
          requesting={false}
          onRunAnalysis={noop}
          onOpenEvidence={noop}
        />
      </LanguageProvider>,
    );

    expect(screen.getByTestId("ai-mode-label")).toHaveTextContent("Frozen AI Output");
    expect(screen.getByText("Frozen AI Output / Offline Replay")).toBeInTheDocument();
    expect(screen.queryByText("Live AI output")).not.toBeInTheDocument();
  });

  it("groups the case timeline into lifecycle stages", async () => {
    renderAt("/cases/O4");

    await screen.findByTestId("next-step");
    for (const stage of ["Import", "Analysis", "Proposal", "Approval", "Execution", "Verification"]) {
      expect(screen.getByLabelText(stage)).toBeInTheDocument();
    }
  });

  it("offers the draft editor only after the next step opens it", async () => {
    const user = userEvent.setup();
    renderAt("/cases/O9");

    expect(await screen.findAllByTestId("next-step")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Draft a proposal" }));

    expect(await screen.findByTestId("authoring-panel")).toBeInTheDocument();
    expect(await screen.findByTestId("send-message-card")).toBeInTheDocument();
  });
});
