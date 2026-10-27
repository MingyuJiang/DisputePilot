/**
 * Approval detail — payload first (FRONTEND_REDESIGN_PLAN §3.4).
 *
 * Reading order is deliberate: the exact payload dominates, then the reasons,
 * then the validator summary (failures always visible, details collapsed),
 * then the capability snapshot. The decision column states — and enforces —
 * that approving does not execute.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowUpRight, ShieldX } from "lucide-react";
import { useWorkspace } from "../hooks/useWorkspace";
import { useRuntime } from "../hooks/useRuntime";
import { disputePilot } from "../api";
import { useToast } from "../components/ui/Toast";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Disclosure } from "../components/ui/Disclosure";
import { PageSection } from "../components/ui/PageSection";
import { StatusBadge } from "../components/ui/StatusBadge";
import { SourceBadge } from "../components/ui/SourceBadge";
import { EvidenceDrawer } from "../components/domain/EvidenceDrawer";
import { AuditTimeline } from "../components/domain/AuditTimeline";
import { ExecutionRecordPanel } from "../components/domain/ExecutionRecordPanel";
import { PayloadPreview } from "../components/domain/PayloadPreview";
import { WhyPanel } from "../components/domain/WhyPanel";
import { PolicySummary } from "../components/domain/PolicySummary";
import { CapabilitySnapshot } from "../components/domain/CapabilitySnapshot";
import { ApprovalDecisionBar } from "../components/domain/ApprovalDecisionBar";
import { RiskBadge } from "../components/domain/Badges";
import { formatDateTime, formatMoney } from "../lib/format";
import { approvalState, caseState, sourceOf, validationState } from "../lib/statusModel";
import { captureViewOf, formatAmountMinor, isRefundAction, refundAmountMinorOf } from "../lib/refund";
import { captureReferenceFor } from "../api/capture";
import { actionLabel, useI18n } from "../i18n";
import {
  createApprovalOriginApi,
  type ApprovalSubmissionOrigin,
} from "../api/approvalOrigin";

export function ApprovalDetailPage() {
  const { proposalId = "" } = useParams();
  const state = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useI18n();
  const runtime = useRuntime();

  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<ApprovalSubmissionOrigin | null>(null);
  const [originError, setOriginError] = useState<{ code: string; message: string } | null>(null);
  const [originLoading, setOriginLoading] = useState(false);
  const [originNonce, setOriginNonce] = useState(0);

  const proposal = state.proposals.find((item) => item.proposalId === proposalId);
  const record = state.cases.find((item) => item.caseId === proposal?.caseId);
  const analysis = state.analyses.find((item) => item.caseId === proposal?.caseId);
  const evidence = state.evidence.filter((item) => item.caseId === proposal?.caseId);
  const audit = state.audit
    .filter((item) => item.caseId === proposal?.caseId)
    .sort((a, b) => a.at.localeCompare(b.at));
  const approval = state.approvals.find((item) => item.proposalId === proposalId);
  const approvalId = approval?.approvalId ?? "";

  // Provenance always comes from the backend; a failed lookup clears the block
  // instead of leaving a previously rendered source on screen.
  useEffect(() => {
    if (!approvalId) return;
    let cancelled = false;
    setOriginLoading(true);
    setOriginError(null);
    createApprovalOriginApi()
      .getOrigin(approvalId)
      .then((value) => {
        if (cancelled) return;
        setOrigin(value);
        setOriginLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setOrigin(null);
        const detail =
          error && typeof error === "object" && "code" in error && "message" in error
            ? { code: String((error as { code: unknown }).code), message: String((error as { message: unknown }).message) }
            : { code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
        setOriginError(detail);
        setOriginLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [approvalId, originNonce]);
  // QA-RC-08: the case wire has no capture_status and `transaction.captureStatus`
  // is a placeholder, so a refund approval used to show "Capture: UNKNOWN".
  // The capture endpoint is authoritative; when it is unavailable the page says
  // "not provided" instead of printing a fake stage.
  const isRefund = proposal ? isRefundAction(proposal.action) : false;
  const captureRef = record ? captureReferenceFor(record) : "";
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!isRefund || !captureRef) {
      setCaptureStatus(null);
      return;
    }
    let cancelled = false;
    void disputePilot.fetchCaptureStatus(captureRef).then((outcome) => {
      if (cancelled) return;
      setCaptureStatus(outcome.ok ? outcome.capture.status : null);
    });
    return () => {
      cancelled = true;
    };
  }, [isRefund, captureRef]);

  const attempt = audit.find(
    (item) => item.proposalId === proposal?.proposalId && item.action === "EXECUTION_ATTEMPT",
  );

  if (!proposal || !record) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-20 text-center">
        <h1 className="text-lg font-semibold text-ink-strong">{t("approval.notFound")}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("approval.notFoundBody", { proposalId })}
        </p>
        <Button variant="primary" className="mt-4" onClick={() => navigate("/approvals")}>
          {t("approval.backToQueue")}
        </Button>
      </div>
    );
  }

  const refundAction = isRefundAction(proposal.action);
  const refundAmount = refundAction ? refundAmountMinorOf(proposal) : undefined;
  const currency = refundAction ? captureViewOf(record, proposal).currency : record.currency;
  const amount = refundAction
    ? refundAmount === undefined
      ? "—"
      : `${formatAmountMinor(refundAmount)} ${currency}`
    : formatMoney(record.amountMinor, record.currency);

  const passed = proposal.validation.checks.filter((check) => check.status === "PASS").length;
  const failed = proposal.validation.checks.filter((check) => check.status === "FAIL").length;
  const validation = validationState(proposal.validation.decision);

  // A refund moves no real funds in offline replay, and never when the case is
  // declared synthetic. The claim follows the runtime, not the page name.
  const synthetic = refundAction
    ? record.provenance === "SIMULATED_COMPOSITE" ||
      !runtime.health ||
      (runtime.health.executionMode ?? "").toUpperCase() === "REPLAY"
    : false;

  const selectedEvidence = evidence.find((item) => item.evidenceId === evidenceId) ?? null;

  const onDecide = (decision: "APPROVED" | "REJECTED", reason: string) => {
    disputePilot.decideProposal(proposal.proposalId, decision, "merchant", reason);
    toast.push(
      decision === "APPROVED"
        ? {
            tone: "info",
            title: t("approval.toast.recorded"),
            detail: t("approval.decision.approvedNext"),
          }
        : {
            tone: "warning",
            title: t("approval.toast.rejected"),
            detail: t("approval.decision.rejectedNext"),
          },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-5 lg:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link
          to="/approvals"
          className="inline-flex items-center gap-1.5 text-base font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={12} aria-hidden />
          {t("approval.backToQueue")}
        </Link>
        <Link
          to={`/cases/${record.caseId}`}
          className="inline-flex items-center gap-1.5 text-base font-medium text-navy-700 transition-colors hover:text-navy-800"
        >
          {t("approval.openWorkspace")}
          <ArrowUpRight size={11} aria-hidden />
        </Link>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="eyebrow mb-1">
            {t("approval.eyebrow", { proposalId: proposal.proposalId })}
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.015em] text-ink-strong">
            {record.caseId} · {actionLabel(proposal.actionLabel, proposal.action, t)}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge state={approvalState(approval)} />
            <StatusBadge state={caseState(record)} />
            <RiskBadge risk={proposal.risk} />
            {/* QA-RC-08: a capture has no dispute lifecycle. On a payment case
                the capture status is the state that actually means something,
                so "UNKNOWN" is never shown as if it were a missing fact. */}
            <Badge tone="neutral">
              {refundAction
                ? t("approval.captureStatus", {
                    status: captureStatus ?? t("rd.notProvided"),
                  })
                : t("approval.lifecycle", { stage: record.lifecycleStage })}
            </Badge>
            <Badge tone="neutral">
              {t("approval.snapshotBadge", { version: proposal.snapshotVersion })}
            </Badge>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
            {t(refundAction ? "refund.amount" : "approval.summary.amount")}
          </div>
          <div className="num text-[26px] font-semibold leading-9 text-ink-strong">{amount}</div>
          <div className="num text-xs text-ink-faint">{currency}</div>
        </div>
      </div>

      <section
        className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line bg-card px-4 py-3 shadow-card sm:grid-cols-3 lg:grid-cols-6"
        aria-label={t("approval.summary.label")}
        data-testid="approval-summary"
      >
        <div className="min-w-0">
          <div className="eyebrow">{t("approval.summary.request")}</div>
          <div className="num mt-0.5 break-all font-mono text-base text-ink">
            {approval?.approvalId ?? t("rd.notProvided")}
          </div>
          <div className="break-all font-mono text-xs text-ink-faint">{proposal.proposalId}</div>
        </div>
        <div className="min-w-0">
          <div className="eyebrow">{t("approval.summary.case")}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="num text-base font-medium text-ink">{record.caseId}</span>
            <StatusBadge state={caseState(record)} size="sm" />
          </div>
        </div>
        <div className="min-w-0">
          <div className="eyebrow">{t("approval.summary.action")}</div>
          <div className="mt-0.5 text-base text-ink">
            {actionLabel(proposal.actionLabel, proposal.action, t)}
          </div>
          <div className="font-mono text-xs text-ink-faint">{proposal.action}</div>
        </div>
        <div className="min-w-0">
          <div className="eyebrow">{t("approval.summary.approval")}</div>
          <div className="mt-0.5">
            <StatusBadge state={approvalState(approval)} size="sm" />
          </div>
          <div className="num mt-0.5 text-xs text-ink-faint">
            {approval?.decidedAt ? formatDateTime(approval.decidedAt) : "—"}
          </div>
        </div>
        <div className="min-w-0">
          <div className="eyebrow">{t("approval.summary.validator")}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <StatusBadge state={validation} size="sm" />
            <span className="num text-xs text-ink-muted">
              {t("approval.summary.counts", { passed, failed })}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="eyebrow">{t("approval.summary.runtime")}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {sourceOf({ provenance: record.provenance }).map((source) => (
              <SourceBadge key={source.key} source={source} size="sm" />
            ))}
          </div>
        </div>
      </section>

      

      <PageSection
        className="mt-4"
        title={t("origin.title")}
        description={t("origin.subtitle")}
        tone={
          originError
            ? "warn"
            : origin?.source_type === "AUTOPILOT_BATCH"
              ? "info"
              : "neutral"
        }
        actions={
          origin?.submission_batch_id ? (
            <Link
              to={`/autopilot?batch=${encodeURIComponent(origin.submission_batch_id)}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:text-navy-800"
            >
              {t("origin.openBatch")}
              <ArrowUpRight size={11} aria-hidden />
            </Link>
          ) : null
        }
      >
        {originLoading ? (
          <p className="px-4 py-3 text-xs text-ink-muted">{t("origin.loading")}</p>
        ) : originError ? (
          <div className="px-4 py-3">
            <p className="text-xs text-stop">
              {t("origin.failed")}: {originError.code} — {originError.message}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => setOriginNonce((value) => value + 1)}
            >
              {t("origin.retry")}
            </Button>
          </div>
        ) : origin ? (
          <div className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={origin.source_type === "AUTOPILOT_BATCH" ? "info" : "neutral"}>
                {origin.source_type === "AUTOPILOT_BATCH"
                  ? t("origin.typeBatch")
                  : t("origin.typeSingle")}
              </Badge>
              {origin.validation_passed === true ? (
                <Badge tone="pass">{t("origin.submitValidationPassed")}</Badge>
              ) : origin.validation_passed === false ? (
                <Badge tone="stop">{t("origin.submitValidationFailed")}</Badge>
              ) : null}
            </div>
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
              <div className="min-w-0">
                <dt className="eyebrow">{t("origin.batch")}</dt>
                <dd className="mt-0.5 break-all font-mono text-ink">
                  {origin.submission_batch_id ?? t("origin.none")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="eyebrow">{t("origin.run")}</dt>
                <dd className="mt-0.5 break-all font-mono text-ink">
                  {origin.run_id ?? t("origin.none")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="eyebrow">{t("origin.proposal")}</dt>
                <dd className="mt-0.5 break-all font-mono text-ink">{origin.proposal_id}</dd>
              </div>
              <div className="min-w-0">
                <dt className="eyebrow">{t("origin.report")}</dt>
                <dd className="mt-0.5 break-all font-mono text-ink">
                  {origin.validation_report_id ?? t("origin.none")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="eyebrow">{t("origin.reason")}</dt>
                <dd className="mt-0.5 break-all font-mono text-ink">
                  {origin.reason_code ?? t("origin.none")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="eyebrow">{t("origin.created")}</dt>
                <dd className="mt-0.5 num text-ink">
                  {origin.approval_created_at ?? t("origin.unknownTime")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="eyebrow">{t("origin.decision")}</dt>
                <dd className="mt-0.5 text-ink">
                  {origin.approval_decision}
                  {origin.approval_decision === "PENDING"
                    ? t("origin.decisionPending")
                    : ""}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="eyebrow">{t("origin.submittedAt")}</dt>
                <dd className="mt-0.5 num text-ink">{origin.submitted_at ?? t("origin.none")}</dd>
              </div>
            </dl>
            {origin.notes.length ? (
              <ul className="mt-2 space-y-0.5">
                {origin.notes.map((note, index) => (
                  <li key={index} className="text-2xs leading-5 text-ink-muted">
                    · {note}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-2xs text-ink-faint">{t("origin.stateNote")}</p>
          </div>
        ) : null}
      </PageSection>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="order-2 min-w-0 space-y-3 xl:order-1">
          <PayloadPreview proposal={proposal} record={record} synthetic={synthetic} />

          <WhyPanel
            analysis={analysis}
            proposal={proposal}
            evidence={evidence}
            onOpenEvidence={(id) => setEvidenceId(id)}
          />

          <PageSection
            title={t("approval.policyTitle")}
            description={t("approval.policySubtitle")}
            tone={validation.tone}
          >
            <PolicySummary
              checks={proposal.validation.checks}
              decision={proposal.validation.decision}
              summary={proposal.validation.summary}
            />
          </PageSection>

          <PageSection
            title={t("approval.capabilityTitle")}
            description={t("approval.capabilitySubtitle")}
          >
            <CapabilitySnapshot snapshot={proposal.hateoas} />
          </PageSection>

          <PageSection
            title={t("approval.auditTitle")}
            actions={
              <Link
                to={`/audit?case=${record.caseId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:text-navy-800"
              >
                {t("approval.openTrail")}
                <ArrowUpRight size={11} aria-hidden />
              </Link>
            }
          >
            <AuditTimeline events={audit} />
          </PageSection>
        </div>

        <div className="order-1 min-w-0 space-y-3 xl:order-2 xl:sticky xl:top-[92px] xl:max-h-[calc(100vh-110px)] xl:self-start xl:overflow-y-auto xl:pr-1">
          <ApprovalDecisionBar
            proposal={proposal}
            approval={approval}
            caseId={record.caseId}
            onDecide={onDecide}
          />

          {proposal.state === "BLOCKED" ? (
            <div className="rounded-md border border-stop-line bg-stop-bg px-3.5 py-2.5">
              <div className="flex items-center gap-1.5 text-base font-semibold text-stop">
                <ShieldX size={12} aria-hidden />
                {t("approval.cannotApprove")}
              </div>
              <p className="mt-1 text-xs leading-4 text-ink">{proposal.blockReason}</p>
            </div>
          ) : null}

          {proposal.execution || attempt ? (
            <ExecutionRecordPanel
              execution={proposal.execution}
              attempt={attempt}
              action={proposal.action}
              refund={
                refundAction
                  ? {
                      captureId: captureViewOf(record, proposal).captureId,
                      amountMinor: refundAmount,
                      currency,
                    }
                  : undefined
              }
            />
          ) : (
            <p className="rounded-md border border-line bg-subtle px-3 py-2 text-xs leading-4 text-ink-muted">
              {t("case.execution.none")}
            </p>
          )}

          <div className="rounded-md border border-line bg-card px-3.5 py-2.5">
            <Disclosure summary={t("approval.technical")}>
              <dl className="space-y-1">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">{t("case.technical.version")}</dt>
                  <dd className="num text-ink">{proposal.snapshotVersion}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">{t("case.technical.hash")}</dt>
                  <dd className="break-all font-mono text-xs text-ink">{proposal.snapshotHash}</dd>
                </div>
              </dl>
              <p className="mt-1.5 text-xs leading-4 text-ink-muted">
                {t("approval.snapshotBindingNote")}
              </p>
            </Disclosure>
          </div>

          {proposal.validation.checks.some((check) => check.id === "V9" && check.status === "FAIL") ? (
            <div className="flex items-start gap-2 rounded-md border border-warn-line bg-warn-bg/60 px-3 py-2">
              <AlertTriangle size={11} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <p className="text-xs leading-4 text-ink">{t("approval.gapTitle")}</p>
            </div>
          ) : null}
        </div>
      </div>

      <EvidenceDrawer
        evidence={selectedEvidence}
        facts={analysis?.facts ?? []}
        onClose={() => setEvidenceId(null)}
        onRequest={() => setEvidenceId(null)}
      />
    </div>
  );
}
