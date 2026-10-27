/**
 * AI Assistant (v2.1) — the merchant-facing wrapper over the autopilot run.
 *
 * Same backend, same safety: this page calls the exact same endpoints as the
 * internal autopilot page (POST /autopilot/runs, POST …/submit-for-review,
 * GET …/submission-batches). What changes is the language:
 *
 *  - internal states are translated through `merchantLanguage` (READY_FOR_REVIEW
 *    → "Ready for your confirmation"), never shown raw as the only label;
 *  - the machine-readable value stays on the badge (`title`) and in the
 *    technical disclosure, so nothing is hidden from an auditor;
 *  - the page states plainly that this run analyses and prepares only — it
 *    never messages buyers, refunds or closes disputes.
 *
 * The two rules from the internal page still hold: every status is the
 * backend's answer, and SUBMITTED_FOR_REVIEW never reads as approved/executed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Play, Send, ShieldCheck } from "lucide-react";
import { PageHeader } from "../components/domain/PageHeader";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { useI18n, type MessageKey } from "../i18n";
import {
  DEMO_CASE_IDS,
  createAutopilotApi,
  type AutopilotCaseResult,
  type AutopilotRun,
  type AutopilotSubmissionBatch,
  type AutopilotSubmitResult,
  type TriageDecision,
} from "../api/autopilot";
import { batchStatus, submissionStatus, triageStatus } from "../lib/merchantLanguage";
import { serviceHandle } from "../api";

const LAST_RUN_KEY = "dp.autopilot.lastRunId";

const TONE: Record<string, BadgeTone> = {
  pass: "pass",
  info: "info",
  warn: "warn",
  stop: "stop",
  neutral: "neutral",
};

/** Group the run result the way a merchant thinks about it. */
const GROUP_OF: Record<TriageDecision, { leadKey: MessageKey; tone: BadgeTone }> = {
  READY_FOR_REVIEW: { leadKey: "assistant.readyLead", tone: "info" },
  BLOCKED: { leadKey: "assistant.blockedLead", tone: "stop" },
  WAIT: { leadKey: "assistant.waitLead", tone: "neutral" },
  NEEDS_HUMAN: { leadKey: "assistant.judgementLead", tone: "warn" },
  FAILED: { leadKey: "assistant.failedLead", tone: "stop" },
};

const failure = (error: unknown): { code: string; message: string } => {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return {
      code: String((error as { code: unknown }).code),
      message: String((error as { message: unknown }).message),
    };
  }
  return { code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
};

export function AssistantPage() {
  const { t } = useI18n();
  const api = useMemo(() => createAutopilotApi(), []);

  const [caseText, setCaseText] = useState(DEMO_CASE_IDS.join("\n"));
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<{ code: string; message: string } | null>(null);
  const [run, setRun] = useState<AutopilotRun | null>(null);
  const [restored, setRestored] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);
  const [submission, setSubmission] = useState<AutopilotSubmitResult | null>(null);
  const submissionRef = useRef<HTMLDivElement | null>(null);

  const [history, setHistory] = useState<AutopilotSubmissionBatch[]>([]);
  const [historyError, setHistoryError] = useState<{ code: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState<AutopilotSubmissionBatch | null>(null);

  const parseCaseIds = (): string[] =>
    caseText
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

  const loadHistory = async (runId: string): Promise<void> => {
    try {
      const batches = await api.listSubmissionBatches(runId);
      setHistory(batches);
      setHistoryError(null);
    } catch (error) {
      setHistory([]);
      setHistoryError(failure(error));
    }
  };

  const openBatch = async (batchId: string): Promise<void> => {
    if (expanded?.submission_batch_id === batchId) {
      setExpanded(null);
      return;
    }
    try {
      setExpanded(await api.getSubmissionBatch(batchId));
      setHistoryError(null);
    } catch (error) {
      setHistoryError(failure(error));
    }
  };

  // A refresh (or the "view batch" link from an approval) restores the run and
  // its stored batches from the backend — never from memory.
  useEffect(() => {
    let cancelled = false;
    const requestedBatch = new URLSearchParams(window.location.search).get("batch");
    void (async () => {
      try {
        if (requestedBatch) {
          const batch = await api.getSubmissionBatch(requestedBatch);
          const previous = await api.getRun(batch.run_id);
          if (cancelled) return;
          setRun(previous);
          setCaseText(previous.requested_case_ids.join("\n"));
          setExpanded(batch);
          window.localStorage.setItem(LAST_RUN_KEY, previous.run_id);
          await loadHistory(previous.run_id);
          return;
        }
        const stored = window.localStorage.getItem(LAST_RUN_KEY);
        if (!stored) return;
        const previous = await api.getRun(stored);
        if (cancelled) return;
        setRun(previous);
        setCaseText(previous.requested_case_ids.join("\n"));
        setRestored(true);
        await loadHistory(previous.run_id);
      } catch (error) {
        if (cancelled) return;
        if (requestedBatch) setHistoryError(failure(error));
        else window.localStorage.removeItem(LAST_RUN_KEY);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runBatch = async (): Promise<void> => {
    const caseIds = parseCaseIds();
    setRunning(true);
    setRunError(null);
    setSubmission(null);
    setExpanded(null);
    setHistory([]);
    try {
      const next = await api.createRun(caseIds);
      setRun(next);
      setRestored(false);
      window.localStorage.setItem(LAST_RUN_KEY, next.run_id);
      await loadHistory(next.run_id);
    } catch (error) {
      setRunError(failure(error));
    } finally {
      setRunning(false);
    }
  };

  const submitAll = async (): Promise<void> => {
    if (!run) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const next = await api.submitForReview(run.run_id);
      setSubmission(next);
      setConfirmOpen(false);
      setExpanded(null);
      await loadHistory(run.run_id);
      // QA-RC-06: submitting creates pending approvals through the autopilot
      // client, which the workspace cache knows nothing about. Without this
      // the Overview still showed the pre-submit counts until a page reload.
      await serviceHandle.refresh().catch(() => undefined);
      submissionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setSubmitError(failure(error));
    } finally {
      setSubmitting(false);
    }
  };

  const results = run?.results ?? [];
  const eligible = results.filter(
    (item) => item.decision === "READY_FOR_REVIEW" && item.candidate_actions.length > 0,
  );
  const grouped = (["READY_FOR_REVIEW", "BLOCKED", "NEEDS_HUMAN", "WAIT", "FAILED"] as TriageDecision[])
    .map((decision) => ({
      decision,
      items: results.filter((item) => item.decision === decision),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-5 lg:px-6 lg:py-6">
      <PageHeader
        eyebrow={t("nav.assistant")}
        title={t("assistant.title")}
        description={t("assistant.merchantSubtitle")}
      />

      <Card className="mt-4">
        <CardHeader
          title={t("assistant.runCta")}
          subtitle={t("assistant.noExecHint")}
        />
        <div className="border-t border-line px-4 py-3">
          <label className="eyebrow" htmlFor="assistant-cases">
            {t("autopilot.inputLabel")}
          </label>
          <textarea
            id="assistant-cases"
            value={caseText}
            onChange={(event) => setCaseText(event.target.value)}
            rows={5}
            spellCheck={false}
            className="mt-1 w-full resize-y rounded-md border border-line bg-card px-3 py-2 font-mono text-xs leading-5 text-ink outline-none transition-colors focus:border-navy-600"
          />
          <p className="mt-1 text-xs text-ink-faint">{t("autopilot.inputFootnote")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void runBatch()} disabled={running}>
              <Play size={13} aria-hidden />
              {running ? t("autopilot.run") : t("assistant.runCta")}
            </Button>
            {run ? (
              <Button
                variant="secondary"
                onClick={() => setConfirmOpen(true)}
                disabled={eligible.length === 0}
              >
                <Send size={13} aria-hidden />
                {t("assistant.submitCta")}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {runError ? (
        <div className="mt-3">
          <ErrorState title={t("autopilot.runFailed")} detail={`${runError.code}: ${runError.message}`} />
        </div>
      ) : null}

      {running ? <LoadingState /> : null}

      {run ? (
        <>
          {restored ? (
            <p className="mt-3 text-xs text-ink-faint">{t("autopilot.restoredRun")}</p>
          ) : null}

          <Card className="mt-4">
            <CardHeader
              title={t("assistant.resultTitle")}
              subtitle={t("autopilot.resultsHint", {
                analyzed: run.analyzed_cases,
                total: run.total_cases,
              })}
              actions={
                <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                  <ShieldCheck size={12} aria-hidden />
                  {t("autopilot.executedNone", { count: run.executed_actions })}
                </span>
              }
            />
            <div className="border-t border-line">
              {grouped.map((group) => {
                const lead = GROUP_OF[group.decision];
                return (
                  <div key={group.decision} className="border-b border-line last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2 bg-sunken/50 px-4 py-2">
                      <Badge tone={lead.tone}>{t(lead.leadKey)}</Badge>
                      <span className="num text-xs text-ink-muted">
                        {t("autopilot.groupCount", { count: group.items.length })}
                      </span>
                    </div>
                    <ul className="divide-y divide-line">
                      {group.items.map((item) => (
                        <ResultRow key={item.case_id} item={item} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      ) : null}

      {submitError ? (
        <div className="mt-3">
          <ErrorState
            title={t("autopilot.submitFailed")}
            detail={`${submitError.code}: ${submitError.message}`}
          />
        </div>
      ) : null}

      {submission ? (
        <div ref={submissionRef}>
          <Card className="mt-3">
            <CardHeader
              title={t("autopilot.submissionTitle")}
              subtitle={t("autopilot.submitHint")}
              actions={
                <Badge tone={TONE[batchStatus(submission.status).tone]}>
                  {t(batchStatus(submission.status).labelKey)}
                </Badge>
              }
            />
            <div className="border-t border-line">
              <p className="px-4 pt-3 text-xs leading-5 text-ink-muted">
                {t(batchStatus(submission.status).meaningKey)}
              </p>
              {/* QA-RC-07: state the real denominator. The batch only covers
                  the cases that were eligible, so "all submitted" must say how
                  many of the run that actually is. */}
              <p className="px-4 pt-1 text-xs leading-5 text-ink-muted">
                {t("autopilot.submissionCounts", {
                  submitted:
                    submission.submitted_cases + submission.already_submitted_cases,
                  total: submission.run_case_count ?? run?.results.length ?? submission.total_cases,
                })}
              </p>
              <ul className="mt-2 divide-y divide-line">
                {submission.results.map((item) => {
                  const status = submissionStatus(item.status);
                  return (
                    <li key={item.case_id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                      <span className="font-mono text-2xs font-medium text-ink-strong">
                        {item.case_id}
                      </span>
                      <Badge tone={TONE[status.tone]}>{t(status.labelKey)}</Badge>
                      <span className="font-mono text-2xs text-ink-faint">{item.reason_code}</span>
                      {item.approval_id ? (
                        <span className="num text-2xs text-ink-faint">
                          {item.approval_id}
                        </span>
                      ) : null}
                      {item.reasons[0] ? (
                        <span className="text-2xs text-ink-muted">· {item.reasons[0]}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-line px-4 py-2 text-xs text-ink-faint">
                {t("autopilot.executedNone", { count: submission.executed_actions })}
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      <Card className="mt-3">
        <CardHeader title={t("autopilot.historyTitle")} subtitle={t("autopilot.historyHint")} />
        <div className="border-t border-line">
          {historyError ? (
            <div className="px-4 py-3 text-xs text-stop">
              {t("autopilot.historyLoadFailed")}: {historyError.code} — {historyError.message}
            </div>
          ) : history.length === 0 ? (
            <div className="px-4 py-3">
              <EmptyState title={t("autopilot.historyEmpty")} body={t("autopilot.historyEmptyHint")} />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {history.map((batch) => {
                const isOpen = expanded?.submission_batch_id === batch.submission_batch_id;
                const status = batchStatus(batch.status);
                return (
                  <li key={batch.submission_batch_id}>
                    <button
                      type="button"
                      onClick={() => void openBatch(batch.submission_batch_id)}
                      aria-expanded={isOpen}
                      className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left hover:bg-hover"
                    >
                      <span className="font-mono text-2xs text-ink-strong">
                        {batch.submission_batch_id}
                      </span>
                      <Badge tone={TONE[status.tone]}>{t(status.labelKey)}</Badge>
                      <span className="font-mono text-2xs text-ink-faint" title={batch.status}>
                        {batch.submission_batch_id}
                      </span>
                      <span className="text-2xs text-ink-faint">
                        {t("autopilot.historyCounts", {
                          submitted: batch.submitted_cases,
                          already: batch.already_submitted_cases,
                          skipped: batch.skipped_cases,
                          blocked: batch.blocked_cases,
                          failed: batch.failed_cases,
                        })}
                      </span>
                      <span className="ml-auto num text-2xs text-ink-faint">{batch.submitted_at}</span>
                    </button>
                    {isOpen && expanded ? (
                      <div className="bg-sunken/40 px-4 pb-3">
                        <ul className="space-y-1.5 pt-1">
                          {expanded.results.map((item) => {
                            const itemStatus = submissionStatus(item.status);
                            return (
                              <li key={item.case_id} className="text-xs leading-5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-2xs font-medium text-ink-strong">
                                    {item.case_id}
                                  </span>
                                  <Badge tone={TONE[itemStatus.tone]}>{t(itemStatus.labelKey)}</Badge>
                                  <span className="font-mono text-2xs text-ink-faint">
                                    {item.reason_code}
                                  </span>
                                  <span className="font-mono text-2xs text-ink-faint">
                                    {t("autopilot.historyProposal", {
                                      proposal: item.proposal_id ?? "—",
                                    })}
                                  </span>
                                  <span className="font-mono text-2xs text-ink-faint">
                                    {t("autopilot.historyApproval", {
                                      approval: item.approval_id ?? "—",
                                    })}
                                  </span>
                                </div>
                                {item.reasons[0] ? (
                                  <div className="text-2xs text-ink-muted">· {item.reasons[0]}</div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("autopilot.confirmTitle")}
        description={t("autopilot.confirmIntro")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void submitAll()} disabled={submitting}>
              <Send size={13} aria-hidden />
              {submitting ? t("autopilot.submitAction") : t("autopilot.submitAction")}
            </Button>
          </>
        }
      >
        <ul className="space-y-1 text-xs">
          {eligible.map((item) => (
            <li key={item.case_id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-2xs font-medium text-ink-strong">{item.case_id}</span>
              {item.candidate_actions.map((action) => (
                <span key={action.action_type} className="text-ink-muted">
                  {/* QA-RC-07: the template interpolates {state}, not
                      {proposal} — passing the wrong key left the raw
                      "{state}" placeholder on screen. */}
                  {t("autopilot.candidateLine", {
                    action: action.action_type,
                    state: action.state,
                  })}
                </span>
              ))}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs leading-5 text-ink-faint">{t("autopilot.confirmWarning")}</p>
      </Dialog>
    </div>
  );
}

/** One dispute in the run result, in merchant language. */
function ResultRow({ item }: { item: AutopilotCaseResult }) {
  const { t } = useI18n();
  const status = triageStatus(item.decision);
  const [techOpen, setTechOpen] = useState(false);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-ink-strong">{item.case_id}</span>
        <Badge tone={TONE[status.tone]}>{t(status.labelKey)}</Badge>
        <span className="font-mono text-2xs text-ink-faint" title={item.decision}>
          {item.decision}
        </span>
        {item.validator ? (
          <span className="text-2xs text-ink-faint">
            {item.validator.passed
              ? t("autopilot.validator.passed", { passed: item.validator.checked })
              : t("autopilot.validator.failed")}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-5 text-ink-muted">{t(status.meaningKey)}</p>

      {item.policy.blocked ? (
        <p className="mt-1 flex items-start gap-1 text-xs leading-5 text-stop">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          {t("merchant.reason.evidenceInsufficient")}
        </p>
      ) : null}

      {item.decision_reasons.length ? (
        <ul className="mt-1 space-y-0.5">
          {item.decision_reasons.map((reason, index) => (
            <li key={index} className="text-2xs leading-5 text-ink-muted">
              · {reason}
            </li>
          ))}
        </ul>
      ) : null}

      {item.candidate_actions.length ? (
        <ul className="mt-1.5 space-y-1">
          {item.candidate_actions.map((action) => (
            <li key={action.action_type} className="text-xs text-ink">
              <span className="font-medium">{action.action_type}</span>
              <span className="ml-1.5 font-mono text-2xs text-ink-faint">{action.proposal_id}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => setTechOpen((open) => !open)}
        className="mt-1.5 inline-flex items-center gap-1 text-2xs text-ink-faint hover:text-ink-muted"
      >
        <ChevronDown
          size={11}
          aria-hidden
          className={techOpen ? "rotate-180 transition-transform" : "transition-transform"}
        />
        {t("autopilot.technicalDetails")}
      </button>
      {techOpen ? (
        <div className="mt-1 space-y-1 rounded-md border border-line bg-sunken/40 px-2.5 py-2">
          <div className="font-mono text-2xs text-ink-faint">
            {t("autopilot.caseId", { id: item.case_id })} · {item.decision}
          </div>
          {item.evidence?.missing_facts.length ? (
            <ul className="space-y-0.5">
              {item.evidence.missing_facts.map((fact, index) => (
                <li key={index} className="text-2xs leading-5 text-ink-muted">
                  · {fact}
                </li>
              ))}
            </ul>
          ) : null}
          {item.evidence?.missing_evidence.length ? (
            <div className="text-2xs leading-5 text-ink-muted">
              {t("autopilot.missingEvidence", { count: item.evidence.missing_evidence.length })}
            </div>
          ) : null}
          {item.candidate_actions.map((action) => (
            <div key={action.action_type} className="font-mono text-2xs text-ink-faint">
              {action.proposal_id} · {action.payload_hash}
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}
