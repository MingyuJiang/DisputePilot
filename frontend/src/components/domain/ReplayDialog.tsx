import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Info, Loader2, ShieldCheck, XCircle } from "lucide-react";
import type { ReplayResult } from "../../api/types";
import { disputePilot } from "../../api";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { ReplaySimulatedBadge } from "./Badges";
import { useI18n, type MessageKey } from "../../i18n";

/** PASS / FAIL are verdicts; INFO is metadata; the rest are progress states. */
type RowState = "PASS" | "FAIL" | "INFO" | "SKIPPED" | "RUNNING" | "AWAITING" | "PENDING";

const STEPS: { labelKey: MessageKey; noteKey: MessageKey }[] = [
  { labelKey: "replay.check1", noteKey: "replay.check1Note" },
  { labelKey: "replay.check2", noteKey: "replay.check2Note" },
  { labelKey: "replay.check3", noteKey: "replay.check3Note" },
  { labelKey: "replay.check4", noteKey: "replay.check4Note" },
];

export function ReplayDialog({
  open,
  proposalId,
  caseId,
  live = false,
  onClose,
  onFinished,
}: {
  open: boolean;
  proposalId: string;
  caseId: string;
  /** LIVE Sandbox execution: never use replay wording for this attempt. */
  live?: boolean;
  onClose: () => void;
  onFinished?: (result: ReplayResult) => void;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<{ status: number; code: string; message: string } | null>(null);
  /** Incremented by the retry button; also the re-open key of the run effect. */
  const [attempt, setAttempt] = useState(0);

  // QA-RC-02: one effect owns the whole run. It is keyed on
  // `open + proposalId + attempt`, so opening the dialog again (or pressing
  // retry) always produces a fresh attempt. The previous version gated the
  // request on a `step` that was already at the end plus a `executedRef` that
  // survived the close, so a second open reset the animation but never fired
  // the request again — the dialog sat in "Revalidating…" forever.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setResult(null);
    setError(null);

    let cancelled = false;
    const timer = window.setInterval(() => {
      setStep((current) => (current >= STEPS.length ? current : current + 1));
    }, 480);

    // RC-2: the request is awaited. The dialog stays in "running" until the
    // backend answers, so a slow or failed call can never look like a block
    // with zero checks — that reading is what invited duplicate executions.
    void (async () => {
      try {
        const outcome = await disputePilot.replay(proposalId);
        if (cancelled) return;
        setResult(outcome);
        setStep(STEPS.length);
        onFinished?.(outcome);
      } catch (cause) {
        if (cancelled) return;
        const shaped = cause as { status?: number; code?: string; message?: string };
        setError({
          status: typeof shaped?.status === "number" ? shaped.status : 0,
          code: shaped?.code ?? "NETWORK_ERROR",
          message: shaped?.message ?? String(cause),
        });
        setStep(STEPS.length);
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // onFinished is intentionally read once at completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proposalId, attempt]);

  const running = result === null && error === null;
  // QA-RC-03: only PASS/FAIL are checks. INFO rows are metadata and must not
  // inflate either the numerator or the denominator of "N/M passed".
  const verdicts = result
    ? result.revalidation.filter((item) => item.status === "PASS" || item.status === "FAIL")
    : [];
  const passed = verdicts.filter((item) => item.status === "PASS").length;
  // QA-RC-03: once the backend answers we render exactly what it reported. The
  // four named phases are a progress animation only; they are never presented
  // as the validator's result.
  const reported = result?.revalidation ?? [];

  // Before the answer arrives, the four named phases animate the progress.
  // After it arrives, the backend's own rows are the only thing rendered.
  const rows: { key: string; label: string; note: string; status: RowState | null }[] =
    reported.length > 0
      ? reported.map((item, index) => ({
          key: `${item.label}-${index}`,
          label: item.label,
          note: item.note,
          status: item.status,
        }))
      : STEPS.map((item) => ({
          key: item.labelKey,
          label: t(item.labelKey),
          note: t(item.noteKey),
          status: null,
        }));

  // A 403/409/422 is a real answer from the backend, not a transport failure:
  // each gets its own wording instead of one generic "blocked".
  const errorTitleKey: MessageKey =
    error?.status === 403
      ? "replay.errorForbidden"
      : error?.status === 409
        ? "replay.errorConflict"
        : error?.status === 422
          ? "replay.errorRejected"
          : error?.status === 0
            ? "replay.errorNetwork"
            : "replay.errorServer";

  return (
    <Dialog
      open={open}
      onClose={running ? () => undefined : onClose}
      title={t(live ? "execution.dialogTitle" : "replay.title")}
      description={t(live ? "execution.dialogDescription" : "replay.description")}
      width="max-w-[600px]"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              navigate(`/audit?case=${caseId}`);
            }}
            disabled={running}
          >
            {t("replay.openAudit")}
          </Button>
          {error ? (
            <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
              {t("replay.retry")}
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose} disabled={running}>
            {running ? t("replay.revalidating") : t("common.done")}
          </Button>
        </>
      }
    >
      {reported.length > 0 ? (
        <p className="mb-2 text-2xs uppercase tracking-[0.06em] text-ink-faint">
          {t("replay.checksTitle")}
        </p>
      ) : null}
      <div className="space-y-2">
        {rows.map((item, index) => {
          // No report → the row is simply "awaiting", never a fabricated PASS.
          const state: RowState = item.status ?? (
            error
              ? "SKIPPED"
              : index === step && running
                ? "RUNNING"
                : index < step
                  ? "AWAITING"
                  : "PENDING"
          );
          return (
            <div
              key={item.key}
              className={[
                "flex items-start gap-2.5 rounded-md border px-3 py-2",
                state === "FAIL"
                  ? "border-stop-line bg-stop-bg"
                  : state === "PASS"
                    ? "border-pass-line bg-pass-bg/50"
                    : "border-line bg-subtle",
              ].join(" ")}
            >
              <span className="mt-0.5 shrink-0">
                {state === "RUNNING" ? (
                  <Loader2 size={14} className="animate-spin text-info" aria-hidden />
                ) : state === "FAIL" ? (
                  <XCircle size={14} className="text-stop" aria-hidden />
                ) : state === "PASS" ? (
                  <CheckCircle2 size={14} className="text-pass" aria-hidden />
                ) : state === "INFO" ? (
                  <Info size={14} className="text-ink-faint" aria-hidden />
                ) : (
                  <span className="block h-3.5 w-3.5 rounded-full border border-line-strong bg-card" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink">{item.label}</span>
                  <span className="text-xs uppercase tracking-[0.06em] text-ink-faint">
                    {state === "PENDING"
                      ? t("replay.queued")
                      : state === "PASS"
                        ? t("replay.passed")
                        : state === "FAIL"
                          ? t("replay.failed")
                          : state === "INFO"
                            ? t("replay.info")
                            : state === "SKIPPED"
                              ? t("replay.notRun")
                              : state === "AWAITING"
                                ? t("replay.noReportYet")
                                : t("replay.running")}
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-4 text-ink-muted">{item.note}</p>
              </div>
            </div>
          );
        })}
      </div>

      {result ? (
        <div
          className={[
            "mt-3 rounded-md border px-3 py-2.5",
            result.outcome === "SUCCEEDED"
              ? "border-pass-line bg-pass-bg"
              : result.outcome === "UNVERIFIED"
                ? "border-warn-line bg-warn-bg"
                : "border-stop-line bg-stop-bg",
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            {result.outcome === "SUCCEEDED" ? (
              <ShieldCheck size={14} className="text-pass" aria-hidden />
            ) : (
              <XCircle
                size={14}
                className={result.outcome === "UNVERIFIED" ? "text-warn" : "text-stop"}
                aria-hidden
              />
            )}
            <span
              className={[
                "text-xs font-semibold",
                result.outcome === "SUCCEEDED"
                  ? "text-pass"
                  : result.outcome === "UNVERIFIED"
                    ? "text-warn"
                    : "text-stop",
              ].join(" ")}
            >
              {result.outcome === "SUCCEEDED"
                ? t(result.simulated === false ? "execution.requestRecorded" : "replay.verified")
                : result.outcome === "UNVERIFIED"
                  ? t("execution.resultUnknown")
                  : t(
                      result.simulated === false
                        ? result.outcome === "BLOCKED"
                          ? "execution.blocked"
                          : "execution.failed"
                        : "replay.blocked",
                    )}
            </span>
            {result.httpStatus ? <Badge tone="neutral">HTTP {result.httpStatus}</Badge> : null}
            {result.simulated ? <ReplaySimulatedBadge /> : null}
            <span className="num ml-auto text-xs text-ink-faint">
              {verdicts.length === 0
                ? t("replay.noChecksReported")
                : t("replay.checksPassed", { passed, total: verdicts.length })}
            </span>
          </div>
          <p className="mt-1 text-base leading-4 text-ink">{result.message}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {result.simulated === false ? t("execution.dialogNote") : t("replay.simulatedNote")}
          </p>
        </div>
      ) : error ? (
        <div className="mt-3 rounded-md border border-stop-line bg-stop-bg px-3 py-2.5" role="alert">
          <div className="flex flex-wrap items-center gap-2">
            <XCircle size={14} className="text-stop" aria-hidden />
            <span className="text-xs font-semibold text-stop">{t(errorTitleKey)}</span>
            {error.status ? <Badge tone="neutral">HTTP {error.status}</Badge> : null}
            <span className="font-mono text-2xs text-ink-faint">{error.code}</span>
          </div>
          <p className="mt-1 text-base leading-4 text-ink">{error.message}</p>
          <p className="mt-1 text-xs text-ink-muted">{t("replay.errorHint")}</p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-faint">
          {t(live ? "execution.dialogWaiting" : "replay.waiting")}
        </p>
      )}
    </Dialog>
  );
}
