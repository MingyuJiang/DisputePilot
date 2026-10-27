/**
 * Loading / failure surface for a real analysis run.
 *
 * Copy is deliberately explicit about what did NOT happen: no mock result, no
 * automatic retry, no business action submitted. The backend message is shown
 * verbatim so an operator can distinguish a model timeout from a validation
 * failure.
 */

import {
  AlertTriangle,
  Clock,
  Cpu,
  Loader2,
  RotateCcw,
  ServerCrash,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import type { AnalysisErrorInfo, AnalysisErrorKind } from "../../api/errors";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import type { AnalysisRunState } from "../../hooks/useAnalysisRun";
import { errorCodeKey, useI18n, type MessageKey } from "../../i18n";

const formatElapsed = (elapsedMs: number): string => {
  const total = Math.floor(elapsedMs / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
};

const ERROR_TITLE: Record<AnalysisErrorKind, MessageKey> = {
  timeout: "error.title.timeout",
  unavailable: "error.title.unavailable",
  network: "error.title.network",
  server: "error.title.server",
  request: "error.title.request",
};

const ERROR_ICON: Record<AnalysisErrorKind, typeof AlertTriangle> = {
  timeout: Clock,
  unavailable: ServerCrash,
  network: WifiOff,
  server: ShieldAlert,
  request: AlertTriangle,
};

function ErrorCard({
  error,
  elapsedMs,
  onRetry,
}: {
  error: AnalysisErrorInfo;
  elapsedMs: number;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const Icon = ERROR_ICON[error.kind];
  const codeKey = errorCodeKey(error.code);

  return (
    <div
      role="alert"
      className="rounded-md border border-stop-line bg-stop-bg/40 px-3.5 py-3"
    >
      <div className="flex items-start gap-2.5">
        <Icon size={16} className="mt-0.5 shrink-0 text-stop" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] font-semibold text-stop">{t(ERROR_TITLE[error.kind])}</span>
            {error.status > 0 ? <Badge tone="stop">HTTP {error.status}</Badge> : null}
            <Badge tone="stop">{error.code}</Badge>
            {error.detailCodes.map((code) => (
              <Badge key={code} tone="warn">
                {code}
              </Badge>
            ))}
            {elapsedMs > 0 ? (
              <span className="num ml-auto text-[10px] text-ink-faint">
                {t("error.after", { elapsed: formatElapsed(elapsedMs) })}
              </span>
            ) : null}
          </div>

          {codeKey ? (
            <p className="mt-1 text-[11px] leading-4 text-ink">{t(codeKey)}</p>
          ) : null}
          <p className="mt-1.5 break-words text-[11.5px] leading-5 text-ink">{error.message}</p>

          <div className="mt-2 rounded border border-line bg-card/70 px-2.5 py-2">
            <p className="text-[10.5px] leading-4 text-ink-muted">
              <span className="font-semibold text-ink">{t("error.noResultTitle")}</span>{" "}
              {t("error.noResultBody")}
            </p>
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] font-medium text-ink-faint hover:text-ink">
              {t("common.technicalDetails")}
            </summary>
            <dl className="mt-1 space-y-1 rounded border border-line bg-card/70 px-2 py-1.5 text-[10px] leading-4">
              <div className="flex gap-2">
                <dt className="shrink-0 text-ink-faint">{t("common.code")}</dt>
                <dd className="break-all font-mono text-ink-muted">{error.code}</dd>
              </div>
              {error.detailCodes.length > 0 ? (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-ink-faint">{t("common.detailCodes")}</dt>
                  <dd className="break-all font-mono text-ink-muted">{error.detailCodes.join(", ")}</dd>
                </div>
              ) : null}
              <div className="flex gap-2">
                <dt className="shrink-0 text-ink-faint">{t("common.originalMessage")}</dt>
                <dd className="break-words text-ink-muted">{error.message}</dd>
              </div>
            </dl>
          </details>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {error.retryable && onRetry ? (
              <Button size="sm" variant="secondary" onClick={onRetry}>
                <RotateCcw size={12} aria-hidden />
                {t("error.retry")}
              </Button>
            ) : (
              <span className="text-[10.5px] text-ink-faint">{t("error.retryUnavailable")}</span>
            )}
            <span className="text-[10px] leading-4 text-ink-faint">{t("error.manualOnly")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AnalysisRunStatus({
  state,
  onRetry,
}: {
  state: AnalysisRunState;
  onRetry?: () => void;
}) {
  const { t } = useI18n();

  if (state.status === "running") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-info-line bg-info-bg/50 px-3.5 py-3"
      >
        <div className="flex items-start gap-2.5">
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-info" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink-strong">
                {t(`phase.${state.phase}.title` as MessageKey)}
              </span>
              <Badge tone="info" dot>
                {t("error.processing")}
              </Badge>
              <span className="num ml-auto text-[10.5px] text-ink-muted">
                {t("error.elapsed", { elapsed: formatElapsed(state.elapsedMs) })}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-ink">
              {t(`phase.${state.phase}.detail` as MessageKey)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-ink-faint">
              <span className="inline-flex items-center gap-1">
                <Cpu size={10} aria-hidden />
                {t("phase.localModelTiming")}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock size={10} aria-hidden />
                {t("phase.noAutoRetry")}
              </span>
            </div>
            <div
              className="mt-2 h-0.5 overflow-hidden rounded-full bg-info-line/50"
              aria-hidden
            >
              <div className="h-full w-1/3 animate-pulse rounded-full bg-info" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "failed" && state.error) {
    return <ErrorCard error={state.error} elapsedMs={state.elapsedMs} onRetry={onRetry} />;
  }

  return null;
}
