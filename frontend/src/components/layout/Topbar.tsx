import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FlaskConical, Menu, PlayCircle, X } from "lucide-react";
import { RoleSwitcher } from "./RoleSwitcher";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { SidebarContent } from "./Sidebar";
import { useMerchant } from "../../hooks/useMerchant";
import { useRuntime } from "../../hooks/useRuntime";
import { useI18n, type MessageKey } from "../../i18n";
import { ConnectionNotice, ModeBadge, sandboxModeOf } from "../domain/SandboxStatus";

const CRUMB_KEYS: Record<string, MessageKey> = {
  overview: "topbar.crumbOverview",
  cases: "topbar.crumbCases",
  approvals: "topbar.crumbApprovals",
  audit: "topbar.crumbAudit",
  demo: "topbar.crumbDemo",
};

export function Topbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { merchant } = useMerchant();
  const { t } = useI18n();
  const runtime = useRuntime();
  const mode = sandboxModeOf(runtime.health);
  const sandbox = mode !== "offline";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(true);

  const sandboxNoticeKey: MessageKey =
    mode === "executable"
      ? "topbar.sandboxNoticeExecutable"
      : mode === "read_only"
        ? "topbar.sandboxNoticeReadOnly"
        : "nav.modeUnknownNote";

  const segments = location.pathname.split("/").filter(Boolean);
  const crumbs =
    segments.length === 0
      ? [{ label: t("topbar.crumbOverview"), to: "/" }]
      : segments.map((segment, index) => ({
          label: CRUMB_KEYS[segment] ? t(CRUMB_KEYS[segment]) : segment,
          to: `/${segments.slice(0, index + 1).join("/")}`,
        }));

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur">
        <div className="flex h-14 items-center gap-2 sm:gap-3 px-3 sm:px-4 lg:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label={t("topbar.openNav")}
            className="shrink-0 rounded-md p-1.5 text-ink-muted hover:bg-hover lg:hidden"
          >
            <Menu size={18} aria-hidden />
          </button>

          <nav
            aria-label={t("topbar.breadcrumb")}
            className="hidden min-w-0 flex-1 items-center gap-1.5 text-xs lg:flex"
          >
            <span className="hidden shrink-0 text-ink-faint 2xl:inline">{t("app.subtitle")}</span>
            {crumbs.map((crumb, index) => (
              <span key={crumb.to} className="flex min-w-0 shrink items-center gap-1.5">
                <span className="hidden shrink-0 text-ink-faint sm:inline" aria-hidden>
                  /
                </span>
                {index === crumbs.length - 1 ? (
                  <span className="max-w-[140px] truncate font-medium text-ink-strong lg:max-w-[220px] 2xl:max-w-none">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    to={crumb.to}
                    className="max-w-[120px] shrink-0 truncate text-ink-muted hover:text-ink"
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap sm:gap-2.5">
            <button
              type="button"
              onClick={() => navigate("/demo")}
              aria-label={t("topbar.demoGuide")}
              className="hidden shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-hover md:inline-flex"
            >
              <PlayCircle size={13} aria-hidden />
              <span className="hidden xl:inline">{t("topbar.demoGuide")}</span>
            </button>

            {/* The single environment indicator for the whole product. */}
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <ModeBadge health={runtime.health} />
            </span>

            <div className="hidden h-6 w-px shrink-0 bg-line sm:block" aria-hidden />

            <LanguageSwitcher />

            <RoleSwitcher />

            <div className="flex shrink-0 items-center gap-2 pl-0.5">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white"
                aria-hidden
              >
                {merchant.initials}
              </div>
              <div className="hidden leading-tight xl:block">
                <div className="text-xs font-medium text-ink-strong">
                  {t(merchant.nameKey)}
                </div>
                <div className="text-xs text-ink-faint">{t("merchant.title")}</div>
              </div>
            </div>
          </div>
        </div>

        {bannerOpen ? (
          <div className="flex items-start gap-2 border-t border-warn-line/70 bg-warn-bg/60 px-4 py-1.5 text-xs leading-5 text-warn lg:px-6">
            <FlaskConical size={12} className="mt-0.5 shrink-0" aria-hidden />
            <p className="flex-1">
              <span className="font-semibold">
                {t(sandbox ? "topbar.sandboxNoticeLabel" : "topbar.demoNoticeLabel")}
              </span>{" "}
              {t(sandbox ? sandboxNoticeKey : "topbar.demoNotice")}
            </p>
            <button
              type="button"
              onClick={() => setBannerOpen(false)}
              aria-label={t("topbar.dismissNotice")}
              className="rounded p-0.5 hover:bg-warn-line/40"
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        ) : null}

        <ConnectionNotice health={runtime.health} issue={runtime.issue} />
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t("topbar.closeNav")}
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-navy-950/30"
          />
          <div className="relative h-full w-[268px] border-r border-line bg-card shadow-overlay animate-slide-in">
            <SidebarContent onNavigate={() => setMobileOpen(false)} onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {t("merchant.identityHint")}
      </span>
    </>
  );
}
