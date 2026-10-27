import { useI18n } from "../../i18n";
import type { DisplayState } from "../../lib/statusModel";
import { Badge } from "./Badge";

/**
 * Runtime / provenance / analysis-mode / capability source. There is no
 * default source: the caller must pass the `DisplayState` produced by
 * `sourceOf()`.
 */
export function SourceBadge({
  source,
  size = "md",
}: {
  source: DisplayState;
  size?: "sm" | "md";
}) {
  const { lang } = useI18n();
  const label = lang === "zh-CN" ? source.labelZh : source.labelEn;

  return (
    <span title={source.raw ? `${source.key} · ${source.raw}` : source.key} data-source={source.key}>
      <Badge tone={source.tone} size={size}>
        {label}
      </Badge>
    </span>
  );
}
