import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Lock,
  RefreshCw,
  Send,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ActionProposal, CaseRecord, EvidenceRecord } from "../../api/types";
import type { AnalysisErrorInfo } from "../../api/errors";
import type { NextStepRole } from "../../lib/nextStep";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { GroundingBadge, ProposalStateBadge, RiskBadge } from "./Badges";
import { PolicyChecks } from "./PolicyChecks";
import { HateoasTable } from "./HateoasTable";
import { BackendErrorNotice } from "./BackendErrorNotice";
import { sandboxModeOf } from "./SandboxStatus";
import { useRuntime } from "../../hooks/useRuntime";
import { formatDateTime } from "../../lib/format";
import { actionLabel, evidenceTypeLabel, useI18n } from "../../i18n";

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-line px-3.5 py-3 first:border-t-0">
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  );
}

export function ActionSafetyPanel({
  proposal,
  record,
  evidence,
  role,
  onOpenEvidence,
  onSubmit,
  onReview,
  onRefresh,
  onRunAnalysis,
  onGenerate,
  hasAnalysis,
  canGenerate = false,
  generating = false,
  generateError,
}: {
  proposal?: ActionProposal;
  record: CaseRecord;
  evidence: EvidenceRecord[];
  role: NextStepRole;
  onOpenEvidence: (evidenceId: string) => void;
  onSubmit: () => void;
  onReview: () => void;
  onRefresh: () => void;
  onRunAnalysis: () => void;
  /** Asks the backend to generate a proposal (http mode only). */
  onGenerate?: () => void;
  hasAnalysis: boolean;
  canGenerate?: boolean;
  generating?: boolean;
  generateError?: AnalysisErrorInfo;
}) {
  const { t } = useI18n();
  const runtime = useRuntime();
  const liveExecution = sandboxModeOf(runtime.health) === "executable";
  const liveProposal =
    proposal?.execution?.simulated === false ||
    (liveExecution && proposal?.execution !== undefined);  const evidenceById = (id: string) => evidence.find((item) => item.evidenceId === id);

  if (!proposal) {
    return (
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-3.5 py-3">
          <div className="text-sm font-semibold text-ink-strong">{t("action.title")}</div>
          <Badge tone="neutral">{t("action.noProposal")}</Badge>
        </div>
        <div className="px-4 py-8 text-center">
          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-line bg-subtle">
            <ShieldCheck size={16} className="text-ink-faint" aria-hidden />
          </div>
          <p className="mt-2 text-xs font-medium text-ink">{t("action.emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-[260px] text-[11px] leading-4 text-ink-muted">
            {hasAnalysis ? t("action.emptyWithAnalysis") : t("action.emptyNoAnalysis")}
          </p>

          {hasAnalysis && canGenerate ? (
            <div className="mx-auto mt-3 max-w-[280px]">
              <Button
                size="sm"
                variant="primary"
                className="w-full"
                onClick={onGenerate}
                loading={generating}
                disabled={generating}
              >
                <Sparkles size={12} aria-hidden />
                {generating ? t("action.generating") : t("action.generate")}
              </Button>
              {generateError ? (
                <div className="mt-2">
                  <BackendErrorNotice error={generateError} titleKey="action.generateErrorTitle" retryableHint />
                </div>
              ) : null}
            </div>
          ) : null}

          {hasAnalysis && !canGenerate ? (
            <p className="mx-auto mt-2 max-w-[240px] text-[10px] leading-4 text-ink-faint">
              {t("action.generateMockNote")}
            </p>
          ) : null}

          {!hasAnalysis ? (
            <Button size="sm" variant="primary" className="mt-3" onClick={onRunAnalysis}>
              {t("action.runAi")}
            </Button>
          ) : null}
        </div>
      </Card>
    );
  }

  const blocked = proposal.state === "BLOCKED" || proposal.validation.decision === "BLOCKED";
  const staleBlock = proposal.validation.checks.some(
    (check) => check.id === "V9" && check.status === "FAIL",
  );

  const cta = (() => {
    if (proposal.state === "BLOCKED") {
      return staleBlock ? (
        <Button variant="primary" onClick={onRefresh} className="w-full">
          <RefreshCw size={13} aria-hidden />
          {t("action.refreshSnapshot")}
        </Button>
      ) : (
        <Button variant="secondary" disabled className="w-full">
          <Lock size={13} aria-hidden />
          {t("action.blockedCta")}
        </Button>
      );
    }
    if (proposal.state === "DRAFT") {
      return role === "SPECIALIST" ? (
        <Button variant="primary" onClick={onSubmit} className="w-full" disabled={blocked}>
          <Send size={13} aria-hidden />
          {t("action.submit")}
        </Button>
      ) : (
        <Button
          variant="secondary"
          className="w-full"
          disabled
          title={t("action.awaitingSpecialistTitle")}
        >
          {t("action.awaitingSpecialist")}
        </Button>
      );
    }
    if (proposal.state === "AWAITING_APPROVAL") {
      return role === "MANAGER" ? (
        <Button variant="primary" onClick={onReview} className="w-full">
          {t("action.reviewDecide")}
          <ArrowRight size={13} aria-hidden />
        </Button>
      ) : (
        <Button variant="secondary" disabled className="w-full">
          {t("action.awaitingManager")}
        </Button>
      );
    }
    if (proposal.state === "REJECTED") {
      return (
        <Button variant="secondary" disabled className="w-full">
          {t("action.rejectedReplan")}
        </Button>
      );
    }
    if (proposal.state === "APPROVED") {
      return (
        <Button variant="primary" disabled className="w-full">
          {t(liveExecution ? "action.approvedQueuedLive" : "action.approvedQueued")}
        </Button>
      );
    }
    return (
      <Button variant="secondary" onClick={onReview} className="w-full">
        {t("action.viewExecution")}
        <ArrowRight size={13} aria-hidden />
      </Button>
    );
  })();

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-ink-strong">{t("action.title")}</div>
          <ProposalStateBadge state={proposal.state} />
        </div>
        {proposal.requiresApproval ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-ink-faint">
            <Lock size={10} aria-hidden />
            {t("action.protected")}
          </span>
        ) : null}
      </div>

      <Section label={t("action.proposedAction")}>
        <div className="rounded-md border border-line bg-subtle px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-ink-strong">
                {actionLabel(proposal.actionLabel, proposal.action, t)}
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] text-ink-muted">{proposal.action}</div>
            </div>
            <RiskBadge risk={proposal.risk} />
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[10.5px] text-ink-faint">
            <span className="num">{record.caseId} · {proposal.proposalId}</span>
            <span className="num">{proposal.snapshotVersion}</span>
          </div>
        </div>
        <ul className="mt-2 space-y-1">
          {proposal.rationale.slice(0, 3).map((line) => (
            <li key={line} className="flex gap-1.5 text-[11px] leading-4 text-ink-muted">
              <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      </Section>

      {blocked ? (
        <div className="border-t border-stop-line bg-stop-bg px-3.5 py-3">
          <div className="flex items-start gap-2">
            <ShieldX size={15} className="mt-0.5 shrink-0 text-stop" aria-hidden />
            <div>
              <div className="text-xs font-semibold text-stop">{t("action.cannotProceed")}</div>
              <p className="mt-1 text-[11px] leading-4 text-ink">
                {proposal.blockReason ?? proposal.validation.summary}
              </p>
              <p className="mt-1.5 text-[10.5px] leading-4 text-ink-muted">
                {t("action.blockExplain")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {proposal.state === "REJECTED" && proposal.decisionReason ? (
        <div className="border-t border-stop-line bg-stop-bg px-3.5 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-stop" aria-hidden />
            <div>
              <div className="text-xs font-semibold text-stop">
                {t("action.rejectedBy", { name: proposal.decidedBy ?? "" })}
              </div>
              <p className="mt-1 text-[11px] leading-4 text-ink">{proposal.decisionReason}</p>
              <p className="mt-1 text-[10px] text-ink-faint">
                {proposal.decidedAt ? formatDateTime(proposal.decidedAt) : ""} · {t("action.noExecution")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {proposal.state === "UNVERIFIED" ? (
        <div className="border-t border-warn-line bg-warn-bg px-3.5 py-3">
          <div className="flex items-start gap-2">
            <ShieldQuestion size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div>
              <div className="text-xs font-semibold text-warn">{t("action.unverifiedResult")}</div>
              <p className="mt-1 text-[11px] leading-4 text-ink">{t("execution.noAutoRetry")}</p>
              {proposal.action === "send-message" ? (
                <p className="mt-1 text-[10.5px] leading-4 text-ink-muted">
                  {t("sendMessage.verificationNote")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {proposal.state === "PENDING" ? (
        <div className="border-t border-warn-line bg-warn-bg px-3.5 py-3">
          <div className="flex items-start gap-2">
            <ShieldQuestion size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div>
              <div className="text-xs font-semibold text-warn">{t("execution.pendingTitle")}</div>
              <p className="mt-1 text-[11px] leading-4 text-ink">{t("execution.pendingBody")}</p>
            </div>
          </div>
        </div>
      ) : null}

      {proposal.state === "EXECUTED" ? (
        <div
          className={[
            "border-t px-3.5 py-3",
            liveProposal ? "border-info-line bg-info-bg" : "border-pass-line bg-pass-bg",
          ].join(" ")}
        >
          <div className="flex items-start gap-2">
            <CheckCircle2
              size={14}
              className={["mt-0.5 shrink-0", liveProposal ? "text-info" : "text-pass"].join(" ")}
              aria-hidden
            />
            <div>
              <div
                className={["text-xs font-semibold", liveProposal ? "text-info" : "text-pass"].join(" ")}
              >
                {t(liveProposal ? "action.executedLive" : "action.executed")}
              </div>
              <p className="mt-1 text-[11px] leading-4 text-ink">
                {liveProposal
                  ? t("action.executedLiveDetail", {
                      at: proposal.executedAt ? formatDateTime(proposal.executedAt) : "",
                    })
                  : t("action.executedDetail", {
                      at: proposal.executedAt ? formatDateTime(proposal.executedAt) : "",
                    })}
              </p>
              {proposal.action === "send-message" ? (
                <p className="mt-1 text-[10.5px] leading-4 text-ink-muted">
                  {t("sendMessage.verificationNote")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <Section label={t("action.policyValidation")}>
        <PolicyChecks
          checks={proposal.validation.checks}
          decision={proposal.validation.decision}
          summary={proposal.validation.summary}
          defaultOpen={blocked}
        />
      </Section>

      <Section label={t("action.evidenceRefs", { count: proposal.evidenceIds.length })}>
        <div className="flex flex-wrap gap-1.5">
          {proposal.evidenceIds.map((id) => {
            const item = evidenceById(id);
            if (!item) {
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onOpenEvidence(id)}
                  className="inline-flex items-center gap-1 rounded border border-line bg-card px-1.5 py-1 font-mono text-[10px] text-ink-muted hover:border-line-strong"
                >
                  {id}
                </button>
              );
            }
            return (
              <button
                key={id}
                type="button"
                onClick={() => onOpenEvidence(id)}
                className="inline-flex items-center gap-1.5 rounded border border-line bg-card px-1.5 py-1 text-[10.5px] text-ink transition-colors hover:border-navy-600 hover:bg-navy-50"
                title={evidenceTypeLabel(item.type, item.typeLabel, t)}
              >
                <span className="font-mono text-[10px]">{id}</span>
                <span className="text-ink-faint">·</span>
                <span className="max-w-[110px] truncate text-ink-muted">
                  {evidenceTypeLabel(item.type, item.typeLabel, t)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
          <span>{t("action.labelsTravel")}</span>
          <GroundingBadge grounding="VERIFIED_OBSERVATION" />
          <GroundingBadge grounding="SCENARIO_DEFINED" />
        </div>
        <p className="mt-1.5 text-[10.5px] leading-4 text-ink-muted">{t("action.onlyCited")}</p>
      </Section>

      <Section label={t("action.hateoas")}>
        <HateoasTable snapshot={proposal.hateoas} />
      </Section>

      <Section label={t("action.approvalRequirement")}>
        <div className="flex items-start gap-2 rounded-md border border-warn-line bg-warn-bg/70 px-2.5 py-2">
          <Info size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <p className="text-[10.5px] leading-4 text-ink">
            {proposal.validation.decision === "BLOCKED"
              ? t("action.approvalBlocked")
              : t(liveExecution ? "action.approvalNoteLive" : "action.approvalNote")}
          </p>
        </div>
      </Section>

      <div className="border-t border-line bg-subtle px-3.5 py-3">
        {cta}
        <p className="mt-2 text-center text-[10px] leading-4 text-ink-faint">
          {t(role === "SPECIALIST" ? "action.specialistView" : "action.managerView")}
        </p>
      </div>
    </Card>
  );
}
