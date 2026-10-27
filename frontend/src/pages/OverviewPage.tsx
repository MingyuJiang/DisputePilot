/**
 * Overview (v2.1 personal-merchant mode).
 *
 * The first screen answers four questions and nothing else:
 *   1. how many disputes need my attention?
 *   2. what has the AI already done?
 *   3. what is waiting for me to decide?
 *   4. what should I do next?
 *
 * Every number is derived from the loaded workspace (never hardcoded); when the
 * workspace has not loaded the count is "—" instead of zero. The old five
 * internal work queues (analysis / approval / blocked / review / recent) are
 * replaced by these four merchant questions plus a task list that links
 * straight into a dispute — not into an internal management page.
 */

import { Link } from "react-router-dom";
import { ChevronRight, Sparkles } from "lucide-react";
import { PageHeader } from "../components/domain/PageHeader";
import { AuditTimeline } from "../components/domain/AuditTimeline";
import { EmptyState } from "../components/ui/EmptyState";
import { useWorkspace } from "../hooks/useWorkspace";
import { useRuntime } from "../hooks/useRuntime";
import { useI18n, type MessageKey } from "../i18n";
import { proposalState } from "../lib/statusModel";

const RECENT_EVENTS = 6;
const MAX_TASKS = 6;

/**
 * RC-4 (review P1-04): the four questions are computed from persisted records,
 * one row per *case*.
 *
 *   awaiting analysis  — cases with no analysis record yet
 *   waiting for you    — pending approvals (unique cases)
 *   blocked            — cases whose latest proposal is blocked, plus cases the
 *                        analysis itself declares blocked (policy layer)
 *   analysed           — cases that have an analysis record
 *
 * "Analysed" used to read the execution queue, so a case could be counted as
 * analysed only after it had been replayed. Duplicate proposals for one case
 * are collapsed to that case.
 */
interface OverviewCounts {
  awaitingAnalysis: number | null;
  awaitingYou: number | null;
  blocked: number | null;
  analysed: number | null;
}

const countUniqueCases = (values: string[]): number => new Set(values).size;

const QUESTIONS: { key: keyof OverviewCounts; labelKey: MessageKey }[] = [
  { key: "awaitingAnalysis", labelKey: "overview.q.awaitingAnalysis" },
  { key: "awaitingYou", labelKey: "overview.q.awaitingYou" },
  { key: "blocked", labelKey: "overview.q.blocked" },
  { key: "analysed", labelKey: "overview.q.analyzed" },
];

const computeCounts = (
  workspace: { cases: { caseId: string }[]; analyses: { caseId: string; status?: string }[]; proposals: { proposalId: string; caseId: string; state: string }[]; approvals: { proposalId: string; decision: string }[] },
  loaded: boolean,
): OverviewCounts => {
  if (!loaded) {
    return { awaitingAnalysis: null, awaitingYou: null, blocked: null, analysed: null };
  }
  const cases = workspace.cases.map((item) => item.caseId);
  const analysedCases = new Set(
    workspace.analyses.filter((item) => item.status === "READY").map((item) => item.caseId),
  );
  // A case counts as blocked only when its *latest* proposal is blocked. An
  // older refused draft (e.g. an over-limit refund the merchant tried once)
  // must not keep the case in the blocked column for ever.
  const latestByCase = new Map<string, { caseId: string; state: string }>();
  for (const proposal of workspace.proposals) {
    latestByCase.set(proposal.caseId, proposal);
  }
  // ...and only when nothing is moving forward for that case: a blocked draft
  // next to a pending/approved/replayed proposal is history, not a blocker.
  const movingCases = new Set(
    workspace.proposals
      .filter((p) =>
        ["PENDING_APPROVAL", "AWAITING_APPROVAL", "APPROVED", "REPLAY_EXECUTED", "REPLAYED", "EXECUTED"].includes(
          p.state,
        ),
      )
      .map((p) => p.caseId),
  );
  const blockedCases = new Set(
    [...latestByCase.values()]
      .filter((p) => p.state === "BLOCKED" && !movingCases.has(p.caseId))
      .map((p) => p.caseId),
  );
  const proposalToCase = new Map(workspace.proposals.map((p) => [p.proposalId, p.caseId]));
  const waitingCases = new Set(
    workspace.approvals
      .filter((a) => a.decision === "PENDING")
      .map((a) => proposalToCase.get(a.proposalId))
      .filter((id): id is string => Boolean(id)),
  );
  return {
    awaitingAnalysis: cases.filter((id) => !analysedCases.has(id)).length,
    awaitingYou: waitingCases.size,
    blocked: countUniqueCases([...blockedCases]),
    analysed: analysedCases.size,
  };
};

const TASK_LABEL: Record<string, { key: MessageKey; tone: "pass" | "warn" | "info" | "neutral" }> = {
  canContinue: { key: "overview.tasks.canContinue", tone: "pass" },
  needMaterial: { key: "overview.tasks.needMaterial", tone: "warn" },
  needJudgement: { key: "overview.tasks.needJudgement", tone: "warn" },
  // RC-4: an approval is an authorisation, not a completion. It stays visible
  // as "authorised, waiting to run" until an execution record exists.
  authorized: { key: "overview.tasks.authorized", tone: "info" },
  done: { key: "overview.tasks.done", tone: "neutral" },
};

export function OverviewPage() {
  const workspace = useWorkspace();
  const runtime = useRuntime();
  const { t } = useI18n();

  const recent = [...workspace.audit]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_EVENTS);

  const counts = computeCounts(workspace, runtime.casesLoaded);
  const countOf = (key: keyof OverviewCounts): number | null => counts[key];
  const countText = (value: number | null): string => (value === null ? "—" : String(value));

  // Tasks: what the merchant can act on now, derived from real workspace state.
  const tasks = workspace.proposals
    .map((proposal) => {
      const record = workspace.cases.find((item) => item.caseId === proposal.caseId);
      const approval = workspace.approvals.find((item) => item.proposalId === proposal.proposalId);
      const state = proposalState({ state: proposal.state });
      const kind =
        state.key === "proposal.replayed" || state.key === "proposal.executed-verified"
          ? "done"
          : state.key === "proposal.approved"
            ? "authorized"
            : approval
              ? "canContinue"
              : state.key === "proposal.blocked"
                ? "needMaterial"
                : "needJudgement";
      return { proposal, record, approval, kind, state };
    })
    .sort((a, b) => {
      const rank = (kind: string): number =>
        kind === "canContinue"
          ? 0
          : kind === "needMaterial"
            ? 1
            : kind === "needJudgement"
              ? 2
              : kind === "authorized"
                ? 3
                : 4;
      return rank(a.kind) - rank(b.kind);
    })
    .slice(0, MAX_TASKS);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-5 lg:px-6 lg:py-6">
      <PageHeader
        eyebrow={t("app.name")}
        title={t("overview.merchantTitle")}
        description={t("overview.merchantDescription")}
        actions={
          <Link
            to="/assistant"
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-hover"
          >
            <Sparkles size={13} aria-hidden />
            {t("assistant.title")}
          </Link>
        }
      />

      <p className="mt-2 text-xs leading-5 text-ink-faint">
        {runtime.casesLoaded
          ? t("overview.derived", { count: workspace.cases.length })
          : t("overview.notLoaded")}
      </p>

      {/* The four questions */}
      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {QUESTIONS.map((question) => (
          <div
            key={question.key}
            className="rounded-lg border border-line bg-card px-4 py-3 shadow-card"
          >
            <div className="eyebrow">{t(question.labelKey)}</div>
            <div className="num mt-1 text-2xl font-semibold leading-8 text-ink-strong">
              {countText(countOf(question.key))}
            </div>
          </div>
        ))}
      </div>

      {/* What to do next */}
      <section className="mt-4 rounded-lg border border-line bg-card shadow-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-lg font-semibold leading-6 text-ink-strong">
            {t("overview.tasks.title")}
          </h2>
          <Link
            to="/cases"
            className="inline-flex items-center gap-0.5 text-xs font-medium text-navy-700 hover:text-navy-800"
          >
            {t("nav.myDisputes")}
            <ChevronRight size={12} aria-hidden />
          </Link>
        </header>
        {tasks.length === 0 ? (
          <div className="px-4 py-3">
            <EmptyState title={t("overview.tasks.empty")} body={t("overview.tasks.emptyBody")} />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((task) => {
              const label = TASK_LABEL[task.kind];
              return (
                <li key={task.proposal.proposalId}>
                  <Link
                    to={`/cases/${task.proposal.caseId}`}
                    className="group flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-subtle"
                  >
                    <span className="num text-base font-semibold text-ink-strong">
                      {task.proposal.caseId}
                    </span>
                    <span className="text-base text-ink">{task.record?.itemName ?? "—"}</span>
                    <span className="rounded border border-line bg-sunken px-1.5 py-0.5 text-2xs text-ink-muted">
                      {t(label.key)}
                    </span>
                    <span className="ml-auto flex items-center gap-1 text-xs text-ink-faint">
                      {task.proposal.action}
                      <ChevronRight
                        size={13}
                        className="opacity-40 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-line bg-card shadow-card">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-lg font-semibold leading-6 text-ink-strong">
            {t("overview.activity.title")}
          </h2>
        </header>
        {recent.length === 0 ? (
          <div className="px-4 py-3">
            <EmptyState compact title={t("overview.activity.empty")} />
          </div>
        ) : (
          <AuditTimeline events={recent} showCase compact />
        )}
      </section>
    </div>
  );
}
