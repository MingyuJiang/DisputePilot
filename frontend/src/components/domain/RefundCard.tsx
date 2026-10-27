/**
 * Capture refund card (contract v1.2, action_family=PAYMENT).
 *
 * The only place a specialist authors a refund draft. It:
 *  - appears only for a PAYMENT case (`action_family=PAYMENT` or `CAP-…`);
 *  - switches between Partial (editable decimal amount) and Full (the
 *    server-defined remaining amount — never an editable field);
 *  - mirrors V13–V18 only as a format/bounds hint; the backend re-validates
 *    against its own capture snapshot and a mismatching client amount is 422;
 *  - shows the server back-filled original / total_refunded / remaining /
 *    proposed values after the draft exists;
 *  - never executes. Submit goes through the existing approval flow.
 *
 * A refund moves funds. It is not dispute resolution, so no success or
 * "dispute resolved" wording exists here.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Lock, PenLine, RefreshCw, Send, Wallet } from "lucide-react";
import type { ActionProposal, CaseRecord, RefundDraftInput } from "../../api/types";
import type { AnalysisErrorInfo, ProposalGenerationOutcome } from "../../api/errors";
import { canAuthorize, canPrepare, type NextStepRole } from "../../lib/nextStep";
import {
  captureViewOf,
  formatAmountMinor,
  isRefundLocked,
  latestRefundProposal,
  refundAmountMinorOf,
  refundIdempotencyKey,
  refundModeOf,
  refundOutcome,
  refundReasonOf,
  validateRefundDraft,
  type RefundMode,
  type RefundValidationReason,
} from "../../lib/refund";
import { formatMoney } from "../../lib/format";
import { useI18n, type MessageKey } from "../../i18n";
import { BackendErrorNotice } from "./BackendErrorNotice";
import { ExecutionResultBadge, ProposalStateBadge, RiskBadge } from "./Badges";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { useToast } from "../ui/Toast";

const ERROR_KEYS: Record<RefundValidationReason, MessageKey> = {
  capture_unavailable: "refund.captureUnavailable",
  amount_required: "refund.amountRequired",
  amount_format: "refund.amountFormat",
  amount_positive: "refund.amountPositive",
  amount_exceeds_remaining: "refund.amountExceeds",
  nothing_refundable: "refund.nothingRefundable",
  reason_required: "refund.reasonRequired",
};

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="num min-w-0 break-words text-right text-base text-ink">{value}</dd>
    </div>
  );
}

export interface RefundCardProps {
  record: CaseRecord;
  proposals: ActionProposal[];
  role: NextStepRole;
  actor: string;
  /**
   * The capture is a synthetic offline fixture: the refund path is simulated
   * and no real funds can move. Set only from the capture record.
   */
  syntheticOffline?: boolean;
  onCreate: (input: RefundDraftInput) => Promise<ProposalGenerationOutcome>;
  /** Existing approval flow: submit a created draft. */
  onSubmitProposal: (proposalId: string) => void;
}

export function RefundCard({
  record,
  proposals,
  role,
  actor,
  syntheticOffline = false,
  onCreate,
  onSubmitProposal,
}: RefundCardProps) {
  const { t } = useI18n();
  const toast = useToast();

  const latest = latestRefundProposal(proposals);
  const view = useMemo(() => captureViewOf(record, latest), [record, latest]);

  const proposalMode = refundModeOf(latest?.action) ?? "partial";
  const proposalAmountMinor = refundAmountMinorOf(latest);
  const proposalAmountText =
    proposalAmountMinor === undefined ? "" : formatAmountMinor(proposalAmountMinor);
  const proposalReason = refundReasonOf(latest);

  const [mode, setMode] = useState<RefundMode>(proposalMode);
  const [amount, setAmount] = useState(proposalAmountText);
  const [reason, setReason] = useState(proposalReason);
  const [revision, setRevision] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AnalysisErrorInfo | undefined>(undefined);

  // A new draft (or another case) defines the form; typing never resets it.
  useEffect(() => {
    setMode(proposalMode);
    setAmount(proposalAmountText);
    setReason(proposalReason);
    setRevision(false);
    setError(undefined);
  }, [record.caseId, latest?.proposalId, proposalMode, proposalAmountText, proposalReason]);

  const check = validateRefundDraft({
    mode,
    amount,
    reason,
    remainingMinor: view.remainingMinor,
    captureId: view.captureId,
  });

  // RC-3: the merchant drafts refunds (`canPrepare`) and also authorizes them
  // (`canAuthorize`). Amount ceilings and the capture balance are enforced by
  // the backend validator, not by disabling the form.
  const mayPrepare = canPrepare(role);
  const mayAuthorize = canAuthorize(role);
  const locked = Boolean(latest && isRefundLocked(latest.state) && !revision);
  const canEdit = mayPrepare && !locked;
  const amountMinor = check.ok ? check.amountMinor : undefined;

  // Submitting must submit exactly what is on screen — never a stale draft.
  const latestMatchesForm =
    latest?.state === "DRAFT" &&
    proposalMode === mode &&
    proposalReason === reason.trim() &&
    (mode === "full"
      ? amountMinor === undefined || proposalAmountMinor === amountMinor
      : proposalAmountMinor === amountMinor);
  const canCreate = canEdit && check.ok && !submitting;
  const canSubmit = canEdit && Boolean(latest) && latestMatchesForm && !submitting;

  const proposedMinor = latest ? proposalAmountMinor : amountMinor;
  const financialImpact =
    proposedMinor !== undefined
      ? t("refund.financialImpactValue", {
          amount: formatAmountMinor(proposedMinor),
          currency: view.currency,
          captureId: view.captureId,
        })
      : t("refund.financialImpactUnknown", { captureId: view.captureId });

  const executionOutcome = refundOutcome(latest?.execution, {
    captureId: view.captureId,
    amountMinor: proposedMinor,
    currency: view.currency,
  });

  const handleCreate = async () => {
    if (!canCreate) return;
    setSubmitting(true);
    setError(undefined);
    const idempotencyKey = refundIdempotencyKey({
      caseId: record.caseId,
      captureId: view.captureId,
      mode,
      amount: mode === "partial" ? amount.trim() : undefined,
      reason: reason.trim(),
    });
    const outcome = await onCreate({
      caseId: record.caseId,
      captureId: view.captureId,
      mode,
      ...(mode === "partial" ? { amount: amount.trim() } : {}),
      currencyCode: view.currency,
      reason: reason.trim(),
      actor,
      idempotencyKey,
    });
    setSubmitting(false);
    if (!outcome.ok || !outcome.proposal) {
      setError(outcome.error);
      toast.push({
        tone: "warning",
        title: t("refund.createFailed"),
        detail: outcome.error?.message,
      });
      return;
    }
    toast.push({
      tone: "success",
      title: t("refund.created"),
      detail: t("refund.createdDetail", {
        proposalId: outcome.proposal.proposalId,
        hash: outcome.proposal.payloadHash ?? "",
      }),
    });
    setRevision(false);
  };

  const handleSubmit = () => {
    if (!canSubmit || !latest) return;
    onSubmitProposal(latest.proposalId);
    toast.push({ tone: "info", title: t("refund.submitted") });
  };

  return (
    <Card className="overflow-hidden" data-testid="refund-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Wallet size={14} className="text-ink-muted" aria-hidden />
            <div className="text-sm font-semibold text-ink-strong">{t("refund.title")}</div>
            <Badge tone="navy">PAYMENT</Badge>
            {latest ? (
              <Badge tone="neutral">
                {t(mode === "full" ? "refund.mode.fullLabel" : "refund.mode.partialLabel")}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 max-w-[720px] text-base leading-4 text-ink-muted">
            {t("refund.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <RiskBadge risk={latest?.risk ?? record.risk} />
          {latest ? <ProposalStateBadge state={latest.state} /> : null}
        </div>
      </div>

      <div
        data-testid="refund-funds-warning"
        className="border-b border-stop-line bg-stop-bg px-4 py-2.5"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-stop" aria-hidden />
          <div>
            <div className="text-base font-semibold text-stop">{t("refund.warningLabel")}</div>
            <p className="mt-0.5 text-base leading-4 text-ink">{t("refund.warning")}</p>
            {syntheticOffline ? (
              <div
                data-testid="refund-synthetic-note"
                className="mt-1.5 rounded border border-warn-line bg-card px-2 py-1"
              >
                <div className="text-base font-semibold text-warn">
                  {t("refund.noRealFunds")}
                </div>
                <p className="mt-0.5 text-xs leading-4 text-ink-muted">
                  {t("refund.syntheticNote")}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {!mayPrepare ? (
        <div className="border-b border-info-line bg-info-bg px-4 py-2.5">
          <p className="text-base leading-4 text-ink">{t("refund.managerNote")}</p>
        </div>
      ) : null}

      {locked && latest ? (
        <div className="border-b border-warn-line bg-warn-bg px-4 py-2.5">
          <div className="flex items-start gap-2">
            <Lock size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="min-w-0">
              <div className="text-base font-semibold text-warn">{t("refund.locked")}</div>
              <p className="mt-0.5 text-base leading-4 text-ink">
                {t("refund.lockedBody", { proposalId: latest.proposalId })}
              </p>
              {mayAuthorize ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => setRevision(true)}
                >
                  <PenLine size={12} aria-hidden />
                  {t("refund.revise")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {revision ? (
        <div className="border-b border-line bg-subtle px-4 py-2">
          <button
            type="button"
            className="text-xs font-medium text-navy-700 hover:text-navy-800"
            onClick={() => {
              setRevision(false);
              setMode(proposalMode);
              setAmount(proposalAmountText);
              setReason(proposalReason);
            }}
          >
            {t("refund.cancelRevise")}
          </button>
        </div>
      ) : null}

      {/* QA-RC-08: the side-by-side split only applies on a wide viewport.
          `lg:` fired inside the 360px authoring column and crushed the form, so
          both halves now stay stacked until the container is genuinely wide. */}
      <div className="grid grid-cols-1 divide-y divide-line">
        <div className="min-w-0 px-4 py-3">
          <fieldset disabled={!canEdit} className="min-w-0">
            <legend className="eyebrow">{t("refund.mode")}</legend>
            <div
              role="radiogroup"
              aria-label={t("refund.mode")}
              className="mt-1.5 inline-flex rounded-md border border-line bg-subtle p-0.5"
            >
              {(["partial", "full"] as RefundMode[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={mode === option}
                  onClick={() => setMode(option)}
                  className={[
                    "rounded px-3 py-1 text-base font-medium transition-colors",
                    mode === option
                      ? "bg-card text-ink-strong shadow-sm"
                      : "text-ink-muted hover:text-ink",
                  ].join(" ")}
                >
                  {t(option === "full" ? "refund.mode.full" : "refund.mode.partial")}
                </button>
              ))}
            </div>

            {mode === "partial" ? (
              <div className="mt-3">
                <label htmlFor="refund-amount" className="block text-base font-medium text-ink">
                  {t("refund.amount")}
                </label>
                <input
                  id="refund-amount"
                  inputMode="decimal"
                  value={amount}
                  readOnly={!canEdit}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="13.00"
                  aria-invalid={!check.ok}
                  aria-describedby="refund-amount-hint"
                  className="num mt-1 w-full max-w-[220px] rounded-md border border-line bg-card px-2.5 py-1.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-navy-600 disabled:bg-subtle"
                />
                <p id="refund-amount-hint" className="mt-1 text-xs leading-4 text-ink-faint">
                  {t("refund.amountHint")}
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <div className="text-base font-medium text-ink">{t("refund.amount")}</div>
                <div
                  data-testid="refund-full-amount"
                  className="mt-1 rounded-md border border-line bg-subtle px-2.5 py-2"
                >
                  <div className="num text-[14px] font-semibold text-ink-strong">
                    {view.remainingMinor !== undefined
                      ? formatMoney(view.remainingMinor, view.currency)
                      : "—"}
                  </div>
                  <p className="mt-0.5 text-xs leading-4 text-ink-muted">
                    {view.remainingMinor !== undefined
                      ? t("refund.fullAmount")
                      : t("refund.fullAmountUnknown")}
                  </p>
                  <p className="mt-0.5 text-xs leading-4 text-ink-faint">
                    {t("refund.fullNotEditable")}
                  </p>
                </div>
                {/* No editable amount in Full mode. */}
              </div>
            )}

            <div className="mt-3">
              <label htmlFor="refund-currency" className="block text-base font-medium text-ink">
                {t("refund.currency")}
              </label>
              <input
                id="refund-currency"
                value={view.currency}
                readOnly
                aria-readonly="true"
                className="num mt-1 w-[120px] rounded-md border border-line bg-subtle px-2.5 py-1.5 text-base text-ink-muted outline-none"
              />
              <p className="mt-1 text-xs leading-4 text-ink-faint">
                {t("refund.currencyReadOnly")}
              </p>
            </div>

            <div className="mt-3">
              <label htmlFor="refund-reason" className="block text-base font-medium text-ink">
                {t("refund.reason")} <span className="text-stop">*</span>
              </label>
              <textarea
                id="refund-reason"
                rows={3}
                value={reason}
                readOnly={!canEdit}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("refund.reasonPlaceholder")}
                className="mt-1 w-full resize-y rounded-md border border-line bg-card px-2.5 py-2 text-base leading-5 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-navy-600 disabled:bg-subtle"
              />
            </div>
          </fieldset>

          {!check.ok ? (
            <p data-testid="refund-validation" className="mt-2 text-xs leading-4 text-stop">
              {t(ERROR_KEYS[check.reason])}
            </p>
          ) : null}

          {error ? (
            <div className="mt-2">
              <BackendErrorNotice error={error} titleKey="refund.createFailed" />
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => void handleCreate()}
              disabled={!canCreate}
              loading={submitting}
            >
              <RefreshCw size={12} aria-hidden />
              {t("refund.create")}
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              <Send size={13} aria-hidden />
              {t("refund.submit")}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-4 text-ink-faint">{t("refund.specialistNote")}</p>
        </div>

        <div className="min-w-0 px-4 py-3">
          <div className="eyebrow">
            {t(view.source === "proposal" ? "refund.snapshotTitle" : "refund.caseSnapshotTitle")}
          </div>
          <dl className="mt-1.5 rounded-md border border-line bg-subtle px-3 py-2">
            <Row label={t("refund.captureId")} value={<span className="font-mono">{view.captureId}</span>} />
            <Row
              label={t("refund.originalAmount")}
              value={
                view.originalMinor !== undefined
                  ? formatMoney(view.originalMinor, view.currency)
                  : "—"
              }
            />
            <Row
              label={t("refund.totalRefunded")}
              value={
                view.totalRefundedMinor !== undefined
                  ? formatMoney(view.totalRefundedMinor, view.currency)
                  : "—"
              }
            />
            <Row
              label={t("refund.remaining")}
              value={
                view.remainingMinor !== undefined
                  ? formatMoney(view.remainingMinor, view.currency)
                  : "—"
              }
            />
            <Row
              label={t("refund.proposed")}
              value={
                proposedMinor !== undefined ? (
                  <span data-testid="refund-proposed">
                    {formatMoney(proposedMinor, view.currency)} {view.currency}
                  </span>
                ) : (
                  "—"
                )
              }
            />
          </dl>
          <p className="mt-1 text-xs leading-4 text-ink-faint">
            {view.source === "proposal" && latest
              ? t("refund.snapshotNote")
              : t("refund.caseLevelNote")}
          </p>

          <div className="mt-3 border-t border-line pt-2.5">
            <div className="eyebrow">{t("refund.risk")}</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <RiskBadge risk={latest?.risk ?? record.risk} />
              <Badge tone="warn">{t("refund.financialImpact")}</Badge>
            </div>
            <p className="mt-1 text-xs leading-4 text-ink">{financialImpact}</p>
          </div>

          <div className="mt-3 border-t border-line pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="eyebrow">{t("refund.executionTitle")}</div>
              {executionOutcome ? (
                <span data-testid="refund-execution-status">
                  <ExecutionResultBadge result={executionOutcome} />
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-4 text-ink-muted">
              {executionOutcome === "PENDING"
                ? t("refund.pendingBody")
                : executionOutcome === "EXECUTED"
                  ? t("refund.executedBody")
                  : executionOutcome === "UNVERIFIED" || executionOutcome === "UNKNOWN"
                    ? t("refund.unverifiedBody")
                    : t("refund.noExecution")}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
