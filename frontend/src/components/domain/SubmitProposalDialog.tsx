import { ArrowRight, Info, ShieldCheck } from "lucide-react";
import type { ActionProposal, CaseRecord } from "../../api/types";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { formatMoney } from "../../lib/format";
import { isRefundAction } from "../../lib/refund";
import { ProposalStateBadge, RiskBadge } from "./Badges";
import { actionLabel, useI18n } from "../../i18n";

export function SubmitProposalDialog({
  proposal,
  record,
  open,
  live = false,
  onClose,
  onConfirm,
}: {
  proposal: ActionProposal;
  record: CaseRecord;
  open: boolean;
  /** LIVE Sandbox: describe execution, never a replay. */
  live?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  // A refund moves funds out of a capture: it is not a disputed amount.
  const payment = proposal.actionFamily === "PAYMENT" || isRefundAction(proposal.action);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("submit.title")}
      description={t("submit.description")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {t("action.submit")}
            <ArrowRight size={13} aria-hidden />
          </Button>
        </>
      }
    >
      <div className="rounded-md border border-line bg-subtle px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ink-strong">
              {actionLabel(proposal.actionLabel, proposal.action, t)}
            </div>
            <div className="mt-0.5 font-mono text-xs text-ink-muted">{proposal.action}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <RiskBadge risk={proposal.risk} />
            <ProposalStateBadge state={proposal.state} />
          </div>
        </div>
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{t("submit.case")}</dt>
            <dd className="mt-0.5 text-xs text-ink">
              {record.caseId} · {record.reasonLabel}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{t(payment ? "workspace.captureAmount" : "submit.amount")}</dt>
            <dd className="num mt-0.5 text-xs text-ink">{formatMoney(record.amountMinor, record.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{t("submit.snapshot")}</dt>
            <dd className="num mt-0.5 text-xs text-ink">{proposal.snapshotVersion}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{t("submit.evidenceAttached")}</dt>
            <dd className="mt-0.5 text-xs text-ink">{proposal.evidenceIds.length} references</dd>
          </div>
        </dl>
      </div>

      <div
        className={[
          "mt-3 rounded-md border px-3 py-2.5",
          proposal.validation.decision === "PASS"
            ? "border-pass-line bg-pass-bg"
            : proposal.validation.decision === "BLOCKED"
              ? "border-stop-line bg-stop-bg"
              : "border-warn-line bg-warn-bg",
        ].join(" ")}
      >
        <div
          className={[
            "flex items-center gap-1.5 text-xs font-medium",
            proposal.validation.decision === "PASS"
              ? "text-pass"
              : proposal.validation.decision === "BLOCKED"
                ? "text-stop"
                : "text-warn",
          ].join(" ")}
        >
          <ShieldCheck size={13} aria-hidden />
          {t("submit.validator", { decision: proposal.validation.decision })}
        </div>
        <p className="mt-1 text-base leading-4 text-ink">{proposal.validation.summary}</p>
      </div>

      <div className="mt-3">
        <div className="eyebrow mb-1.5">{t("submit.next")}</div>
        <ol className="space-y-1.5">
          {[
            t("submit.step1"),
            t("submit.step2"),
            t(live ? "submit.step3Live" : "submit.step3"),
            t("submit.step4"),
          ].map((step, index) => (
            <li key={step} className="flex gap-2 text-base leading-5 text-ink">
              <span className="num mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line bg-card text-xs text-ink-faint">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-md border border-line bg-subtle px-3 py-2">
        <Info size={12} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
        <p className="text-xs leading-4 text-ink-muted">
          {t(live ? "submit.noteLive" : "submit.note", {
            snapshot: proposal.snapshotVersion,
          })}
        </p>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <Badge tone="warn">{t("submit.managerRequired")}</Badge>
        <Badge tone="neutral">{t("submit.mvp")}</Badge>
      </div>
    </Dialog>
  );
}
