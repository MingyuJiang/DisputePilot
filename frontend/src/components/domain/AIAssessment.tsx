/**
 * AI assessment, laid out as hierarchy rather than tabs
 * (FRONTEND_REDESIGN_PLAN §3.3.2).
 *
 * Order: mode → summary → recommendation (raw vs effective) → verified facts
 * → unverified claims → gaps. Grounding badges travel with every fact, so an
 * inference can never be read as an observation. Frozen output is labelled as
 * frozen and never as a live model result.
 */

import { AlertTriangle, Cpu, FileWarning, RefreshCw, Sparkles } from "lucide-react";
import type { AIAnalysis, CaseRecord, EvidenceRecord } from "../../api/types";
import type { AnalysisRunState } from "../../hooks/useAnalysisRun";
import type { AnalysisErrorInfo } from "../../api/errors";
import { disputePilot } from "../../api";
import { formatDateTime } from "../../lib/format";
import { actionLabel, evidenceTypeLabel, useI18n } from "../../i18n";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { AnalysisModeBadge, GroundingBadge } from "./Badges";
import { AnalysisRunStatus } from "./AnalysisRunStatus";
import { BackendErrorNotice } from "./BackendErrorNotice";

const normalize = (value?: string): string => (value ?? "").trim().toUpperCase();

export function AIAssessment({
  record,
  analysis,
  evidence,
  onOpenEvidence,
  requesting,
  runState,
  onRunAnalysis,
  onRetry,
  onRunLive,
  replayOnly = false,
  liveChecking = false,
  liveError,
  generateError,
  generating = false,
  onGenerate,
  canGenerate = false,
  blockedReason,
}: {
  record: CaseRecord;
  analysis?: AIAnalysis;
  evidence: EvidenceRecord[];
  onOpenEvidence: (evidenceId: string, factId?: string) => void;
  requesting: boolean;
  runState?: AnalysisRunState;
  onRunAnalysis: () => void;
  onRetry?: () => void;
  onRunLive?: () => void;
  /** RC-6: the demo replays a recording; say so instead of implying inference. */
  replayOnly?: boolean;
  liveChecking?: boolean;
  liveError?: string;
  generateError?: AnalysisErrorInfo;
  generating?: boolean;
  onGenerate?: () => void;
  canGenerate?: boolean;
  /** When set, the recommendation is shown as advice only — not executable. */
  blockedReason?: string;
}) {
  const { t } = useI18n();
  const running = requesting || runState?.status === "running";
  const rerunLocked =
    record.validationLevel === "FROZEN_SANDBOX_E1_VERIFIED" && disputePilot.mode === "mock";

  if (!analysis || analysis.status !== "READY") {
    return (
      <Card className="overflow-hidden" data-testid="ai-assessment">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-infer" aria-hidden />
            <h2 className="text-sm font-semibold text-ink-strong">{t("case.ai.title")}</h2>
          </div>
          <Badge tone="neutral">{t("case.ai.none")}</Badge>
        </div>
        {runState && (runState.status === "running" || runState.status === "failed") ? (
          <div className="px-4 py-3">
            <AnalysisRunStatus state={runState} onRetry={onRetry ?? onRunAnalysis} />
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <p className="text-base leading-5 text-ink-muted">{t("ai.emptyBody")}</p>
            <Button variant="primary" size="sm" className="mt-3" onClick={onRunAnalysis} loading={requesting}>
              <Sparkles size={12} aria-hidden />
              {t("ai.run")}
            </Button>
            <p className="mt-1.5 text-xs text-ink-faint">{t("ai.emptyFootnote")}</p>
          </div>
        )}
      </Card>
    );
  }

  const mode = normalize(analysis.analysisMode);
  const frozen = mode === "FROZEN_REPLAY";
  const live = mode === "LLM" || mode === "LOCAL_LLM";
  const verifiedFacts = analysis.facts.filter(
    (fact) => fact.grounding === "VERIFIED_OBSERVATION" || fact.grounding === "SCENARIO_DEFINED",
  );
  const unverifiedFacts = analysis.facts.filter(
    (fact) => fact.grounding === "UNVERIFIED_CLAIM" || fact.grounding === "MISSING",
  );
  const raw = analysis.rawRecommendation;
  const rawLabel = raw?.actionLabel ?? raw?.action;
  const differs =
    rawLabel !== undefined &&
    (normalize(raw?.action) !== normalize(analysis.recommendation.action) ||
      normalize(rawLabel) !== normalize(analysis.recommendation.actionLabel));

  return (
    <Card className="overflow-hidden" data-testid="ai-assessment">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles size={14} className="text-infer" aria-hidden />
          <h2 className="text-sm font-semibold text-ink-strong">{t("case.ai.title")}</h2>
          <AnalysisModeBadge mode={analysis.analysisMode} />
          <span data-testid="ai-mode-label">
            <Badge tone={frozen ? "scenario" : live ? "infer" : "neutral"} size="sm">
              {t(frozen ? "case.ai.frozen" : live ? "case.ai.live" : "badge.analysisFixture")}
            </Badge>
            {replayOnly ? (
              <span className="text-2xs text-ink-faint">{t("ai.replayOnlyNote")}</span>
            ) : null}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="num text-xs text-ink-faint">{formatDateTime(analysis.generatedAt)}</span>
          {onRunLive ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRunLive}
              loading={liveChecking}
              disabled={running || liveChecking}
              title={t("ai.liveAiTitle")}
            >
              <Cpu size={11} aria-hidden />
              {t("ai.liveAi")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={onRunAnalysis}
            loading={running}
            disabled={rerunLocked || running}
            title={
              replayOnly
                ? t("ai.replayHint")
                : rerunLocked
                  ? t("ai.frozenTitle")
                  : t("ai.reRunTitle")
            }
          >
            <RefreshCw size={11} aria-hidden />
            {rerunLocked ? t("ai.frozen") : t("ai.reRun")}
          </Button>
        </div>
      </div>

      {liveError ? (
        <div
          role="alert"
          data-testid="live-ai-error"
          className="border-b border-stop-line bg-stop-bg/60 px-4 py-2.5 text-base leading-4 text-ink"
        >
          <span className="font-semibold text-stop">{liveError}</span>
        </div>
      ) : null}

      {runState && (runState.status === "running" || runState.status === "failed") ? (
        <div className="border-b border-line px-4 py-3">
          <AnalysisRunStatus state={runState} onRetry={onRetry ?? onRunAnalysis} />
        </div>
      ) : null}

      <div className="px-4 py-3">
        <div className="eyebrow mb-1">{t("case.ai.summary")}</div>
        <p className="text-base leading-6 text-ink">{analysis.summary}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
          <Cpu size={10} aria-hidden />
          <span className="font-mono text-ink-muted">{analysis.modelLabel}</span>
          {analysis.uncertainty !== undefined ? (
            <>
              <span aria-hidden>·</span>
              <span>{t("ai.uncertaintyLabel")} </span>
              <span className="font-mono">{String(analysis.uncertainty)}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="eyebrow mb-1">{t("case.ai.recommendation")}</div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[13.5px] font-semibold text-ink-strong">
            {actionLabel(analysis.recommendation.actionLabel, analysis.recommendation.action, t)}
          </span>
          <span className="font-mono text-xs text-ink-muted">
            {analysis.recommendation.action}
          </span>
          {blockedReason ? (
            <Badge tone="stop" dot>
              {t("case.ai.notExecutable")}
            </Badge>
          ) : null}
        </div>
        {blockedReason ? (
          <p className="mt-1 rounded border border-stop-line bg-stop-bg px-2 py-1.5 text-xs leading-5 text-stop">
            {t("case.ai.notExecutableReason")}
          </p>
        ) : null}
        <ul className="mt-1 space-y-1">
          {analysis.recommendation.rationale.map((line) => (
            <li key={line} className="flex gap-1.5 text-base leading-5 text-ink">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
              {line}
            </li>
          ))}
        </ul>

        <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="ai-raw">
          <div className="rounded border border-line bg-subtle px-2.5 py-1.5">
            <div className="eyebrow">{t("case.ai.raw")}</div>
            {rawLabel ? (
              <p className="mt-0.5 text-base text-ink">{rawLabel}</p>
            ) : (
              <p className="mt-0.5 text-xs leading-4 text-ink-muted">{t("case.ai.noRaw")}</p>
            )}
          </div>
          <div className="rounded border border-navy-100 bg-navy-50/40 px-2.5 py-1.5">
            <div className="eyebrow">{t("case.ai.effective")}</div>
            <p className="mt-0.5 text-base text-ink">
              {actionLabel(analysis.recommendation.actionLabel, analysis.recommendation.action, t)}
            </p>
            {rawLabel ? (
              <p className="mt-0.5 text-xs leading-4 text-ink-muted">
                {differs
                  ? `${t("case.ai.gate")}: ${analysis.gateReason ?? t("rd.notProvided")}`
                  : t("case.ai.same")}
              </p>
            ) : null}
          </div>
        </div>

        {analysis.waitRule.reason ? (
          <p className="mt-1.5 rounded border border-line bg-subtle px-2.5 py-1.5 text-xs leading-4 text-ink-muted">
            <span className="font-semibold text-ink">{t("ai.waitRule")} </span>
            {analysis.waitRule.reason}
          </p>
        ) : null}
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="eyebrow">{t("case.ai.verified")}</div>
          <span className="num text-xs text-ink-faint">{verifiedFacts.length}</span>
        </div>
        {verifiedFacts.length === 0 ? (
          <p className="mt-1 text-base leading-4 text-ink-muted">{t("case.ai.noFacts")}</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {verifiedFacts.map((fact) => (
              <li key={fact.factId} className="flex items-start gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
                <div className="min-w-0">
                  <p className="text-base leading-4 text-ink">{fact.statement}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <GroundingBadge grounding={fact.grounding} />
                    {fact.evidenceIds.map((id) => {
                      const item = evidence.find((entry) => entry.evidenceId === id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onOpenEvidence(id, fact.factId)}
                          title={item ? evidenceTypeLabel(item.type, item.typeLabel, t) : id}
                          className="rounded border border-line bg-card px-1 font-mono text-xs text-ink-muted hover:border-navy-600 hover:text-navy-700"
                        >
                          {id}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="eyebrow">{t("case.ai.unverified")}</div>
          <span className="num text-xs text-ink-faint">{unverifiedFacts.length}</span>
        </div>
        {unverifiedFacts.length === 0 ? (
          <p className="mt-1 text-base leading-4 text-ink-muted">{t("case.ai.noUnverified")}</p>
        ) : (
          <ul className="mt-1 space-y-1" data-testid="ai-unverified">
            {unverifiedFacts.map((fact) => (
              <li
                key={fact.factId}
                className="rounded border border-dashed border-warn-line bg-warn-bg/30 px-2 py-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-base leading-4 text-ink">{fact.statement}</p>
                  <GroundingBadge grounding={fact.grounding} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="eyebrow">{t("case.ai.gaps")}</div>
          <span className="num text-xs text-ink-faint">{analysis.gaps.length}</span>
        </div>
        {analysis.gaps.length === 0 ? (
          <p className="mt-1 text-base leading-4 text-ink-muted">{t("case.ai.noGaps")}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {analysis.gaps.map((gap) => (
              <li key={gap.gapId} className="flex items-start gap-1.5">
                <FileWarning
                  size={11}
                  className={["mt-0.5 shrink-0", gap.severity === "HIGH" ? "text-stop" : "text-warn"].join(" ")}
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base font-medium text-ink">{gap.title}</span>
                    <Badge tone={gap.severity === "HIGH" ? "stop" : gap.severity === "MEDIUM" ? "warn" : "neutral"} size="sm">
                      {gap.severity}
                    </Badge>
                  </div>
                  <p className="text-xs leading-4 text-ink-muted">{gap.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {analysis.contradictions.length > 0 ? (
        <div className="flex items-start gap-2 border-t border-warn-line bg-warn-bg/40 px-4 py-2">
          <AlertTriangle size={11} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <p className="text-xs leading-4 text-ink">
            <span className="font-semibold">{t("approval.contradiction")}: </span>
            {analysis.contradictions[0].detail}
          </p>
        </div>
      ) : null}

      {canGenerate && onGenerate ? (
        <div className="border-t border-line bg-subtle px-4 py-2.5">
          <Button size="sm" variant="secondary" onClick={onGenerate} loading={generating} disabled={generating}>
            <Sparkles size={11} aria-hidden />
            {generating ? t("action.generating") : t("case.next.generate")}
          </Button>
          {generateError ? (
            <div className="mt-1.5">
              <BackendErrorNotice error={generateError} titleKey="action.generateErrorTitle" retryableHint />
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="border-t border-line bg-subtle px-4 py-1.5 text-xs leading-4 text-ink-faint">
        {t("ai.disclaimer")}
      </p>
    </Card>
  );
}
