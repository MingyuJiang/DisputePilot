/**
 * Executions & Audit (FRONTEND_REDESIGN_PLAN §3.6).
 *
 * There is no global execution endpoint: every row is derived from the loaded
 * cases/proposals and labelled as such. Mode, result and remote verification
 * are three separate facts — REPLAY never shares the LIVE success colour, and
 * UNVERIFIED/PENDING always read as warnings. Request id and verification
 * evidence are folded; payload hash and the linked audit events live there.
 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  FileWarning,
  Search,
  ShieldX,
} from "lucide-react";
import { PageHeader } from "../components/domain/PageHeader";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { StatusBadge } from "../components/ui/StatusBadge";
import { AuditTimeline } from "../components/domain/AuditTimeline";
import { useWorkspace } from "../hooks/useWorkspace";
import { useRuntime } from "../hooks/useRuntime";
import { serviceHandle } from "../api";
import { formatDateTime } from "../lib/format";
import { auditDetail, auditSummary } from "../lib/auditText";
import {
  buildExecutionLedger,
  countExecutionStates,
  executionModeOf,
  filterExecutionLedger,
  verificationOf,
  type ExecutionLedgerRow,
  type ExecutionMode,
  type ExecutionState,
  type VerificationFilter,
} from "../lib/executionLedger";
import { ledgerExecutionState } from "../lib/statusModel";
import {
  actionLabel as localizeActionLabel,
  useI18n,
  type MessageKey,
} from "../i18n";

const RESULT_OPTIONS: { value: ExecutionState; key: MessageKey }[] = [
  { value: "REPLAYED", key: "auditPage.state.REPLAYED" },
  { value: "EXECUTED", key: "auditPage.state.EXECUTED" },
  { value: "UNVERIFIED", key: "auditPage.state.UNVERIFIED" },
  { value: "BLOCKED", key: "auditPage.state.BLOCKED" },
  { value: "FAILED", key: "auditPage.state.FAILED" },
  { value: "EXPIRED", key: "auditPage.state.EXPIRED" },
  { value: "PENDING", key: "auditPage.state.PENDING" },
];

const OUTCOME_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "ALL", labelKey: "auditPage.allOutcomes" },
  { value: "SUCCEEDED", labelKey: "auditPage.outcomeSucceeded" },
  { value: "FAILED", labelKey: "auditPage.outcomeFailed" },
  { value: "BLOCKED", labelKey: "auditPage.outcomeBlocked" },
  { value: "EXPIRED", labelKey: "auditPage.outcomeExpired" },
  { value: "DUPLICATE_SUPPRESSED", labelKey: "auditPage.outcomeDuplicate" },
];

const SELECT_CLASS =
  "h-9 rounded-md border border-line bg-card px-2 text-base text-ink outline-none transition-colors hover:border-line-strong focus:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600";

function ModeBadge({ mode }: { mode: ExecutionMode }) {
  const { t } = useI18n();
  if (mode === "LIVE") {
    return <Badge tone="info">{t("auditPage.modeLive")}</Badge>;
  }
  if (mode === "REPLAY") {
    return <Badge tone="scenario">{t("auditPage.modeReplay")}</Badge>;
  }
  return <Badge tone="neutral">{t("auditPage.modeNotReported")}</Badge>;
}

function VerificationBadge({ row }: { row: ExecutionLedgerRow }) {
  const { t } = useI18n();
  const mode = executionModeOf(row);
  const verification = verificationOf(row);

  // An offline replay has no remote state to verify: "n/a" is more accurate
  // than "not confirmed", which would imply a failed LIVE check.
  if (mode === "REPLAY" && verification === "NOT_REPORTED") {
    return <Badge tone="neutral">{t("auditPage.verifiedReplay")}</Badge>;
  }
  if (verification === "CONFIRMED") {
    return <Badge tone="pass">{t("auditPage.verifiedYes")}</Badge>;
  }
  if (verification === "NOT_CONFIRMED") {
    return <Badge tone="warn">{t("auditPage.verifiedNo")}</Badge>;
  }
  return <Badge tone="neutral">{t("auditPage.notReported")}</Badge>;
}

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
  tone?: "neutral" | "warn" | "stop" | "pass";
  icon: ReactNode;
}) {
  const valueTone =
    tone === "pass"
      ? "text-pass"
      : tone === "warn"
        ? "text-warn"
        : tone === "stop"
          ? "text-stop"
          : "text-ink-strong";
  return (
    <Card className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{label}</div>
        <div className="text-ink-faint">{icon}</div>
      </div>
      <div className={["num mt-1 text-2xl font-semibold leading-8", valueTone].join(" ")}>{value}</div>
      <div className="mt-0.5 text-xs leading-5 text-ink-muted">{detail}</div>
    </Card>
  );
}

function VerificationDetails({ row }: { row: ExecutionLedgerRow }) {
  const { t } = useI18n();
  const verification = row.proposal.execution?.verification;
  const observations = verification?.observations
    ? Object.entries(verification.observations)
    : [];

  return (
    <div className="rounded-md border border-line bg-subtle px-3.5 py-3">
      <div className="text-sm font-semibold text-ink-strong">{t("auditPage.verificationTitle")}</div>
      {verification ? (
        <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-ink-faint">{t("auditPage.method")}</dt>
            <dd className="mt-0.5 break-all font-mono text-base text-ink">
              {verification.method ?? t("rd.notProvided")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">{t("auditPage.basis")}</dt>
            <dd className="mt-0.5 break-all font-mono text-base text-ink">
              {verification.basis ?? t("rd.notProvided")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">{t("auditPage.checkedAt")}</dt>
            <dd className="num mt-0.5 text-base text-ink">
              {verification.checkedAt ? formatDateTime(verification.checkedAt) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">{t("auditPage.remoteStatus")}</dt>
            <dd className="num mt-0.5 text-base text-ink">
              {verification.remoteStatus ?? "—"}
            </dd>
          </div>
          {observations.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-ink-faint">{t("auditPage.observations")}</dt>
              <dd className="mt-0.5">
                <ul className="space-y-0.5">
                  {observations.map(([key, value]) => (
                    <li key={key} className="break-all font-mono text-base text-ink">
                      {key} = {value}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-1 text-base leading-6 text-ink-muted">
          {row.proposal.execution
            ? t("rd.notProvided")
            : t("auditPage.noAttempt")}
        </p>
      )}
    </div>
  );
}

export function ExecutionAuditPage() {
  const state = useWorkspace();
  const runtime = useRuntime();
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const [caseFilter, setCaseFilter] = useState(params.get("case") ?? "ALL");
  const [outcomeFilter, setOutcomeFilter] = useState("ALL");
  const [modeFilter, setModeFilter] = useState<"ALL" | ExecutionMode>("ALL");
  const [resultFilter, setResultFilter] = useState<"ALL" | ExecutionState>("ALL");
  const [verificationFilter, setVerificationFilter] = useState<"ALL" | VerificationFilter>("ALL");
  const [expanded, setExpanded] = useState<string[]>([]);

  const ledger = useMemo(
    () => buildExecutionLedger(state.proposals, state.audit),
    [state.proposals, state.audit],
  );
  const counts = useMemo(
    () => countExecutionStates(ledger, state.audit),
    [ledger, state.audit],
  );
  const rows = useMemo(
    () =>
      filterExecutionLedger(ledger, {
        mode: modeFilter,
        result: resultFilter,
        verification: verificationFilter,
        caseId: caseFilter,
        query,
      }),
    [ledger, modeFilter, resultFilter, verificationFilter, caseFilter, query],
  );

  const events = useMemo(
    () =>
      state.audit
        .filter((event) => {
          if (caseFilter !== "ALL" && event.caseId !== caseFilter) return false;
          if (outcomeFilter !== "ALL" && event.outcome !== outcomeFilter) return false;
          const text = query.trim().toLowerCase();
          if (!text) return true;
          return (
            auditSummary(event, t).toLowerCase().includes(text) ||
            event.action.toLowerCase().includes(text) ||
            event.actor.name.toLowerCase().includes(text) ||
            event.caseId.toLowerCase().includes(text)
          );
        })
        .sort((a, b) => b.at.localeCompare(a.at)),
    [state.audit, caseFilter, outcomeFilter, query, t],
  );

  const toggle = (id: string) =>
    setExpanded((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const notLoaded = !runtime.casesLoaded;
  const value = (count: number): string | number => (notLoaded ? "—" : count);

  const resetFilters = () => {
    setCaseFilter("ALL");
    setModeFilter("ALL");
    setResultFilter("ALL");
    setVerificationFilter("ALL");
    setQuery("");
  };
  const activeFilters =
    (caseFilter !== "ALL" ? 1 : 0) +
    (modeFilter !== "ALL" ? 1 : 0) +
    (resultFilter !== "ALL" ? 1 : 0) +
    (verificationFilter !== "ALL" ? 1 : 0) +
    (query.trim() ? 1 : 0);

  const retry = () => {
    void serviceHandle.refresh().catch(() => undefined);
  };

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-5 lg:px-6 lg:py-6">
      <PageHeader
        eyebrow={t("auditPage.eyebrow")}
        title={t("auditPage.title")}
        description={t("auditPage.description")}
      />

      

      <p className="mt-2 text-xs leading-5 text-ink-faint">
        {notLoaded
          ? t("auditPage.notLoaded")
          : t("auditPage.derived", { count: state.cases.length })}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Kpi
          label={t("auditPage.replayed")}
          value={value(counts.replayed)}
          detail={t("auditPage.replayedDetail")}
          icon={<Copy size={14} aria-hidden />}
        />
        <Kpi
          label={t("auditPage.executed")}
          value={value(counts.executed + counts.verified)}
          detail={t("auditPage.executedDetail")}
          icon={<FileText size={14} aria-hidden />}
        />
        <Kpi
          label={t("auditPage.unverified")}
          value={value(counts.unverified)}
          detail={t("auditPage.unverifiedDetail")}
          tone="warn"
          icon={<AlertTriangle size={14} aria-hidden />}
        />
        <Kpi
          label={t("auditPage.blocked")}
          value={value(counts.blocked)}
          detail={t("auditPage.failedDetail")}
          tone="stop"
          icon={<ShieldX size={14} aria-hidden />}
        />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold leading-6 text-ink-strong">{t("auditPage.ledger")}</h2>
              <p className="mt-0.5 text-base leading-6 text-ink-muted">{t("auditPage.ledgerSubtitle")}</p>
            </div>
            <span className="text-xs text-ink-faint">
              {t("auditPage.rows", { count: rows.length })}
            </span>
          </div>
          <p className="mt-1 text-base leading-6 text-ink-muted">
            <span className="font-semibold text-ink">{t("auditPage.modeReplay")}</span>{" "}
            {t("auditPage.replayDisclosure")}
          </p>
          <p className="mt-0.5 text-base leading-6 text-ink-muted">
            <span className="font-semibold text-ink">{t("auditPage.modeLive")}</span>{" "}
            {t("auditPage.liveDisclosure")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              placeholder={t("auditPage.searchPlaceholder")}
              aria-label={t("auditPage.searchLabel")}
              className="h-9 w-full rounded-md border border-line bg-card pl-8 pr-2.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
            />
          </div>

          <select
            aria-label={t("auditPage.modeFilter")}
            value={modeFilter}
            onChange={(event) => setModeFilter(event.target.value as "ALL" | ExecutionMode)}
            className={SELECT_CLASS}
          >
            <option value="ALL">{t("auditPage.allModes")}</option>
            <option value="LIVE">{t("auditPage.modeLive")}</option>
            <option value="REPLAY">{t("auditPage.modeReplay")}</option>
            <option value="NOT_REPORTED">{t("auditPage.modeNotReported")}</option>
          </select>

          <select
            aria-label={t("auditPage.resultFilter")}
            value={resultFilter}
            onChange={(event) => setResultFilter(event.target.value as "ALL" | ExecutionState)}
            className={SELECT_CLASS}
          >
            <option value="ALL">{t("auditPage.allResults")}</option>
            {RESULT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.key)}
              </option>
            ))}
          </select>

          <select
            aria-label={t("auditPage.verifiedFilter")}
            value={verificationFilter}
            onChange={(event) =>
              setVerificationFilter(event.target.value as "ALL" | VerificationFilter)
            }
            className={SELECT_CLASS}
          >
            <option value="ALL">{t("auditPage.allVerification")}</option>
            <option value="CONFIRMED">{t("auditPage.confirmed")}</option>
            <option value="NOT_CONFIRMED">{t("auditPage.notConfirmed")}</option>
            <option value="NOT_REPORTED">{t("auditPage.notReported")}</option>
          </select>

          <select
            aria-label={t("auditPage.filterCase")}
            value={caseFilter}
            onChange={(event) => setCaseFilter(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="ALL">{t("auditPage.allCases")}</option>
            {state.cases.map((record) => (
              <option key={record.caseId} value={record.caseId}>
                {record.caseId}
              </option>
            ))}
          </select>

          {activeFilters > 0 ? (
            <Button size="sm" variant="ghost" onClick={resetFilters}>
              {t("approvals.clearFilters")}
            </Button>
          ) : null}
        </div>

        {notLoaded ? (
          runtime.issue ? (
            <ErrorState
              title={t("auditPage.loadFailedTitle")}
              detail={t("auditPage.loadFailedBody")}
              onRetry={retry}
            />
          ) : (
            <LoadingState />
          )
        ) : ledger.length === 0 ? (
          <EmptyState title={t("auditPage.noLedgerTitle")} body={t("auditPage.noLedgerBody")} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t("auditPage.noRowsTitle")}
            body={t("auditPage.noRowsBody")}
            action={
              <Button size="sm" variant="secondary" onClick={resetFilters}>
                {t("approvals.clearFilters")}
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const isOpen = expanded.includes(row.proposal.proposalId);
              const mode = executionModeOf(row);
              const action = localizeActionLabel(row.proposal.actionLabel, row.proposal.action, t);
              const eventsForProposal = state.audit
                .filter((event) => event.proposalId === row.proposal.proposalId)
                .sort((a, b) => b.at.localeCompare(a.at));

              return (
                <li key={row.proposal.proposalId} data-testid={`execution-row-${row.proposal.proposalId}`}>
                  <div className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="num text-xs text-ink-faint">
                            {row.last ? formatDateTime(row.last.at) : "—"}
                          </span>
                          <Link
                            to={`/cases/${row.proposal.caseId}`}
                            className="num text-base font-semibold text-ink-strong hover:text-navy-700"
                          >
                            {row.proposal.caseId}
                          </Link>
                          <span className="text-base text-ink">{action}</span>
                          <ModeBadge mode={mode} />
                          <StatusBadge state={ledgerExecutionState(row.state)} size="md" />
                          <VerificationBadge row={row} />
                        </div>
                        <p className="mt-1 break-all font-mono text-xs text-ink-faint">
                          {row.proposal.proposalId}
                        </p>
                        <p className="mt-1 max-w-[840px] text-base leading-6 text-ink">
                          {row.last
                            ? auditSummary(row.last, t)
                            : row.proposal.decisionReason ?? t("auditPage.noAttempt")}
                        </p>
                        {row.last ? (
                          <p className="mt-0.5 text-xs leading-5 text-ink-faint">
                            {auditDetail(row.last, t)}
                          </p>
                        ) : null}
                      </div>

                      <Button
                        size="sm"
                        variant="ghost"
                        aria-expanded={isOpen}
                        onClick={() => toggle(row.proposal.proposalId)}
                      >
                        {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                        {t(isOpen ? "auditPage.collapse" : "auditPage.expand")}
                      </Button>
                    </div>

                    {isOpen ? (
                      <div
                        className="mt-3 space-y-2.5"
                        data-testid={`execution-detail-${row.proposal.proposalId}`}
                      >
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="rounded-md border border-line bg-subtle px-3 py-2">
                            <div className="text-xs text-ink-faint">{t("auditPage.payloadHash")}</div>
                            <div className="mt-0.5 break-all font-mono text-base text-ink">
                              {row.proposal.payloadHash ?? t("rd.notProvided")}
                            </div>
                          </div>
                          <div className="rounded-md border border-line bg-subtle px-3 py-2">
                            <div className="text-xs text-ink-faint">{t("auditPage.snapshotHash")}</div>
                            <div className="mt-0.5 break-all font-mono text-base text-ink">
                              {row.proposal.snapshotHash}
                            </div>
                          </div>
                          <div className="rounded-md border border-line bg-subtle px-3 py-2 sm:col-span-2">
                            <div className="text-xs text-ink-faint">{t("auditPage.colRequestId")}</div>
                            <div className="mt-0.5 break-all font-mono text-base text-ink">
                              {row.proposal.execution?.requestId ?? row.last?.requestId ?? t("rd.notProvided")}
                            </div>
                          </div>
                        </div>

                        <VerificationDetails row={row} />

                        <div className="rounded-md border border-line bg-card px-3.5 py-2.5">
                          <div className="mb-1.5 text-sm font-semibold text-ink-strong">
                            {t("auditPage.linkedEvents")}
                          </div>
                          {eventsForProposal.length === 0 ? (
                            <p className="text-base leading-6 text-ink-muted">
                              {t("auditPage.noLinkedEvents")}
                            </p>
                          ) : (
                            <AuditTimeline events={eventsForProposal} />
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-subtle px-4 py-2.5 text-xs text-ink-muted">
          <span>
            {t("auditPage.rows", { count: rows.length })}
            {activeFilters > 0 ? ` · ${rows.length} / ${ledger.length}` : null}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} aria-hidden />
            {t("auditPage.timezone")}
          </span>
        </div>
      </Card>

      <Card className="mt-3 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="mr-2">
            <h2 className="text-lg font-semibold leading-6 text-ink-strong">{t("auditPage.trail")}</h2>
            <p className="text-base text-ink-muted">{t("auditPage.trailSubtitle")}</p>
          </div>
          <select
            aria-label={t("auditPage.filterOutcome")}
            value={outcomeFilter}
            onChange={(event) => setOutcomeFilter(event.target.value)}
            className={SELECT_CLASS}
          >
            {OUTCOME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
            <span>{t("auditPage.events", { count: events.length })}</span>
            <span className="inline-flex items-center gap-1">
              <Copy size={12} aria-hidden />
              {t("auditPage.duplicateGuard")}
            </span>
          </div>
        </div>

        <div className="px-4 py-3">
          {events.length === 0 ? (
            <p className="py-8 text-center text-base text-ink-muted">{t("auditPage.noEvents")}</p>
          ) : (
            <AuditTimeline events={events} showCase />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-subtle px-4 py-2 text-xs text-ink-faint">
          <span>{t("auditPage.footer")}</span>
          <span className="inline-flex items-center gap-1">
            <FileWarning size={12} aria-hidden />
            {t("auditPage.timezone")}
          </span>
        </div>
      </Card>
    </div>
  );
}
