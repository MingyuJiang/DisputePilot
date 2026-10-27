import { ArrowUpRight, FileWarning, Link2, Receipt, ShieldCheck, User } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AuditEvent, CaseRecord, EvidenceRecord } from "../../api/types";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { GroundingBadge, DisputeStatusBadge, RiskBadge } from "./Badges";
import { CaseReadTime, ProvenanceBadge } from "./SandboxStatus";
import { formatDateTime, formatMoney } from "../../lib/format";
import { remoteStatusFromNote } from "../../lib/sandbox";
import { AuditTimeline } from "./AuditTimeline";
import { evidenceTypeLabel, useI18n } from "../../i18n";

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <dt className="shrink-0 text-[11px] text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-right text-[11.5px] text-ink">{value}</dd>
    </div>
  );
}

function EvidenceRow({
  item,
  onOpen,
}: {
  item: EvidenceRecord;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const missing = item.grounding === "MISSING" || item.grounding === "UNKNOWN";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
        missing
          ? "border-dashed border-stop-line bg-stop-bg/30 hover:bg-stop-bg/60"
          : "border-line bg-card hover:border-navy-600 hover:bg-navy-50/40",
      ].join(" ")}
    >
      <span className="mt-0.5 shrink-0">
        {missing ? (
          <FileWarning size={13} className="text-stop" aria-hidden />
        ) : item.direction === "FROM_PAYPAL" ? (
          <Link2 size={13} className="text-ink-faint" aria-hidden />
        ) : item.direction === "FROM_MERCHANT" ? (
          <Receipt size={13} className="text-ink-faint" aria-hidden />
        ) : (
          <User size={13} className="text-ink-faint" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-1.5">
          <span className="truncate text-[11.5px] font-medium text-ink">
            {evidenceTypeLabel(item.type, item.typeLabel, t)}
          </span>
          <span className="shrink-0 font-mono text-[9.5px] text-ink-faint">{item.evidenceId}</span>
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-ink-faint">{item.source}</span>
      </span>
    </button>
  );
}

/** Capture-level stages. Anything else is not a payment lifecycle value. */
const PAYMENT_LIFECYCLE_VALUES: readonly string[] = [
  "PENDING",
  "CAPTURED",
  "COMPLETED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "DECLINED",
  "FAILED",
  "UNKNOWN",
];

export function CaseContextPanel({
  record,
  evidence,
  audit,
  payment = false,
  captureStatus,
  onOpenEvidence,
}: {
  record: CaseRecord;
  evidence: EvidenceRecord[];
  audit: AuditEvent[];
  /** PAYMENT (capture) case: capture wording only, no dispute wording. */
  payment?: boolean;
  /**
   * Capture status read from the capture endpoint. It is a capture field and
   * must never be replaced by the dispute status or the refund status.
   */
  captureStatus?: string;
  onOpenEvidence: (evidenceId: string) => void;
}) {
  const { t } = useI18n();
  const available = evidence.filter((item) => item.available);
  const missing = evidence.filter((item) => !item.available);
  const remoteStatus = remoteStatusFromNote(record.liveStatusNote);
  const remoteActions = record.availableActions ?? [];
  const liveBasis = remoteActions.some((link) => link.basis === "LIVE_HATEOAS");
  // QA-RC-08: a dispute lifecycle stage is meaningless for a capture. Printing
  // the backend's "UNKNOWN" here read as a missing fact about the money; the
  // capture status above is the state that actually applies.
  const lifecycle = payment
    ? (PAYMENT_LIFECYCLE_VALUES.includes(record.lifecycleStage)
        ? record.lifecycleStage
        : t("rd.notProvided"))
    : record.lifecycleStage;
  // A capture case's transaction status is the capture status — never the
  // dispute status (UNKNOWN on the backend) and never a refund result.
  const transactionStatus = payment
    ? (captureStatus?.trim() || t("capture.notRead"))
    : record.transaction.captureStatus;
  const remoteStatusValue =
    remoteStatus && remoteStatus.toUpperCase() !== "UNKNOWN"
      ? remoteStatus
      : record.status === "UNKNOWN"
        ? t("context.notReported")
        : record.status;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="border-b border-line px-3.5 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-ink-strong">{t("context.title")}</div>
            <RiskBadge risk={record.risk} />
          </div>
          <div className="mt-1 text-[10.5px] text-ink-faint">
            {t("context.openedUpdated", {
              opened: formatDateTime(record.openedAt),
              updated: formatDateTime(record.updatedAt),
            })}
          </div>
        </div>

        <div className="border-b border-line px-3.5 py-3">
          <div className="eyebrow mb-1">{t(payment ? "context.payment" : "context.dispute")}</div>
          <dl>
            <Row
              label={t(payment ? "context.typePayment" : "context.type")}
              value={`${record.family} · ${record.reasonLabel}`}
            />
            <Row label={t("context.amount")} value={<span className="num">{formatMoney(record.amountMinor, record.currency)}</span>} />
            <Row
              label={t(payment ? "context.statusPayment" : "context.status")}
              value={
                payment ? (
                  <span
                    data-testid="transaction-status"
                    className="font-mono text-[10.5px] font-semibold text-ink-strong"
                  >
                    {transactionStatus}
                  </span>
                ) : (
                  <DisputeStatusBadge status={record.status} />
                )
              }
            />
            <Row
              label={t(payment ? "context.lifecyclePayment" : "context.lifecycle")}
              value={<span className="font-mono text-[10.5px]">{lifecycle}</span>}
            />
            <Row label={t("context.sellerProtection")} value={<span className="text-[10.5px]">{record.sellerProtection}</span>} />
          </dl>
        </div>

        {payment ? null : (
          <div className="border-b border-line px-3.5 py-3">
            <div className="mb-1 flex items-center justify-between">
              <div className="eyebrow">{t("context.buyerClaim")}</div>
              <Badge tone="scenario">{t("badge.grounding.SCENARIO_DEFINED")}</Badge>
            </div>
            <blockquote className="border-l-2 border-line-strong pl-2.5 text-[11.5px] leading-5 text-ink">
              {record.buyerClaim}
            </blockquote>
            <div className="mt-1.5 text-[10px] text-ink-faint">
              {t("context.claimNote")}
            </div>
          </div>
        )}

        <div className="border-b border-line px-3.5 py-3">
          <div className="eyebrow mb-1">{t("context.transaction")}</div>
          <dl>
            <Row label={t("context.order")} value={<span className="font-mono text-[10.5px]">{record.transaction.orderRef}</span>} />
            <Row label={t("context.capture")} value={<span className="font-mono text-[10.5px]">{record.transaction.captureRef}</span>} />
            <Row
              label={t("context.captureStatus")}
              value={
                <span data-testid="context-capture-status" className="font-mono text-[10.5px]">
                  {transactionStatus}
                </span>
              }
            />
          </dl>
          <p className="mt-1 text-[10px] leading-4 text-ink-faint">{record.transaction.note}</p>
        </div>

        <div className="px-3.5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="eyebrow">{t("context.evidenceOnFile")}</div>
            <span className="num text-[10px] text-ink-faint">
              {t("context.availableMissing", { available: available.length, missing: missing.length })}
            </span>
          </div>
          <div className="space-y-1">
            {evidence.map((item) => (
              <EvidenceRow key={item.evidenceId} item={item} onOpen={() => onOpenEvidence(item.evidenceId)} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <GroundingBadge grounding="VERIFIED_OBSERVATION" />
            <GroundingBadge grounding="SCENARIO_DEFINED" />
            <GroundingBadge grounding="AI_INFERENCE" />
            <GroundingBadge grounding="MISSING" />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-3.5 py-3">
          <div className="text-sm font-semibold text-ink-strong">{t("context.timeline")}</div>
          <Link to={`/audit?case=${record.caseId}`} className="inline-flex items-center gap-1 text-[10.5px] font-medium text-navy-700 hover:text-navy-800">
            {t("context.fullAudit")}
            <ArrowUpRight size={11} aria-hidden />
          </Link>
        </div>
        <div className="px-3.5 py-3">
          <AuditTimeline events={audit.slice(-3)} compact />
        </div>
      </Card>

      <Card className="px-3.5 py-3">
        <div className="flex items-center gap-1.5">
          <ShieldCheck size={12} className="text-ink-faint" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
            {t("context.sourceSnapshot")}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={record.validationLevel === "FROZEN_SANDBOX_E1_VERIFIED" ? "pass" : "scenario"}>
            {record.validationLevel === "FROZEN_SANDBOX_E1_VERIFIED"
              ? t("context.frozenSandbox")
              : t("badge.grounding.SCENARIO_DEFINED")}
          </Badge>
          <span className="num rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] text-ink-muted">
            {record.snapshotVersion}
          </span>
        </div>

        <dl className="mt-2 border-t border-line pt-1.5">
          <Row
            label={t("context.dataSource")}
            value={
              record.provenance ? (
                <ProvenanceBadge provenance={record.provenance} />
              ) : (
                t("context.notReported")
              )
            }
          />
          <Row
            label={t("context.readAt")}
            value={<CaseReadTime record={record} audit={audit} className="num" />}
          />
          <Row
            label={t("context.remoteStatus")}
            value={<span className="num">{remoteStatusValue}</span>}
          />
          <Row
            label={t("context.remoteActions")}
            value={
              remoteActions.length > 0 ? (
                <span className="num">
                  {t(
                    liveBasis ? "context.remoteActionsLive" : "context.remoteActionsFrozen",
                    { count: remoteActions.length },
                  )}
                </span>
              ) : (
                t("context.notReported")
              )
            }
          />
        </dl>

        {record.liveStatusNote ? (
          <p className="mt-1.5 text-[10px] leading-4 text-ink-muted">
            <span className="font-medium text-ink-faint">{t("context.liveNote")}: </span>
            {record.liveStatusNote}
          </p>
        ) : null}
        <p className="mt-1.5 text-[10px] leading-4 text-ink-muted">{record.fixtureNote}</p>
        <p className="mt-1 break-words font-mono text-[9.5px] leading-4 text-ink-faint">
          {t("context.snapshotHash", { hash: record.snapshotHash })}
        </p>
      </Card>
    </div>
  );
}
