/**
 * Execution state, separate from approval state (FRONTEND_STATE_MODEL §4).
 *
 * No record → "Not executed". A result comes from `executionState()` so an
 * offline replay never becomes green and UNVERIFIED never offers a retry.
 */

import { ArrowUpRight, ShieldQuestion } from "lucide-react";
import { Link } from "react-router-dom";
import type { ExecutionRecord } from "../../api/types";
import { formatDateTime } from "../../lib/format";
import { executionState } from "../../lib/statusModel";
import { useI18n } from "../../i18n";
import { StatusBadge } from "../ui/StatusBadge";

export function ExecutionStatusCard({
  execution,
  caseId,
}: {
  execution?: ExecutionRecord;
  caseId: string;
}) {
  const { t } = useI18n();
  const state = executionState(execution);
  const verification = execution?.verification;
  const unverified = state.key === "execution.unverified" || state.key === "execution.unknown";
  // QA-RC-04: a replay carries `remote_readback: false`; a legacy record has
  // no read-back field but is a simulated REPLAY. Either way there was no
  // remote confirmation to report.
  const noRemoteReadback =
    verification?.remote_readback === false ||
    (verification?.remote_readback === undefined &&
      (execution?.simulated === true || execution?.executionMode === "REPLAY"));

  return (
    <div data-testid="execution-state">
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-medium text-ink">{t("case.execution.title")}</span>
        <StatusBadge state={state} size="sm" />
      </div>

      {!execution ? (
        <p className="mt-1 text-xs leading-4 text-ink-muted">{t("case.execution.none")}</p>
      ) : (
        <dl className="mt-1.5">
          <div className="flex items-baseline justify-between gap-3 py-0.5">
            <dt className="text-xs text-ink-faint">{t("execution.mode")}</dt>
            <dd className="num text-xs text-ink">{execution.executionMode ?? "—"}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-0.5">
            <dt className="text-xs text-ink-faint">{t("execution.confirmed")}</dt>
            <dd className="text-xs text-ink">
              {/* QA-RC-04: an offline replay never reads the remote state back,
                  so "confirmed" is not "no" — it is not applicable. Only a run
                  that actually performed a read-back may answer yes/no. */}
              {noRemoteReadback
                ? t("execution.noRemoteReadback")
                : verification?.confirmed === undefined
                  ? t("rd.notProvided")
                  : verification.confirmed
                    ? t("common.yes")
                    : t("common.no")}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-0.5">
            <dt className="text-xs text-ink-faint">{t("execution.checkedAt")}</dt>
            <dd className="num text-xs text-ink">
              {verification?.checkedAt ? formatDateTime(verification.checkedAt) : "—"}
            </dd>
          </div>
        </dl>
      )}

      {unverified ? (
        <p className="mt-1.5 flex items-start gap-1.5 rounded border border-warn-line bg-warn-bg/60 px-2 py-1.5 text-xs leading-4 text-ink">
          <ShieldQuestion size={11} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          {t("approval.decision.unverified")}
        </p>
      ) : null}

      <Link
        to={`/audit?case=${caseId}`}
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:text-navy-800"
      >
        {t("approval.decision.toAudit")}
        <ArrowUpRight size={10} aria-hidden />
      </Link>
    </div>
  );
}
