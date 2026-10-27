import { useState } from "react";
import type { ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Info,
  ShieldX,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { AuditEvent, AuditOutcome } from "../../api/types";
import { formatDateTime } from "../../lib/format";
import { auditDetail, auditSummary } from "../../lib/auditText";
import { OutcomeBadge } from "./Badges";
import { Badge } from "../ui/Badge";
import { useI18n } from "../../i18n";

const OUTCOME_STYLE: Record<AuditOutcome, { ring: string; icon: ReactNode }> = {
  SUCCEEDED: { ring: "border-pass-line bg-pass-bg text-pass", icon: <CheckCircle2 size={11} aria-hidden /> },
  FAILED: { ring: "border-stop-line bg-stop-bg text-stop", icon: <XCircle size={11} aria-hidden /> },
  BLOCKED: { ring: "border-warn-line bg-warn-bg text-warn", icon: <ShieldX size={11} aria-hidden /> },
  EXPIRED: { ring: "border-line-strong bg-sunken text-ink-muted", icon: <Clock size={11} aria-hidden /> },
  DUPLICATE_SUPPRESSED: { ring: "border-info-line bg-info-bg text-info", icon: <Copy size={11} aria-hidden /> },
  INFO: { ring: "border-line bg-subtle text-ink-faint", icon: <Circle size={7} aria-hidden /> },
};

export function AuditTimeline({
  events,
  showCase = false,
  compact = false,
}: {
  events: AuditEvent[];
  showCase?: boolean;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const { t } = useI18n();

  const toggle = (id: string) =>
    setExpanded((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  if (events.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line-strong bg-subtle px-3 py-4 text-xs text-ink-muted">
        {t("audit.empty")}
      </p>
    );
  }

  return (
    <ol className="relative pl-6">
      <span className="absolute left-[10px] top-2 bottom-3 w-px bg-line" aria-hidden />
      {events.map((event) => {
        const style = OUTCOME_STYLE[event.outcome];
        const isOpen = expanded.includes(event.eventId);
        const sandboxEvent =
          event.simulated === false ||
          event.executionMode === "LIVE" ||
          (event.backendEventType?.startsWith("EXECUTION_") === true &&
            event.backendEventType !== "EXECUTION_REPLAYED");
        return (
          <li key={event.eventId} className="relative pb-3.5 last:pb-0">
            <span
              className={[
                "absolute -left-6 top-0.5 flex h-[21px] w-[21px] items-center justify-center rounded-full border",
                style.ring,
              ].join(" ")}
              aria-hidden
            >
              {style.icon}
            </span>
            <button
              type="button"
              onClick={() => toggle(event.eventId)}
              aria-expanded={isOpen}
              className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-subtle"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {showCase ? (
                      <Link
                        to={`/cases/${event.caseId}`}
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                        className="num rounded border border-line bg-card px-1 py-px text-xs font-semibold text-ink hover:border-line-strong"
                      >
                        {event.caseId}
                      </Link>
                    ) : null}
                    <span className="text-base font-medium text-ink-strong">
                      {auditSummary(event, t)}
                    </span>
                    {!compact ? <OutcomeBadge outcome={event.outcome} /> : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                    <span className="num">{formatDateTime(event.at)}</span>
                    <span aria-hidden>·</span>
                    <span className="font-mono text-xs">{event.action}</span>
                    <span aria-hidden>·</span>
                    <span>{event.actor.name}</span>
                    <Badge tone="neutral" uppercase>
                      {event.actor.type}
                    </Badge>
                  </div>
                </div>
                <span className="mt-1 shrink-0 text-ink-faint">
                  {isOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                </span>
              </div>
            </button>

            {isOpen ? (
              <div className="ml-2 mt-1 rounded-md border border-line bg-subtle px-3 py-2.5">
                <p className="text-base leading-5 text-ink">{auditDetail(event, t)}</p>

                {event.fields.length > 0 ? (
                  <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {event.fields.map((field) => (
                      <div key={field.label}>
                        <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
                          {field.label}
                        </dt>
                        <dd className="mt-0.5 break-words text-base leading-4 text-ink">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {event.revalidation ? (
                  <div className="mt-2.5 rounded border border-line bg-card px-2.5 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
                        {t("audit.revalidation")}
                      </span>
                      <Badge tone={event.revalidation.status === "PASS" ? "pass" : "stop"}>
                        {event.revalidation.status}
                      </Badge>
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {event.revalidation.checks.map((check) => (
                        <li key={check.label} className="flex items-start gap-1.5 text-base leading-4">
                          {check.status === "INFO" ? (
                            <Info
                              size={11}
                              className="mt-0.5 shrink-0 text-ink-faint"
                              aria-hidden
                            />
                          ) : check.status === "PASS" ? (
                            <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-pass" aria-hidden />
                          ) : (
                            <XCircle size={11} className="mt-0.5 shrink-0 text-stop" aria-hidden />
                          )}
                          <span className="text-ink">
                            {check.label}
                            <span className="text-ink-faint"> — {check.note}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  <span className="font-mono">{event.eventId}</span>
                  {event.httpStatus ? <span>HTTP {event.httpStatus}</span> : null}
                  {event.requestId ? <span className="font-mono break-all">{event.requestId}</span> : null}
                  <span>{t(sandboxEvent ? "audit.sandboxEvent" : "audit.localSimulation")}</span>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
