import { percent } from "../../lib/format";
import { useI18n } from "../../i18n";

export function Readiness({
  provided,
  requested,
  compact = false,
}: {
  provided: number;
  requested: number;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const ratio = percent(provided, requested);
  const tone =
    ratio >= 100 ? "bg-pass" : ratio >= 50 ? "bg-warn" : "bg-stop";

  return (
    <div className={compact ? "w-[92px]" : "w-full"}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-xs font-medium text-ink">
          {provided}
          <span className="text-ink-faint"> / {requested}</span>
        </span>
        {!compact ? (
          <span className="text-2xs text-ink-faint">{t("readiness.ofRequested", { ratio })}</span>
        ) : null}
      </div>
      <div
        className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-sunken"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={requested}
        aria-valuenow={provided}
        aria-label={t("readiness.aria", { provided, requested })}
      >
        <div className={["h-full rounded-full", tone].join(" ")} style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}
