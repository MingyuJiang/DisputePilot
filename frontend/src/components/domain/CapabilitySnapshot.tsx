/**
 * Capability snapshot (FRONTEND_REDESIGN_PLAN §3.4 step 5).
 *
 * Live HATEOAS and a frozen fixture are different claims, so the basis comes
 * from `statusModel.sourceOf()` and is never inferred from the URL or from the
 * fact that a link happens to be available. The raw table stays folded.
 */

import { FlaskConical, Radio } from "lucide-react";
import type { HateoasSnapshot } from "../../api/types";
import { formatDateTime } from "../../lib/format";
import { sourceOf } from "../../lib/statusModel";
import { useI18n } from "../../i18n";
import { Disclosure } from "../ui/Disclosure";
import { SourceBadge } from "../ui/SourceBadge";
import { HateoasTable } from "./HateoasTable";

export function CapabilitySnapshot({
  snapshot,
  className = "",
}: {
  snapshot?: HateoasSnapshot;
  className?: string;
}) {
  const { t } = useI18n();

  if (!snapshot) {
    return (
      <p className={["text-base leading-4 text-ink-muted", className].join(" ")}>
        {t("case.capability.noLinks")}
      </p>
    );
  }

  const live = snapshot.links.some((link) => (link.basis ?? "").toUpperCase() === "LIVE_HATEOAS");
  const basis = live ? "LIVE_HATEOAS" : "FIXTURE_SNAPSHOT";
  const sources = sourceOf({ basis });

  return (
    <div className={className} data-testid="capability-snapshot">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-ink-faint">
          {live ? <Radio size={12} aria-hidden /> : <FlaskConical size={12} aria-hidden />}
        </span>
        {sources.map((source) => (
          <SourceBadge key={source.key} source={source} />
        ))}
        {snapshot.frozen ? (
          <span className="text-xs text-ink-faint">{t("case.evidence.fixture")}</span>
        ) : null}
      </div>

      <dl className="mt-1.5">
        <div className="flex items-baseline justify-between gap-3 py-0.5">
          <dt className="text-xs text-ink-faint">{t("approval.capability.readAt")}</dt>
          <dd className="num text-base text-ink">{formatDateTime(snapshot.observedAt)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-0.5">
          <dt className="shrink-0 text-xs text-ink-faint">
            {t("approval.capability.drift")}
          </dt>
          <dd className="text-right text-xs leading-4 text-ink-muted">
            {t(live ? "approval.capability.driftLive" : "approval.capability.driftFixture")}
          </dd>
        </div>
      </dl>

      <p className="mt-1 break-words text-xs leading-4 text-ink-faint">{snapshot.source}</p>

      <div className="mt-2">
        <Disclosure summary={t("approval.capability.links")}>
          <HateoasTable snapshot={snapshot} />
        </Disclosure>
      </div>
    </div>
  );
}
