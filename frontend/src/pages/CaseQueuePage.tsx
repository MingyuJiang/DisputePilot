import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, PlayCircle, Search, ShieldAlert, Stamp, X } from "lucide-react";
import { PageHeader } from "../components/domain/PageHeader";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { StatusBadge } from "../components/ui/StatusBadge";
import { SourceBadge } from "../components/ui/SourceBadge";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { DemoGuideDialog } from "../components/domain/DemoGuideDialog";
import { useWorkspace } from "../hooks/useWorkspace";
import { useRuntime } from "../hooks/useRuntime";
import { disputePilot, serviceHandle } from "../api";
import type { ActionProposal, DisputeFamily } from "../api/types";
import { FAMILY_LABEL, formatMoney } from "../lib/format";
import { nextStep } from "../lib/nextStep";
import {
  NOT_REPORTED_SOURCE,
  analysisState,
  caseState,
  proposalState,
  sourceOf,
  type DisplayState,
} from "../lib/statusModel";
import { toneTextClass } from "../components/ui/tone";
import { useI18n } from "../i18n";

const SELECT_CLASS =
  "h-8 rounded-md border border-line bg-card px-2 text-xs text-ink outline-none transition-colors hover:border-line-strong focus:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600";

type SortKey = "updated" | "amount" | "caseId";

const BLOCKED_KEYS = ["proposal.blocked", "proposal.failed", "execution.blocked"];

function Kpi({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  tone?: "neutral" | "warn" | "stop";
}) {
  const iconTone =
    tone === "warn"
      ? "text-warn bg-warn-bg border-warn-line"
      : tone === "stop"
        ? "text-stop bg-stop-bg border-stop-line"
        : "text-ink-muted bg-subtle border-line";
  return (
    <Card className="px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{label}</div>
        <div className={["flex h-6 w-6 items-center justify-center rounded border", iconTone].join(" ")}>
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

export function CaseQueuePage() {
  const workspace = useWorkspace();
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { lang, t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState<"ALL" | DisputeFamily>("ALL");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const guideOpen = params.get("guide") === "1";

  const pendingCount = disputePilot.listPendingApprovals().length;
  const blockedCount = workspace.proposals.filter((proposal) =>
    BLOCKED_KEYS.includes(proposalState(proposal).key),
  ).length;

  // Case-level state and source are computed once per record by statusModel.
  const decorated = useMemo(
    () =>
      workspace.cases.map((record) => {
        const proposals = workspace.proposals.filter((item) => item.caseId === record.caseId);
        const proposal: ActionProposal | undefined = proposals[proposals.length - 1];
        const approval = proposal
          ? workspace.approvals.find((item) => item.proposalId === proposal.proposalId)
          : undefined;
        return {
          record,
          analysis: workspace.analyses.find((item) => item.caseId === record.caseId),
          proposal,
          approval,
          state: caseState(record),
          ai: analysisState(record.aiReview),
          source: sourceOf({ provenance: record.provenance })[0] ?? NOT_REPORTED_SOURCE,
        };
      }),
    [workspace],
  );

  const stateOptions = useMemo(() => {
    const seen = new Map<string, DisplayState>();
    decorated.forEach((row) => {
      if (!seen.has(row.state.key)) seen.set(row.state.key, row.state);
    });
    return [...seen.values()];
  }, [decorated]);

  const sourceOptions = useMemo(() => {
    const seen = new Map<string, DisplayState>();
    decorated.forEach((row) => {
      if (!seen.has(row.source.key)) seen.set(row.source.key, row.source);
    });
    return [...seen.values()];
  }, [decorated]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = decorated.filter((row) => {
      if (family !== "ALL" && row.record.family !== family) return false;
      if (stateFilter !== "ALL" && row.state.key !== stateFilter) return false;
      if (sourceFilter !== "ALL" && row.source.key !== sourceFilter) return false;
      if (!query) return true;
      return (
        row.record.caseId.toLowerCase().includes(query) ||
        row.record.itemName.toLowerCase().includes(query)
      );
    });

    return filtered.sort((a, b) => {
      if (sortKey === "amount") return b.record.amountMinor - a.record.amountMinor;
      if (sortKey === "caseId") return a.record.caseId.localeCompare(b.record.caseId);
      return b.record.updatedAt.localeCompare(a.record.updatedAt);
    });
  }, [decorated, search, family, stateFilter, sourceFilter, sortKey]);

  const resetFilters = () => {
    setSearch("");
    setFamily("ALL");
    setStateFilter("ALL");
    setSourceFilter("ALL");
  };

  const activeFilters = [
    family !== "ALL",
    stateFilter !== "ALL",
    sourceFilter !== "ALL",
    search.trim() !== "",
  ].filter(Boolean).length;

  const retry = () => {
    void serviceHandle.refresh().catch(() => undefined);
  };

  const dataState = !runtime.casesLoaded ? (
    runtime.issue ? (
      <ErrorState
        title={t("cases.loadFailedTitle")}
        detail={t("cases.loadFailedBody")}
        onRetry={retry}
      />
    ) : (
      <LoadingState />
    )
  ) : workspace.cases.length === 0 ? (
    <EmptyState title={t("cases.emptyTitle")} body={t("cases.emptyBody")} />
  ) : rows.length === 0 ? (
    <EmptyState
      title={t("cases.noMatchTitle")}
      body={t("cases.noMatchBody")}
      action={
        <Button size="sm" variant="secondary" onClick={resetFilters}>
          {t("cases.clearFilters")}
        </Button>
      }
    />
  ) : null;

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-5 lg:px-6 lg:py-6">
      <PageHeader
        eyebrow={t("cases.eyebrow")}
        title={t("queue.title")}
        description={t("cases.description")}
        actions={
          <Button variant="secondary" onClick={() => navigate("/cases?guide=1")}>
            <PlayCircle size={14} aria-hidden />
            {t("queue.guidedDemo")}
          </Button>
        }
      />

      

      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Kpi
          label={t("cases.kpi.open")}
          value={runtime.casesLoaded ? workspace.cases.length : t("common.notAvailable")}
          detail={t("cases.kpi.openDetail")}
          icon={<Stamp size={13} aria-hidden />}
        />
        <Kpi
          label={t("queue.kpi.awaitingApproval")}
          value={pendingCount}
          detail={t("cases.kpi.approvalDetail")}
          tone="warn"
          icon={<ShieldAlert size={13} aria-hidden />}
        />
        <Kpi
          label={t("queue.kpi.blockedActions")}
          value={blockedCount}
          detail={t("cases.kpi.blockedDetail")}
          tone="stop"
          icon={<X size={13} aria-hidden />}
        />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              type="search"
              placeholder={t("cases.searchPlaceholder")}
              aria-label={t("cases.searchLabel")}
              className="h-8 w-full rounded-md border border-line bg-card pl-8 pr-2.5 text-xs text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
            />
          </div>

          <select
            aria-label={t("cases.filterFamily")}
            value={family}
            onChange={(event) => setFamily(event.target.value as "ALL" | DisputeFamily)}
            className={SELECT_CLASS}
          >
            <option value="ALL">{t("cases.allFamilies")}</option>
            <option value="INR">{t("queue.typeInr")}</option>
            <option value="SNAD">{t("queue.typeSnad")}</option>
            <option value="BILLING">{t("queue.typeBilling")}</option>
          </select>

          <select
            aria-label={t("cases.filterState")}
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="ALL">{t("cases.allStates")}</option>
            {stateOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {lang === "zh-CN" ? option.labelZh : option.labelEn}
              </option>
            ))}
          </select>

          <select
            aria-label={t("cases.filterSource")}
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="ALL">{t("cases.allSources")}</option>
            {sourceOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {lang === "zh-CN" ? option.labelZh : option.labelEn}
              </option>
            ))}
          </select>

          <select
            aria-label={t("cases.sortLabel")}
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
            className={SELECT_CLASS}
          >
            <option value="updated">{t("cases.sort.updated")}</option>
            <option value="amount">{t("cases.sort.amount")}</option>
            <option value="caseId">{t("cases.sort.caseId")}</option>
          </select>

          {activeFilters > 0 ? (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
            >
              <X size={12} aria-hidden />
              {t("cases.clearCount", { count: activeFilters })}
            </button>
          ) : null}
        </div>

        {dataState ?? (
          <ul>
            {rows.map(({ record, analysis, proposal, approval, state, ai, source }) => {
              const next = nextStep({
                role: "MERCHANT",
                record,
                analysis,
                proposal,
                approval,
                execution: proposal?.execution,
              });
              const nextLabel = lang === "zh-CN" ? next.labelZh : next.labelEn;

              return (
                <li key={record.caseId} className="border-b border-line last:border-b-0">
                  <Link
                    to={`/cases/${record.caseId}`}
                    className="group block px-4 py-3 transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy-600"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="num text-base font-semibold text-ink-strong">
                            {record.caseId}
                          </span>
                          <span className="text-base text-ink">
                            <span>
                              {record.family === "BILLING"
                                ? t("queue.typeBilling")
                                : FAMILY_LABEL[record.family]}
                            </span>
                            <span aria-hidden> · </span>
                            <span className="num">
                              {formatMoney(record.amountMinor, record.currency)}
                            </span>
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-base text-ink-muted" title={record.itemName}>
                          {record.itemName}
                        </div>
                        <div className="truncate text-xs text-ink-faint" title={record.reasonLabel}>
                          {record.reasonLabel}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <ChevronRight
                          size={14}
                          className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden
                        />
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
                      <Field label={t("cases.colState")}>
                        <StatusBadge state={state} />
                      </Field>
                      <Field label={t("cases.colAi")}>
                        <StatusBadge state={ai} />
                      </Field>
                      <Field label={t("cases.colNext")}>
                        <span className={["text-base leading-6", toneTextClass(next.tone)].join(" ")}>
                          {nextLabel}
                        </span>
                      </Field>
                      <Field label={t("cases.colSource")}>
                        <SourceBadge source={source} />
                      </Field>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-subtle px-4 py-2 text-xs text-ink-muted">
          <span>
            {t("cases.showing", {
              shown: rows.length,
              total: runtime.casesLoaded ? workspace.cases.length : 0,
            })}
          </span>
          <span>{t("overview.derived", { count: workspace.cases.length })}</span>
        </div>
      </Card>

      <DemoGuideDialog
        open={guideOpen}
        onClose={() => {
          if (params.get("guide")) {
            params.delete("guide");
            setParams(params, { replace: true });
          }
        }}
      />
    </div>
  );
}

/** Inline "label: value" pair used in the responsive case row. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-ink-faint">{label}</span>
      {children}
    </div>
  );
}
