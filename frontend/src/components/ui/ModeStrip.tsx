import type { RuntimeHealth } from "../../api/runtime";
import { useI18n } from "../../i18n";
import { formatClock } from "../../lib/format";
import { sourceOf } from "../../lib/statusModel";
import { SourceBadge } from "./SourceBadge";

/**
 * Runtime / source strip. Every value comes from `/health` (or the offline
 * runtime bundle) — the mode is never inferred from case data, the URL or a
 * default. The analysis-mode badge is optional and shown only when the caller
 * passes a real value.
 */
export function ModeStrip({
  health,
  analysisMode,
  lastReadAt,
  lastReadKind,
}: {
  health?: RuntimeHealth;
  analysisMode?: string;
  lastReadAt?: string;
  lastReadKind?: "remote" | "local";
}) {
  const { t } = useI18n();
  const sources = sourceOf({ health, analysisMode });
  const offline = !health || (health.executionMode || "").toUpperCase() === "REPLAY";

  return (
    <section
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-card px-3.5 py-2.5 shadow-card"
      aria-label={t("mode.stripLabel")}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
        {t("mode.stripLabel")}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {sources.map((source) => (
          <SourceBadge key={source.key} source={source} />
        ))}
      </div>
      <span className="text-xs leading-5 text-ink-muted">
        {offline ? t("mode.stripOffline") : t("mode.stripSandbox")}
      </span>
      <span className="num ml-auto text-xs text-ink-faint">
        {lastReadAt
          ? t(lastReadKind === "local" ? "connection.lastRefresh" : "connection.lastRead", {
              time: formatClock(lastReadAt),
            })
          : t("connection.noRemoteRead")}
      </span>
    </section>
  );
}
