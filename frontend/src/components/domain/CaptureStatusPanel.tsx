/**
 * Capture status panel (contract v1.3 hidden demo endpoint).
 *
 * Values come from `GET /payments/captures/{capture_id}` and are rendered as
 * the backend's decimal strings — no arithmetic, no rounding. The capture
 * status is a capture field: the refund lifecycle is shown separately (refund
 * card), so a refund COMPLETED can never be presented as the capture status.
 */

import { AlertTriangle, FlaskConical, RefreshCw, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import {
  formatCaptureAmount,
  isSyntheticCapture,
  type CaptureStatusOutcome,
} from "../../api/capture";
import { useI18n } from "../../i18n";

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1 last:border-b-0">
      <dt className="shrink-0 text-[10.5px] text-ink-faint">{label}</dt>
      <dd className="num min-w-0 break-words text-right text-[11.5px] text-ink">{value}</dd>
    </div>
  );
}

export function CaptureStatusPanel({
  captureId,
  outcome,
  loading,
  onRetry,
}: {
  captureId: string;
  /** Undefined while the first read is in flight. */
  outcome?: CaptureStatusOutcome;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const capture = outcome?.ok ? outcome.capture : undefined;
  const synthetic = isSyntheticCapture(capture);

  return (
    <Card className="overflow-hidden" data-testid="capture-panel">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Wallet size={14} className="text-ink-muted" aria-hidden />
          <div className="text-sm font-semibold text-ink-strong">{t("capture.title")}</div>
          {synthetic ? (
            <Badge tone="scenario" dot>
              {t("capture.synthetic")}
            </Badge>
          ) : null}
        </div>
        <span className="font-mono text-[10px] text-ink-faint">{captureId}</span>
      </div>

      {loading && !outcome ? (
        <div className="px-4 py-6 text-xs text-ink-muted" aria-busy="true">
          {t("capture.loading")}
        </div>
      ) : null}

      {outcome && !outcome.ok ? (
        <div className="px-4 py-3" role="alert">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-stop" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-stop">{t("capture.failedTitle")}</div>
              <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">
                {t("capture.failedBody")}
              </p>
              <p className="mt-1 break-words font-mono text-[10px] text-ink-faint">
                {outcome.error.status > 0 ? `HTTP ${outcome.error.status} · ` : ""}
                {outcome.error.code} · {outcome.error.message}
              </p>
            </div>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink hover:bg-hover"
              >
                <RefreshCw size={10} aria-hidden />
                {t("capture.retry")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {capture ? (
        <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)] lg:divide-x lg:divide-y-0">
          <div className="min-w-0 px-4 py-3">
            <div className="eyebrow mb-1">{t("capture.title")}</div>
            <dl>
              <Row
                label={t("capture.status")}
                value={
                  <span data-testid="capture-status" className="font-semibold text-ink-strong">
                    {capture.status}
                  </span>
                }
              />
              <Row
                label={t("capture.originalAmount")}
                value={formatCaptureAmount(capture.originalAmount, capture.currencyCode)}
              />
              <Row
                label={t("capture.totalRefunded")}
                value={formatCaptureAmount(capture.totalRefunded, capture.currencyCode)}
              />
              <Row
                label={t("capture.refundableRemaining")}
                value={formatCaptureAmount(capture.refundableRemaining, capture.currencyCode)}
              />
              <Row label={t("capture.currency")} value={capture.currencyCode} />
              <Row
                label={t("capture.captureId")}
                value={<span className="font-mono text-[10.5px]">{capture.captureId}</span>}
              />
              <Row
                label={t("capture.source")}
                value={
                  <span data-testid="capture-source" className="font-mono text-[10px]">
                    {capture.source || t("capture.notReported")}
                  </span>
                }
              />
            </dl>
            {synthetic ? (
              <p className="mt-1.5 inline-flex items-start gap-1.5 text-[10px] leading-4 text-warn">
                <FlaskConical size={11} className="mt-0.5 shrink-0" aria-hidden />
                {t("capture.syntheticNote")}
              </p>
            ) : null}
          </div>

          <div className="min-w-0 px-4 py-3">
            <div className="eyebrow mb-1">{t("capture.refundArea")}</div>
            <p className="text-[10.5px] leading-4 text-ink-muted">{t("capture.refundAreaBody")}</p>
            <p
              data-testid="capture-no-real-funds"
              className="mt-2 rounded-md border border-warn-line bg-warn-bg/60 px-2.5 py-2 text-[11px] font-semibold text-warn"
            >
              {t("refund.noRealFunds")}
            </p>
            <p className="mt-2 text-[10px] leading-4 text-ink-faint">
              {t("capture.subtitle")}
            </p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
