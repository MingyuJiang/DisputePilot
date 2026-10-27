import { useI18n } from "../../i18n";
import type { DisplayState } from "../../lib/statusModel";
import { Badge } from "./Badge";

/**
 * The only way a status reaches the screen. It accepts a `DisplayState` (never
 * a raw string), so the label, tone and unknown-raw tooltip all come from
 * `statusModel`.
 */
export function StatusBadge({
  state,
  size = "md",
}: {
  state: DisplayState;
  size?: "sm" | "md";
}) {
  const { lang } = useI18n();
  const label = lang === "zh-CN" ? state.labelZh : state.labelEn;
  const title = state.raw ? `${state.key} · ${state.raw}` : state.key;

  return (
    <span title={title} data-state={state.key}>
      <Badge tone={state.tone} size={size}>
        {label}
      </Badge>
    </span>
  );
}
