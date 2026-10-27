/**
 * Autopilot (MVP-1) — batch triage + batch review submission.
 *
 * Two hard rules this page never breaks:
 *  1. every status shown is the backend's answer, never a guess from a click;
 *  2. SUBMITTED_FOR_REVIEW is rendered as "submitted for review" — never as
 *     approved, executed or replayed. Approving stays a manager action.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Play, Send, ShieldCheck } from "lucide-react";
import { PageHeader } from "../components/domain/PageHeader";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { useI18n, type MessageKey } from "../i18n";
import {
  DEMO_CASE_IDS,
  createAutopilotApi,
  type AutopilotCaseResult,
  type AutopilotRun,
  type AutopilotSubmissionBatch,
  type AutopilotSubmitResult,
  type ReviewSubmissionStatus,
  type TriageDecision,
} from "../api/autopilot";

const DECISION_TONE: Record<TriageDecision, BadgeTone> = {
  READY_FOR_REVIEW: "pass",
  NEEDS_HUMAN: "warn",
  BLOCKED: "stop",
  WAIT: "neutral",
  FAILED: "stop",
};

const DECISION_KEY: Record<TriageDecision, MessageKey> = {
  READY_FOR_REVIEW: "autopilot.decision.ready",
  NEEDS_HUMAN: "autopilot.decision.needsHuman",
  BLOCKED: "autopilot.decision.blocked",
  WAIT: "autopilot.decision.wait",
  FAILED: "autopilot.decision.failed",
};

const LAST_RUN_KEY = "dp.autopilot.lastRunId";

const BATCH_TONE: Record<AutopilotSubmissionBatch["status"], BadgeTone> = {
  COMPLETED: "pass",
  PARTIAL: "warn",
  NOTHING_SUBMITTED: "neutral",
  FAILED: "stop",
};

const SUBMISSION_TONE: Record<ReviewSubmissionStatus, BadgeTone> = {
  SUBMITTED_FOR_REVIEW: "pass",
  ALREADY_SUBMITTED: "info",
  SKIPPED_NOT_ELIGIBLE: "neutral",
  BLOCKED_VALIDATION: "stop",
  BLOCKED_STALE: "warn",
  FAILED: "stop",
};

const SUBMISSION_KEY: Record<ReviewSubmissionStatus, MessageKey> = {
  SUBMITTED_FOR_REVIEW: "autopilot.submitStatus.submitted",
  ALREADY_SUBMITTED: "autopilot.submitStatus.already",
  SKIPPED_NOT_ELIGIBLE: "autopilot.submitStatus.skipped",
  BLOCKED_VALIDATION: "autopilot.submitStatus.blockedValidation",
  BLOCKED_STALE: "autopilot.submitStatus.blockedStale",
  FAILED: "autopilot.submitStatus.failed",
};

function parseCaseIds(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function validatorLabel(item: AutopilotCaseResult, t: (key: MessageKey) => string): string {
  if (!item.validator) return t("autopilot.validator.notRun");
  return item.validator.passed
    ? t("autopilot.validator.passed")
    : t("autopilot.validator.failed");
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-line bg-card px-3 py-2">
      <div className="text-2xs uppercase tracking-[0.08em] text-ink-faint">{label}</div>
      <div className={["num mt-0.5 text-lg font-semibold", tone ?? "text-ink-strong"].join(" ")}>
        {value}
      </div>
    </div>
  );
}

export function AutopilotPage() {
  const { t } = useI18n();
  const api = useMemo(() => createAutopilotApi(), []);
  const [caseText, setCaseText] = useState<string>(DEMO_CASE_IDS.join("\n"));
  const [run, setRun] = useState<AutopilotRun | null>(null);
  const [runError, setRunError] = useState<{ code: string; message: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<AutopilotSubmitResult | null>(null);
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);
  const [history, setHistory] = useState<AutopilotSubmissionBatch[]>([]);
  const [historyError, setHistoryError] = useState<{ code: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState<AutopilotSubmissionBatch | null>(null);
  const [restored, setRestored] = useState(false);
  const [batchError, setBatchError] = useState<{ code: string; message: string } | null>(null);
  const submissionRef = useRef<HTMLDivElement | null>(null);

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
      const detail = await api.getSubmissionBatch(batchId);
      setExpanded(detail);
      setHistoryError(null);
    } catch (error) {
      setHistoryError(failure(error));
    }
  };

  // Deep link from an approval ("view submission batch") or a plain refresh:
  // both re-read the run and its batches from the backend, never from memory.
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
        if (requestedBatch) {
          setBatchError(failure(error));
        } else {
          window.localStorage.removeItem(LAST_RUN_KEY);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The result of a batch submission must be visible without hunting for it:
  // the per-case statuses are the answer to the click.
  useEffect(() => {
    const node = submissionRef.current;
    // jsdom (and a few embedded browsers) do not implement scrollIntoView;
    // the statuses are still rendered, so the missing smooth scroll is benign.
    if (submission && node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [submission]);

  const caseIds = parseCaseIds(caseText);
  const eligible = run?.results.filter((item) => item.decision === "READY_FOR_REVIEW") ?? [];
  const notEligible = (run?.results.length ?? 0) - eligible.length;
  const proposals = eligible.flatMap((item) =>
    item.candidate_actions
      .filter((candidate) => candidate.action_type !== "wait")
      .map((candidate) => ({ caseId: item.case_id, candidate })),
  );

  const failure = (error: unknown): { code: string; message: string } => {
    if (error && typeof error === "object" && "code" in error && "message" in error) {
      const typed = error as { code: unknown; message: unknown };
      return { code: String(typed.code), message: String(typed.message) };
    }
    return { code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
  };

  const runBatch = async (): Promise<void> => {
    setRunning(true);
    setRunError(null);
    setSubmission(null);
    setSubmitError(null);
    try {
      const next = await api.createRun(caseIds);
      setRun(next);
      setRestored(false);
      setExpanded(null);
      setHistory([]);
      window.localStorage.setItem(LAST_RUN_KEY, next.run_id);
      await loadHistory(next.run_id);
    } catch (error) {
      setRun(null);
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
    } catch (error) {
      setSubmitError(failure(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-6 lg:px-6">
      <PageHeader
        eyebrow={t("autopilot.eyebrow")}
        title={t("autopilot.title")}
        description={t("autopilot.description")}
        actions={
          <Button
            variant="primary"
            onClick={() => void runBatch()}
            loading={running}
            disabled={caseIds.length === 0}
          >
            <Play size={14} aria-hidden />
            {t("autopilot.run")}
          </Button>
        }
      />

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title={t("autopilot.inputTitle")} subtitle={t("autopilot.inputHint")} />
          <div className="px-4 py-3">
            <label className="text-xs font-medium text-ink-muted" htmlFor="autopilot-cases">
              {t("autopilot.inputLabel")}
            </label>
            <textarea
              id="autopilot-cases"
              value={caseText}
              onChange={(event) => setCaseText(event.target.value)}
              rows={5}
              spellCheck={false}
              className="mt-1 w-full rounded-md border border-line-strong bg-card px-2.5 py-2 font-mono text-xs text-ink-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
            />
            <p className="mt-1.5 text-xs text-ink-faint">{t("autopilot.inputFootnote")}</p>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("autopilot.safetyTitle")} />
          <div className="space-y-2 px-4 py-3 text-xs leading-5 text-ink-muted">
            <p className="flex items-start gap-1.5">
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-pass" aria-hidden />
              {t("autopilot.safetyTriage")}
            </p>
            <p className="flex items-start gap-1.5">
              <Send size={13} className="mt-0.5 shrink-0 text-navy-700" aria-hidden />
              {t("autopilot.safetySubmit")}
            </p>
            <p className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              {t("autopilot.safetyBoundary")}
            </p>
          </div>
        </Card>
      </div>

      {batchError ? (
        <div className="mt-4">
          <ErrorState
            title={t("autopilot.batchLoadFailed")}
            detail={`${batchError.code}: ${batchError.message}`}
          />
        </div>
      ) : null}

      {runError ? (
        <div className="mt-4">
          <ErrorState
            title={t("autopilot.runFailed")}
            detail={`${runError.code}: ${runError.message}`}
          />
        </div>
      ) : null}

      {run ? (
        <>
          {restored ? (
            <p className="mt-3 text-xs text-ink-faint">{t("autopilot.restoredRun")}</p>
          ) : null}
          <Card className="mt-4">
            <CardHeader
              title={t("autopilot.runTitle")}
              subtitle={
                <span className="font-mono text-xs text-ink-muted">{run.run_id}</span>
              }
              actions={
                <Badge tone={run.status === "COMPLETED" ? "pass" : run.status === "PARTIAL" ? "warn" : "stop"}>
                  {run.status}
                </Badge>
              }
            />
            <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-4 lg:grid-cols-7">
              <Stat label={t("autopilot.stat.total")} value={run.total_cases} />
              <Stat label={t("autopilot.stat.analyzed")} value={run.analyzed_cases} />
              <Stat label={t("autopilot.stat.ready")} value={run.ready_for_review_cases} tone="text-pass" />
              <Stat label={t("autopilot.stat.needsHuman")} value={run.needs_human_cases} tone="text-warn" />
              <Stat label={t("autopilot.stat.blocked")} value={run.blocked_cases} tone="text-stop" />
              <Stat label={t("autopilot.stat.wait")} value={run.wait_cases} />
              <Stat label={t("autopilot.stat.failed")} value={run.failed_cases} tone="text-stop" />
            </div>
            <div className="border-t border-line px-4 py-2 text-xs text-ink-faint">
              {t("autopilot.executedNone", { count: run.executed_actions })}
            </div>
          </Card>

          <Card className="mt-3">
            <CardHeader
              title={t("autopilot.resultsTitle")}
              subtitle={t("autopilot.resultsHint")}
            />
            <div className="divide-y divide-line">
              {run.results.map((item) => (
                <div key={item.case_id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium text-ink-strong">
                      {item.case_id}
                    </span>
                    <Badge tone={DECISION_TONE[item.decision]}>{t(DECISION_KEY[item.decision])}</Badge>
                    <Badge tone={item.validator?.passed ? "neutral" : item.validator ? "stop" : "neutral"}>
                      {validatorLabel(item, t)}
                      {item.validator ? ` · ${item.validator.checked}` : ""}
                    </Badge>
                    {item.policy.blocked ? (
                      <Badge tone="stop">{t("autopilot.policyBlocked")}</Badge>
                    ) : null}
                    {item.requires_human ? (
                      <Badge tone="warn">{t("autopilot.needsHumanBadge")}</Badge>
                    ) : null}
                    {item.executed ? <Badge tone="stop">{t("autopilot.executedBadge")}</Badge> : null}
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {item.decision_reasons.slice(0, 4).map((reason, index) => (
                      <li key={index} className="text-xs leading-5 text-ink-muted">
                        · {reason}
                      </li>
                    ))}
                  </ul>
                  {item.reason_codes.length ? (
                    <div className="mt-1 font-mono text-2xs text-ink-faint">
                      {item.reason_codes.join(" · ")}
                    </div>
                  ) : null}
                  {item.candidate_actions.length ? (
                    <div className="mt-1 font-mono text-2xs text-ink-faint">
                      {t("autopilot.candidateLine", {
                        action: item.candidate_actions[0].action_type,
                        state: item.candidate_actions[0].state,
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card className="mt-3">
            <CardHeader
              title={t("autopilot.submitTitle")}
              subtitle={t("autopilot.submitHint")}
              actions={
                <Button
                  variant="primary"
                  onClick={() => setConfirmOpen(true)}
                  disabled={eligible.length === 0}
                >
                  <Send size={14} aria-hidden />
                  {t("autopilot.submitAction")}
                </Button>
              }
            />
            <div className="px-4 py-3 text-xs leading-5 text-ink-muted">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label={t("autopilot.stat.eligible")} value={eligible.length} tone="text-pass" />
                <Stat label={t("autopilot.stat.notEligible")} value={notEligible} />
                <Stat label={t("autopilot.stat.proposals")} value={proposals.length} />
                <Stat label={t("autopilot.stat.alreadySubmitted")} value={submission?.already_submitted_cases ?? 0} />
              </div>
              {eligible.length === 0 ? (
                <div className="mt-3">
                  <EmptyState title={t("autopilot.noEligibleTitle")} body={t("autopilot.noEligibleHint")} />
                </div>
              ) : null}
            </div>
          </Card>
        </>
      ) : null}

      {submission ? (
        <div ref={submissionRef}>
        <Card className="mt-3">
          <CardHeader
            title={t("autopilot.submissionTitle")}
            subtitle={
              <span className="font-mono text-xs text-ink-muted">
                {submission.run_id} · {submission.submitted_at}
              </span>
            }
            actions={
              <Badge
                tone={
                  submission.status === "COMPLETED"
                    ? "pass"
                    : submission.status === "PARTIAL"
                      ? "warn"
                      : "stop"
                }
              >
                {submission.status}
              </Badge>
            }
          />
          <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-5">
            <Stat label={t("autopilot.stat.submitted")} value={submission.submitted_cases} tone="text-pass" />
            <Stat label={t("autopilot.stat.alreadySubmitted")} value={submission.already_submitted_cases} />
            <Stat label={t("autopilot.stat.skipped")} value={submission.skipped_cases} />
            <Stat label={t("autopilot.stat.blocked")} value={submission.blocked_cases} tone="text-stop" />
            <Stat label={t("autopilot.stat.failed")} value={submission.failed_cases} tone="text-stop" />
          </div>
          <div className="divide-y divide-line border-t border-line">
            {submission.results.map((item) => (
              <div key={item.case_id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium text-ink-strong">{item.case_id}</span>
                  <Badge tone={SUBMISSION_TONE[item.status]}>{t(SUBMISSION_KEY[item.status])}</Badge>
                  {item.approval_id ? (
                    <span className="font-mono text-2xs text-ink-faint">{item.approval_id}</span>
                  ) : null}
                  {item.approval_decision ? (
                    <Badge tone="warn">{item.approval_decision}</Badge>
                  ) : null}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {item.reasons.map((reason, index) => (
                    <li key={index} className="text-xs leading-5 text-ink-muted">
                      · {reason}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t border-line px-4 py-2 text-xs text-ink-faint">
            {t("autopilot.executedNone", { count: submission.executed_actions })}
          </div>
        </Card>
        </div>
      ) : null}

      {run ? (
        <Card className="mt-3">
          <CardHeader
            title={t("autopilot.historyTitle")}
            subtitle={t("autopilot.historyHint")}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadHistory(run.run_id)}
              >
                {t("autopilot.historyRefresh")}
              </Button>
            }
          />
          <div className="border-t border-line">
            {historyError ? (
              <div className="px-4 py-3 text-xs text-stop">
                {t("autopilot.historyLoadFailed")}: {historyError.code} — {historyError.message}
              </div>
            ) : history.length === 0 ? (
              <div className="px-4 py-3">
                <EmptyState
                  title={t("autopilot.historyEmpty")}
                  body={t("autopilot.historyEmptyHint")}
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {history.map((batch) => {
                  const isOpen = expanded?.submission_batch_id === batch.submission_batch_id;
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
                        <Badge tone={BATCH_TONE[batch.status]}>{batch.status}</Badge>
                        <span className="text-2xs text-ink-faint">
                          {t("autopilot.historyCounts", {
                            submitted: batch.submitted_cases,
                            already: batch.already_submitted_cases,
                            skipped: batch.skipped_cases,
                            blocked: batch.blocked_cases,
                            failed: batch.failed_cases,
                          })}
                        </span>
                        <span className="ml-auto num text-2xs text-ink-faint">
                          {batch.submitted_at}
                        </span>
                      </button>
                      {isOpen && expanded ? (
                        <div className="bg-sunken/40 px-4 pb-3">
                          <ul className="space-y-1.5 pt-1">
                            {expanded.results.map((item) => (
                              <li key={item.case_id} className="text-xs leading-5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-2xs font-medium text-ink-strong">
                                    {item.case_id}
                                  </span>
                                  <Badge tone={SUBMISSION_TONE[item.status]}>
                                    {t(SUBMISSION_KEY[item.status])}
                                  </Badge>
                                  {item.reason_code ? (
                                    <span className="font-mono text-2xs text-ink-faint">
                                      {item.reason_code}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="font-mono text-2xs text-ink-faint">
                                  {t("autopilot.historyProposal", {
                                    proposal: item.proposal_id ?? "—",
                                  })}
                                  {" · "}
                                  {t("autopilot.historyApproval", {
                                    approval: item.approval_id ?? "—",
                                  })}
                                </div>
                                {item.reasons[0] ? (
                                  <div className="text-2xs text-ink-muted">· {item.reasons[0]}</div>
                                ) : null}
                              </li>
                            ))}
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
      ) : null}

      {submitError ? (
        <div className="mt-3">
          <ErrorState
            title={t("autopilot.submitFailed")}
            detail={`${submitError.code}: ${submitError.message}`}
          />
        </div>
      ) : null}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("autopilot.confirmTitle")}
        description={t("autopilot.confirmIntro")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void submitAll()} loading={submitting}>
              {t("autopilot.confirmAction")}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-xs leading-5 text-ink-muted">
          <div className="rounded-md border border-line bg-sunken px-3 py-2">
            <div className="font-mono text-xs text-ink-strong">{run?.run_id}</div>
            <div className="mt-1">
              {t("autopilot.confirmCounts", {
                eligible: eligible.length,
                other: notEligible,
              })}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-ink-strong">
              {t("autopilot.confirmList")}
            </div>
            <ul className="space-y-1">
              {proposals.map(({ caseId, candidate }) => (
                <li key={candidate.proposal_id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-2xs text-ink-strong">{caseId}</span>
                  <Badge tone="navy">{candidate.action_type}</Badge>
                  <Badge tone={candidate.risk_level === "HIGH" ? "warn" : "neutral"}>
                    {candidate.risk_level}
                  </Badge>
                  <span className="font-mono text-2xs text-ink-faint">{candidate.proposal_id}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
            {t("autopilot.confirmWarning")}
          </p>
        </div>
      </Dialog>
    </div>
  );
}
