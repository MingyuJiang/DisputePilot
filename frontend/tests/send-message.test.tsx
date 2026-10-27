/**
 * Send-message UI — zero network.
 *
 * The rules under test are the ones the operator can see:
 *  - no send_message link → no clickable submit, with a stage-specific reason;
 *  - empty / over-2000 characters → submit disabled;
 *  - an edited text creates a NEW proposal with a NEW payload hash;
 *  - the manager preview shows the exact text, including line breaks;
 *  - UNVERIFIED never renders as a success and never claims the buyer read it;
 *  - an approved text is locked until an explicit revision is requested.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { LanguageProvider } from "../src/i18n";
import { disputePilot } from "../src/api";
import type { ProposalGenerationOutcome } from "../src/api/errors";
import type { HateoasLink } from "../src/api/types";
import { SendMessageCard } from "../src/components/domain/SendMessageCard";
import { SendMessagePreview } from "../src/components/domain/SendMessagePreview";
import { ExecutionRecordPanel } from "../src/components/domain/ExecutionRecordPanel";
import { MESSAGE_MAX_LENGTH, messageBodyOf, validateMessage } from "../src/lib/sendMessage";

const en = (ui: ReactElement) =>
  render(<LanguageProvider initialLang="en">{ui}</LanguageProvider>);

const inquiryLinks = (): HateoasLink[] => [
  { rel: "self", method: "GET", available: true },
  { rel: "send_message", method: "POST", available: true, basis: "FIXTURE_SNAPSHOT" },
];

const submitButton = () =>
  screen.getByRole("button", { name: "Send message: submit for approval" });

const noopSubmit = async (): Promise<ProposalGenerationOutcome> => ({
  ok: false,
  error: {
    status: 0,
    code: "NOT_USED",
    message: "not used",
    detailCodes: [],
    kind: "request",
    retryable: false,
  },
});

describe("send-message — availability gate", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("disables the action without a usable link and names the CHARGEBACK stage", () => {
    const record = disputePilot.getCase("O17")!;
    const proposals = disputePilot.listProposals("O17");
    const card = (
      <SendMessageCard
        record={record}
        analysis={disputePilot.getAnalysis("O17")}
        evidence={disputePilot.listEvidence("O17")}
        proposals={proposals}
        role="SPECIALIST"
        onOpenEvidence={() => undefined}
        onSubmit={noopSubmit}
      />
    );

    const first = en(card);
    expect(
      screen.getByText("Current stage CHARGEBACK does not support sending messages."),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByLabelText("Message text")).toBeDisabled();
    first.unmount();

    render(<LanguageProvider initialLang="zh-CN">{card}</LanguageProvider>);
    expect(screen.getByText("当前阶段 CHARGEBACK，不支持发送消息。")).toBeInTheDocument();
  });

  it("keeps submit disabled for an empty message", () => {
    const record = disputePilot.getCase("O7")!;
    en(
      <SendMessageCard
        record={record}
        analysis={disputePilot.getAnalysis("O7")}
        evidence={disputePilot.listEvidence("O7")}
        proposals={[]}
        role="SPECIALIST"
        fallbackLinks={inquiryLinks()}
        onOpenEvidence={() => undefined}
        onSubmit={noopSubmit}
      />,
    );

    expect(screen.getByLabelText("Message text")).toHaveValue("");
    expect(screen.getByText("A message is required.")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("keeps submit disabled above 2000 characters and shows the counter", () => {
    const record = disputePilot.getCase("O7")!;
    en(
      <SendMessageCard
        record={record}
        analysis={disputePilot.getAnalysis("O7")}
        evidence={disputePilot.listEvidence("O7")}
        proposals={[]}
        role="SPECIALIST"
        fallbackLinks={inquiryLinks()}
        onOpenEvidence={() => undefined}
        onSubmit={noopSubmit}
      />,
    );

    const tooLong = "x".repeat(MESSAGE_MAX_LENGTH + 1);
    fireEvent.change(screen.getByLabelText("Message text"), { target: { value: tooLong } });

    expect(screen.getByTestId("send-message-counter")).toHaveTextContent("2001/2000 characters");
    expect(screen.getByText("The message exceeds 2000 characters.")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    expect(validateMessage(tooLong)).toMatchObject({ ok: false, reason: "too_long" });
  });
});

describe("send-message — proposal binding", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("creates a new proposal with a new payload hash after an edit", async () => {
    const first = await disputePilot.createSendMessageProposal({
      caseId: "O6",
      actor: "Dana Whitfield",
      message: "First version of the reply.",
      evidenceIds: ["E-O6-01"],
    });
    expect(first.ok).toBe(true);
    expect(first.proposal?.payloadHash).toBeTruthy();

    const second = await disputePilot.createSendMessageProposal({
      caseId: "O6",
      actor: "Dana Whitfield",
      message: "Second version, edited by the specialist.",
      evidenceIds: ["E-O6-01"],
    });
    expect(second.ok).toBe(true);
    expect(second.proposal?.proposalId).not.toBe(first.proposal?.proposalId);
    expect(second.proposal?.payloadHash).not.toBe(first.proposal?.payloadHash);

    const proposals = disputePilot.listProposals("O6");
    expect(
      proposals.some((item) => item.proposalId === first.proposal?.proposalId),
    ).toBe(true);
    expect(
      proposals.some((item) => item.proposalId === second.proposal?.proposalId),
    ).toBe(true);

    // An unchanged text is the same proposal (idempotent), not a third one.
    const count = proposals.length;
    const repeat = await disputePilot.createSendMessageProposal({
      caseId: "O6",
      actor: "Dana Whitfield",
      message: "Second version, edited by the specialist.",
      evidenceIds: ["E-O6-01"],
    });
    expect(repeat.proposal?.proposalId).toBe(second.proposal?.proposalId);
    expect(disputePilot.listProposals("O6")).toHaveLength(count);
  });

  it("submits the exact multiline text the specialist typed", async () => {
    const user = userEvent.setup();
    const record = disputePilot.getCase("O6")!;
    const create = vi.spyOn(disputePilot, "createSendMessageProposal");
    const onSubmit = async (draft: {
      message: string;
      rationale: string[];
      evidenceIds: string[];
    }): Promise<ProposalGenerationOutcome> => {
      const outcome = await disputePilot.createSendMessageProposal({
        caseId: record.caseId,
        actor: "Dana Whitfield",
        message: draft.message,
        rationale: draft.rationale,
        evidenceIds: draft.evidenceIds,
      });
      return outcome;
    };

    en(
      <SendMessageCard
        record={record}
        analysis={disputePilot.getAnalysis("O6")}
        evidence={disputePilot.listEvidence("O6")}
        proposals={disputePilot.listProposals("O6")}
        role="SPECIALIST"
        onOpenEvidence={() => undefined}
        onSubmit={onSubmit}
      />,
    );

    const text = "Hello,\n\nWe could not find a shipment record.\nPlease share yours.";
    fireEvent.change(screen.getByLabelText("Message text"), { target: { value: text } });
    expect(submitButton()).toBeEnabled();

    await user.click(submitButton());

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ message: text });
    expect(disputePilot.listProposals("O6").some((item) => item.action === "send-message")).toBe(
      true,
    );
    create.mockRestore();
  });

  it("locks an approved text until a revision is explicitly requested", async () => {
    const user = userEvent.setup();
    const record = disputePilot.getCase("O4")!;
    const proposals = disputePilot.listProposals("O4");

    en(
      <SendMessageCard
        record={record}
        analysis={disputePilot.getAnalysis("O4")}
        evidence={disputePilot.listEvidence("O4")}
        proposals={proposals}
        role="SPECIALIST"
        fallbackLinks={proposals[proposals.length - 1]?.hateoas.links ?? []}
        onOpenEvidence={() => undefined}
        onSubmit={noopSubmit}
      />,
    );

    expect(screen.getByText("Approved text is locked")).toBeInTheDocument();
    expect(screen.getByLabelText("Message text")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Create revised proposal" }));
    expect(screen.getByLabelText("Message text")).toBeEnabled();
  });
});

describe("send-message — manager preview and verification", () => {
  it("renders the complete message text with line breaks preserved", () => {
    const message = [
      "Dear buyer,",
      "",
      "We checked the order record and found no shipment entry.",
      "Could you share the dispatch message you received?",
      "",
      "We will review the order as soon as we hear from you.",
      "This reply does not admit liability or promise a refund.",
    ].join("\n");

    en(
      <SendMessagePreview
        message={message}
        payloadHash="ABC123PAYLOADHASH"
        requestId="DP-SEND-MESSAGE-O6-ABC123"
        state="AWAITING_APPROVAL"
      />,
    );

    const preview = screen.getByTestId("send-message-preview-text");
    expect(preview.textContent).toBe(message);
    expect(preview.textContent).toContain("\n\n");
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.getByText(/ABC123PAYLOADHASH/)).toBeInTheDocument();
    expect(
      screen.getByText(/confirmed only when the remote messages\[\] contains this exact text/),
    ).toBeInTheDocument();
  });

  it("never renders UNVERIFIED as success and never claims the buyer received it", () => {
    const { container } = en(
      <ExecutionRecordPanel
        action="send-message"
        execution={{
          executionId: "EXE-SEND-01",
          executionMode: "LIVE",
          simulated: false,
          result: "UNVERIFIED",
          httpStatus: 202,
          requestId: "REQ-SEND-01",
          at: "2026-10-20T09:00:00Z",
          verification: {
            method: "LIVE_GET",
            basis: "REMOTE_GET",
            confirmed: false,
            remoteStatus: "UNKNOWN",
            checkedAt: "2026-10-20T09:00:03Z",
            uncertainReason: "messages[] did not contain the exact text",
          },
        }}
      />,
    );

    expect(screen.getByText("Unverified (result unknown)")).toBeInTheDocument();
    expect(screen.queryByText("Executed (remote confirmed)")).not.toBeInTheDocument();
    expect(screen.getByText(/verbatim match in the remote messages\[\]/)).toBeInTheDocument();
    // The rule is stated, but no affirmative delivery/read claim is made.
    expect(container.textContent).toContain("never reports that the buyer received");
    expect(container.textContent?.toLowerCase()).not.toContain("buyer received the message");
    expect(container.textContent).not.toContain("买家已收到");
    expect(container.textContent).not.toContain("已读");
  });

  it("shows the exact payload text on the manager approval page", async () => {
    window.history.pushState({}, "", "/approvals/P-O8-01");
    render(<App />);

    // v2.1: the merchant decides directly — no identity switch to click through.
    await screen.findByTestId("payload-preview");
    const preview = await screen.findByTestId("send-message-preview-text");
    const proposal = disputePilot.listProposals("O8")[0];

    expect(preview.textContent).toBe(messageBodyOf(proposal));
    expect(screen.getByText("Lifecycle INQUIRY")).toBeInTheDocument();
    expect(screen.getByText("High risk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve action" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject with reason" })).toBeInTheDocument();
  });
});
