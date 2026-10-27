/**
 * Phase 4 — Sandbox mode, provenance, read time and connection surfaces.
 *
 * All values come from `/health`, `/cases` or the audit trail. When the
 * backend reports nothing the badge says "not reported" rather than inferring
 * a mode from the data.
 */

import { AlertTriangle, Clock, FlaskConical, HelpCircle, RefreshCw, ShieldCheck, ShieldX, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import type { AuditEvent, CaseRecord, Provenance } from "../../api/types";
import {
  isCredentialsNotConfigured,
  type ConnectionIssue,
  type RuntimeHealth,
} from "../../api/runtime";
import { serviceHandle } from "../../api";
import { useRuntime } from "../../hooks/useRuntime";
import { formatClock } from "../../lib/format";
import { latestCaseReadTime } from "../../lib/sandbox";
import { Badge, type BadgeTone } from "../ui/Badge";
import { useI18n, type MessageKey } from "../../i18n";

/* ------------------------------------------------------------------ *
 * Mode
 * ------------------------------------------------------------------ */

export type SandboxModeKind =
  | "offline"
  | "read_only"
  | "executable"
  | "live_unconfirmed"
  | "inconsistent"
  | "unknown";

export const sandboxModeOf = (health?: RuntimeHealth): SandboxModeKind => {
  const mode = (health?.executionMode ?? "").toUpperCase();
  const access = (health?.networkAccess ?? "").toUpperCase();
  if (!health || (!mode && !access)) return "unknown";
  if (mode === "REPLAY" && (!access || access === "NONE")) return "offline";
  if (mode === "REPLAY" && access === "PAYPAL_SANDBOX_READ_ONLY") return "read_only";
  if (mode === "LIVE" && access === "PAYPAL_SANDBOX_WRITE_ENABLED") return "executable";
  if (mode === "LIVE") return "live_unconfirmed";
  return "inconsistent";
};

const MODE_META: Record<SandboxModeKind, { key: MessageKey; tone: BadgeTone; icon: ReactNode }> = {
  offline: { key: "mode.replayNone", tone: "warn", icon: <FlaskConical size={11} aria-hidden /> },
  read_only: { key: "mode.sandboxReadOnly", tone: "info", icon: <ShieldCheck size={11} aria-hidden /> },
  executable: { key: "mode.sandboxExecutable", tone: "stop", icon: <ShieldX size={11} aria-hidden /> },
  live_unconfirmed: { key: "mode.liveUnconfirmed", tone: "warn", icon: <AlertTriangle size={11} aria-hidden /> },
  inconsistent: { key: "mode.liveUnconfirmed", tone: "warn", icon: <AlertTriangle size={11} aria-hidden /> },
  unknown: { key: "mode.notReported", tone: "neutral", icon: <HelpCircle size={11} aria-hidden /> },
};

export function ModeBadge({ health }: { health?: RuntimeHealth }) {
  const runtime = useRuntime();
  const { t } = useI18n();
  const value = health ?? runtime.health;
  const kind = sandboxModeOf(value);
  const meta = MODE_META[kind];
  const title = value
    ? t("mode.title", {
        mode: value.executionMode || t("context.notReported"),
        access: value.networkAccess || t("context.notReported"),
      })
    : t("mode.notReported");

  return (
    <span title={title}>
      <Badge tone={meta.tone} dot>
        {meta.icon}
        {t(meta.key)}
      </Badge>
    </span>
  );
}

/** Copy for the sidebar / topbar notice, derived from the same health value. */
export const modeNoticeKey = (kind: SandboxModeKind): MessageKey => {
  if (kind === "read_only") return "nav.sandboxReadOnlyNote";
  if (kind === "executable") return "nav.sandboxExecutableNote";
  if (kind === "unknown" || kind === "inconsistent" || kind === "live_unconfirmed") {
    return "nav.modeUnknownNote";
  }
  return "nav.offlineNote";
};

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

const PROVENANCE_META: Record<string, { key: MessageKey; tone: BadgeTone }> = {
  PAYPAL_API_OBSERVED: { key: "provenance.PAYPAL_API_OBSERVED", tone: "pass" },
  SCENARIO_DEFINED: { key: "provenance.SCENARIO_DEFINED", tone: "scenario" },
  HUMAN_OBSERVED_SANDBOX_UI: { key: "provenance.HUMAN_OBSERVED_SANDBOX_UI", tone: "info" },
  AI_INFERRED: { key: "provenance.AI_INFERRED", tone: "infer" },
  SIMULATED_COMPOSITE: { key: "provenance.SIMULATED_COMPOSITE", tone: "neutral" },
};

export function ProvenanceBadge({ provenance }: { provenance?: Provenance | string }) {
  const { t } = useI18n();
  const meta = provenance ? PROVENANCE_META[provenance] : undefined;
  return (
    <Badge tone={meta?.tone ?? "neutral"} dot>
      {t(meta?.key ?? "provenance.unknown")}
    </Badge>
  );
}

/* ------------------------------------------------------------------ *
 * Last read
 * ------------------------------------------------------------------ */

export function CaseReadTime({
  record,
  audit,
  className = "",
}: {
  record: Pick<CaseRecord, "liveStatusNote">;
  audit: AuditEvent[];
  className?: string;
}) {
  const { t } = useI18n();
  const read = latestCaseReadTime(record, audit);
  if (!read.at) {
    return <span className={className}>{t("readTime.none")}</span>;
  }
  const sourceKey: MessageKey =
    read.source === "live_status_note" ? "readTime.fromNote" : "readTime.fromImport";
  return (
    <span className={className} title={`${read.at} · ${t(sourceKey)}`}>
      {t("readTime.label", { time: formatClock(read.at) })}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Connection notice
 * ------------------------------------------------------------------ */

const ISSUE_COPY: Record<
  ConnectionIssue["kind"],
  { title: MessageKey; body: MessageKey; tone: "warn" | "stop"; icon: ReactNode }
> = {
  credentials: {
    title: "connection.credentials.title",
    body: "connection.credentials.body",
    tone: "stop",
    icon: <ShieldX size={13} aria-hidden />,
  },
  permission: {
    title: "connection.permission.title",
    body: "connection.permission.body",
    tone: "stop",
    icon: <ShieldX size={13} aria-hidden />,
  },
  rate_limited: {
    title: "connection.rate.title",
    body: "connection.rate.body",
    tone: "warn",
    icon: <Clock size={13} aria-hidden />,
  },
  remote_unavailable: {
    title: "connection.unavailable.title",
    body: "connection.unavailable.body",
    tone: "stop",
    icon: <WifiOff size={13} aria-hidden />,
  },
  network: {
    title: "connection.network.title",
    body: "connection.network.body",
    tone: "stop",
    icon: <WifiOff size={13} aria-hidden />,
  },
  remote_not_found: {
    title: "connection.notFound.title",
    body: "connection.notFound.body",
    tone: "warn",
    icon: <AlertTriangle size={13} aria-hidden />,
  },
  protocol: {
    title: "connection.protocol.title",
    body: "connection.protocol.body",
    tone: "warn",
    icon: <AlertTriangle size={13} aria-hidden />,
  },
  unknown: {
    title: "connection.unknown.title",
    body: "connection.unknown.body",
    tone: "warn",
    icon: <AlertTriangle size={13} aria-hidden />,
  },
};

export function ConnectionNotice({
  health,
  issue,
  onRetry,
}: {
  health?: RuntimeHealth;
  issue?: ConnectionIssue;
  onRetry?: () => void;
}) {
  const runtime = useRuntime();
  const { t } = useI18n();
  const currentHealth = health ?? runtime.health;
  const currentIssue = issue ?? runtime.issue;

  const retry = onRetry ?? (() => {
    if (serviceHandle.mode !== "http") return;
    void serviceHandle.refresh().catch(() => undefined);
  });

  // Missing credentials: yellow setup card, not a red outage.
  if (currentHealth && isCredentialsNotConfigured(currentHealth.note) && currentIssue?.kind !== "credentials") {
    return (
      <div className="border-t border-warn-line/70 bg-warn-bg/70 px-4 py-2 lg:px-6" role="status">
        <div className="flex items-start gap-2 text-base leading-4 text-ink">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-warn">{t("connection.unconfigured.title")}</span>{" "}
            <span>{t("connection.unconfigured.body")}</span>{" "}
            <span className="text-ink-muted">{t("connection.unconfigured.offline")}</span>
          </div>
          <button
            type="button"
            onClick={retry}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-warn-line bg-card px-1.5 py-0.5 text-xs font-medium text-warn hover:bg-warn-bg"
          >
            <RefreshCw size={10} aria-hidden />
            {runtime.status === "loading" ? t("connection.retrying") : t("connection.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!currentIssue) return null;

  const copy = ISSUE_COPY[currentIssue.kind];
  const toneClass =
    copy.tone === "stop"
      ? "border-stop-line/70 bg-stop-bg/70 text-ink"
      : "border-warn-line/70 bg-warn-bg/70 text-ink";
  const titleClass = copy.tone === "stop" ? "text-stop" : "text-warn";
  const bodyParams: Record<string, string | number> = {
    status: currentIssue.status || "—",
  };
  if (currentIssue.kind === "rate_limited") {
    if (currentIssue.retryAfterSeconds !== undefined) {
      bodyParams.seconds = currentIssue.retryAfterSeconds;
    }
  }

  const bodyKey: MessageKey =
    currentIssue.kind === "rate_limited" && currentIssue.retryAfterSeconds === undefined
      ? "connection.rate.bodyNoWait"
      : copy.body;

  return (
    <div className={`border-t px-4 py-2 lg:px-6 ${toneClass}`} role="alert">
      <div className="flex items-start gap-2 text-base leading-4">
        <span className={`mt-0.5 shrink-0 ${titleClass}`}>{copy.icon}</span>
        <div className="min-w-0 flex-1">
          <span className={`font-semibold ${titleClass}`}>{t(copy.title)}</span>{" "}
          <span>{t(bodyKey, bodyParams)}</span>
          {runtime.casesLoaded && runtime.lastSuccessReadAt ? (
            <span className="text-ink-muted"> {t("connection.stale")}</span>
          ) : null}
          {currentIssue.message ? (
            <div className="mt-0.5 break-words font-mono text-xs text-ink-faint">
              {currentIssue.code} · {currentIssue.message}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={retry}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-card px-1.5 py-0.5 text-xs font-medium text-ink hover:bg-hover"
        >
          <RefreshCw size={10} aria-hidden />
          {runtime.status === "loading" ? t("connection.retrying") : t("connection.retry")}
        </button>
      </div>
    </div>
  );
}

/** Small inline strip used by pages that must not replace a failure with an empty list. */
export function LoadFailureNotice({ onRetry }: { onRetry?: () => void }) {
  const runtime = useRuntime();
  const { t } = useI18n();
  if (!runtime.issue || runtime.casesLoaded) return null;
  return (
    <div className="mt-4 rounded-lg border border-stop-line bg-stop-bg/60 px-3.5 py-3" role="alert">
      <div className="flex items-start gap-2">
        <ShieldX size={14} className="mt-0.5 shrink-0 text-stop" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-stop">{t("connection.failedTitle")}</div>
          <p className="mt-0.5 text-base leading-4 text-ink">{t("connection.failedBody")}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-card px-2 py-1 text-xs font-medium text-ink hover:bg-hover"
        >
          <RefreshCw size={10} aria-hidden />
          {t("connection.retry")}
        </button>
      </div>
    </div>
  );
}
