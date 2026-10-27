/**
 * Demo reset control (FRONTEND_REDESIGN_PLAN §3.7).
 *
 * Shared by `/demo` and the legacy dialog. Reset is a two-step action and is
 * only enabled when the app runs in HTTP mode against the offline replay
 * backend. A backend refusal is shown with its sandbox / golden / path reason
 * verbatim; the control never retries on its own.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, ShieldX } from "lucide-react";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { disputePilot, type ServiceMode } from "../../api";
import type { DemoResetOutcome } from "../../api/demoReset";
import { resetErrorMessage } from "../../api/demoReset";
import { useI18n, type MessageKey } from "../../i18n";

type ResetState =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "running" }
  | { kind: "done"; message: string; detail?: string }
  | { kind: "failed"; message: string };

export function DemoResetPanel({
  mode = disputePilot.mode,
  offline,
  reset,
  onResetSuccess,
  className = "",
}: {
  mode?: ServiceMode;
  /** Whether the backend runs in offline replay mode (reset is only valid then). */
  offline?: boolean;
  reset?: () => Promise<DemoResetOutcome>;
  onResetSuccess?: () => void | Promise<void>;
  className?: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<ResetState>({ kind: "idle" });

  const resetEnabled = mode === "http" && offline === true;
  const noteKey: MessageKey = mode === "mock" ? "guide.reset.mockOnly" : "guide.reset.offlineOnly";

  const runReset = async () => {
    setState({ kind: "running" });
    const call = reset ?? (() => disputePilot.resetDemo());
    let outcome: DemoResetOutcome;
    try {
      outcome = await call();
    } catch (error) {
      outcome = {
        ok: false,
        error: {
          status: 0,
          code: "CLIENT_ERROR",
          message: error instanceof Error ? error.message : String(error),
          reason: "network",
        },
      };
    }

    if (outcome.ok) {
      const message = t("guide.reset.success", { count: outcome.cases });
      const detail = outcome.backup
        ? t("guide.reset.successDetail", { backup: outcome.backup })
        : undefined;
      setState({ kind: "done", message, detail });
      toast.push({ tone: "success", title: message, detail });
      await onResetSuccess?.();
      return;
    }

    const message = resetErrorMessage(outcome.error);
    setState({ kind: "failed", message });
    toast.push({ tone: "warning", title: t("guide.reset.failed"), detail: message });
  };

  return (
    <section
      className={[
        "rounded-lg border border-line bg-card px-4 py-3 shadow-card",
        className,
      ].join(" ")}
      data-testid="demo-reset"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-strong">{t("demo.resetTitle")}</h2>
          <p className="mt-0.5 max-w-[720px] text-base leading-6 text-ink-muted">
            {t("demo.resetDescription")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="secondary"
            onClick={() => setState({ kind: "confirm" })}
            disabled={!resetEnabled || state.kind === "running"}
            title={resetEnabled ? t("guide.reset.body") : t(noteKey)}
          >
            <RotateCcw size={14} aria-hidden />
            {state.kind === "running" ? t("guide.reset.running") : t("guide.reset.button")}
          </Button>
          {!resetEnabled ? (
            <span className="max-w-[300px] text-right text-xs leading-5 text-ink-faint">
              {t(noteKey)}
            </span>
          ) : null}
        </div>
      </div>

      {state.kind === "confirm" ? (
        <div
          data-testid="reset-confirm"
          className="mt-3 rounded-lg border border-warn-line bg-warn-bg/60 px-3.5 py-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">{t("guide.reset.title")}</div>
              <p className="mt-1 text-base leading-6 text-ink-muted">{t("guide.reset.body")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" onClick={() => void runReset()}>
                  {t("guide.reset.confirm")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setState({ kind: "idle" })}>
                  {t("guide.reset.cancel")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {state.kind === "done" ? (
        <div
          data-testid="reset-result"
          role="status"
          className="mt-3 flex items-start gap-2 rounded-lg border border-pass-line bg-pass-bg/60 px-3.5 py-2.5"
        >
          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-pass" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-pass">{state.message}</div>
            {state.detail ? (
              <p className="mt-0.5 break-words font-mono text-xs text-ink-muted">{state.detail}</p>
            ) : null}
            <p className="mt-0.5 text-xs leading-5 text-ink-muted">{t("demo.resetRefreshed")}</p>
          </div>
        </div>
      ) : null}

      {state.kind === "failed" ? (
        <div
          data-testid="reset-result"
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-stop-line bg-stop-bg/60 px-3.5 py-2.5"
        >
          <ShieldX size={15} className="mt-0.5 shrink-0 text-stop" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-stop">{t("guide.reset.failed")}</div>
            <p className="mt-0.5 break-words text-base leading-6 text-ink">{state.message}</p>
          </div>
        </div>
      ) : null}

      {state.kind === "running" ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-ink-muted" aria-busy="true">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          {t("guide.reset.running")}
        </div>
      ) : null}
    </section>
  );
}
