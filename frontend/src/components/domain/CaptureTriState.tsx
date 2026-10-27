/**
 * Capture case states (FRONTEND_REDESIGN_PLAN §3.3, payment variant).
 *
 * Three vocabularies side by side, never merged:
 *   capture — the backend capture status and its decimal amount strings;
 *   refund  — the proposal/execution state of the refund action;
 *   dispute — not reported for a capture case.
 *
 * Amounts are printed exactly as the backend returned them (42.00 / 12.00 /
 * 30.00); no arithmetic happens here.
 */

import { FlaskConical } from "lucide-react";
import type { ActionProposal, CaseRecord, ExecutionRecord } from "../../api/types";
import { formatCaptureAmount, isSyntheticCapture, type CaptureStatusOutcome } from "../../api/capture";
import { captureState, proposalState } from "../../lib/statusModel";
import { useI18n } from "../../i18n";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";

const AmountRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-2 border-b border-line py-1 last:border-b-0">
    <dt className="shrink-0 text-xs text-ink-faint">{label}</dt>
    <dd className="num text-right text-base text-ink">{value}</dd>
  </div>
);

export function CaptureTriState({
  record,
  outcome,
  refundProposal,
  execution,
  offline,
}: {
  record: CaseRecord;
  outcome?: CaptureStatusOutcome;
  refundProposal?: ActionProposal;
  execution?: ExecutionRecord;
  /** Offline replay / synthetic: no real funds can move. */
  offline?: boolean;
}) {
  const { t } = useI18n();
  const capture = outcome?.ok ? outcome.capture : undefined;
  const snapshot = record.captureSnapshot;
  const currency = capture?.currencyCode ?? snapshot?.currencyCode ?? record.currency;
  const status = capture?.status ?? snapshot?.status;
  const original = capture?.originalAmount ?? snapshot?.originalAmount;
  const refunded = capture?.totalRefunded ?? snapshot?.totalRefunded;
  const remaining = capture?.refundableRemaining ?? snapshot?.refundableRemaining;
  const source = capture?.source;
  const synthetic = isSyntheticCapture(capture);

  const refundState = refundProposal
    ? proposalState({ state: refundProposal.state, backendState: refundProposal.backendState }, execution)
    : undefined;

  return (
    <Card className="overflow-hidden" data-testid="capture-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-strong">{t("case.capture.title")}</h2>
          <span className="font-mono text-xs text-ink-faint">
            {capture?.captureId ?? snapshot?.captureId ?? record.transaction.captureRef}
          </span>
          {synthetic ? (
            <Badge tone="scenario" dot>
              {t("case.capture.synthetic")}
            </Badge>
          ) : null}
        </div>
        <Badge tone="navy">PAYMENT</Badge>
      </div>

      <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
        <section className="min-w-0 px-4 py-3" aria-label={t("case.capture.group")}>
          <div className="eyebrow">{t("case.capture.group")}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              data-testid="transaction-status"
              className="num font-mono text-base font-semibold text-ink-strong"
            >
              {status ?? t("rd.notProvided")}
            </span>
            {status ? <StatusBadge state={captureState(status)} size="sm" /> : null}
          </div>
          <span data-testid="capture-status" className="sr-only">
            {status ?? ""}
          </span>
          <dl className="mt-1.5">
            <AmountRow
              label={t("capture.originalAmount")}
              value={original ? formatCaptureAmount(original, currency) : "—"}
            />
            <AmountRow
              label={t("capture.totalRefunded")}
              value={refunded ? formatCaptureAmount(refunded, currency) : "—"}
            />
            <AmountRow
              label={t("capture.refundableRemaining")}
              value={remaining ? formatCaptureAmount(remaining, currency) : "—"}
            />
          </dl>
          <p className="mt-1 text-xs leading-4 text-ink-faint">
            {t("rd.sourceLabel")}:{" "}
            <span data-testid="capture-source" className="font-mono">
              {source ?? t("rd.notProvided")}
            </span>
          </p>
        </section>

        <section className="min-w-0 px-4 py-3" aria-label={t("case.capture.refundGroup")}>
          <div className="eyebrow">{t("case.capture.refundGroup")}</div>
          {refundState ? (
            <>
              <div className="mt-1">
                <StatusBadge state={refundState} />
              </div>
              <p className="mt-1 break-all font-mono text-xs text-ink-muted">
                {refundProposal?.proposalId}
              </p>
            </>
          ) : (
            <p className="mt-1 text-base leading-4 text-ink-muted">{t("case.capture.noRefund")}</p>
          )}
        </section>

        <section className="min-w-0 px-4 py-3" aria-label={t("case.capture.disputeGroup")}>
          <div className="eyebrow">{t("case.capture.disputeGroup")}</div>
          <p className="mt-1 text-base leading-4 text-ink-muted">
            {t("case.capture.disputeUnreported")}
          </p>
        </section>
      </div>

      {synthetic || offline ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-subtle px-4 py-2">
          <p className="inline-flex items-start gap-1.5 text-xs leading-4 text-warn">
            <FlaskConical size={11} className="mt-0.5 shrink-0" aria-hidden />
            <span data-testid="capture-no-real-funds">{t("refund.noRealFunds")}</span>
          </p>
        </div>
      ) : null}
    </Card>
  );
}
