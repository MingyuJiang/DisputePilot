/**
 * Execution request vs remote verification.
 *
 * Two independent blocks on purpose: a request row is never evidence that the
 * remote state changed. `simulated=false` must never inherit replay wording,
 * and `confirmed=false` / `result=UNVERIFIED` always becomes "Result unknown"
 * with an explicit no-auto-retry note.
 */

import { CheckCircle2, Clock, Send, ShieldQuestion } from "lucide-react";
import type { ReactNode } from "react";
import type { ActionKind, AuditEvent, ExecutionRecord } from "../../api/types";
import { formatDateTime } from "../../lib/format";
import { resolveExecutionResult } from "../../lib/executionResult";
import { refundOutcome, type RefundExpectation } from "../../lib/refund";
import { ExecutionResultBadge } from "./Badges";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { useI18n, type MessageKey } from "../../i18n";

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <dt className="shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 break-words text-right text-base text-ink">{value}</dd>
    </div>
  );
}

const dashed = (value?: string | number): ReactNode =>
  value === undefined || value === "" ? "—" : value;

export function ExecutionRecordPanel({
  execution,
  attempt,
  action,
  refund,
}: {
  execution?: ExecutionRecord;
  attempt?: AuditEvent;
  /** Send-message carries a stricter confirmation rule than other actions. */
  action?: ActionKind;
  /**
   * Refund expectation (capture / amount / currency). When present, EXECUTED is
   * only shown for a COMPLETED refund that matches every value.
   */
  refund?: RefundExpectation;
}) {
  const { t } = useI18n();

  const mode =
    execution?.executionMode ??
    attempt?.executionMode ??
    (attempt?.backendEventType === "EXECUTION_REPLAYED" ? "REPLAY" : undefined);
  const simulated = execution?.simulated ?? attempt?.simulated;
  const result = execution?.result;
  const verification = execution?.verification;
  const httpStatus = execution?.httpStatus ?? attempt?.httpStatus;
  const requestId = execution?.requestId ?? attempt?.requestId;
  const at = execution?.at ?? attempt?.at;

  const confirmed = verification?.confirmed;
  const noRemoteReadback = verification?.remote_readback === false ||
    (verification?.remote_readback === undefined && (simulated === true || mode === "REPLAY"));
  const baseResolved = resolveExecutionResult(execution);
  // A refund is only "executed" when the remote refund is COMPLETED and the
  // amount / currency / capture match the proposal (contract v1.2).
  const resolved = refund
    ? refundOutcome(execution, refund, baseResolved)
    : baseResolved;
  const pending = resolved === "PENDING";
  const isLive = simulated === false || mode === "LIVE";
  const unknown =
    !pending &&
    (resolved === "UNVERIFIED" ||
      resolved === "UNKNOWN" ||
      (isLive && confirmed === false) ||
      (verification !== undefined && confirmed === undefined && isLive) ||
      (execution === undefined && isLive && attempt !== undefined));

  const attemptLabelKey: MessageKey = isLive
    ? "execution.sentLive"
    : simulated === true || mode === "REPLAY"
      ? "execution.replayAttempt"
      : "execution.attemptRecorded";
  const attemptTone = isLive ? "info" : simulated === true || mode === "REPLAY" ? "scenario" : "neutral";
  // The reason for an unknown result can arrive on the execution warning or on
  // the EXECUTION_UNKNOWN audit event; both are shown verbatim.
  const unknownReason =
    verification?.uncertainReason ??
    execution?.warning ??
    attempt?.fields.find((field) => /reason/i.test(field.label))?.value;

  return (
    <Card className="overflow-hidden" role="group" aria-label={t("execution.title")}>
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="text-sm font-semibold text-ink-strong">{t("execution.title")}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={attemptTone} dot>
              {t(attemptLabelKey)}
            </Badge>
            <ExecutionResultBadge result={resolved} />
          </div>
        </div>
        <p className="mt-0.5 text-xs leading-4 text-ink-muted">{t("execution.subtitle")}</p>
      </div>

      <div className="divide-y divide-line">
        <section className="px-4 py-2.5" aria-label={t("execution.requestTitle")}>
          <div className="mb-1 flex items-center gap-1.5">
            <Send size={11} className="text-ink-faint" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
              {t("execution.requestTitle")}
            </span>
          </div>
          <dl>
            <Row
              label={t("execution.mode")}
              value={<span className="num">{dashed(mode)}</span>}
            />
            <Row
              label={t("execution.simulated")}
              value={
                simulated === undefined
                  ? t("execution.notProvided")
                  : simulated
                    ? t("execution.yes")
                    : t("execution.no")
              }
            />
            <Row label={t("execution.result")} value={<span className="num">{dashed(result)}</span>} />
            <Row label={t("execution.http")} value={<span className="num">{dashed(httpStatus)}</span>} />
            <Row
              label={t("execution.requestId")}
              value={<span className="break-all font-mono text-xs">{dashed(requestId)}</span>}
            />
            <Row
              label={t("execution.at")}
              value={<span className="num">{at ? formatDateTime(at) : "—"}</span>}
            />
          </dl>
        </section>

        <section className="px-4 py-2.5" aria-label={t("execution.verifyTitle")}>
          <div className="mb-1 flex items-center gap-1.5">
            {unknown ? (
              <Clock size={11} className="text-warn" aria-hidden />
            ) : (
              <CheckCircle2 size={11} className="text-ink-faint" aria-hidden />
            )}
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
              {t("execution.verifyTitle")}
            </span>
          </div>

          {verification ? (
            <>
              <dl>
                <Row
                  label={t("execution.method")}
                  value={<span className="font-mono text-xs">{dashed(verification.method)}</span>}
                />
                <Row
                  label={t("execution.basis")}
                  value={<span className="font-mono text-xs">{dashed(verification.basis)}</span>}
                />
                <Row
                  label={t("execution.confirmed")}
                  value={
                    noRemoteReadback ? (
                      <Badge tone="neutral">{t("execution.noRemoteReadback")}</Badge>
                    ) : confirmed === undefined ? (
                      <Badge tone="neutral">{t("execution.notProvided")}</Badge>
                    ) : confirmed ? (
                      <Badge tone="pass">{t("execution.yes")}</Badge>
                    ) : (
                      <Badge tone="warn">{t("execution.no")}</Badge>
                    )
                  }
                />
                <Row
                  label={t("execution.remoteStatus")}
                  value={<span className="num">{dashed(verification.remoteStatus)}</span>}
                />
                <Row
                  label={t("execution.checkedAt")}
                  value={
                    <span className="num">
                      {verification.checkedAt ? formatDateTime(verification.checkedAt) : "—"}
                    </span>
                  }
                />
              </dl>

              {verification.observations &&
              Object.keys(verification.observations).length > 0 ? (
                <div className="mt-1.5">
                  <div className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
                    {t("execution.observations")}
                  </div>
                  <dl className="mt-0.5 rounded border border-line bg-subtle px-2 py-1">
                    {Object.entries(verification.observations).map(([key, value]) => (
                      <Row
                        key={key}
                        label={<span className="font-mono">{key}</span>}
                        value={<span className="break-words font-mono text-xs">{value}</span>}
                      />
                    ))}
                  </dl>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-base leading-4 text-ink-muted">
              {simulated === false ? t("execution.noVerifyLive") : t("execution.noVerifyReplay")}
            </p>
          )}

          {action === "send-message" ? (
            <p className="mt-1.5 rounded border border-line bg-subtle px-2 py-1 text-xs leading-4 text-ink-muted">
              {t("execution.sendMessageRule")}
            </p>
          ) : null}

          {pending ? (
            <div className="mt-2 rounded-md border border-warn-line bg-warn-bg/70 px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-base font-semibold text-warn">
                <Clock size={12} aria-hidden />
                {t("execution.pendingTitle")}
              </div>
              <p className="mt-0.5 text-xs leading-4 text-ink">
                {t("execution.pendingBody")}
              </p>
            </div>
          ) : null}

          {unknown ? (
            <div className="mt-2 rounded-md border border-warn-line bg-warn-bg/70 px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-base font-semibold text-warn">
                <ShieldQuestion size={12} aria-hidden />
                {t("execution.unverifiedTitle")}
              </div>
              <p className="mt-0.5 text-xs leading-4 text-ink">
                {t("execution.unverifiedBody")}
              </p>
              {unknownReason ? (
                <p className="mt-0.5 text-xs leading-4 text-ink-muted">
                  {t("execution.unverifiedReason", { reason: unknownReason })}
                </p>
              ) : null}
              {resolved === "UNKNOWN" ? (
                <p className="mt-0.5 text-xs leading-4 text-ink-muted">
                  {t("execution.unknownResultBody")}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </Card>
  );
}
