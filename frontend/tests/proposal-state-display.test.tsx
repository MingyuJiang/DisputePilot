/**
 * Proposal state display — the execution record outranks the proposal state.
 *
 * The backend uses REPLAY_EXECUTED for offline replays and folds an unknown
 * LIVE result into FAILED; rendering those as "Executed" / "Blocked" would
 * mislead the operator about what actually happened. No network: the wire
 * records are constructed here and mapped through the adapter.
 */

import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../src/i18n";
import {
  mapExecutionRecord,
  mapProposal,
  mapProposalState,
  resolveProposalState,
} from "../src/api/mapping";
import type { WireExecution, WireProposal } from "../src/api/http/types";
import { ProposalStateBadge } from "../src/components/domain/Badges";

const zh = (ui: ReactElement) =>
  render(<LanguageProvider initialLang="zh-CN">{ui}</LanguageProvider>);

const wireProposal = (overrides: Partial<WireProposal> = {}): WireProposal => ({
  proposal_id: "P-STATE-01",
  case_id: "C-STATE",
  analysis_id: "A-STATE-01",
  action_type: "send-message",
  action_payload: { message: "Status update for the buyer." },
  expected_preconditions: [],
  required_evidence: [],
  rationale: [],
  evidence_ids: [],
  risk_level: "MEDIUM",
  validation_status: "PASSED",
  state: "REPLAY_EXECUTED",
  snapshot_hash: "sha256:snapshot",
  payload_hash: "sha256:payload",
  policy_version: "policy-v1.0",
  execution_authorized: true,
  created_at: "2026-10-19T08:00:00Z",
  updated_at: "2026-10-19T08:00:00Z",
  ...overrides,
});

const wireExecution = (overrides: Partial<WireExecution> = {}): WireExecution => ({
  execution_id: "EXE-STATE-01",
  proposal_id: "P-STATE-01",
  case_id: "C-STATE",
  execution_mode: "LIVE",
  simulated: false,
  result: "EXECUTED",
  verification: { method: "LIVE_GET", basis: "LIVE_HATEOAS", confirmed: true },
  created_at: "2026-10-19T09:00:00Z",
  ...overrides,
});

/** The badge element itself (an UNVERIFIED badge is wrapped in a titled span). */
const badgeOf = (container: HTMLElement): HTMLElement => {
  const root = container.firstElementChild as HTMLElement;
  return root.getAttribute("title") === null ? root : (root.firstElementChild as HTMLElement);
};

describe("proposal state — execution record is authoritative", () => {
  it("shows an offline replay as 已回放（离线）, never as 已执行", () => {
    const proposal = mapProposal(wireProposal({ state: "REPLAY_EXECUTED" }), {
      execution: wireExecution({
        execution_mode: "REPLAY",
        simulated: true,
        result: "REPLAYED",
        verification: { method: "FIXTURE_SNAPSHOT", basis: "FIXTURE_SNAPSHOT" },
      }),
    });

    expect(proposal.state).toBe("REPLAYED");

    const { container } = zh(<ProposalStateBadge state={proposal.state} />);
    expect(screen.getByText("已回放（离线）")).toBeInTheDocument();
    expect(screen.queryByText(/已执行/)).not.toBeInTheDocument();
    // Neutral tone: a replay is neither a success nor a failure.
    expect(badgeOf(container).className).toContain("text-ink-muted");
  });

  it("shows a LIVE, GET-confirmed execution as 已执行（远端已确认）", () => {
    const proposal = mapProposal(wireProposal({ state: "EXECUTED" }), {
      execution: wireExecution(),
    });

    expect(proposal.state).toBe("EXECUTED");
    zh(<ProposalStateBadge state={proposal.state} />);
    expect(screen.getByText("已执行（远端已确认）")).toBeInTheDocument();
  });

  it("shows an unknown LIVE result as 待核验（结果未知）, never as 阻断", () => {
    // The backend stores FAILED when the LIVE result is UNVERIFIED.
    const proposal = mapProposal(wireProposal({ state: "FAILED" }), {
      execution: wireExecution({
        result: "UNVERIFIED",
        verification: { method: "LIVE_GET", confirmed: false, uncertain_reason: "GET timed out" },
      }),
    });

    expect(proposal.state).toBe("UNVERIFIED");

    const { container } = zh(<ProposalStateBadge state={proposal.state} />);
    expect(screen.getByText("待核验（结果未知）")).toBeInTheDocument();
    expect(screen.queryByText(/阻断/)).not.toBeInTheDocument();
    expect(screen.queryByText("受阻")).not.toBeInTheDocument();
    // Yellow tone + the no-auto-retry warning travels with the badge.
    expect(badgeOf(container).className).toContain("text-warn");
    expect(container.firstElementChild?.getAttribute("title")).toBe("不会自动重试，请人工核对。");
  });

  it("shows a failed LIVE execution as 执行失败", () => {
    const proposal = mapProposal(wireProposal({ state: "FAILED" }), {
      execution: wireExecution({
        result: "FAILED",
        verification: { method: "LIVE_GET", confirmed: false },
      }),
    });

    expect(proposal.state).toBe("FAILED");
    const { container } = zh(<ProposalStateBadge state={proposal.state} />);
    expect(screen.getByText("执行失败")).toBeInTheDocument();
    expect(badgeOf(container).className).toContain("text-stop");
  });

  it("keeps mapProposalState behaviour when no execution record exists", () => {
    const cases: [string, string][] = [
      ["DRAFT", "草稿"],
      ["PENDING_APPROVAL", "待审批"],
      ["APPROVED", "已批准"],
      ["REJECTED", "已拒绝"],
      ["BLOCKED", "受阻"],
    ];

    for (const [wireState, label] of cases) {
      const proposal = mapProposal(wireProposal({ state: wireState }), {});
      expect(proposal.state).toBe(mapProposalState(wireState));
      const { unmount } = zh(<ProposalStateBadge state={proposal.state} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }

    // No execution record: REPLAY_EXECUTED now maps to REPLAYED. The old
    // mapping (EXECUTED) encoded an offline replay as a live execution.
    expect(mapProposal(wireProposal({ state: "REPLAY_EXECUTED" }), {}).state).toBe("REPLAYED");
  });

  it("never upgrades a contradictory or unconfirmed record to success", () => {
    // REPLAY mode reporting EXECUTED is not a live success.
    expect(
      resolveProposalState(
        "REPLAY_EXECUTED",
        mapExecutionRecord(
          wireExecution({ execution_mode: "REPLAY", simulated: true, result: "EXECUTED" }),
        ),
      ),
    ).toBe("UNVERIFIED");

    // LIVE EXECUTED without verification.confirmed=true is still unknown.
    expect(
      resolveProposalState(
        "EXECUTED",
        mapExecutionRecord(
          wireExecution({ verification: { method: "LIVE_GET", confirmed: false } }),
        ),
      ),
    ).toBe("UNVERIFIED");

    // An unknown wire value degrades to UNVERIFIED, not to a success state.
    expect(
      resolveProposalState(
        "EXECUTED",
        mapExecutionRecord(wireExecution({ result: "SOMETHING_NEW" })),
      ),
    ).toBe("UNVERIFIED");
  });
});
