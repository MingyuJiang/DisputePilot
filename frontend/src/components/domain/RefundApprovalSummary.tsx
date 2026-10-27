/**
 * Manager-facing refund summary (approval page).
 *
 * Shows the exact amount + currency, the Partial/Full marker, the capture id,
 * the server snapshot the amount was validated against, and the risk note.
 * The wording is read-only: approval binds the payload hash, so the manager
 * cannot approve one amount and have another rendered later.
 */

import { AlertTriangle, Wallet } from "lucide-react";
import type { ActionProposal, CaseRecord } from "../../api/types";
import {
  captureViewOf,
  formatAmountMinor,
  refundAmountMinorOf,
  refundModeOf,
} from "../../lib/refund";
import { useI18n } from "../../i18n";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { RiskBadge } from "./Badges";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-4 py-2">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-faint">
        {label}
      </dt>
      <dd className="num break-words text-[11px] leading-5 text-ink">{value}</dd>
    </div>
  );
}

export function RefundApprovalSummary({
  proposal,
  record,
}: {
  proposal: ActionProposal;
  record: CaseRecord;
}) {
  const { t } = useI18n();
  const view = captureViewOf(record, proposal);
  const mode = refundModeOf(proposal.action) ?? "partial";
  const amountMinor = refundAmountMinorOf(proposal);
  const amount =
    amountMinor === undefined ? "—" : `${formatAmountMinor(amountMinor)} ${view.currency}`;
  const money = (minor?: number): string =>
    minor === undefined ? "—" : `${formatAmountMinor(minor)} ${view.currency}`;

  return (
    <Card className="overflow-hidden" data-testid="refund-approval-summary">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Wallet size={14} className="text-ink-muted" aria-hidden />
          <div className="text-sm font-semibold text-ink-strong">{t("refund.approvalTitle")}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="navy">PAYMENT</Badge>
          <Badge tone={mode === "full" ? "warn" : "info"}>
            {mode === "full" ? t("refund.mode.fullLabel") : t("refund.mode.partialLabel")}
          </Badge>
          <RiskBadge risk={proposal.risk} />
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
          {t("refund.approvalAmount")}
        </div>
        <div className="num mt-0.5 text-[22px] font-semibold leading-8 text-ink-strong">
          {amount}
        </div>
        <p className="mt-0.5 text-[10.5px] leading-4 text-ink-muted">{t("refund.subtitle")}</p>
      </div>

      <dl className="divide-y divide-line border-t border-line">
        <Row label={t("refund.captureId")} value={view.captureId} />
        <Row label={t("refund.originalAmount")} value={money(view.originalMinor)} />
        <Row label={t("refund.totalRefunded")} value={money(view.totalRefundedMinor)} />
        <Row label={t("refund.remaining")} value={money(view.remainingMinor)} />
        <Row
          label={t("refund.reason")}
          value={proposal.payload.find((field) => field.label === "Refund reason")?.value ?? "—"}
        />
      </dl>

      <div className="flex items-start gap-2 border-t border-warn-line bg-warn-bg/70 px-4 py-2.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <div>
          <p className="text-[10.5px] leading-4 text-ink">{t("refund.riskNote")}</p>
          <p className="mt-1 text-[10px] leading-4 text-ink-muted">{t("refund.boundNote")}</p>
        </div>
      </div>
    </Card>
  );
}
