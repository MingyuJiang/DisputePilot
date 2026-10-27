/**
 * Contract v1.1 — EXECUTED / UNVERIFIED on the UI side.
 *
 * No network: execution records and audit events are constructed at the adapter
 * boundary and rendered in jsdom. Every assertion pins the rule that a result
 * is only shown as success when the backend reported LIVE + confirmed=true.
 */

import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../src/i18n";
import { disputePilot } from "../src/api";
import { mapExecutionRecord } from "../src/api/mapping";
import type { ActionProposal, ExecutionRecord } from "../src/api/types";
import { ExecutionResultBadge } from "../src/components/domain/Badges";
import { ExecutionRecordPanel } from "../src/components/domain/ExecutionRecordPanel";
import {
  buildExecutionLedger,
  countExecutionStates,
  executionStateOf,
} from "../src/lib/executionLedger";
import { mapExecutionResult, resolveExecutionResult } from "../src/lib/executionResult";

const en = (ui: ReactElement) =>
  render(<LanguageProvider initialLang="en">{ui}</LanguageProvider>);
const zh = (ui: ReactElement) =>
  render(<LanguageProvider initialLang="zh-CN">{ui}</LanguageProvider>);

const liveExecution = (overrides: Partial<ExecutionRecord> = {}): ExecutionRecord => ({
  executionId: "EXE-LIVE-01",
  executionMode: "LIVE",
  simulated: false,
  result: "EXECUTED",
  httpStatus: 200,
  requestId: "REQ-LIVE-01",
  at: "2026-10-19T09:00:00Z",
  verification: {
    method: "LIVE_GET",
    basis: "LIVE_HATEOAS",
    confirmed: true,
    checkedAt: "2026-10-19T09:00:03Z",
    remoteStatus: "UNDER_REVIEW",
  },
  ...overrides,
});

const baseProposal = (): ActionProposal => {
  const base = disputePilot.listProposals()[0];
  if (!base) throw new Error("fixture proposal missing");
  return { ...base, caseId: "C-V11", state: "APPROVED", backendState: "APPROVED" };
};

describe("v1.1 — wire mapping", () => {
  it("maps every known result and degrades unknown values to UNKNOWN", () => {
    expect(mapExecutionResult("EXECUTED")).toBe("EXECUTED");
    expect(mapExecutionResult("UNVERIFIED")).toBe("UNVERIFIED");
    expect(mapExecutionResult("REPLAYED")).toBe("REPLAYED");
    expect(mapExecutionResult("BLOCKED")).toBe("BLOCKED");
    expect(mapExecutionResult("FAILED")).toBe("FAILED");
    expect(mapExecutionResult("SOMETHING_NEW")).toBe("UNKNOWN");
    expect(mapExecutionResult("")).toBeUndefined();

    const record = mapExecutionRecord({
      execution_id: "EXE-WIRE-01",
      execution_mode: "LIVE",
      simulated: false,
      result: "SOMETHING_NEW",
      verification: {
        method: "LIVE_GET",
        basis: "REMOTE_GET",
        confirmed: true,
        remote_status: "UNDER_REVIEW",
      },
    });
    expect(record?.result).toBe("UNKNOWN");
    expect(record?.verification?.method).toBe("LIVE_GET");
  });

  it("downgrades EXECUTED unless the record is LIVE and confirmed", () => {
    expect(resolveExecutionResult(liveExecution())).toBe("EXECUTED");
    expect(
      resolveExecutionResult(liveExecution({ verification: { method: "LIVE_GET", confirmed: false } })),
    ).toBe("UNVERIFIED");
    expect(
      resolveExecutionResult(
        liveExecution({ executionMode: "REPLAY", simulated: true, result: "EXECUTED" }),
      ),
    ).toBe("UNVERIFIED");
  });
});

describe("v1.1 — result badges", () => {
  it("shows EXECUTED only for LIVE + remote confirmed", () => {
    const { rerender } = en(<ExecutionResultBadge execution={liveExecution()} />);
    expect(screen.getByText("Executed (remote confirmed)")).toBeInTheDocument();

    rerender(
      <LanguageProvider initialLang="en">
        <ExecutionResultBadge
          execution={liveExecution({ verification: { method: "LIVE_GET", confirmed: false } })}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText("Unverified (result unknown)")).toBeInTheDocument();
    expect(screen.queryByText("Executed (remote confirmed)")).not.toBeInTheDocument();
  });

  it("labels UNVERIFIED in yellow with the no-auto-retry note (zh + en)", () => {
    zh(<ExecutionResultBadge execution={liveExecution({ result: "UNVERIFIED" })} />);
    const badge = screen.getByText("待核验（结果未知）");
    expect(badge.parentElement?.getAttribute("title")).toBe("不会自动重试，请人工核对。");

    en(<ExecutionResultBadge result="UNVERIFIED" />);
    expect(screen.getByText("Unverified (result unknown)")).toBeInTheDocument();
  });

  it("keeps REPLAYED offline wording and never claims a live PayPal execution", () => {
    zh(
      <ExecutionResultBadge
        execution={liveExecution({ executionMode: "REPLAY", simulated: true, result: "REPLAYED" })}
      />,
    );
    expect(screen.getByText("已回放（离线）")).toBeInTheDocument();
    expect(screen.queryByText(/已执行/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PayPal 已执行/)).not.toBeInTheDocument();
  });

  it("renders an unknown wire value as 未知结果, never as success", () => {
    zh(<ExecutionResultBadge execution={liveExecution({ result: "UNKNOWN" })} />);
    expect(screen.getByText("未知结果")).toBeInTheDocument();
    expect(screen.queryByText("已执行（远端已确认）")).not.toBeInTheDocument();
  });
});

describe("v1.1 — ledger", () => {
  it("keeps UNVERIFIED out of success and counts EXECUTED separately from REPLAYED", () => {
    const executed = { ...baseProposal(), proposalId: "P-V11-EXEC", execution: liveExecution() };
    const unverified = {
      ...baseProposal(),
      proposalId: "P-V11-UNV",
      execution: liveExecution({ result: "UNVERIFIED" }),
    };
    const replayed = {
      ...baseProposal(),
      proposalId: "P-V11-REPLAY",
      execution: liveExecution({ executionMode: "REPLAY", simulated: true, result: "REPLAYED" }),
    };

    expect(executionStateOf(executed, [])).toBe("EXECUTED");
    expect(executionStateOf(unverified, [])).toBe("UNVERIFIED");
    expect(executionStateOf(replayed, [])).toBe("REPLAYED");

    const ledger = buildExecutionLedger([executed, unverified, replayed], []);
    const counts = countExecutionStates(ledger, []);
    expect(counts).toMatchObject({
      replayed: 1,
      executed: 1,
      verified: 0,
      unverified: 1,
      blocked: 0,
      failed: 0,
    });
    // UNVERIFIED must never roll into either success bucket.
    expect(counts.executed + counts.verified).toBe(1);
  });

  it("treats an unrecognised result as UNVERIFIED, not REPLAYED or EXECUTED", () => {
    const proposal: ActionProposal = {
      ...baseProposal(),
      proposalId: "P-V11-UNKNOWN",
      execution: liveExecution({ result: "UNKNOWN" }),
    };
    expect(executionStateOf(proposal, [])).toBe("UNVERIFIED");
  });
});

describe("v1.1 — execution detail panel", () => {
  it("separates the LIVE request from the GET re-read and shows the unknown reason", () => {
    const { container } = zh(
      <ExecutionRecordPanel
        execution={liveExecution({
          result: "UNVERIFIED",
          httpStatus: 202,
          verification: {
            method: "LIVE_GET",
            confirmed: false,
            remoteStatus: "UNKNOWN",
            checkedAt: "2026-10-19T09:00:03Z",
            uncertainReason: "GET request timed out",
          },
        })}
      />,
    );

    expect(screen.getByText("执行请求")).toBeInTheDocument();
    expect(screen.getByText("远端回查")).toBeInTheDocument();
    expect(screen.getByText("回查方式")).toBeInTheDocument();
    expect(screen.getByText("LIVE_GET")).toBeInTheDocument();
    expect(screen.getByText("REQ-LIVE-01")).toBeInTheDocument();
    expect(screen.getByText("待核验（结果未知）")).toBeInTheDocument();
    expect(screen.getByText(/GET request timed out/)).toBeInTheDocument();
    expect(screen.getByText(/不会自动重试/)).toBeInTheDocument();
    // A LIVE record must never inherit replay wording.
    expect(container.textContent).not.toContain("回放");
  });
});
