/**
 * Refund UI (contract v1.2, action_family=PAYMENT) — zero network.
 *
 * The rules under test are the ones the operator can see:
 *  - the card only exists for a PAYMENT capture case;
 *  - Full mode shows the server-defined remainder and has no editable amount;
 *  - Partial mode disables the draft for a missing / malformed / over-balance
 *    amount (the backend still re-validates);
 *  - after drafting, the server back-filled snapshot is what the UI shows;
 *  - PENDING is never success, and EXECUTED requires a COMPLETED refund whose
 *    amount / currency / capture all match;
 *  - the funds warning is present in both languages;
 *  - the manager approval page shows the exact amount, currency and capture;
 *  - no wording ever claims the dispute was resolved or the buyer accepted.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { LanguageProvider } from "../src/i18n";
import { disputePilot } from "../src/api";
import type { ActionProposal, ExecutionRecord, RefundDraftInput } from "../src/api/types";
import { ExecutionRecordPanel } from "../src/components/domain/ExecutionRecordPanel";
import { RefundCard } from "../src/components/domain/RefundCard";
import { refundOutcome, refundIdempotencyKey } from "../src/lib/refund";
import {
  buildExecutionLedger,
  countExecutionStates,
  executionStateOf,
} from "../src/lib/executionLedger";
import { useWorkspace } from "../src/hooks/useWorkspace";
import type { Role } from "../src/hooks/useRole";

const CAPTURE = "CAP-8AB12345XY9876543";
const CASE_ID = "CAP-DEMO-9001";

const en = (ui: ReactElement) => render(<LanguageProvider initialLang="en">{ui}</LanguageProvider>);
const zh = (ui: ReactElement) => render(<LanguageProvider initialLang="zh-CN">{ui}</LanguageProvider>);

function CardHarness({
  override,
  role = "SPECIALIST",
}: {
  override?: ActionProposal[];
  role?: Role;
}) {
  const state = useWorkspace();
  const record = state.cases.find((item) => item.caseId === CASE_ID);
  if (!record) return null;
  const proposals =
    override ?? state.proposals.filter((item) => item.caseId === CASE_ID);
  return (
    <RefundCard
      record={record}
      proposals={proposals}
      role={role}
      actor="Dana Whitfield"
      onCreate={(input: RefundDraftInput) => disputePilot.createRefundProposal(input)}
      onSubmitProposal={(proposalId: string) => {
        disputePilot.submitProposal(proposalId, "Dana Whitfield");
      }}
    />
  );
}

const createButton = () => screen.getByRole("button", { name: "Create refund proposal" });
const submitButton = () => screen.getByRole("button", { name: "Submit for approval" });

const execution = (overrides: Partial<ExecutionRecord> = {}): ExecutionRecord => ({
  executionId: "EXE-REFUND-01",
  executionMode: "LIVE",
  simulated: false,
  result: "EXECUTED",
  httpStatus: 201,
  at: "2026-10-20T10:00:00Z",
  verification: {
    method: "LIVE_GET",
    basis: "REMOTE_GET",
    confirmed: true,
    remoteStatus: "COMPLETED",
    checkedAt: "2026-10-20T10:00:05Z",
    observations: {
      capture_id: CAPTURE,
      amount: "13.00",
      currency_code: "USD",
      status: "COMPLETED",
    },
  },
  ...overrides,
});

describe("refund — payment case gate", () => {
  beforeEach(() => disputePilot.reset());

  it("shows the refund card only for a PAYMENT capture case", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", `/cases/${CASE_ID}`);
    const first = render(<App />);
    // The editors live in the rail and open on demand, not as page-bottom blocks.
    await user.click(await screen.findByRole("button", { name: "Open authoring" }));
    expect(await screen.findByTestId("refund-card")).toBeInTheDocument();
    expect(screen.queryByTestId("send-message-card")).not.toBeInTheDocument();
    first.unmount();

    window.history.pushState({}, "", "/cases/O6");
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open authoring" }));
    expect(await screen.findByTestId("send-message-card")).toBeInTheDocument();
    expect(screen.queryByTestId("refund-card")).not.toBeInTheDocument();
  });
});

describe("refund — amount rules", () => {
  beforeEach(() => disputePilot.reset());

  it("keeps Full mode non-editable and shows the remaining refundable amount", () => {
    en(<CardHarness />);
    fireEvent.click(screen.getByRole("radio", { name: "Full" }));

    expect(screen.queryByLabelText("Refund amount")).not.toBeInTheDocument();
    expect(screen.getByTestId("refund-full-amount")).toHaveTextContent(
      "Refunds the remaining refundable amount.",
    );
    expect(screen.getByTestId("refund-full-amount")).toHaveTextContent("$30.00");
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
    expect(screen.getByLabelText("Currency")).toHaveAttribute("readonly");
  });

  it("disables the draft without an amount", () => {
    en(<CardHarness />);
    expect(screen.getByLabelText("Refund amount")).toHaveValue("");
    expect(screen.getByText("Enter the amount to refund.")).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it("disables the draft for a malformed amount (2 decimals required)", () => {
    en(<CardHarness />);
    fireEvent.change(screen.getByLabelText("Refund amount"), { target: { value: "13.5" } });
    expect(
      screen.getByText("Use a decimal amount with exactly 2 places, e.g. 13.00."),
    ).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it("disables the draft above the refundable remaining balance", () => {
    en(<CardHarness />);
    fireEvent.change(screen.getByLabelText("Refund amount"), { target: { value: "30.01" } });
    expect(
      screen.getByText("The amount exceeds the refundable remaining balance."),
    ).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });
});

describe("refund — draft and server snapshot", () => {
  beforeEach(() => disputePilot.reset());

  it("creates a partial draft and shows the server back-filled snapshot", async () => {
    const user = userEvent.setup();
    en(<CardHarness />);

    fireEvent.change(screen.getByLabelText("Refund amount"), { target: { value: "13.00" } });
    fireEvent.change(screen.getByLabelText(/Refund reason/), {
      target: { value: "Partial fulfillment agreed with the buyer." },
    });
    expect(createButton()).toBeEnabled();
    await user.click(createButton());

    const proposals = disputePilot.listProposals(CASE_ID);
    const draft = proposals[proposals.length - 1];
    expect(draft.action).toBe("partial-refund");
    expect(draft.actionFamily).toBe("PAYMENT");
    expect(draft.state).toBe("DRAFT");
    expect(draft.captureSnapshot?.originalAmount).toBe("42.00");

    // Snapshot values come from the server record, not from the input.
    expect(await screen.findByTestId("refund-proposed")).toHaveTextContent("$13.00 USD");
    expect(screen.getByText("$42.00")).toBeInTheDocument();
    expect(screen.getByText("$12.00")).toBeInTheDocument();
    expect(screen.getByText("$30.00")).toBeInTheDocument();
    expect(screen.getByText(CAPTURE)).toBeInTheDocument();

    // The existing approval flow submits this exact draft.
    expect(submitButton()).toBeEnabled();
    await user.click(submitButton());
    expect(disputePilot.listProposals(CASE_ID).slice(-1)[0].state).toBe("AWAITING_APPROVAL");
  });

  it("sends no client amount in Full mode and lets the server compute the remainder", async () => {
    const user = userEvent.setup();
    en(<CardHarness />);
    fireEvent.click(screen.getByRole("radio", { name: "Full" }));
    fireEvent.change(screen.getByLabelText(/Refund reason/), {
      target: { value: "Return the full remaining balance." },
    });
    await user.click(createButton());

    const draft = disputePilot.listProposals(CASE_ID).slice(-1)[0];
    expect(draft.action).toBe("full-refund");
    expect(draft.payload.find((field) => field.label === "Amount")?.value).toBe("30.00");
    expect(draft.payload.find((field) => field.label === "Mode")?.value).toBe("FULL");
  });

  it("shows the funds warning in English and Chinese", () => {
    const first = en(<CardHarness />);
    expect(screen.getByTestId("refund-funds-warning")).toHaveTextContent(
      "This action may move funds and cannot be treated as a reversible preview.",
    );
    first.unmount();

    zh(<CardHarness />);
    expect(screen.getByTestId("refund-funds-warning")).toHaveTextContent(
      "此操作可能实际划转资金，不能视为可撤销的预览。",
    );
  });

  it("never offers execution to a specialist and never claims the dispute is resolved", () => {
    const { container } = en(<CardHarness />);
    expect(screen.queryByRole("button", { name: /execute/i })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot execute it/)).toBeInTheDocument();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/dispute (?:has been |is )?resolved/i);
    expect(text).not.toContain("buyer accepted");
    expect(text).not.toContain("争议已解决");
    expect(text).not.toContain("买家已接受");
  });
});

describe("refund — execution honesty", () => {
  beforeEach(() => disputePilot.reset());

  it("renders PENDING as 处理中（未结算） and never as success", () => {
    const base = disputePilot.getCase(CASE_ID)!;
    const draft: ActionProposal = {
      ...{
        proposalId: "P-REFUND-PENDING",
        caseId: CASE_ID,
        action: "partial-refund",
        actionLabel: "Partial refund",
        state: "PENDING",
        risk: "HIGH",
        rationale: ["Refund drafted for test."],
        evidenceIds: [],
        payload: [
          { label: "Capture ID", value: CAPTURE },
          { label: "Mode", value: "PARTIAL" },
          { label: "Amount", value: "13.00" },
          { label: "Currency", value: "USD" },
          { label: "Refund reason", value: "Partial fulfillment." },
        ],
        payloadNote: "",
        requiresApproval: true,
        validation: { decision: "PASS" as const, checks: [], summary: "" },
        policyRefs: [],
        hateoas: { observedAt: base.updatedAt, source: "fixture", frozen: true, links: [] },
        snapshotVersion: base.snapshotVersion,
        snapshotHash: base.snapshotHash,
        evidenceStatus: "",
        actionFamily: "PAYMENT" as const,
        captureSnapshot: base.captureSnapshot,
      },
      execution: execution({
        result: "PENDING",
        verification: { method: "LIVE_GET", confirmed: false, remoteStatus: "PENDING" },
      }),
    };

    // A PENDING execution is not success and does not enter the success counts.
    expect(executionStateOf(draft, [])).toBe("PENDING");
    const counts = countExecutionStates(buildExecutionLedger([draft], []), []);
    expect(counts.executed + counts.verified + counts.replayed).toBe(0);

    const first = en(<CardHarness override={[draft]} />);
    expect(screen.getAllByText("Pending (not settled)").length).toBeGreaterThan(0);
    expect(screen.queryByText("Executed (remote confirmed)")).not.toBeInTheDocument();
    expect(screen.getByText(/has not settled/)).toBeInTheDocument();
    first.unmount();

    zh(<CardHarness override={[draft]} />);
    expect(screen.getAllByText("处理中（未结算）").length).toBeGreaterThan(0);
    expect(screen.queryByText("已执行（远端已确认）")).not.toBeInTheDocument();
  });

  it("only reports EXECUTED when the refund is COMPLETED and the values match", () => {
    const expected = { captureId: CAPTURE, amountMinor: 1300, currency: "USD" };

    expect(refundOutcome(execution(), expected)).toBe("EXECUTED");
    expect(
      refundOutcome(
        execution({
          verification: {
            ...execution().verification,
            observations: { capture_id: CAPTURE, amount: "12.00", currency_code: "USD" },
          },
        }),
        expected,
      ),
    ).toBe("UNVERIFIED");
    expect(
      refundOutcome(
        execution({
          verification: {
            ...execution().verification,
            observations: { capture_id: CAPTURE, amount: "13.00", currency_code: "EUR" },
          },
        }),
        expected,
      ),
    ).toBe("UNVERIFIED");
    expect(
      refundOutcome(
        execution({
          executionMode: "REPLAY",
          simulated: true,
        }),
        expected,
      ),
    ).toBe("UNVERIFIED");
  });

  it("renders a mismatched EXECUTED record as unverified in the execution panel", () => {
    en(
      <ExecutionRecordPanel
        action="partial-refund"
        refund={{ captureId: CAPTURE, amountMinor: 1300, currency: "USD" }}
        execution={execution({
          verification: {
            ...execution().verification,
            observations: { capture_id: CAPTURE, amount: "99.00", currency_code: "USD" },
          },
        })}
      />,
    );

    expect(screen.getByText("Unverified (result unknown)")).toBeInTheDocument();
    expect(screen.queryByText("Executed (remote confirmed)")).not.toBeInTheDocument();
  });
});

describe("refund — manager approval", () => {
  beforeEach(() => disputePilot.reset());

  it("shows the exact amount, currency and capture id to the manager", async () => {
    const key = refundIdempotencyKey({
      caseId: CASE_ID,
      captureId: CAPTURE,
      mode: "partial",
      amount: "13.00",
      reason: "Partial fulfillment agreed with the buyer.",
    });
    const created = await disputePilot.createRefundProposal({
      caseId: CASE_ID,
      captureId: CAPTURE,
      mode: "partial",
      amount: "13.00",
      currencyCode: "USD",
      reason: "Partial fulfillment agreed with the buyer.",
      actor: "Dana Whitfield",
      idempotencyKey: key,
    });
    expect(created.ok).toBe(true);
    const proposalId = created.proposal!.proposalId;
    disputePilot.submitProposal(proposalId, "Dana Whitfield");

    window.history.pushState({}, "", `/approvals/${proposalId}`);
    render(<App />);
    // v2.1: the merchant decides directly — no identity switch to click through.
    await screen.findByTestId("payload-preview");

    // The exact payload card is the first thing a manager reads.
    const summary = await screen.findByTestId("payload-preview");
    expect(within(summary).getByText("13.00 USD")).toBeInTheDocument();
    expect(within(summary).getByText("Partial refund")).toBeInTheDocument();
    expect(within(summary).getByText(CAPTURE)).toBeInTheDocument();
    expect(within(summary).getByText("42.00 USD")).toBeInTheDocument();
    expect(within(summary).getByText("12.00 USD")).toBeInTheDocument();
    expect(within(summary).getByText("30.00 USD")).toBeInTheDocument();
    expect(within(summary).getByText(/does not resolve the dispute/)).toBeInTheDocument();
    expect(within(summary).getByText(/cannot be changed silently/)).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Approve action" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject with reason" })).toBeInTheDocument();
  });
});
