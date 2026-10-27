/**
 * P0 regression — offline replay must land in the execution ledger as
 * REPLAYED, not as "awaiting approval".
 *
 * The real backend event shape (EXECUTION_REPLAYED) has no `proposal_id`;
 * only `approval_id: "APR-<proposal_id>"`. These tests pin both the adapter
 * join and the ledger projection.
 */

import { describe, expect, it } from "vitest";
import { mapAuditEvent } from "../src/api/mapping";
import type { WireAuditEvent } from "../src/api/http/types";
import type { ActionProposal } from "../src/api/types";
import { disputePilot } from "../src/api";
import {
  buildExecutionLedger,
  countExecutionStates,
  executionStateOf,
} from "../src/lib/executionLedger";

const CASE_ID = "O6";
const PROPOSAL_ID = "PRP-O6-send-message-4f2a91";
const APPROVAL_ID = `APR-${PROPOSAL_ID}`;

const replayedEvent: WireAuditEvent = {
  event_id: "AUD-O6-EXE",
  case_id: CASE_ID,
  event_type: "EXECUTION_REPLAYED",
  actor_type: "SYSTEM",
  actor_id: "replay-runner",
  // Exact backend shape: no proposal_id, only approval_id.
  payload: {
    approval_id: APPROVAL_ID,
    execution_id: "EXE-O6-001",
    execution_mode: "REPLAY",
    simulated: true,
    artifact: "replay_EXE-O6-001.json",
    verification: { method: "fixture comparison", basis: "FIXTURE_SNAPSHOT" },
  },
  created_at: "2026-10-18T09:30:00Z",
};

const proposal = (): ActionProposal => {
  const base = disputePilot.listProposals()[0];
  if (!base) throw new Error("fixture proposal missing");
  return {
    ...base,
    proposalId: PROPOSAL_ID,
    caseId: CASE_ID,
    state: "EXECUTED",
    backendState: "REPLAY_EXECUTED",
  };
};

describe("P0 — EXECUTION_REPLAYED without proposal_id", () => {
  it("derives proposalId from approval_id (APR- prefix)", () => {
    const event = mapAuditEvent(replayedEvent);
    expect(event.proposalId).toBe(PROPOSAL_ID);
    expect(event.action).toBe("EXECUTION_ATTEMPT");
    expect(event.outcome).toBe("SUCCEEDED");
    expect(event.summaryKey).toBe("auditEvent.EXECUTION_REPLAYED.summary");
  });

  it("keeps an explicit proposal_id when the backend supplies one", () => {
    const event = mapAuditEvent({
      ...replayedEvent,
      payload: { ...replayedEvent.payload, proposal_id: "PRP-EXPLICIT" },
    });
    expect(event.proposalId).toBe("PRP-EXPLICIT");
  });

  it("counts a successful offline replay as REPLAYED and never PENDING", () => {
    const event = mapAuditEvent(replayedEvent);
    const row = proposal();

    const ledger = buildExecutionLedger([row], [event]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.state).toBe("REPLAYED");

    const counts = countExecutionStates(ledger, [event]);
    expect(counts).toEqual({
      replayed: 1,
      executed: 0,
      verified: 0,
      unverified: 0,
      blocked: 0,
      failed: 0,
      duplicates: 0,
    });
    expect(ledger[0]?.state).not.toBe("PENDING");
  });

  it("only counts VERIFIED when an EXECUTION_VERIFIED event exists", () => {
    const replayEvent = mapAuditEvent(replayedEvent);
    const verified = executionStateOf(proposal(), [
      replayEvent,
      {
        action: "EXECUTION_VERIFIED",
        outcome: "SUCCEEDED",
      },
    ]);
    expect(verified).toBe("VERIFIED");
  });

  it("falls back to REPLAYED from the proposal state when the event is not linked", () => {
    expect(executionStateOf(proposal(), [])).toBe("REPLAYED");
  });
});

describe("execution ledger — proposals without an execution", () => {
  it("shows NOT_EXECUTED, never PENDING settlement", () => {
    const row = { ...proposal(), state: "AWAITING_APPROVAL" as const, backendState: "PENDING_APPROVAL", execution: undefined };
    expect(executionStateOf(row, [])).toBe("NOT_EXECUTED");
    expect(executionStateOf(row, [])).not.toBe("PENDING");
  });
});
