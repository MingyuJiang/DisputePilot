/**
 * Read-time provenance and footer wording.
 *
 * A successful `/cases` call is not automatically a PayPal read: with Sandbox
 * credentials missing the backend serves the local fixture bundle. The sidebar
 * must not turn the client clock into a "last successful read", and the footer
 * must match the mode badge (`PAYPAL_SANDBOX_WRITE_ENABLED` only = controllable
 * execution).
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { LanguageProvider, type Lang } from "../src/i18n";
import { RoleProvider } from "../src/hooks/useRole";
import { SidebarContent } from "../src/components/layout/Sidebar";
import { Topbar } from "../src/components/layout/Topbar";
import {
  getRuntime,
  initializeHttpRuntime,
  initializeOfflineRuntime,
  markCasesLoaded,
  setRuntimeForTest,
  type RuntimeHealth,
} from "../src/api/runtime";
import { extractLastSuccessfulRead } from "../src/lib/sandbox";

const NOW = "2026-10-19T10:35:56Z";
const BACKEND_READ = "2026-10-19T09:12:33Z";

const health = (overrides: Partial<RuntimeHealth> = {}): RuntimeHealth => ({
  executionMode: "REPLAY",
  networkAccess: "PAYPAL_SANDBOX_READ_ONLY",
  note: "PayPal sandbox reachable; credentials not configured",
  source: "health",
  ...overrides,
});

const renderTopbar = (lang: Lang = "en") =>
  render(
    <LanguageProvider initialLang={lang}>
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    </LanguageProvider>,
  );

const renderSidebar = (lang: Lang = "en") =>
  render(
    <LanguageProvider initialLang={lang}>
      <RoleProvider>
        <MemoryRouter>
          <SidebarContent />
        </MemoryRouter>
      </RoleProvider>
    </LanguageProvider>,
  );

describe("read-time provenance", () => {
  beforeEach(() => {
    initializeOfflineRuntime();
  });

  it("does not claim a remote read when sandbox credentials are missing", () => {
    initializeHttpRuntime();
    setRuntimeForTest({ health: health() });

    markCasesLoaded(NOW);

    expect(getRuntime().lastSuccessReadAt).toBeUndefined();
    expect(getRuntime().lastReadKind).toBeUndefined();

    renderSidebar("en");
    // v2.1: no remote read means no timestamp at all — never the client clock.
    expect(screen.queryByText(/Last successful read/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Last refresh/)).not.toBeInTheDocument();
  });

  it("uses the backend-reported last_successful_read timestamp", () => {
    initializeHttpRuntime();
    setRuntimeForTest({
      health: health({ note: `sandbox ok · last_successful_read=${BACKEND_READ}` }),
    });

    markCasesLoaded(NOW);

    expect(getRuntime().lastSuccessReadAt).toBe(BACKEND_READ);
    expect(getRuntime().lastReadKind).toBe("remote");

    renderSidebar("en");
    const label = screen.getByText(/Last successful read:/);
    expect(label).toHaveAttribute("title", BACKEND_READ);
    expect(screen.queryByText("No remote data read yet")).not.toBeInTheDocument();
  });

  it("labels the offline fixture timestamp as a refresh, not a remote read", () => {
    setRuntimeForTest({
      health: {
        executionMode: "REPLAY",
        networkAccess: "NONE",
        note: "Local fixture store. No PayPal API is configured.",
        source: "local",
      },
    });

    markCasesLoaded(NOW);

    expect(getRuntime().lastSuccessReadAt).toBe(NOW);
    expect(getRuntime().lastReadKind).toBe("local");

    renderSidebar("en");
    expect(screen.getByText(/Last refresh:/)).toBeInTheDocument();
    expect(screen.queryByText(/Last successful read/)).not.toBeInTheDocument();
  });

  it("follows network_access in the single topbar indicator, never claiming execution by default", () => {
    initializeHttpRuntime();
    setRuntimeForTest({ health: health() });
    const { unmount } = renderTopbar("en");

    // v2.1: one environment indicator, driven by /health.
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    expect(screen.queryByText(/execution enabled/)).not.toBeInTheDocument();
    unmount();

    initializeHttpRuntime();
    setRuntimeForTest({
      health: health({ executionMode: "LIVE", networkAccess: "PAYPAL_SANDBOX_WRITE_ENABLED" }),
    });
    renderTopbar("zh-CN");

    expect(screen.getByText(/可执行/)).toBeInTheDocument();
    expect(screen.queryByText(/只读/)).not.toBeInTheDocument();
  });

  it("only parses ISO timestamps out of the health note", () => {
    expect(extractLastSuccessfulRead(`last_successful_read=${BACKEND_READ}`)).toBe(BACKEND_READ);
    expect(extractLastSuccessfulRead("last_successful_read=never")).toBeUndefined();
    expect(extractLastSuccessfulRead("credentials not configured")).toBeUndefined();
    expect(extractLastSuccessfulRead(undefined)).toBeUndefined();
  });
});
