/**
 * Case workspace — facts → gaps → next step (FRONTEND_REDESIGN_PLAN §3.3).
 *
 * Main column: buyer statement, AI assessment, evidence review, timeline.
 * Rail (sticky at ≥1280): exactly one next step, then proposal state, execution
 * state and the capability snapshot. The action editors are collapsed into the
 * rail; they are not page-bottom blocks with their own competing CTA.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ShieldAlert } from "lucide-react";
import { useWorkspace } from "../hooks/useWorkspace";
import { useMerchant } from "../hooks/useMerchant";
import { useRuntime } from "../hooks/useRuntime";
import { useAnalysisRun } from "../hooks/useAnalysisRun";
import { disputePilot } from "../api";
import type { AnalysisErrorInfo } from "../api/errors";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Disclosure } from "../components/ui/Disclosure";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageSection } from "../components/ui/PageSection";
import { StatusBadge } from "../components/ui/StatusBadge";
import { SourceBadge } from "../components/ui/SourceBadge";
import { useToast } from "../components/ui/Toast";
import { AIAssessment } from "../components/domain/AIAssessment";
import { AuditTimeline } from "../components/domain/AuditTimeline";
import { CaptureTriState } from "../components/domain/CaptureTriState";
import { CapabilitySnapshot } from "../components/domain/CapabilitySnapshot";
import { EvidenceDrawer } from "../components/domain/EvidenceDrawer";
import { EvidenceReview } from "../components/domain/EvidenceReview";
import { ExecutionStatusCard } from "../components/domain/ExecutionStatusCard";
import { NextStepCard, type NextStepBlocker } from "../components/domain/NextStepCard";
import { RefundCard } from "../components/domain/RefundCard";
import { ReplayDialog } from "../components/domain/ReplayDialog";
import { SendMessageCard } from "../components/domain/SendMessageCard";
import { SubmitProposalDialog } from "../components/domain/SubmitProposalDialog";
import { sandboxModeOf } from "../components/domain/SandboxStatus";
import { formatDateTime, formatMoney } from "../lib/format";
import type { SendMessageComposerDraft } from "../lib/sendMessage";
import { isPaymentCase, latestRefundProposal } from "../lib/refund";
import { nextStep } from "../lib/nextStep";
import { groupAuditByStage } from "../lib/auditStages";
import { caseState, proposalState, sourceOf } from "../lib/statusModel";
import {
  captureReferenceFor,
  isCaptureCaseId,
  isSyntheticCapture,
  type CaptureStatusOutcome,
} from "../api/capture";
import { runLiveAi } from "../api/llm";
import { actionLabel, useI18n, type MessageKey } from "../i18n";

export function CaseWorkspacePage() {
  const { caseId = "" } = useParams();
  const state = useWorkspace();
  const navigate = useNavigate();
  const { merchant } = useMerchant();
  const toast = useToast();
  const { t, lang } = useI18n();
  const runtime = useRuntime();
  const liveExecution = sandboxModeOf(runtime.health) === "executable";
  const offline = !runtime.health || (runtime.health.executionMode ?? "").toUpperCase() === "REPLAY";

  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [focusFactId, setFocusFactId] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [authoringOpen, setAuthoringOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<AnalysisErrorInfo | undefined>(undefined);
  const [captureOutcome, setCaptureOutcome] = useState<CaptureStatusOutcome | undefined>(undefined);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | undefined>(undefined);
  const [liveChecking, setLiveChecking] = useState(false);

  /**
   * Proposal generation is a backend write (POST /cases/{id}/proposals/generate).
   * The UI never builds a proposal locally: on failure the backend error is
   * shown, and the empty state keeps its "no proposal" status.
   */
  const generateProposal = useCallback(async (): Promise<void> => {
    if (generating) return;
    setGenerating(true);
    setGenerateError(undefined);
    const outcome = await disputePilot.generateProposal(caseId);
    setGenerating(false);
    if (!outcome.ok) {
      setGenerateError(outcome.error);
      toast.push({
        tone: "warning",
        title: t("workspace.toast.generateFailed"),
        detail: outcome.error?.message,
      });
      return;
    }
    toast.push({
      tone: "success",
      title: t("workspace.toast.generated"),
      detail: t("workspace.toast.generatedDetail"),
    });
  }, [caseId, generating, t, toast]);

  const { state: analysisRun, start: startAnalysis } = useAnalysisRun({
    caseId,
    actor: merchant.id,
    run: (id, actor) => disputePilot.runAnalysisRequest(id, actor),
    onSuccess: () => {
      toast.push({
        tone: "success",
        title: t("workspace.toast.analysisDone"),
        detail:
          disputePilot.mode === "http"
            ? t("workspace.toast.analysisDoneHttp")
            : t("workspace.toast.analysisDoneMock"),
      });
      // A real analysis run does not create a proposal by itself. In http mode
      // ask the backend to generate one so the next-step rail is not left with
      // an empty "no proposal" state after a successful run.
      if (disputePilot.mode === "http") void generateProposal();
    },
  });

  useEffect(() => {
    window.scrollTo(0, 0);
    setEvidenceId(null);
    setFocusFactId(null);
    setGenerateError(undefined);
    setAuthoringOpen(false);
    setReplayOpen(false);
  }, [caseId]);

  const record = state.cases.find((item) => item.caseId === caseId);
  const evidence = state.evidence.filter((item) => item.caseId === caseId);
  const analysis = state.analyses.find((item) => item.caseId === caseId);
  const proposals = state.proposals.filter((item) => item.caseId === caseId);
  const proposal = proposals[proposals.length - 1];
  const approval = state.approvals.find((item) => item.proposalId === proposal?.proposalId);
  const audit = state.audit
    .filter((item) => item.caseId === caseId)
    .sort((a, b) => a.at.localeCompare(b.at));
  const auditGroups = groupAuditByStage(audit);

  /**
   * Capture-level cases read their transaction status from the capture record.
   * Detection is the contract's `CAP-…` case form or an explicit PAYMENT
   * family; the capture id itself comes from the case's capture reference.
   */
  const captureCase = isCaptureCaseId(caseId) || record?.actionFamily === "PAYMENT";
  const captureRef = record
    ? captureReferenceFor(record)
    : isCaptureCaseId(caseId)
      ? caseId.slice(4)
      : caseId;

  const loadCapture = useCallback(async (): Promise<void> => {
    setCaptureLoading(true);
    const outcome = await disputePilot.fetchCaptureStatus(captureRef);
    setCaptureOutcome(outcome);
    setCaptureLoading(false);
  }, [captureRef]);

  useEffect(() => {
    if (!captureCase || !record) {
      setCaptureOutcome(undefined);
      setCaptureLoading(false);
      return;
    }
    let cancelled = false;
    setCaptureOutcome(undefined);
    setCaptureLoading(true);
    void disputePilot.fetchCaptureStatus(captureRef).then((outcome) => {
      if (cancelled) return;
      setCaptureOutcome(outcome);
      setCaptureLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // The capture reference is the identity; the record object changes on every
    // workspace refresh and must not trigger another read.
  }, [captureCase, captureRef, Boolean(record)]);

  if (!record) {
    return (
      <div className="mx-auto max-w-[640px] px-6 py-20 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-line bg-card">
          <ShieldAlert size={16} className="text-ink-faint" aria-hidden />
        </div>
        <h1 className="mt-3 text-lg font-semibold text-ink-strong">{t("workspace.notFoundTitle")}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("workspace.notFoundBody", { caseId })}
        </p>
        <Button variant="primary" className="mt-4" onClick={() => navigate("/cases")}>
          {t("workspace.backToQueue")}
        </Button>
      </div>
    );
  }

  const paymentCase = isPaymentCase(record, proposals);
  const refundProposal = latestRefundProposal(proposals);
  const selectedEvidence = evidence.find((item) => item.evidenceId === evidenceId) ?? null;

  // RC-6 (review Phase 6.6): a frozen demo has no live model. Asking the backend
  // once lets the UI stop offering a "live" entry it cannot honour, and lets the
  // primary button say what it actually does (replay a recording).
  const [frozenProvider, setFrozenProvider] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void disputePilot
      .fetchLlmStatus()
      .then((outcome) => {
        if (!cancelled && outcome.ok) setFrozenProvider(outcome.status.provider === "frozen");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRun = () => {
    // Manual trigger only. A failed or timed-out run never retries itself.
    void startAnalysis();
  };

  /**
   * "Live AI": availability is checked first. An unavailable model is an
   * explicit error carrying the backend detail — never a silent stub run.
   */
  const handleRunLive = async () => {
    if (liveChecking || analysisRun.status === "running") return;
    setLiveError(undefined);
    setLiveChecking(true);
    const outcome = await runLiveAi(
      () => disputePilot.fetchLlmStatus(),
      async () => {
        await startAnalysis();
      },
    );
    setLiveChecking(false);
    if (!outcome.ok) {
      setLiveError(outcome.message);
      toast.push({ tone: "warning", title: t("ai.liveAi"), detail: outcome.message });
    }
  };

  const handleSubmit = () => {
    if (!proposal) return;
    disputePilot.submitProposal(proposal.proposalId, merchant.id);
    setSubmitOpen(false);
    toast.push({
      tone: "success",
      title: t("workspace.toast.submitted"),
      detail: t("workspace.toast.submittedDetail", {
        action: actionLabel(proposal.actionLabel, proposal.action, t),
      }),
    });
  };

  /**
   * Send-message always creates a NEW proposal for the exact text, then submits
   * that proposal. An approved proposal is never edited in place: its payload
   * hash stays bound to the text the manager approved.
   */
  const handleSendMessage = async (draft: SendMessageComposerDraft) => {
    const outcome = await disputePilot.createSendMessageProposal({
      caseId,
      actor: merchant.id,
      message: draft.message,
      rationale: draft.rationale,
      evidenceIds: draft.evidenceIds,
    });
    if (outcome.ok && outcome.proposal) {
      disputePilot.submitProposal(outcome.proposal.proposalId, merchant.id);
    }
    return outcome;
  };

  const handleCreateRefund = (input: Parameters<typeof disputePilot.createRefundProposal>[0]) =>
    disputePilot.createRefundProposal(input);

  const handleSubmitProposal = (proposalId: string) => {
    disputePilot.submitProposal(proposalId, merchant.id);
  };

  /* ------------------------------ next step ------------------------------ */

  const step = nextStep({ role: "MERCHANT", record, analysis, proposal, approval, execution: proposal?.execution });
  const failedChecks = proposal?.validation.checks.filter((check) => check.status === "FAIL") ?? [];

  const whyKeyOf = (key: string): MessageKey => {
    switch (key) {
      case "next.analyze":
        return "case.why.analyze";
      case "next.propose":
        return "case.why.propose";
      case "next.submit":
        return "case.why.submit";
      case "next.awaiting-approval":
        return "case.why.awaitingManager";
      case "next.review-approval":
        return "case.why.reviewApproval";
      case "next.execute-gated":
        return "case.why.executeGated";
      case "next.resolve-block":
        return "case.why.blocked";
      case "next.review-unverified":
        return "case.why.unverified";
      case "next.review-failed":
        return "case.why.unverified";
      case "next.monitor-buyer":
        return "case.why.monitor";
      case "next.monitor-pending":
        return "case.why.pending";
      case "next.replan":
      case "next.awaiting-replan":
        return "case.why.replan";
      default:
        return "case.why.generic";
    }
  };

  const why = [t(whyKeyOf(step.key))];
  if (analysis?.recommendation.action) {
    why.push(
      t("ai.recommended") +
        ": " +
        actionLabel(analysis.recommendation.actionLabel, analysis.recommendation.action, t),
    );
  }
  const proposalDisplay = proposal ? proposalState(proposal, proposal.execution) : undefined;
  if (proposalDisplay) {
    why.push(
      `${t("case.proposal.title")}: ${lang === "zh-CN" ? proposalDisplay.labelZh : proposalDisplay.labelEn}`,
    );
  }

  const blockers: NextStepBlocker[] = [];
  if (proposal?.blockReason) {
    blockers.push({ label: t("action.cannotProceed"), detail: proposal.blockReason });
  }
  for (const gap of analysis?.gaps ?? []) {
    if (gap.severity === "HIGH") blockers.push({ label: gap.title, detail: gap.detail });
  }
  for (const check of failedChecks) {
    blockers.push({ label: `${check.id} · ${check.label}`, detail: check.detail });
  }

  /** The single primary control for this page. */
  const primaryAction = (() => {
    switch (step.key) {
      // v2.1: the merchant runs the analysis and drafts the proposal — the
      // specialist/manager split no longer decides who may press these.
      case "next.analyze":
        return (
          <Button
            variant="primary"
            className="w-full"
            onClick={handleRun}
            loading={analysisRun.status === "running"}
          >
            {t("ai.run")}
          </Button>
        );
      case "next.propose":
        return (
          <Button
            variant="primary"
            className="w-full"
            onClick={() => setAuthoringOpen(true)}
          >
            {t("case.next.openAuthoring")}
          </Button>
        );
      case "next.submit":
        return (
          <Button variant="primary" className="w-full" onClick={() => setSubmitOpen(true)}>
            {t("case.next.submit")}
          </Button>
        );
      case "next.review-approval":
        return proposal ? (
          <Link
            to={`/approvals/${proposal.proposalId}`}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-navy-800 bg-navy-800 px-3.5 text-sm font-medium text-white transition-colors hover:bg-navy-700"
          >
            {t("case.next.review")}
            <ArrowUpRight size={12} aria-hidden />
          </Link>
        ) : (
          <Link
            to={`/audit?case=${record.caseId}`}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-white px-3.5 text-sm font-medium text-ink"
          >
            {t("case.next.audit")}
          </Link>
        );
      case "next.execute-gated":
        return proposal ? (
          <Button variant="primary" className="w-full" onClick={() => setReplayOpen(true)}>
            {t("case.next.execute")}
          </Button>
        ) : undefined;
      case "next.resolve-block":
        return failedChecks.some((check) => check.id === "V9") ? (
          <Button
            variant="primary"
            className="w-full"
            onClick={() => {
              disputePilot.refreshSnapshot(record.caseId);
              toast.push({
                tone: "success",
                title: t("approval.refreshToast"),
                detail: t("approval.refreshToastDetail"),
              });
            }}
          >
            {t("case.next.refresh")}
          </Button>
        ) : (
          <Button variant="secondary" className="w-full" disabled>
            {t("action.blockedCta")}
          </Button>
        );
      case "next.review-unverified":
      case "next.review-failed":
        return (
          <Link
            to={`/audit?case=${record.caseId}`}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-white px-3.5 text-sm font-medium text-ink"
          >
            {t("case.next.audit")}
            <ArrowUpRight size={12} aria-hidden />
          </Link>
        );
      case "next.replan":
        return false ? (
          <Button variant="primary" className="w-full" onClick={() => setAuthoringOpen(true)}>
            {t("case.next.openAuthoring")}
          </Button>
        ) : undefined;
      default:
        return undefined;
    }
  })();

  const headerSources = sourceOf({ provenance: record.provenance });

  // Capture-level stages only. A dispute lifecycle value is meaningless on a
  // capture case, so it is shown as UNKNOWN rather than relabelled.
  const PAYMENT_LIFECYCLE = [
    "PENDING",
    "CAPTURED",
    "COMPLETED",
    "PARTIALLY_REFUNDED",
    "REFUNDED",
    "DECLINED",
    "FAILED",
    "UNKNOWN",
  ];
  // QA-RC-08: for a capture case the dispute lifecycle is not applicable; the
  // backend's "UNKNOWN" is not a missing money fact and must not look like one.
  const lifecycleStageValue = paymentCase
    ? PAYMENT_LIFECYCLE.includes(record.lifecycleStage) &&
      record.lifecycleStage !== "UNKNOWN"
      ? record.lifecycleStage
      : t("rd.notProvided")
    : record.lifecycleStage;
  const captureStatusValue = captureOutcome?.ok
    ? captureOutcome.capture.status
    : record.captureSnapshot?.status ?? record.transaction.captureStatus;

  return (
    <div className="mx-auto w-full max-w-[1560px] px-4 py-5 lg:px-6">
      <div className="mb-3">
        <Link
          to="/cases"
          className="inline-flex items-center gap-1.5 text-base font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={12} aria-hidden />
          {t("workspace.backToQueue")}
        </Link>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="eyebrow mb-1">
            {record.family} · {record.reasonLabel}
          </div>
          <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-semibold tracking-[-0.015em] text-ink-strong">
            <span className="num">{record.caseId}</span>
            <span className="hidden h-5 w-px bg-line-strong sm:block" aria-hidden />
            <span className="text-lg font-medium text-ink">{record.itemName}</span>
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge state={caseState(record, captureStatusValue)} />
            {paymentCase ? null : <Badge tone="neutral">{record.lifecycleStage}</Badge>}
            {headerSources.map((source) => (
              <SourceBadge key={source.key} source={source} />
            ))}
            <span className="text-xs text-ink-faint">
              {t("common.updated", { at: formatDateTime(record.updatedAt) })}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
            {t(paymentCase ? "workspace.captureAmount" : "workspace.disputedAmount")}
          </div>
          <div className="num text-[26px] font-semibold leading-9 text-ink-strong">
            {formatMoney(record.amountMinor, record.currency)}
          </div>
        </div>
      </div>

      <div className="mt-2">
        <Disclosure summary={t("case.technical")}>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2" data-testid="case-technical">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-faint">
                {t(paymentCase ? "context.typePayment" : "context.type")}
              </dt>
              <dd className="text-right text-ink">
                {record.family} · {record.reasonLabel}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-faint">
                {t(paymentCase ? "context.statusPayment" : "context.status")}
              </dt>
              <dd className="num text-right text-ink">
                {paymentCase ? captureStatusValue : record.status}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-faint">
                {t(paymentCase ? "context.lifecyclePayment" : "context.lifecycle")}
              </dt>
              <dd className="num text-right text-ink">{lifecycleStageValue}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-faint">{t("context.sellerProtection")}</dt>
              <dd className="text-right text-ink">{record.sellerProtection ?? t("rd.notProvided")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-faint">{t("context.order")}</dt>
              <dd className="break-all text-right font-mono text-xs text-ink">
                {record.transaction.orderRef}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-faint">{t("context.capture")}</dt>
              <dd className="break-all text-right font-mono text-xs text-ink">
                {record.transaction.captureRef}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-faint">{t("case.technical.version")}</dt>
              <dd className="num text-right text-ink">{record.snapshotVersion}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-faint">{t("case.technical.hash")}</dt>
              <dd className="break-all text-right font-mono text-xs text-ink">
                {record.snapshotHash}
              </dd>
            </div>
          </dl>
          <p className="mt-1 break-all font-mono text-xs text-ink-faint">
            {t("case.technical.disputeRef")}: {record.disputeRef}
          </p>
          {record.liveStatusNote ? (
            <p className="mt-1.5 text-xs leading-4 text-ink-muted">
              <span className="font-medium text-ink-faint">{t("case.technical.liveNote")}: </span>
              {record.liveStatusNote}
            </p>
          ) : null}
          <p className="mt-1.5 text-xs leading-4 text-ink-muted">{record.fixtureNote}</p>
        </Disclosure>
      </div>

      

      {/* QA-RC-08: the authoring column was 360px, which squeezed the refund
          draft form (and clipped Chinese labels). 420px gives the amount and
          reason fields room to breathe on a 1440-wide screen. */}
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="order-2 min-w-0 space-y-3 xl:order-1">
          {paymentCase ? (
            <>
              {captureLoading && !captureOutcome ? <LoadingState rows={1} /> : null}
              {captureOutcome && !captureOutcome.ok ? (
                <ErrorState
                  title={t("capture.failedTitle")}
                  detail={`${captureOutcome.error.code} · ${captureOutcome.error.message}`}
                  onRetry={() => void loadCapture()}
                />
              ) : null}
              <CaptureTriState
                record={record}
                outcome={captureOutcome}
                refundProposal={refundProposal}
                execution={proposal?.execution}
                offline={offline || isSyntheticCapture(captureOutcome?.ok ? captureOutcome.capture : undefined)}
              />
            </>
          ) : null}

          {paymentCase ? null : (
            <PageSection title={t("case.claim.title")} description={t("case.claim.note")}>
              <blockquote className="border-l-2 border-line-strong pl-3 text-base leading-6 text-ink">
                {record.buyerClaim}
              </blockquote>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                <Badge tone="scenario" size="sm">
                  {t("badge.grounding.SCENARIO_DEFINED")}
                </Badge>
                <span>{t("context.claimNote")}</span>
              </div>
            </PageSection>
          )}

          {!paymentCase || analysis ? (
            <AIAssessment
              record={record}
              analysis={analysis}
              evidence={evidence}
              blockedReason={proposal?.state === "BLOCKED" ? proposal.blockReason : undefined}
              onOpenEvidence={(id, factId) => {
                setEvidenceId(id);
                setFocusFactId(factId ?? null);
              }}
              requesting={analysisRun.status === "running"}
              runState={analysisRun}
              onRunAnalysis={handleRun}
              onRetry={handleRun}
              onRunLive={frozenProvider ? undefined : () => void handleRunLive()}
              liveChecking={liveChecking}
              liveError={liveError}
              replayOnly={frozenProvider}
              generating={generating}
              generateError={generateError}
              onGenerate={() => void generateProposal()}
              canGenerate={disputePilot.mode === "http"}
            />
          ) : null}

          <PageSection title={t("case.evidence.title")}>
            <EvidenceReview
              evidence={evidence}
              requirements={analysis?.requirements ?? []}
              proposal={proposal}
              analysis={analysis}
              onOpenEvidence={(id) => setEvidenceId(id)}
            />
          </PageSection>

          <PageSection
            title={t("case.timeline")}
            actions={
              <Link
                to={`/audit?case=${record.caseId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:text-navy-800"
              >
                {t("context.fullAudit")}
                <ArrowUpRight size={11} aria-hidden />
              </Link>
            }
          >
            {auditGroups.length === 0 ? (
              <p className="text-base leading-4 text-ink-muted">{t("audit.empty")}</p>
            ) : (
              <div className="space-y-3">
                {auditGroups.map((group) => (
                  <section
                    key={group.stage}
                    aria-label={t(`case.stage.${group.stage}` as MessageKey)}
                  >
                    <div className="mb-1 flex items-baseline gap-1.5">
                      <span className="eyebrow">{t(`case.stage.${group.stage}` as MessageKey)}</span>
                      <span className="num text-xs text-ink-faint">{group.events.length}</span>
                    </div>
                    <AuditTimeline events={group.events} compact />
                  </section>
                ))}
              </div>
            )}
          </PageSection>
        </div>

        <div className="order-1 min-w-0 space-y-3 xl:order-2 xl:sticky xl:top-[92px] xl:max-h-[calc(100vh-110px)] xl:self-start xl:overflow-y-auto xl:pr-1">
          <NextStepCard
            step={step}
            role={"MERCHANT"}
            why={why}
            blockers={blockers}
            action={primaryAction}
            
          />

          <section className="rounded-lg border border-line bg-card px-4 py-3 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">{t("case.proposal.title")}</h2>
              {proposal ? (
                <StatusBadge state={proposalState(proposal, proposal.execution)} size="sm" />
              ) : (
                <Badge tone="neutral" size="sm">
                  {t("case.proposal.none")}
                </Badge>
              )}
            </div>
            {proposal ? (
              <>
                <p className="mt-1 break-all font-mono text-xs text-ink-muted">
                  {proposal.proposalId}
                </p>
                <p className="mt-0.5 text-base text-ink">
                  {actionLabel(proposal.actionLabel, proposal.action, t)}
                </p>
                <p className="mt-1 text-xs leading-4 text-ink-faint">{t("case.proposal.note")}</p>
              </>
            ) : (
              <p className="mt-1 text-xs leading-4 text-ink-muted">{t("case.proposal.note")}</p>
            )}
          </section>

          <section className="rounded-lg border border-line bg-card px-4 py-3 shadow-card">
            <ExecutionStatusCard execution={proposal?.execution} caseId={record.caseId} />
          </section>

          <section className="rounded-lg border border-line bg-card px-4 py-3 shadow-card">
            <h2 className="mb-1.5 text-base font-semibold text-ink">
              {t("case.capability.title")}
            </h2>
            <CapabilitySnapshot snapshot={proposal?.hateoas} />
          </section>

          <section className="rounded-lg border border-line bg-card shadow-card">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink">{t("case.authoring.title")}</h2>
                <p className="mt-0.5 text-xs leading-4 text-ink-faint">
                  {t("case.authoring.body")}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setAuthoringOpen((open) => !open)}>
                {t(authoringOpen ? "case.authoring.close" : "case.authoring.open")}
              </Button>
            </div>
            {authoringOpen ? (
              <div className="border-t border-line px-2 py-2" data-testid="authoring-panel">
                {paymentCase ? (
                  <RefundCard
                    record={record}
                    proposals={proposals}
                    role={"MERCHANT"}
                    actor={merchant.id}
                    syntheticOffline={
                      captureOutcome?.ok
                        ? isSyntheticCapture(captureOutcome.capture)
                        : record.provenance === "SIMULATED_COMPOSITE" || offline
                    }
                    onCreate={handleCreateRefund}
                    onSubmitProposal={handleSubmitProposal}
                  />
                ) : (
                  <SendMessageCard
                    record={record}
                    analysis={analysis}
                    evidence={evidence}
                    proposals={proposals}
                    role={"MERCHANT"}
                    fallbackLinks={proposal?.hateoas.links ?? []}
                    onOpenEvidence={(id) => setEvidenceId(id)}
                    onSubmit={handleSendMessage}
                  />
                )}
              </div>
            ) : null}
          </section>

          <p className="text-xs leading-4 text-ink-faint">
            {record.fixtureNote}
          </p>
        </div>
      </div>

      <EvidenceDrawer
        evidence={selectedEvidence}
        facts={analysis?.facts ?? []}
        focusFactId={focusFactId}
        onClose={() => {
          setEvidenceId(null);
          setFocusFactId(null);
        }}
        onRequest={() => {
          setEvidenceId(null);
          toast.push({
            tone: "info",
            title: t("workspace.toast.evidenceRequested"),
            detail: t("workspace.toast.evidenceRequestedDetail"),
          });
        }}
      />

      {proposal ? (
        <>
          <SubmitProposalDialog
            proposal={proposal}
            record={record}
            open={submitOpen}
            live={liveExecution || proposal.execution?.executionMode === "LIVE"}
            onClose={() => setSubmitOpen(false)}
            onConfirm={handleSubmit}
          />
          <ReplayDialog
            open={replayOpen}
            proposalId={proposal.proposalId}
            caseId={record.caseId}
            live={liveExecution || proposal.execution?.executionMode === "LIVE"}
            onClose={() => setReplayOpen(false)}
            onFinished={(result) => {
              toast.push({
                tone: result.outcome === "SUCCEEDED" ? "success" : "warning",
                title:
                  result.outcome === "SUCCEEDED"
                    ? t(result.simulated === false ? "execution.requestRecorded" : "replay.toastSuccess")
                    : result.outcome === "UNVERIFIED"
                      ? t("execution.resultUnknown")
                      : t("replay.toastBlocked"),
                detail: result.message,
              });
            }}
          />
        </>
      ) : null}
    </div>
  );
}
