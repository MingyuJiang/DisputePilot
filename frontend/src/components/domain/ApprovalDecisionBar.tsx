/**
 * Approval decision bar (FRONTEND_REDESIGN_PLAN §3.4 step 6).
 *
 * Decisions and execution are deliberately separated:
 *   - the approval record decides the request (approve / reject, reason required);
 *   - execution is a different, gated step on the case page / audit trail.
 *
 * A specialist never sees an enabled approve button. An approved request is
 * never green, and an UNVERIFIED execution offers no retry.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Info, ShieldQuestion, XCircle } from "lucide-react";
import type { ActionProposal, ApprovalRecord } from "../../api/types";
import { approvalState, executionState } from "../../lib/statusModel";
import { formatDateTime } from "../../lib/format";
import { useI18n } from "../../i18n";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { StatusBadge } from "../ui/StatusBadge";

export function ApprovalDecisionBar({
  proposal,
  approval,
  caseId,
  onDecide,
}: {
  proposal: ActionProposal;
  approval?: ApprovalRecord;
  caseId: string;
  onDecide: (decision: "APPROVED" | "REJECTED", reason: string) => void;
}) {
  const { t } = useI18n();
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [reason, setReason] = useState("");

  const state = approvalState(approval);
  const execution = executionState(proposal.execution);
  const unverified =
    execution.key === "execution.unverified" || execution.key === "execution.unknown";
  const awaiting = proposal.state === "AWAITING_APPROVAL" && approval?.decision !== "APPROVED";
  const decided = approval && approval.decision !== "PENDING";

  const openDialog = (choice: "APPROVED" | "REJECTED") => {
    setDecision(choice);
    setReason(choice === "APPROVED" ? t("approval.defaultApproveReason") : "");
  };

  const confirm = () => {
    if (!decision || reason.trim().length < 8) return;
    onDecide(decision, reason.trim());
    setDecision(null);
  };

  return (
    <section
      className="overflow-hidden rounded-lg border border-line bg-card shadow-card"
      data-testid="approval-decision"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink-strong">{t("approval.decision")}</h2>
        <StatusBadge state={state} size="sm" />
      </header>

      <div className="px-4 py-3">
        <dl className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs text-ink-faint">{t("approval.submittedBy")}</dt>
            <dd className="text-base text-ink">{proposal.submittedBy ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs text-ink-faint">{t("approval.submitted")}</dt>
            <dd className="num text-base text-ink">
              {proposal.submittedAt ? formatDateTime(proposal.submittedAt) : "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs text-ink-faint">{t("approval.evidenceStatus")}</dt>
            <dd className="text-right text-base text-ink">{proposal.evidenceStatus}</dd>
          </div>
        </dl>

        {awaiting ? (
          <div className="mt-3 space-y-2">
            <Button variant="primary" className="w-full" onClick={() => openDialog("APPROVED")}>
              <CheckCircle2 size={13} aria-hidden />
              {t("approval.approve")}
            </Button>
            <Button
              variant="secondary"
              className="w-full border-stop-line text-stop hover:bg-stop-bg"
              onClick={() => openDialog("REJECTED")}
            >
              <XCircle size={13} aria-hidden />
              {t("approval.reject")}
            </Button>
            <p className="text-center text-xs leading-4 text-ink-faint">
              {t("approval.recordedAgainst", { name: t("merchant.name") })}
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {decided ? (
              <div
                className={[
                  "rounded-md border px-3 py-2",
                  approval?.decision === "REJECTED"
                    ? "border-stop-line bg-stop-bg"
                    : "border-info-line bg-info-bg/60",
                ].join(" ")}
                data-testid="decision-record"
              >
                <div className="flex items-center gap-1.5">
                  {approval?.decision === "REJECTED" ? (
                    <XCircle size={12} className="text-stop" aria-hidden />
                  ) : (
                    <CheckCircle2 size={12} className="text-info" aria-hidden />
                  )}
                  <span
                    className={[
                      "text-base font-semibold",
                      approval?.decision === "REJECTED" ? "text-stop" : "text-info",
                    ].join(" ")}
                  >
                    {t(approval?.decision === "REJECTED" ? "approval.rejected" : "approval.approved")}
                  </span>
                  <span className="num ml-auto text-xs font-normal text-ink-faint">
                    {approval ? formatDateTime(approval.decidedAt) : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-4 text-ink">{approval?.reason}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {t("approval.by", { name: approval?.decidedBy ?? "" })}
                </p>
                <p className="mt-1 text-xs leading-4 text-ink-muted">
                  {t(
                    approval?.decision === "REJECTED"
                      ? "approval.decision.rejectedNext"
                      : "approval.decision.approvedNext",
                  )}
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-line bg-subtle px-3 py-2.5">
                <div className="text-base font-semibold text-ink">
                  {t(
                    proposal.state === "DRAFT"
                      ? "approval.notSubmitted"
                      : "approval.decision.noRecord",
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-4 text-ink-muted">
                  {t(
                    proposal.state === "DRAFT"
                      ? "approval.notSubmittedBody"
                      : "approval.decision.noRecordBody",
                  )}
                </p>
              </div>
            )}

            {approval?.decision === "APPROVED" ? (
              <div className="flex flex-wrap gap-1.5">
                <Link
                  to={`/cases/${caseId}`}
                  className="inline-flex items-center gap-1 rounded border border-line bg-card px-2 py-1 text-xs font-medium text-navy-700 hover:bg-hover"
                >
                  {t("approval.decision.toExecution")}
                  <ArrowUpRight size={10} aria-hidden />
                </Link>
                <Link
                  to={`/audit?case=${caseId}`}
                  className="inline-flex items-center gap-1 rounded border border-line bg-card px-2 py-1 text-xs font-medium text-navy-700 hover:bg-hover"
                >
                  {t("approval.decision.toAudit")}
                  <ArrowUpRight size={10} aria-hidden />
                </Link>
              </div>
            ) : null}
          </div>
        )}

        {unverified ? (
          <div
            className="mt-2 flex items-start gap-2 rounded-md border border-warn-line bg-warn-bg/70 px-2.5 py-2"
            data-testid="decision-unverified"
          >
            <ShieldQuestion size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <p className="text-xs leading-4 text-ink">{t("approval.decision.unverified")}</p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-line bg-subtle px-4 py-2.5">
        <div className="flex items-start gap-2">
          <Info size={11} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
          <p className="text-xs leading-4 text-ink-muted" data-testid="decision-execution-note">
            {t("approval.decision.note")}
          </p>
        </div>
      </div>

      <Dialog
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision === "APPROVED" ? t("approval.dialog.approveTitle") : t("approval.dialog.rejectTitle")}
        description={
          decision === "APPROVED"
            ? t("approval.dialog.approveDesc")
            : t("approval.dialog.rejectDesc")
        }
        tone={decision === "REJECTED" ? "danger" : "default"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecision(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant={decision === "REJECTED" ? "danger" : "primary"}
              onClick={confirm}
              disabled={reason.trim().length < 8}
            >
              {t(decision === "APPROVED" ? "approval.dialog.recordCta" : "approval.dialog.rejectCta")}
            </Button>
          </>
        }
      >
        <label htmlFor="decision-reason" className="text-base font-medium text-ink">
          {t("approval.dialog.reason")} <span className="text-stop">*</span>
        </label>
        <textarea
          id="decision-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          className="mt-1.5 w-full resize-y rounded-md border border-line bg-card px-2.5 py-2 text-xs leading-5 text-ink outline-none transition-colors focus:border-navy-600"
          placeholder={
            decision === "APPROVED"
              ? t("approval.dialog.reasonPlaceholderApprove")
              : t("approval.dialog.reasonPlaceholderReject")
          }
        />
        <div className="mt-1 flex items-center justify-between text-xs text-ink-faint">
          <span>{t("approval.dialog.required")}</span>
          <span className="num">{reason.trim().length}</span>
        </div>
        {decision === "APPROVED" ? (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-warn-line bg-warn-bg/60 px-2.5 py-2">
            <AlertTriangle size={11} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <p className="text-xs leading-4 text-ink">{t("approval.decision.note")}</p>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
