/**
 * Why / evidence panel (FRONTEND_REDESIGN_PLAN §3.4 step 3).
 *
 * Shows the AI's raw recommendation next to the effective one that is being
 * approved. When the backend does not send `plan.raw_recommendation` the panel
 * says "not provided" — it never reconstructs a diff from the effective plan.
 */

import { ArrowRight, FileWarning, GitCompare, Info } from "lucide-react";
import type { ActionProposal, AIAnalysis, EvidenceRecord } from "../../api/types";
import { evidenceTypeLabel, useI18n } from "../../i18n";
import { Badge } from "../ui/Badge";
import { PageSection } from "../ui/PageSection";
import { GroundingBadge } from "./Badges";

const normalize = (value?: string): string => (value ?? "").trim().toUpperCase();

export function WhyPanel({
  analysis,
  proposal,
  evidence,
  onOpenEvidence,
}: {
  analysis?: AIAnalysis;
  proposal: ActionProposal;
  evidence: EvidenceRecord[];
  onOpenEvidence: (evidenceId: string) => void;
}) {
  const { t } = useI18n();

  const raw = analysis?.rawRecommendation;
  const rawLabel = raw?.actionLabel ?? raw?.action;
  const gateReason = analysis?.gateReason;
  // A difference is only claimed when the backend supplied both sides.
  const differs =
    rawLabel !== undefined &&
    (normalize(raw?.action) !== normalize(proposal.action) ||
      normalize(rawLabel) !== normalize(proposal.actionLabel));

  const citedFacts = (analysis?.facts ?? []).filter(
    (fact) =>
      fact.evidenceIds.some((id) => proposal.evidenceIds.includes(id)) &&
      fact.grounding !== "UNVERIFIED_CLAIM" &&
      fact.grounding !== "MISSING",
  );
  const gaps = analysis?.gaps ?? [];
  const citedEvidence = proposal.evidenceIds
    .map((id) => evidence.find((item) => item.evidenceId === id))
    .filter((item): item is EvidenceRecord => Boolean(item));

  return (
    <PageSection title={t("approval.whyTitle")} description={t("approval.whySubtitle", { snapshot: proposal.snapshotVersion })}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-line bg-subtle px-3 py-2" data-testid="raw-recommendation">
          <div className="eyebrow">{t("approval.why.raw")}</div>
          {rawLabel ? (
            <>
              <p className="mt-1 text-base font-medium text-ink">{rawLabel}</p>
              {raw?.action ? (
                <p className="font-mono text-xs text-ink-muted">{raw.action}</p>
              ) : null}
              {raw?.rationale ? (
                <ul className="mt-1 space-y-0.5">
                  {raw.rationale.map((line) => (
                    <li key={line} className="text-xs leading-4 text-ink-muted">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-base leading-4 text-ink-muted">{t("approval.why.noRaw")}</p>
          )}
        </div>

        <div className="rounded-md border border-navy-100 bg-navy-50/40 px-3 py-2" data-testid="effective-recommendation">
          <div className="eyebrow">{t("approval.why.effective")}</div>
          <p className="mt-1 text-base font-medium text-ink">
            {proposal.actionLabel}
          </p>
          <p className="font-mono text-xs text-ink-muted">{proposal.action}</p>
          {rawLabel ? (
            <div className="mt-1 flex items-center gap-1.5">
              <Badge tone={differs ? "warn" : "neutral"} size="sm">
                <GitCompare size={9} aria-hidden />
                {differs ? t("approval.why.gate") : t("approval.why.same")}
              </Badge>
            </div>
          ) : null}
          {differs && gateReason ? (
            <p className="mt-1 text-xs leading-4 text-ink">{gateReason}</p>
          ) : null}
          {differs && !gateReason ? (
            <p className="mt-1 text-xs leading-4 text-ink-muted">
              {t("approval.why.gate")}: {t("rd.notProvided")}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        <div className="eyebrow mb-1">{t("approval.why.rationale")}</div>
        <ul className="space-y-1">
          {proposal.rationale.map((line) => (
            <li key={line} className="flex gap-2 text-base leading-5 text-ink">
              <ArrowRight size={11} className="mt-1.5 shrink-0 text-ink-faint" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="eyebrow mb-1">{t("approval.why.facts")}</div>
          {citedFacts.length === 0 ? (
            <p className="text-base leading-4 text-ink-muted">{t("approval.why.noFacts")}</p>
          ) : (
            <ul className="space-y-1" data-testid="approval-facts">
              {citedFacts.map((fact) => (
                <li key={fact.factId} className="flex items-start gap-1.5">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-base leading-4 text-ink">{fact.statement}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <GroundingBadge grounding={fact.grounding} />
                      {fact.evidenceIds.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onOpenEvidence(id)}
                          className="rounded border border-line bg-card px-1 font-mono text-xs text-ink-muted hover:border-navy-600 hover:text-navy-700"
                        >
                          {id}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="eyebrow mb-1">{t("approval.why.gaps")}</div>
          {gaps.length === 0 ? (
            <p className="text-base leading-4 text-ink-muted">{t("approval.why.noGaps")}</p>
          ) : (
            <ul className="space-y-1" data-testid="approval-gaps">
              {gaps.map((gap) => (
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
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="eyebrow">{t("approval.why.citedEvidence")}</div>
          <span className="num text-xs text-ink-faint">
            {t("approval.cited", { count: citedEvidence.length })}
          </span>
        </div>
        {citedEvidence.length === 0 ? (
          <p className="mt-1 text-base leading-4 text-ink-muted">{t("approval.why.noEvidence")}</p>
        ) : (
          <ul className="mt-1 divide-y divide-line rounded-md border border-line">
            {citedEvidence.map((item) => (
              <li key={item.evidenceId}>
                <button
                  type="button"
                  onClick={() => onOpenEvidence(item.evidenceId)}
                  className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-subtle"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs text-ink-muted">{item.evidenceId}</span>
                      <span className="text-base font-medium text-ink">
                        {evidenceTypeLabel(item.type, item.typeLabel, t)}
                      </span>
                      <GroundingBadge grounding={item.grounding} />
                      {!item.available ? (
                        <Badge tone="warn" size="sm">
                          {t("case.evidence.missing")}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-ink-muted">
                      {item.excerpt}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {analysis?.contradictions.length ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-warn-line bg-warn-bg/40 px-2.5 py-2">
          <Info size={11} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <p className="text-xs leading-4 text-ink">
            <span className="font-semibold">{t("approval.contradiction")}: </span>
            {analysis.contradictions[0].detail}
          </p>
        </div>
      ) : null}
    </PageSection>
  );
}
