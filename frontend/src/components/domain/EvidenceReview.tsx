/**
 * Evidence review — three independent buckets (FRONTEND_REDESIGN_PLAN §3.3.3).
 *
 *   On file                 — the records that exist, verbatim excerpt.
 *   Required for this action — what the current/recommended action asks for.
 *   Assessment              — the AI's grounding, gaps and unverified claims.
 *
 * A record exists or it does not; a requirement is open or satisfied. Record
 * counts are displayed with an explicit "not a sufficiency test" note so no
 * reader can read "4 on file" as "enough evidence".
 */

import { CheckCircle2, FileQuestion, FileWarning, Link2 } from "lucide-react";
import type {
  ActionProposal,
  AIAnalysis,
  EvidenceRecord,
  EvidenceRequirement,
  GroundingClass,
} from "../../api/types";
import { evidenceTypeLabel, useI18n } from "../../i18n";
import { Badge } from "../ui/Badge";
import { GroundingBadge } from "./Badges";

const isFixtureProvenance = (provenance?: string): boolean =>
  provenance === "SCENARIO_DEFINED" || provenance === "SIMULATED_COMPOSITE";

function EvidenceRow({
  item,
  cited,
  onOpen,
}: {
  item: EvidenceRecord;
  cited: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const missing = !item.available || item.grounding === "MISSING";

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={[
          "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
          missing
            ? "border-dashed border-stop-line bg-stop-bg/30 hover:bg-stop-bg/50"
            : "border-line bg-card hover:border-navy-600 hover:bg-navy-50/40",
        ].join(" ")}
      >
        <span className="mt-0.5 shrink-0">
          {missing ? (
            <FileWarning size={12} className="text-stop" aria-hidden />
          ) : (
            <Link2 size={12} className="text-ink-faint" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-base font-medium text-ink">
              {evidenceTypeLabel(item.type, item.typeLabel, t)}
            </span>
            <span className="font-mono text-xs text-ink-faint">{item.evidenceId}</span>
            <GroundingBadge grounding={item.grounding} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-faint">{item.source}</span>
          <span className="mt-0.5 block text-xs leading-4 text-ink-muted">{item.excerpt}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {isFixtureProvenance(item.provenance) ? (
              <Badge tone="scenario" size="sm">
                {t("case.evidence.fixture")}
              </Badge>
            ) : null}
            <Badge tone={cited ? "info" : "neutral"} size="sm">
              {cited ? t("case.evidence.cited") : t("case.evidence.notCited")}
            </Badge>
          </span>
        </span>
      </button>
    </li>
  );
}

export function EvidenceReview({
  evidence,
  requirements,
  proposal,
  analysis,
  onOpenEvidence,
}: {
  evidence: EvidenceRecord[];
  requirements: EvidenceRequirement[];
  proposal?: ActionProposal;
  analysis?: AIAnalysis;
  onOpenEvidence: (evidenceId: string) => void;
}) {
  const { t } = useI18n();

  const cited = new Set(proposal?.evidenceIds ?? []);
  const facts = analysis?.facts ?? [];
  const verified = facts.filter(
    (fact) => fact.grounding === "VERIFIED_OBSERVATION" || fact.grounding === "SCENARIO_DEFINED",
  );
  const unverified = facts.filter(
    (fact) => fact.grounding === "UNVERIFIED_CLAIM" || fact.grounding === "MISSING",
  );
  const gaps = analysis?.gaps ?? [];

  const groundingCount = (values: GroundingClass[]): number =>
    facts.filter((fact) => values.includes(fact.grounding)).length;

  return (
    <div className="space-y-3" data-testid="evidence-review">
      <section aria-label={t("case.evidence.onFile")}>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-ink-strong">
            {t("case.evidence.onFile")}
          </h3>
          <span className="num text-xs text-ink-faint">{evidence.length}</span>
        </div>
        {evidence.length === 0 ? (
          <p className="mt-1 text-base leading-4 text-ink-muted">{t("case.evidence.noOnFile")}</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {evidence.map((item) => (
              <EvidenceRow
                key={item.evidenceId}
                item={item}
                cited={cited.has(item.evidenceId)}
                onOpen={() => onOpenEvidence(item.evidenceId)}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("case.evidence.required")} className="border-t border-line pt-2.5">
        <h3 className="text-base font-semibold text-ink-strong">
          {t("case.evidence.required")}
        </h3>
        {requirements.length === 0 ? (
          <p className="mt-1 text-base leading-4 text-ink-muted">
            {t("case.evidence.noRequired")}
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {requirements.map((requirement) => {
              const open = requirement.status === "OPEN";
              const record = evidence.find(
                (item) => item.type.toUpperCase() === requirement.evidenceType.toUpperCase(),
              );
              return (
                <li
                  key={requirement.evidenceType}
                  className="flex flex-wrap items-start justify-between gap-1.5 rounded border border-line bg-subtle px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-ink">
                      {requirement.evidenceType}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-faint">
                      {requirement.sourceExpected || t("rd.notProvided")}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      {record
                        ? t("case.evidence.recordOnFile", { id: record.evidenceId })
                        : t("case.evidence.noRecord")}
                    </div>
                  </div>
                  <Badge tone={open ? "warn" : "pass"}>
                    {open ? t("case.evidence.stillOpen") : t("case.evidence.satisfies")}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label={t("case.evidence.assessment")} className="border-t border-line pt-2.5">
        <h3 className="text-base font-semibold text-ink-strong">
          {t("case.evidence.assessment")}
        </h3>

        <dl className="mt-1.5 grid grid-cols-2 gap-1.5">
          <div className="rounded border border-line bg-subtle px-2 py-1.5">
            <dt className="text-xs uppercase tracking-[0.05em] text-ink-faint">
              {t("case.ai.verified")}
            </dt>
            <dd className="num text-base font-semibold text-ink">{verified.length}</dd>
          </div>
          <div className="rounded border border-warn-line bg-warn-bg/40 px-2 py-1.5">
            <dt className="text-xs uppercase tracking-[0.05em] text-ink-faint">
              {t("case.ai.unverified")}
            </dt>
            <dd className="num text-base font-semibold text-warn">{unverified.length}</dd>
          </div>
        </dl>

        <p className="mt-1 text-xs leading-4 text-ink-faint">
          {t("case.evidence.countsNote")} ·{" "}
          {t("case.evidence.missing")}: {groundingCount(["MISSING"])}
        </p>

        {gaps.length > 0 ? (
          <ul className="mt-2 space-y-1" data-testid="evidence-gaps">
            {gaps.map((gap) => (
              <li key={gap.gapId} className="flex items-start gap-1.5">
                {gap.severity === "HIGH" ? (
                  <FileWarning size={11} className="mt-0.5 shrink-0 text-stop" aria-hidden />
                ) : (
                  <FileQuestion size={11} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                )}
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
        ) : (
          <p className="mt-1 flex items-center gap-1 text-xs leading-4 text-ink-muted">
            <CheckCircle2 size={11} className="text-ink-faint" aria-hidden />
            {t("case.ai.noGaps")}
          </p>
        )}
      </section>
    </div>
  );
}
