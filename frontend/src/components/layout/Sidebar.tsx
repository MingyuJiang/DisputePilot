import { NavLink } from "react-router-dom";
import {
  CheckCircle2,
  History,
  LayoutDashboard,
  LayoutList,
  LifeBuoy,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useRuntime } from "../../hooks/useRuntime";
import { disputePilot, type ServiceMode } from "../../api";
import { isCredentialsNotConfigured } from "../../api/runtime";
import { Badge } from "../ui/Badge";
import { useI18n, type MessageKey } from "../../i18n";
import { formatClock } from "../../lib/format";

function BrandMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-navy-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 2.5 3.5 5v5.1c0 3.6 2.6 6.7 6.5 7.6 3.9-.9 6.5-4 6.5-7.6V5L10 2.5Z" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M6.9 7.9h6.2M10 6.6v6.6" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

const navBase =
  "group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600";

/**
 * Reset is a fixture-store operation. In http mode the backend DB is not
 * UI-resettable (B-3), so the control is replaced by an explanation instead of
 * a button that silently does nothing.
 */
export function ResetDemoControl({
  mode = disputePilot.mode,
  onReset,
}: {
  mode?: ServiceMode;
  onReset?: () => void;
}) {
  const { t } = useI18n();

  if (mode === "http") {
    return (
      <p className="mt-2.5 text-xs leading-5 text-ink-faint">{t("nav.resetUnavailable")}</p>
    );
  }

  return (
    <button
      type="button"
      onClick={onReset}
      className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-navy-700 hover:text-navy-800"
    >
      <RotateCcw size={11} aria-hidden />
      {t("nav.reset")}
    </button>
  );
}

/**
 * v2.1 merchant task structure. No internal roles: every item is something a
 * merchant does, not a job title. `/approvals` used to be manager-gated in the
 * UI; the merchant is the decision maker, so it is a normal workspace item
 * (the backend still enforces its own role on the decision call).
 */
const NAV_ITEMS: { to: string; labelKey: MessageKey; icon: typeof LayoutDashboard }[] = [
  { to: "/", labelKey: "nav.overview", icon: LayoutDashboard },
  { to: "/cases", labelKey: "nav.myDisputes", icon: LayoutList },
  { to: "/approvals", labelKey: "nav.needsConfirmation", icon: CheckCircle2 },
  { to: "/assistant", labelKey: "nav.assistant", icon: Sparkles },
  { to: "/audit", labelKey: "nav.activity", icon: History },
];

export function SidebarContent({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  const state = useWorkspace();
  const { t } = useI18n();
  const runtime = useRuntime();
  const pending = disputePilot.listPendingApprovals().length;

  const dotClass = runtime.issue
    ? "bg-stop"
    : runtime.status === "loading"
      ? "bg-warn"
      : "bg-pass";
  const credentialsMissing = isCredentialsNotConfigured(runtime.health?.note);
  const lastReadAt = runtime.lastSuccessReadAt;
  const lastReadKey: MessageKey =
    runtime.lastReadKind === "local" ? "connection.lastRefresh" : "connection.lastRead";
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-4 pt-4">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-[-0.01em] text-ink-strong">
              {t("app.name")}
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
              {t("app.subtitle")}
            </div>
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("topbar.closeNav")}
            className="rounded p-1.5 text-ink-muted hover:bg-hover md:hidden"
          >
            <X size={16} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="px-3">
        <div className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          {t("nav.workspace")}
        </div>
        <nav className="flex flex-col gap-0.5" aria-label={t("nav.primary")}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  [
                    navBase,
                    isActive
                      ? "bg-navy-50 font-medium text-navy-800"
                      : "text-ink hover:bg-hover hover:text-ink-strong",
                  ].join(" ")
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={[
                        "absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-r bg-navy-800",
                        isActive ? "opacity-100" : "opacity-0",
                      ].join(" ")}
                      aria-hidden
                    />
                    <Icon size={16} className="shrink-0 opacity-80" aria-hidden />
                    <span className="flex-1">{t(item.labelKey)}</span>
                    {item.to === "/cases" ? (
                      <span className="num text-2xs text-ink-faint">{state.cases.length}</span>
                    ) : null}
                    {item.to === "/approvals" && pending > 0 ? (
                      <Badge tone="warn">{pending}</Badge>
                    ) : null}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="mb-1.5 mt-4 px-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          {t("nav.help")}
        </div>
        <nav className="flex flex-col gap-0.5" aria-label={t("nav.help")}>
          <NavLink
            to="/demo"
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                navBase,
                isActive
                  ? "bg-navy-50 font-medium text-navy-800"
                  : "text-ink hover:bg-hover hover:text-ink-strong",
              ].join(" ")
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={[
                    "absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-r bg-navy-800",
                    isActive ? "opacity-100" : "opacity-0",
                  ].join(" ")}
                  aria-hidden
                />
                <LifeBuoy size={16} className="shrink-0 opacity-80" aria-hidden />
                <span className="flex-1">{t("nav.guidedDemo")}</span>
              </>
            )}
          </NavLink>
        </nav>
      </div>

      <div className="mt-auto p-3">
        {/* v2.1: the topbar badge is the single environment indicator. This
            footer only keeps the demo controls and the last-read time, so the
            same state is not repeated four times on one screen. */}
        <div className="rounded-lg border border-line bg-subtle p-3">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-muted">
              {t("nav.demoControls")}
            </span>
          </div>
          {lastReadAt ? (
            <p className="num mt-1.5 text-xs leading-5 text-ink-faint" title={lastReadAt}>
              {t(lastReadKey, { time: formatClock(lastReadAt) })}
            </p>
          ) : null}
          {credentialsMissing ? (
            <p className="mt-1.5 text-xs leading-5 text-ink-faint">
              {t("connection.unconfigured.body")}
            </p>
          ) : null}
          <ResetDemoControl
            onReset={() => {
              disputePilot.reset();
              onNavigate?.();
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-[236px] shrink-0 border-r border-line bg-card lg:block">
      <div className="sticky top-0 h-screen">
        <SidebarContent />
      </div>
    </aside>
  );
}
