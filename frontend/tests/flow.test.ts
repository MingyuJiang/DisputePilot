import { beforeEach, describe, expect, it } from "vitest";
import { disputePilot } from "../src/api";

describe("approval -> revalidation -> execution invariants", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("runs the full protected-write path only after approval", async () => {
    const proposal = disputePilot.listProposals("O10")[0];
    expect(proposal.state).toBe("DRAFT");
    expect(proposal.validation.decision).toBe("PASS");

    // A draft cannot be executed directly.
    const premature = await disputePilot.replay(proposal.proposalId);
    expect(premature.outcome).toBe("BLOCKED");

    const submitted = disputePilot.submitProposal(proposal.proposalId, "Dana Whitfield");
    expect(submitted?.state).toBe("AWAITING_APPROVAL");

    const pendingBefore = disputePilot.listPendingApprovals().length;
    expect(pendingBefore).toBeGreaterThan(0);

    const approved = disputePilot.decideProposal(
      proposal.proposalId,
      "APPROVED",
      "Marcus Lindqvist",
      "Evidence reviewed against the open requirement.",
    );
    expect(approved?.state).toBe("APPROVED");

    const replay = await disputePilot.replay(proposal.proposalId);
    expect(replay.outcome).toBe("SUCCEEDED");
    expect(replay.httpStatus).toBe(200);

    const executed = disputePilot.listProposals("O10")[0];
    expect(executed.state).toBe("EXECUTED");

    const record = disputePilot.getCase("O10");
    expect(record?.status).toBe("UNDER_REVIEW");

    const events = disputePilot.listAudit("O10");
    expect(events.some((event) => event.action === "EXECUTION_VERIFIED")).toBe(true);
    expect(events.some((event) => event.action === "APPROVAL_GRANTED")).toBe(true);
  });

  it("refuses to queue a blocked proposal", () => {
    const blocked = disputePilot.listProposals("O14")[0];
    expect(blocked.state).toBe("BLOCKED");
    expect(blocked.validation.decision).toBe("BLOCKED");

    const afterSubmit = disputePilot.submitProposal(blocked.proposalId, "Dana Whitfield");
    expect(afterSubmit?.state).toBe("BLOCKED");

    const afterApprove = disputePilot.decideProposal(
      blocked.proposalId,
      "APPROVED",
      "Marcus Lindqvist",
      "Attempting to approve a blocked action.",
    );
    expect(afterApprove?.state).toBe("BLOCKED");
  });

  it("refreshes a stale snapshot before allowing submission", () => {
    const stale = disputePilot.listProposals("O12")[0];
    expect(stale.state).toBe("BLOCKED");
    expect(stale.validation.checks.find((check) => check.id === "V9")?.status).toBe("FAIL");

    const refreshed = disputePilot.refreshSnapshot("O12");
    expect(refreshed?.state).toBe("DRAFT");
    expect(refreshed?.validation.decision).toBe("PASS");
  });

  it("blocked HATEOAS action cannot be executed even after an approval record exists", async () => {
    const blocked = disputePilot.listProposals("O17")[0];
    expect(blocked.validation.checks.find((check) => check.id === "V3")?.status).toBe("FAIL");
    const result = await disputePilot.replay(blocked.proposalId);
    expect(result.outcome).toBe("BLOCKED");
    expect(disputePilot.listProposals("O17")[0].state).toBe("BLOCKED");
  });
});
