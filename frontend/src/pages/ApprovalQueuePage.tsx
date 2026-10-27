/**
 * Approvals queue (FRONTEND_REDESIGN_PLAN §3.5).
 *
 * Manager view only. Priority, validator, risk, age and approval state are one
 * row per proposal; the technical V1–V12/V13–V18 checks stay on the detail
 * page. The row layout is a responsive list (not a fixed-width table), so the
 * queue cannot introduce horizontal scrolling at 1280 or 800 px.
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  FileWarning,
  Search,
  ShieldCheck,
  Stamp,
  X,
} from "lucide-react";
import { PageHeader } from "../components/domain/PageHeader";
import { ManagerOnly } from "../components/domain/ManagerOnly";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { StatusBadge } from "../components/ui/StatusBadge";
import { SourceBadge } from "../components/ui/SourceBadge";
import { RiskBadge } from "../components/domain/Badges";
import { useWorkspace } from "../hooks/useWorkspace";
import { useRuntime } from "../hooks/useRuntime";
import { serviceHandle } from "../api";
import {
  createApprovalOriginApi,
  type ApprovalSubmissionOrigin,
} from "../api/approvalOrigin";
import type { RiskLevel } from "../api/types";
import { formatDateTime, formatMoney, formatWaiting } from "../lib/format";
import {
  buildApprovalQueue,
  approvalActionOptions,
  filterApprovalQueue,
  SNAPSHOT_FRESHNESS_MINUTES,
  type ApprovalQueueRow,
} from "../lib/approvalQueue";
import { NOT_REPORTED_SOURCE, sourceOf } from "../lib/statusModel";
import { actionLabel, useI18n, type MessageKey } from "../i18n";

const SELECT_CLASS =
  "h-9 rounded-md border border-line bg-card px-2 text-base text-ink outline-none transition-colors hover:border-line-strong focus:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600";

function Kpi({
  label,
  value,
  detail,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "warn" | "stop";
  icon: ReactNode;
}) {
  const iconTone =
    tone === "warn"
      ? "text-warn bg-warn-bg border-warn-line"
      : tone === "stop"
        ? "text-stop bg-stop-bg border-stop-line"
        : "text-ink-muted bg-subtle border-line";
  return (
    <Card className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{label}</div>
        <div className={["flex h-7 w-7 items-center justify-center rounded border", iconTone].join(" ")}>
          {icon}
        </div>
      </div>
      <div className="num mt-1 text-2xl font-semibold leading-8 tracking-[-0.02em] text-ink-strong">
        {value}
      </div>
      <div className="mt-0.5 text-xs leading-5 text-ink-muted">{detail}</div>
    </Card>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="mt-0.5 min-w-0 text-base leading-6 text-ink">{children}</div>
    </div>
  );
}

function PriorityCell({ row }: { row: ApprovalQueueRow }) {
  const { t } = useI18n();
  const tone = row.priority === "urgent" ? "stop" : row.priority === "pending" ? "warn" : "neutral";
  const labelKey: MessageKey =
    row.priority === "urgent"
      ? "approvals.priority.urgent"
      : row.priority === "pending"
        ? "approvals.priority.pending"
        : "approvals.priority.decided";
  const reason =
    row.priority === "urgent"
      ? row.proposal.risk === "HIGH" || row.proposal.risk === "BLOCKED"
        ? t("approvals.priority.riskNote")
        : t("approvals.priority.expiryNote", { minutes: SNAPSHOT_FRESHNESS_MINUTES })
      : undefined;

  return (
    <div className="min-w-0">
      <Badge tone={tone} size="md">
        {t(labelKey)}
      </Badge>
      {reason ? (
        <div className="mt-1 flex items-start gap-1 text-xs leading-5 text-ink-muted">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-stop" aria-hidden />
          <span>{reason}</span>
        </div>
      ) : null}
    </div>
  );
}

type OriginState = ApprovalSubmissionOrigin | "error" | "loading";

/**
 * One short provenance hint per approval row. Never inferred from the approval
 * id: an unknown/failed lookup reads "source unavailable" rather than guessing.
 */
function OriginHint({
  state,
  t,
}: {
  state: OriginState | undefined;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (!state) return null;
  if (state === "error") {
    return <Badge tone="neutral">{t("approvals.originUnavailable")}</Badge>;
  }
  if (state === "loading") {
    return <Badge tone="neutral">{t("approvals.originLoading")}</Badge>;
  }
  if (state.source_type === "AUTOPILOT_BATCH" && state.submission_batch_id) {
    const short = state.submission_batch_id.replace(/^SUB-/, "").slice(0, 13);
    return (
      <Badge tone="info">{t("approvals.originBatch", { batch: short })}</Badge>
    );
  }
  return <Badge tone="neutral">{t("approvals.originSingle")}</Badge>;
}

export function ApprovalQueuePage() {
  const state = useWorkspace();
  const runtime = useRuntime();
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [risk, setRisk] = useState<"ALL" | RiskLevel>("ALL");
  const [action, setAction] = useState("ALL");

  // Provenance is fetched per approval from the backend; the queue never
  // derives it from cached proposal/approval shapes. The queue is built first
  // (from the workspace) so the fetch knows which approvals exist; the
  // persisted creation times then re-sort it.
  const [origins, setOrigins] = useState<Record<string, OriginState>>({});

  const baseQueue = useMemo(() => buildApprovalQueue(state, Date.now()), [state]);

  const approvalIds = useMemo(
    () =>
      baseQueue
        .map((row) => row.approval?.approvalId)
        .filter((id): id is string => Boolean(id))
        .join(","),
    [baseQueue],
  );

  useEffect(() => {
    const ids = approvalIds ? approvalIds.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    const api = createApprovalOriginApi();
    setOrigins((current) => {
      const next = { ...current };
      for (const id of ids) if (!next[id]) next[id] = "loading";
      return next;
    });
    void Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await api.getOrigin(id)] as const;
        } catch {
          return [id, "error"] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setOrigins((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
  }, [approvalIds]);

  // Persisted approval creation times (from the origin endpoint), keyed by
  // approval id. The queue sorts by these — not by proposal submit time.
  const createdTimes = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const [approvalId, origin] of Object.entries(origins)) {
      if (origin === "loading" || origin === "error") continue;
      map.set(approvalId, origin.approval_created_at);
    }
    return map;
  }, [origins]);

  const queue = useMemo(
    () => buildApprovalQueue(state, Date.now(), createdTimes),
    [state, createdTimes],
  );

  const rows = useMemo(
    () => filterApprovalQueue(queue, { action, risk, query: search }),
    [queue, action, risk, search],
  );

  const actionOptions = useMemo(() => approvalActionOptions(queue), [queue]);

  const pending = queue.filter((row) => row.pending);
  const urgent = pending.filter((row) => row.priority === "urgent").length;
  const gaps = pending.filter((row) => {
    const requested = row.case?.evidenceReadiness.requested ?? 0;
    const provided = row.case?.evidenceReadiness.provided ?? 0;
    if (requested === 0) return false;
    return provided < requested;
  }).length;
  const longest = pending.reduce<number | null>(
    (current, row) =>
      row.waitingMinutes === null ? current : Math.max(current ?? 0, row.waitingMinutes),
    null,
  );

  const resetFilters = () => {
    setSearch("");
    setRisk("ALL");
    setAction("ALL");
  };
  const activeFilters =
    (search.trim() ? 1 : 0) + (risk !== "ALL" ? 1 : 0) + (action !== "ALL" ? 1 : 0);

  const retry = () => {
    void serviceHandle.refresh().catch(() => undefined);
  };

  const dataState = !runtime.casesLoaded ? (
    runtime.issue ? (
      <ErrorState
        title={t("approvals.loadFailedTitle")}
        detail={t("approvals.loadFailedBody")}
        onRetry={retry}
      />
    ) : (
      <LoadingState />
    )
  ) : queue.length === 0 ? (
    <EmptyState title={t("approvals.emptyTitle")} body={t("approvals.emptyBody")} />
  ) : rows.length === 0 ? (
    <EmptyState
      title={t("approvals.noMatchTitle")}
      body={t("approvals.noMatchBody")}
      action={
        <Button size="sm" variant="secondary" onClick={resetFilters}>
          {t("approvals.clearFilters")}
        </Button>
      }
    />
  ) : null;

  return (
    <ManagerOnly>
      <div className="mx-auto w-full max-w-[1480px] px-4 py-5 lg:px-6 lg:py-6">
        <PageHeader
          eyebrow={t("approvals.eyebrow")}
          title={t("approvals.title")}
          description={t("approvals.description")}
        />

        <div className="mt-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
          <Kpi
            label={t("approvals.kpi.pending")}
            value={runtime.casesLoaded ? pending.length : "—"}
            detail={t("approvals.sortNote")}
            icon={<Stamp size={14} aria-hidden />}
          />
          <Kpi
            label={t("approvals.kpi.highRisk")}
            value={runtime.casesLoaded ? urgent : "—"}
            detail={t("approvals.kpi.highRiskDetail")}
            tone="stop"
            icon={<ShieldCheck size={14} aria-hidden />}
          />
          <Kpi
            label={t("approvals.kpi.gaps")}
            value={runtime.casesLoaded ? gaps : "—"}
            detail={t("approvals.kpi.gapsDetail")}
            tone="warn"
            icon={<FileWarning size={14} aria-hidden />}
          />
          <Kpi
            label={t("approvals.kpi.longest")}
            value={longest === null ? "—" : formatWaiting(longest)}
            detail={pending.length ? t("approvals.kpi.pendingDetail") : t("approvals.kpi.empty")}
            icon={<Clock size={14} aria-hidden />}
          />
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-md border border-info-line bg-info-bg px-3.5 py-2.5">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-info" aria-hidden />
          <p className="text-base leading-6 text-ink">
            <span className="font-semibold">{t("approvals.notGuaranteeTitle")}</span>{" "}
            {t("approvals.notGuarantee")}
          </p>
        </div>

        <Card className="mt-3 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-3">
            <div className="relative min-w-[220px] flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
                aria-hidden
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
                placeholder={t("approvals.searchPlaceholder")}
                aria-label={t("approvals.searchLabel")}
                className="h-9 w-full rounded-md border border-line bg-card pl-8 pr-2.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
              />
            </div>

            <select
              aria-label={t("approvals.filterAction")}
              value={action}
              onChange={(event) => setAction(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="ALL">{t("approvals.allActions")}</option>
              {actionOptions.map((option) => (
                <option key={option} value={option}>
                  {actionLabel(option, option, t)}
                </option>
              ))}
            </select>

            <select
              aria-label={t("approvals.filterRisk")}
              value={risk}
              onChange={(event) => setRisk(event.target.value as "ALL" | RiskLevel)}
              className={SELECT_CLASS}
            >
              <option value="ALL">{t("approvals.allRisk")}</option>
              <option value="MEDIUM">{t("approvals.mediumRisk")}</option>
              <option value="HIGH">{t("approvals.highRisk")}</option>
              <option value="BLOCKED">{t("badge.risk.BLOCKED")}</option>
            </select>

            {activeFilters > 0 ? (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-muted hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
              >
                <X size={13} aria-hidden />
                {t("approvals.clearFilters")}
              </button>
            ) : null}

            <div className="ml-auto text-xs text-ink-faint">
              {t("approvals.count", { shown: rows.length, total: queue.length })}
            </div>
          </div>

          {dataState ?? (
            <ul className="divide-y divide-line">
              {rows.map((row) => {
                // Waiting time starts at the persisted approval creation time.
                const rowOrigin = row.approval?.approvalId
                  ? origins[row.approval.approvalId]
                  : undefined;
                // waitingMinutes comes from buildApprovalQueue, i.e. from the
                // persisted approval creation time — one source of truth.
                const waitingLabel = !row.approval?.approvalId
                  ? t("approvals.waitingUnknown")
                  : rowOrigin === "loading"
                    ? t("approvals.waitingChecking")
                    : row.waitingMinutes === null
                      ? t("approvals.waitingNoCreatedTime")
                      : formatWaiting(row.waitingMinutes);
                return (
                  <li key={row.proposal.proposalId}>
                  <Link
                    to={`/approvals/${row.proposal.proposalId}`}
                    aria-label={`${t("approvals.openHint")} · ${row.proposal.caseId} ${row.proposal.proposalId}`}
                    className="group block px-4 py-3 transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy-600"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="num text-base font-semibold text-ink-strong">
                            {row.proposal.caseId}
                          </span>
                          <span className="num text-base font-semibold text-ink-strong">
                            {row.case
                              ? formatMoney(row.case.amountMinor, row.case.currency)
                              : "—"}
                          </span>
                          <StatusBadge state={row.approvalDisplay} size="md" />
                          <OriginHint
                            state={
                              row.approval?.approvalId
                                ? origins[row.approval.approvalId]
                                : undefined
                            }
                            t={t}
                          />
                        </div>
                        <div className="mt-0.5 truncate text-base text-ink-muted" title={row.case?.itemName}>
                          {row.case?.itemName ?? "—"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <PriorityCell row={row} />
                        <ChevronRight
                          size={16}
                          className="text-ink-faint opacity-40 transition-opacity group-hover:opacity-100"
                          aria-hidden
                        />
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 xl:grid-cols-5">
                      <Meta label={t("approvals.colAction")}>
                        <span className="font-medium">
                          {actionLabel(row.proposal.actionLabel, row.proposal.action, t)}
                        </span>
                        <span className="mt-0.5 block break-all font-mono text-xs text-ink-faint">
                          {row.proposal.proposalId}
                        </span>
                      </Meta>
                      <Meta label={t("approvals.colValidator")}>
                        <StatusBadge state={row.validator} size="sm" />
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {t("approvals.validatorCounts", {
                            passed: row.passed,
                            failed: row.failed,
                          })}
                        </span>
                      </Meta>
                      <Meta label={t("approvals.colRisk")}>
                        <RiskBadge risk={row.proposal.risk} />
                      </Meta>
                      <Meta label={t("approvals.colWaiting")}>
                        <span className="num font-medium">{waitingLabel}</span>
                        <span className="mt-0.5 block num text-xs text-ink-faint">
                          {row.waitingMinutes === null
                            ? "—"
                            : formatDateTime(
                                createdTimes.get(row.approval!.approvalId) ?? "",
                              )}
                        </span>
                      </Meta>
                      <Meta label={t("approvals.colSource")}>
                        <SourceBadge
                          source={
                            sourceOf({ provenance: row.case?.provenance })[0] ?? NOT_REPORTED_SOURCE
                          }
                          size="sm"
                        />
                      </Meta>
                    </div>
                  </Link>
                </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-subtle px-4 py-2.5 text-xs text-ink-muted">
            <span>{t("approvals.derived", { count: state.cases.length })}</span>
            <span className="inline-flex items-center gap-1">
              <Badge tone="warn">{t("approvals.mvp")}</Badge>
              {t("approvals.mvpNote")}
            </span>
          </div>
        </Card>
      </div>
    </ManagerOnly>
  );
}
