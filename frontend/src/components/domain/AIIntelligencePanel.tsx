import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  CircleHelp,
  Cpu,
  FileWarning,
  Link2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { AIAnalysis, CaseRecord, EvidenceRecord, GroundedFact } from "../../api/types";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { AnalysisModeBadge, GroundingBadge } from "./Badges";
import { AnalysisRunStatus } from "./AnalysisRunStatus";
import type { AnalysisRunState } from "../../hooks/useAnalysisRun";
import { disputePilot } from "../../api";
import { formatDateTime } from "../../lib/format";
import {
  actionLabel as localizeActionLabel,
  evidenceTypeLabel,
  useI18n,
  type MessageKey,
} from "../../i18n";

type Tab = "facts" | "gaps" | "contradictions" | "integrity";

const isLocalLlm = (mode?: string): boolean => {
  const upper = (mode ?? "").toUpperCase();
  return upper === "LLM" || upper === "LOCAL_LLM";
};

/** v1.3: pre-recorded analysis replayed offline — never a live model result. */
const isFrozenReplay = (mode?: string): boolean =>
  (mode ?? "").toUpperCase() === "FROZEN_REPLAY";

function FactRow({
  fact,
  index,
  evidence,
  onOpenEvidence,
}: {
  fact: GroundedFact;
  index: number;
  evidence: EvidenceRecord[];
  onOpenEvidence: (evidenceId: string, factId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <li
      className={[
        "group relative px-3.5 py-2.5 transition-colors hover:bg-subtle/70",
        fact.grounding === "UNVERIFIED_CLAIM" ? "border-l-2 border-warn-line bg-warn-bg/30" : "",
        fact.grounding === "MISSING" ? "border-l-2 border-stop-line bg-stop-bg/20" : "",
      ].join(" ")}
    >
      <div className="flex gap-2.5">
        <span className="num mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line bg-subtle text-[9px] font-medium text-ink-faint">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] leading-5 text-ink">{fact.statement}</p>
          {fact.grounding === "UNVERIFIED_CLAIM" ? (
            <p className="mt-1 rounded border border-dashed border-warn-line bg-card/60 px-2 py-1 text-[10.5px] leading-4 text-warn">
              {t("ai.unverifiedNote")}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <GroundingBadge grounding={fact.grounding} />
            {fact.evidenceIds.map((id) => {
              const item = evidence.find((entry) => entry.evidenceId === id);
              const missing = item ? !item.available : false;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onOpenEvidence(id, fact.factId)}
                  className={[
                    "inline-flex items-center gap-1 rounded border px-1.5 py-[1px] font-mono text-[10px] transition-colors",
                    missing
                      ? "border-dashed border-stop-line bg-stop-bg/50 text-stop hover:bg-stop-bg"
                      : "border-line bg-card text-ink-muted hover:border-navy-600 hover:bg-navy-50 hover:text-navy-700",
                  ].join(" ")}
                  title={
                    item
                      ? `${evidenceTypeLabel(item.type, item.typeLabel, t)} — ${item.source}`
                      : id
                  }
                >
                  <Link2 size={9} aria-hidden />
                  {id}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-ink-faint">
            {t("ai.basis", { basis: fact.basis })}
          </p>
        </div>
      </div>
    </li>
  );
}

export function AIIntelligencePanel({
  record,
  analysis,
  evidence,
  onOpenEvidence,
  onRunAnalysis,
  onRetry,
  requesting,
  runState,
  onRunLive,
  liveChecking = false,
  liveError,
}: {
  record: CaseRecord;
  analysis?: AIAnalysis;
  evidence: EvidenceRecord[];
  onOpenEvidence: (evidenceId: string, factId?: string) => void;
  onRunAnalysis: () => void;
  /** Manual retry for a failed run; defaults to the normal run handler. */
  onRetry?: () => void;
  requesting: boolean;
  /** Loading / failure state of an explicit analysis run (Phase 3). */
  runState?: AnalysisRunState;
  /** "Live AI": checked against /llm/status before any live model run. */
  onRunLive?: () => void;
  liveChecking?: boolean;
  /** Explicit backend refusal/failure detail, already formatted for display. */
  liveError?: string;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("facts");
  const [showLegend, setShowLegend] = useState(false);

  const counts = useMemo(
    () => ({
      facts: analysis?.facts.length ?? 0,
      gaps: analysis?.gaps.length ?? 0,
      contradictions: analysis?.contradictions.length ?? 0,
      integrity:
        (analysis?.facts.filter(
          (fact) => fact.grounding === "UNVERIFIED_CLAIM" || fact.grounding === "MISSING",
        ).length ?? 0) + (analysis?.missingEvidence?.length ?? 0),
    }),
    [analysis],
  );

  const running = requesting || runState?.status === "running";
  const failed = runState?.status === "failed";
  // Frozen E1 is a fixture-only guarantee. In http mode the backend owns the
  // analysis, and Phase 3 needs a re-run path (stub result → local LLM).
  const rerunLocked =
    record.validationLevel === "FROZEN_SANDBOX_E1_VERIFIED" && disputePilot.mode === "mock";

  if (!analysis || analysis.status !== "READY") {
    return (
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-infer" aria-hidden />
            <div className="text-sm font-semibold text-ink-strong">{t("ai.title")}</div>
          </div>
          <Badge tone="neutral">
            {running ? t("ai.status.processing") : failed ? t("ai.status.failed") : t("ai.status.notStarted")}
          </Badge>
        </div>

        {runState && (runState.status === "running" || runState.status === "failed") ? (
          <div className="px-4 py-3">
            <AnalysisRunStatus state={runState} onRetry={onRetry ?? onRunAnalysis} />
          </div>
        ) : (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-infer-line bg-infer-bg">
              <Sparkles size={17} className="text-infer" aria-hidden />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-ink-strong">
              {t("ai.emptyTitle", { caseId: record.caseId })}
            </h2>
            <p className="mt-1 max-w-[400px] text-xs leading-5 text-ink-muted">{t("ai.emptyBody")}</p>
            <Button variant="primary" className="mt-4" onClick={onRunAnalysis} loading={requesting}>
              <Sparkles size={13} aria-hidden />
              {t("ai.run")}
            </Button>
            <p className="mt-2 text-[10px] text-ink-faint">{t("ai.emptyFootnote")}</p>
          </div>
        )}
      </Card>
    );
  }

  const modeIsLlm = isLocalLlm(analysis.analysisMode);
  const frozen = isFrozenReplay(analysis.analysisMode);
  const unverifiedFacts = analysis.facts.filter(
    (fact) => fact.grounding === "UNVERIFIED_CLAIM" || fact.grounding === "MISSING",
  );
  const missingEvidence = analysis.missingEvidence ?? [];

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "facts", label: t("ai.tabFacts"), count: counts.facts },
    { id: "gaps", label: t("ai.tabGaps"), count: counts.gaps },
    { id: "contradictions", label: t("ai.tabContradictions"), count: counts.contradictions },
    { id: "integrity", label: t("ai.tabIntegrity"), count: counts.integrity },
  ];

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-infer" aria-hidden />
            <div className="text-sm font-semibold text-ink-strong">{t("ai.title")}</div>
            <AnalysisModeBadge mode={analysis.analysisMode} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ink-faint">{formatDateTime(analysis.generatedAt)}</span>
            {onRunLive ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={onRunLive}
                loading={liveChecking}
                disabled={running || liveChecking}
                title={t("ai.liveAiTitle")}
              >
                <Cpu size={12} aria-hidden />
                {liveChecking ? t("ai.liveAiChecking") : t("ai.liveAi")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={onRunAnalysis}
              loading={running}
              disabled={rerunLocked || running}
              title={rerunLocked ? t("ai.frozenTitle") : t("ai.reRunTitle")}
            >
              <RefreshCw size={12} aria-hidden />
              {rerunLocked ? t("ai.frozen") : t("ai.reRun")}
            </Button>
          </div>
        </div>

        {liveError ? (
          <div
            role="alert"
            data-testid="live-ai-error"
            className="border-b border-stop-line bg-stop-bg/60 px-4 py-2.5 text-[11.5px] leading-4 text-ink"
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
          <div className="eyebrow mb-1">{t("ai.caseSummary")}</div>
          <p className="text-[13px] leading-6 text-ink">{analysis.summary}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
            <Cpu size={10} aria-hidden />
            <span className="font-mono text-ink-muted">{analysis.modelLabel}</span>
            <span aria-hidden>·</span>
            <span>
              {frozen
                ? t("ai.frozenOutput")
                : modeIsLlm
                  ? t("ai.localInference")
                  : analysis.analysisMode
                    ? t("ai.stub")
                    : t("ai.fixtureLabel")}
            </span>
          </div>

          {analysis.uncertainty !== undefined ? (
            <div className="mt-2 rounded-md border border-line bg-subtle px-2.5 py-1.5 text-[11px] leading-4 text-ink">
              <span className="font-semibold">{t("ai.uncertaintyLabel")} </span>
              <span className="font-mono">{String(analysis.uncertainty)}</span>
              <span className="ml-1 text-[10px] text-ink-faint">{t("ai.uncertaintyNote")}</span>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
              {t("ai.paypalRequested")}
            </span>
            {analysis.requirements.map((requirement) => (
              <span
                key={requirement.evidenceType}
                className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] text-ink"
              >
                <span className="font-mono text-[10px]">{requirement.evidenceType}</span>
                <span className="text-ink-faint">{requirement.sourceExpected}</span>
                <Badge tone={requirement.status === "OPEN" ? "warn" : "pass"}>
                  {requirement.status === "OPEN" ? t("ai.reqOpen") : t("ai.reqSatisfied")}
                </Badge>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-0 border-y border-line bg-subtle px-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-pressed={tab === item.id}
              className={[
                "relative px-2.5 py-2 text-[11.5px] font-medium transition-colors",
                tab === item.id ? "text-navy-800" : "text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              {item.label}
              <span
                className={["num ml-1", item.count > 0 ? "text-ink" : "text-ink-faint"].join(" ")}
              >
                {item.count}
              </span>
              {tab === item.id ? (
                <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-navy-800" aria-hidden />
              ) : null}
            </button>
          ))}
        </div>

        {tab === "facts" ? (
          <div>
            {analysis.facts.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-ink-muted">{t("ai.noFacts")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {analysis.facts.map((fact, index) => (
                  <FactRow
                    key={fact.factId}
                    fact={fact}
                    index={index}
                    evidence={evidence}
                    onOpenEvidence={onOpenEvidence}
                  />
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === "gaps" ? (
          <div className="divide-y divide-line">
            {analysis.gaps.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-ink-muted">{t("ai.noGaps")}</p>
            ) : (
              analysis.gaps.map((gap) => (
                <div key={gap.gapId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <FileWarning
                        size={13}
                        className={[
                          "mt-0.5 shrink-0",
                          gap.severity === "HIGH" ? "text-stop" : "text-warn",
                        ].join(" ")}
                        aria-hidden
                      />
                      <div>
                        <div className="text-[12.5px] font-medium text-ink">{gap.title}</div>
                        <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">{gap.detail}</p>
                      </div>
                    </div>
                    <Badge tone={gap.severity === "HIGH" ? "stop" : gap.severity === "MEDIUM" ? "warn" : "neutral"}>
                      {gap.severity}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[21px]">
                    <span className="font-mono text-[10px] text-ink-faint">{gap.requestedType}</span>
                    <span className="text-ink-faint" aria-hidden>·</span>
                    <span className="text-[10.5px] text-ink-muted">{gap.remedy}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "contradictions" ? (
          <div className="divide-y divide-line">
            {analysis.contradictions.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-ink-muted">{t("ai.noContradictions")}</p>
            ) : (
              analysis.contradictions.map((item) => (
                <div key={item.contradictionId} className="bg-warn-bg/30 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                    <div>
                      <div className="text-[12.5px] font-medium text-ink">{item.title}</div>
                      <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">{item.detail}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {item.evidenceIds.map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onOpenEvidence(id)}
                            className="rounded border border-warn-line bg-card px-1.5 py-px font-mono text-[10px] text-ink-muted hover:border-warn"
                          >
                            {id}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "integrity" ? (
          <div className="divide-y divide-line">
            <div className="px-4 py-3">
              <div className="eyebrow mb-1.5">{t("ai.claimsNoRecord")}</div>
              {unverifiedFacts.length === 0 ? (
                <p className="text-[11.5px] leading-4 text-ink-muted">{t("ai.noUnverified")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {unverifiedFacts.map((fact) => (
                    <li
                      key={fact.factId}
                      className="rounded-md border border-dashed border-warn-line bg-warn-bg/30 px-2.5 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11.5px] leading-4 text-ink">{fact.statement}</p>
                        <GroundingBadge grounding={fact.grounding} />
                      </div>
                      <p className="mt-1 font-mono text-[9.5px] text-ink-faint">{fact.factId}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-4 py-3">
              <div className="eyebrow mb-1.5">{t("ai.missingTitle")}</div>
              {missingEvidence.length === 0 ? (
                <p className="text-[11.5px] leading-4 text-ink-muted">{t("ai.noMissing")}</p>
              ) : (
                <ul className="space-y-1">
                  {missingEvidence.map((item, index) => (
                    <li
                      key={`${index}-${item}`}
                      className="flex items-start gap-1.5 text-[11px] leading-4 text-ink"
                    >
                      <FileWarning size={11} className="mt-0.5 shrink-0 text-stop" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="px-4 py-2.5 text-[10.5px] leading-4 text-ink-muted">{t("ai.validatorNote")}</p>
          </div>
        ) : null}

        <div className="border-t border-line bg-subtle px-4 py-1.5 text-[10px] leading-4 text-ink-faint">
          {t("ai.sourceLabels")}
        </div>

        <button
          type="button"
          onClick={() => setShowLegend((value) => !value)}
          aria-expanded={showLegend}
          className="flex w-full items-center justify-between border-t border-line bg-subtle px-4 py-2 text-[10.5px] text-ink-muted hover:text-ink"
        >
          <span className="inline-flex items-center gap-1.5">
            <CircleHelp size={11} aria-hidden />
            {t("ai.legendToggle")}
          </span>
          <ChevronDown
            size={12}
            className={showLegend ? "rotate-180 transition-transform" : "transition-transform"}
            aria-hidden
          />
        </button>
        {showLegend ? (
          <div className="grid gap-1.5 border-t border-line px-4 py-2.5">
            {(
              [
                "VERIFIED_OBSERVATION",
                "SCENARIO_DEFINED",
                "AI_INFERENCE",
                "UNVERIFIED_CLAIM",
                "MISSING",
                "UNKNOWN",
              ] as const
            ).map((kind) => (
              <div key={kind} className="flex items-start gap-2">
                <GroundingBadge grounding={kind} />
                <span className="text-[10.5px] leading-4 text-ink-muted">
                  {t(`ai.legend.${kind}` as MessageKey)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-sm font-semibold text-ink-strong">{t("ai.recommended")}</div>
          <Badge
            tone={
              analysis.recommendation.strength === "STRONG"
                ? "pass"
                : analysis.recommendation.strength === "CONDITIONAL"
                  ? "warn"
                  : "neutral"
            }
          >
            {analysis.recommendation.strength
              ? t("ai.strengthStrong", { strength: analysis.recommendation.strength })
              : t("ai.backendPlan")}
          </Badge>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded border border-navy-100 bg-navy-50">
              <ArrowRight size={14} className="text-navy-700" aria-hidden />
            </div>
            <div>
              <div className="text-[13.5px] font-semibold text-ink-strong">
                {localizeActionLabel(
                  analysis.recommendation.actionLabel,
                  analysis.recommendation.action,
                  t,
                )}
              </div>
              <div className="font-mono text-[10px] text-ink-muted">
                {analysis.recommendation.action}
              </div>
            </div>
          </div>

          <ul className="mt-2.5 space-y-1">
            {analysis.recommendation.rationale.map((line) => (
              <li key={line} className="flex gap-1.5 text-[11.5px] leading-5 text-ink">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
                {line}
              </li>
            ))}
          </ul>

          {analysis.recommendation.alternatives.length > 0 ? (
            <div className="mt-3">
              <div className="eyebrow mb-1.5">{t("ai.alternatives")}</div>
              <div className="overflow-hidden rounded-md border border-line">
                {analysis.recommendation.alternatives.map((alt, index) => (
                  <div
                    key={alt.action + index}
                    className="flex items-start justify-between gap-3 border-b border-line px-2.5 py-1.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-ink">
                        {index + 2}. {localizeActionLabel(alt.label, alt.action, t)}
                      </div>
                      <div className="text-[10px] leading-4 text-ink-faint">{alt.note}</div>
                    </div>
                    <span className="shrink-0 font-mono text-[9.5px] text-ink-faint">{alt.action}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div
            className={[
              "mt-3 rounded-md border px-2.5 py-2 text-[10.5px] leading-4",
              analysis.waitRule.applies
                ? "border-warn-line bg-warn-bg/60 text-ink"
                : "border-line bg-subtle text-ink-muted",
            ].join(" ")}
          >
            <span className="font-semibold text-ink">{t("ai.waitRule")} </span>
            {analysis.waitRule.applies ? t("ai.waitApplies") : t("ai.waitNotApplied")}
            {analysis.waitRule.reason}
          </div>

          <p className="mt-2 text-[10px] leading-4 text-ink-faint">{t("ai.disclaimer")}</p>
        </div>
      </Card>
    </div>
  );
}
