import { AlertTriangle, ArrowDownLeft, ArrowUpRight, FileQuestion, Hash, Link2, ShieldCheck } from "lucide-react";
import type { EvidenceRecord, GroundedFact } from "../../api/types";
import { Drawer } from "../ui/Drawer";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { GroundingBadge, groundingDescKey, groundingLabelKey, groundingTone } from "./Badges";
import { ProvenanceBadge } from "./SandboxStatus";
import { formatDateTime } from "../../lib/format";
import { evidenceTypeLabel, useI18n } from "../../i18n";

function Highlighted({ text, highlight }: { text: string; highlight?: string }) {
  if (!highlight || !text.includes(highlight)) return <>{text}</>;
  const [before, ...rest] = text.split(highlight);
  const after = rest.join(highlight);
  return (
    <>
      {before}
      <mark className="rounded-[2px] bg-warn-bg px-0.5 font-medium text-ink-strong ring-1 ring-inset ring-warn-line">
        {highlight}
      </mark>
      {after}
    </>
  );
}

/**
 * Locate the backend's verbatim `evidence_span` inside the record excerpt.
 * Exact match first, then a case-insensitive match — never a fuzzy rewrite,
 * because the highlighted text must still exist in the source.
 */
const findSpan = (text: string, span?: string): string | undefined => {
  const trimmed = span?.trim();
  if (!trimmed) return undefined;
  const exact = text.indexOf(trimmed);
  if (exact >= 0) return text.slice(exact, exact + trimmed.length);
  const lower = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (lower >= 0) return text.slice(lower, lower + trimmed.length);
  return undefined;
};

export function EvidenceDrawer({
  evidence,
  facts,
  focusFactId,
  onClose,
  onRequest,
}: {
  evidence: EvidenceRecord | null;
  facts: GroundedFact[];
  /** Fact the operator clicked; its evidence_span wins when available. */
  focusFactId?: string | null;
  onClose: () => void;
  onRequest: (evidence: EvidenceRecord) => void;
}) {
  const { t } = useI18n();
  if (!evidence) return null;

  const tone = groundingTone(evidence.grounding);
  const label = t(groundingLabelKey(evidence.grounding));
  const description = t(groundingDescKey(evidence.grounding));
  const supported = facts.filter((fact) => evidence.supportedFactIds.includes(fact.factId));
  const isMissing = evidence.grounding === "MISSING";
  const isUnknown = evidence.grounding === "UNKNOWN";
  const isInference = evidence.grounding === "AI_INFERENCE";

  const focusFact = focusFactId
    ? supported.find((fact) => fact.factId === focusFactId)
    : undefined;
  // Without a focus fact, use the first cited span that actually exists.
  const spanFact =
    focusFact ??
    supported.find((fact) => findSpan(evidence.excerpt, fact.evidenceSpan) !== undefined);
  const spanHighlight = findSpan(evidence.excerpt, spanFact?.evidenceSpan);
  const highlight = evidence.highlight ?? spanHighlight;

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="num text-[15px]">{evidence.evidenceId}</span>
          <GroundingBadge grounding={evidence.grounding} />
        </span>
      }
      subtitle={evidenceTypeLabel(evidence.type, evidence.typeLabel, t)}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-base leading-4 text-ink-faint">
            {isMissing || isUnknown ? t("evidence.footerMissing") : t("evidence.footerVerbatim")}
          </span>
          {isMissing ? (
            <Button size="sm" variant="secondary" onClick={() => onRequest(evidence)}>
              <ArrowDownLeft size={13} aria-hidden />
              {t("evidence.addRequest")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex items-start gap-2 rounded-md border border-line bg-subtle px-3 py-2.5">
        <div
          className={[
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border",
            tone === "pass"
              ? "border-pass-line bg-pass-bg text-pass"
              : tone === "scenario"
                ? "border-scenario-line bg-scenario-bg text-scenario"
                : tone === "infer"
                  ? "border-infer-line bg-infer-bg text-infer"
                  : "border-stop-line bg-stop-bg text-stop",
          ].join(" ")}
        >
          {evidence.grounding === "VERIFIED_OBSERVATION" ? (
            <ShieldCheck size={13} aria-hidden />
          ) : evidence.grounding === "MISSING" ? (
            <FileQuestion size={13} aria-hidden />
          ) : (
            <AlertTriangle size={13} aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-ink-strong">{label}</div>
          <p className="mt-0.5 text-base leading-4 text-ink-muted">{description}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{t("evidence.type")}</dt>
          <dd className="mt-0.5 text-xs text-ink">{evidence.type}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{t("evidence.source")}</dt>
          <dd className="mt-0.5 text-xs text-ink">{evidence.source}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{t("evidence.direction")}</dt>
          <dd className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink">
            {evidence.direction === "FROM_BUYER" ? (
              <ArrowDownLeft size={11} aria-hidden />
            ) : evidence.direction === "FROM_PAYPAL" ? (
              <Link2 size={11} aria-hidden />
            ) : (
              <ArrowUpRight size={11} aria-hidden />
            )}
            {evidence.direction === "FROM_BUYER"
              ? t("evidence.directionFromBuyer")
              : evidence.direction === "FROM_PAYPAL"
                ? t("evidence.directionFromPaypal")
                : evidence.direction === "FROM_MERCHANT"
                  ? t("evidence.directionFromMerchant")
                  : evidence.direction.replaceAll("_", " ").toLowerCase()}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{t("evidence.collected")}</dt>
          <dd className="num mt-0.5 text-xs text-ink">{formatDateTime(evidence.collectedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{t("evidence.verification")}</dt>
          <dd className="mt-0.5 text-xs text-ink">{label}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">{t("evidence.provenance")}</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <ProvenanceBadge provenance={evidence.provenance} />
            <span className="font-mono text-xs leading-4 text-ink-faint">
              {evidence.provenance}
            </span>
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="eyebrow">{t("evidence.excerpt")}</div>
          {highlight ? (
            <span className="text-xs text-ink-faint">
              {spanHighlight === highlight && spanFact
                ? t("evidence.verbatimSpan", { factId: spanFact.factId })
                : t("evidence.highlightSupports")}
            </span>
          ) : null}
        </div>
        {isMissing ? (
          <div className="rounded-md border border-dashed border-stop-line bg-stop-bg/40 px-3.5 py-4">
            <div className="flex items-center gap-1.5 text-xs font-medium text-stop">
              <FileQuestion size={13} aria-hidden />
              {t("evidence.noRecord")}
            </div>
            <p className="mt-1 text-xs leading-5 text-ink">
              {t("evidence.noRecordBody")}
            </p>
            <div className="mt-2 text-base leading-4 text-ink-muted">{evidence.note}</div>
          </div>
        ) : isUnknown ? (
          <div className="rounded-md border border-dashed border-line-strong bg-subtle px-3.5 py-4">
            <div className="text-xs font-medium text-ink-strong">{t("evidence.notRequested")}</div>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{evidence.excerpt}</p>
          </div>
        ) : (
          <blockquote
            className={[
              "rounded-md border px-3.5 py-3 text-xs leading-6 text-ink",
              isInference ? "border-infer-line bg-infer-bg/40" : "border-line bg-subtle",
            ].join(" ")}
          >
            {isInference ? (
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-infer">
                <AlertTriangle size={11} aria-hidden />
                {t("evidence.derived")}
              </div>
            ) : null}
            <Highlighted text={evidence.excerpt} highlight={highlight} />
          </blockquote>
        )}
      </div>

      <div className="mt-4">
        <div className="eyebrow mb-1.5">{t("evidence.supported")}</div>
        {supported.length === 0 ? (
          <p className="rounded-md border border-line bg-subtle px-3 py-2.5 text-xs text-ink-muted">
            {t("evidence.notCited")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {supported.map((fact) => (
              <li key={fact.factId} className="rounded-md border border-line px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs leading-5 text-ink">{fact.statement}</p>
                  <Badge tone={groundingTone(fact.grounding)}>{fact.factId}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 rounded-md border border-line bg-subtle px-3 py-2.5">
        <div className="flex items-start gap-2">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
          <p className="text-base leading-4 text-ink-muted">{evidence.note}</p>
        </div>
      </div>

      {evidence.sha256 ? (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint">
          <Hash size={10} aria-hidden />
          <span className="font-mono">{evidence.sha256}</span>
          <span>{t("evidence.fixtureHash")}</span>
        </div>
      ) : null}
    </Drawer>
  );
}
