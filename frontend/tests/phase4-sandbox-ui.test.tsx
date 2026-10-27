/**
 * Phase 4 — Sandbox mode / provenance / connection / execution-vs-verification.
 *
 * No network and no browser: fetch is mocked at the adapter boundary and the
 * pieces are rendered in jsdom. Every assertion checks that the UI only claims
 * what the backend reported.
 */

import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../src/i18n";
import {
  CaseReadTime,
  ConnectionNotice,
  ModeBadge,
  ProvenanceBadge,
} from "../src/components/domain/SandboxStatus";
import { ExecutionRecordPanel } from "../src/components/domain/ExecutionRecordPanel";
import { PolicyChecks } from "../src/components/domain/PolicyChecks";
import { AuditTimeline } from "../src/components/domain/AuditTimeline";
import { mapAuditEvent } from "../src/api/mapping";
import { createHttpFacade } from "../src/api/http";
import { executionStateOf } from "../src/lib/executionLedger";
import { getRuntime, initializeHttpRuntime, initializeOfflineRuntime } from "../src/api/runtime";
import type { ConnectionIssue } from "../src/api/runtime";
import type { ActionProposal, AuditEvent, ExecutionRecord } from "../src/api/types";
import type { WireAuditEvent } from "../src/api/http/types";

const noop = (): void => undefined;

const en = (ui: ReactElement) =>
  render(<LanguageProvider initialLang="en">{ui}</LanguageProvider>);
const zh = (ui: ReactElement) =>
  render(<LanguageProvider initialLang="zh-CN">{ui}</LanguageProvider>);

const issue = (overrides: Partial<ConnectionIssue> = {}): ConnectionIssue => ({
  kind: "credentials",
  status: 401,
  code: "UNAUTHORIZED",
  message: "Sandbox credentials rejected",
  source: "health",
  at: "2026-10-19T08:00:00Z",
  ...overrides,
});

const execution = (overrides: Partial<ExecutionRecord> = {}): ExecutionRecord => ({
  executionId: "EXE-SBX-01",
  executionMode: "LIVE",
  simulated: false,
  result: "EXECUTED",
  httpStatus: 200,
  requestId: "REQ-SBX-01",
  at: "2026-10-19T08:10:00Z",
  verification: {
    basis: "LIVE_GET",
    confirmed: true,
    checkedAt: "2026-10-19T08:10:04Z",
    remoteStatus: "UNDER_REVIEW",
  },
  ...overrides,
});

describe("phase 4 — mode, provenance and read time", () => {
  beforeEach(() => {
    initializeOfflineRuntime();
  });

  it("labels the three health combinations exactly and never guesses an unknown mode", () => {
    const { rerender } = render(
      <LanguageProvider initialLang="en">
        <ModeBadge health={{ executionMode: "REPLAY", networkAccess: "NONE", source: "health" }} />
      </LanguageProvider>,
    );
    expect(screen.getByText("Offline replay")).toBeInTheDocument();

    rerender(
      <LanguageProvider initialLang="en">
        <ModeBadge
          health={{ executionMode: "REPLAY", networkAccess: "PAYPAL_SANDBOX_READ_ONLY", source: "health" }}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText("Sandbox · read-only")).toBeInTheDocument();

    rerender(
      <LanguageProvider initialLang="en">
        <ModeBadge
          health={{
            executionMode: "LIVE",
            networkAccess: "PAYPAL_SANDBOX_WRITE_ENABLED",
            source: "health",
          }}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText(/Sandbox · execution enabled/)).toBeInTheDocument();

    rerender(
      <LanguageProvider initialLang="en">
        <ModeBadge health={{ executionMode: "", networkAccess: "", source: "health" }} />
      </LanguageProvider>,
    );
    expect(screen.getByText("Mode not reported")).toBeInTheDocument();
  });

  it("renders provenance badges without blending the vocabularies", () => {
    en(
      <>
        <ProvenanceBadge provenance="PAYPAL_API_OBSERVED" />
        <ProvenanceBadge provenance="SCENARIO_DEFINED" />
        <ProvenanceBadge provenance="HUMAN_OBSERVED_SANDBOX_UI" />
      </>,
    );
    expect(screen.getByText("Sandbox live data")).toBeInTheDocument();
    expect(screen.getByText("Offline de-identified data")).toBeInTheDocument();
    expect(screen.getByText("Sandbox UI observation")).toBeInTheDocument();

    render(<LanguageProvider initialLang="en"><ProvenanceBadge /></LanguageProvider>);
    expect(screen.getAllByText("Source not reported").length).toBeGreaterThan(0);
  });

  it("prefers live_status_note over the CASE_IMPORTED fallback and exposes the full timestamp", () => {
    const audit: AuditEvent[] = [
      {
        eventId: "A-1",
        caseId: "C-1",
        at: "2026-10-19T06:00:00Z",
        actor: { type: "SYSTEM", name: "loader" },
        action: "CASE_IMPORTED",
        environment: "backend_offline_replay",
        outcome: "INFO",
        summary: "",
        detail: "",
        fields: [],
      },
    ];
    const { rerender } = en(
      <CaseReadTime
        record={{ liveStatusNote: "PayPal Sandbox read at 2026-10-19T07:15:30Z; remote status=UNDER_REVIEW" }}
        audit={audit}
      />,
    );
    const withNote = screen.getByText(/Last read:/);
    expect(withNote.getAttribute("title")).toContain("2026-10-19T07:15:30Z");
    expect(withNote.getAttribute("title")).toContain("live status note");

    rerender(
      <LanguageProvider initialLang="en">
        <CaseReadTime record={{}} audit={audit} />
      </LanguageProvider>,
    );
    const fallback = screen.getByText(/Last read:/);
    expect(fallback.getAttribute("title")).toContain("2026-10-19T06:00:00Z");
    expect(fallback.getAttribute("title")).toContain("CASE_IMPORTED");
  });
});

describe("phase 4 — connection states", () => {
  beforeEach(() => {
    initializeOfflineRuntime();
  });

  it("shows the yellow not-configured card while keeping offline capabilities explicit", () => {
    en(
      <ConnectionNotice
        health={{
          executionMode: "REPLAY",
          networkAccess: "NONE",
          note: "PayPal credentials are not configured",
          source: "health",
        }}
        onRetry={noop}
      />,
    );
    expect(screen.getByText("PayPal Sandbox not configured")).toBeInTheDocument();
    expect(screen.getByText(/DP_PAYPAL_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.getByText(/simulated replay do not require PayPal/)).toBeInTheDocument();
  });

  it("distinguishes invalid credentials from a missing permission and offers manual retry only", () => {
    const onRetry = vi.fn();
    const { rerender } = en(
      <ConnectionNotice issue={issue()} onRetry={onRetry} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Sandbox credentials invalid or expired");
    expect(screen.getByRole("alert")).toHaveTextContent(/no automatic retry/);
    expect(screen.getByRole("button", { name: "Read again" })).toBeInTheDocument();

    rerender(
      <LanguageProvider initialLang="en">
        <ConnectionNotice
          issue={issue({ kind: "permission", status: 403, code: "FORBIDDEN" })}
          onRetry={onRetry}
        />
      </LanguageProvider>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The app lacks this permission");
    expect(alert).toHaveTextContent(/retrying will not fix a configuration problem/);
  });

  it("shows Retry-After seconds for a 429 instead of retrying in the background", () => {
    en(
      <ConnectionNotice
        issue={issue({
          kind: "rate_limited",
          status: 429,
          code: "RATE_LIMITED",
          retryAfterSeconds: 30,
        })}
        onRetry={noop}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests");
    expect(screen.getByRole("alert")).toHaveTextContent("Retry-After: 30s");
  });

  it("reads Retry-After from a 429 response and classifies 5xx as unavailable", async () => {
    initializeHttpRuntime();
    const rateLimited = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname.replace("/api/v1", "");
      if (path === "/health") {
        return new Response(JSON.stringify({ execution_mode: "REPLAY", network_access: "NONE" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow down" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "42" },
      });
    }) as unknown as typeof fetch;

    const facade = createHttpFacade({ baseUrl: "http://dp.test/api/v1", fetch: rateLimited });
    await expect(facade.refresh()).rejects.toThrow();
    expect(getRuntime().issue?.kind).toBe("rate_limited");
    expect(getRuntime().issue?.retryAfterSeconds).toBe(42);

    initializeHttpRuntime();
    const unavailable = createHttpFacade({
      baseUrl: "http://dp.test/api/v1",
      fetch: (async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname.replace("/api/v1", "");
        if (path === "/health") {
          return new Response(JSON.stringify({ execution_mode: "REPLAY", network_access: "NONE" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ error: { code: "REMOTE_UNAVAILABLE", message: "sandbox down" } }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch,
    });

    await expect(unavailable.refresh()).rejects.toThrow();
    expect(getRuntime().issue?.kind).toBe("remote_unavailable");
    expect(getRuntime().issue?.status).toBe(503);
  });

  it("keeps a successful empty /cases result distinct from a failed load", async () => {
    initializeHttpRuntime();
    const fetchMock = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname.replace("/api/v1", "");
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (path === "/health") {
        return json({ execution_mode: "REPLAY", network_access: "PAYPAL_SANDBOX_READ_ONLY", note: "" });
      }
      if (path === "/cases") return json([]);
      if (path === "/approvals") return json([]);
      return json({ error: { code: "NOT_FOUND", message: path } }, 404);
    }) as unknown as typeof fetch;

    const facade = createHttpFacade({ baseUrl: "http://dp.test/api/v1", fetch: fetchMock });
    await facade.refresh();

    const runtime = getRuntime();
    expect(runtime.casesLoaded).toBe(true);
    expect(runtime.issue).toBeUndefined();
    expect(runtime.health?.networkAccess).toBe("PAYPAL_SANDBOX_READ_ONLY");

    // A 401 on /cases must become a credential issue, not an empty workspace.
    initializeHttpRuntime();
    const failing = createHttpFacade({
      baseUrl: "http://dp.test/api/v1",
      fetch: (async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname.replace("/api/v1", "");
        if (path === "/health") {
          return new Response(JSON.stringify({ execution_mode: "REPLAY", network_access: "NONE" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "bad key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    await expect(failing.refresh()).rejects.toThrow();
    expect(getRuntime().issue?.kind).toBe("credentials");
    expect(getRuntime().casesLoaded).toBe(false);
  });
});

describe("phase 4 — execution vs verification", () => {
  it("renders LIVE request and GET verification as two blocks with no replay wording", () => {
    const { container } = en(<ExecutionRecordPanel execution={execution()} />);
    expect(screen.getByText("Execution request")).toBeInTheDocument();
    expect(screen.getByText("Remote verification")).toBeInTheDocument();
    expect(screen.getByText("One Sandbox request was sent")).toBeInTheDocument();
    expect(screen.getByText("LIVE_GET")).toBeInTheDocument();
    expect(screen.getByText("UNDER_REVIEW")).toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toContain("replay");
  });

  it("never claims PayPal executed anything for a simulated attempt", () => {
    en(
      <ExecutionRecordPanel
        execution={execution({
          executionMode: "REPLAY",
          simulated: true,
          result: "REPLAYED",
          verification: { basis: "FIXTURE_SNAPSHOT", confirmed: true },
        })}
      />,
    );
    expect(screen.getByText("One simulated attempt recorded (not a PayPal request)")).toBeInTheDocument();
    expect(screen.queryByText(/PayPal executed/i)).not.toBeInTheDocument();
  });

  it("marks UNVERIFIED / confirmed=false as result unknown with no auto-retry", () => {
    en(
      <ExecutionRecordPanel
        execution={execution({
          result: "UNVERIFIED",
          verification: {
            basis: "LIVE_GET",
            confirmed: false,
            uncertainReason: "GET timed out after the request",
          },
        })}
      />,
    );
    expect(screen.getByText("Result unknown")).toBeInTheDocument();
    expect(screen.getByText(/No automatic retry; verify the remote state manually/)).toBeInTheDocument();
    expect(screen.getByText(/GET timed out after the request/)).toBeInTheDocument();
  });

  it("maps EXECUTION_ATTEMPT / VERIFIED / UNKNOWN into the ledger and bilingual labels", () => {
    const base = {
      case_id: "C-1",
      actor_type: "SYSTEM" as const,
      actor_id: "sandbox-gateway",
      created_at: "2026-10-19T08:00:00Z",
    };
    const attempt = mapAuditEvent({
      ...base,
      event_id: "E-1",
      event_type: "EXECUTION_ATTEMPT",
      payload: { approval_id: "APR-P-1", execution_mode: "LIVE", simulated: false, request_id: "REQ-1" },
    } satisfies WireAuditEvent);
    const verified = mapAuditEvent({
      ...base,
      event_id: "E-2",
      event_type: "EXECUTION_VERIFIED",
      payload: { confirmed: true, http_status: 200, remote_status: "UNDER_REVIEW" },
    } satisfies WireAuditEvent);
    const unknown = mapAuditEvent({
      ...base,
      event_id: "E-3",
      event_type: "EXECUTION_UNKNOWN",
      payload: { reason: "timeout", next_action: "HUMAN_REVIEW" },
    } satisfies WireAuditEvent);
    const unconfirmed = mapAuditEvent({
      ...base,
      event_id: "E-4",
      event_type: "EXECUTION_VERIFIED",
      payload: { confirmed: false },
    } satisfies WireAuditEvent);

    expect(attempt.action).toBe("EXECUTION_ATTEMPT");
    expect(attempt.simulated).toBe(false);
    expect(verified.action).toBe("EXECUTION_VERIFIED");
    expect(verified.summaryKey).toBe("auditEvent.EXECUTION_VERIFIED.summary");
    expect(unknown.action).toBe("EXECUTION_UNKNOWN");
    expect(unknown.summaryKey).toBe("auditEvent.EXECUTION_UNKNOWN.summary");

    const proposal = {
      proposalId: "P-1",
      caseId: "C-1",
      state: "APPROVED",
    } as ActionProposal;

    expect(executionStateOf(proposal, [attempt])).toBe("UNVERIFIED");
    expect(executionStateOf(proposal, [attempt, verified])).toBe("VERIFIED");
    expect(executionStateOf(proposal, [attempt, unconfirmed])).toBe("UNVERIFIED");
    expect(executionStateOf(proposal, [attempt, unknown])).toBe("UNVERIFIED");

    zh(<AuditTimeline events={[attempt, verified, unknown]} />);
    expect(screen.getByText("已记录执行请求（单次尝试）")).toBeInTheDocument();
    expect(screen.getByText("远端回查已确认结果")).toBeInTheDocument();
    expect(screen.getByText("执行结果未知 — 需人工核对")).toBeInTheDocument();
    // The technical event names stay visible as secondary labels.
    expect(screen.getByText("EXECUTION_ATTEMPT")).toBeInTheDocument();
    expect(screen.getByText("EXECUTION_VERIFIED")).toBeInTheDocument();
    expect(screen.getByText("EXECUTION_UNKNOWN")).toBeInTheDocument();
  });
});

describe("phase 4 — validator basis", () => {
  it("labels LIVE_HATEOAS and FIXTURE_SNAPSHOT without upgrading a snapshot", () => {
    const { rerender } = en(
      <PolicyChecks
        decision="PASS"
        summary="ok"
        checks={[
          {
            id: "V3",
            label: "HATEOAS permission",
            status: "PASS",
            detail: "link present",
            basis: "LIVE_HATEOAS",
          },
        ]}
        defaultOpen
      />,
    );
    expect(screen.getByText("Based on the current remote response")).toBeInTheDocument();

    rerender(
      <LanguageProvider initialLang="en">
        <PolicyChecks
          decision="PASS"
          summary="ok"
          checks={[
            {
              id: "V3",
              label: "HATEOAS permission",
              status: "PASS",
              detail: "link present",
              basis: "FIXTURE_SNAPSHOT",
            },
          ]}
          defaultOpen
        />
      </LanguageProvider>,
    );
    expect(screen.getByText("Based on the frozen snapshot")).toBeInTheDocument();
    expect(screen.queryByText("Based on the current remote response")).not.toBeInTheDocument();
  });
});
