import { Languages } from "lucide-react";
import { useI18n, type Lang } from "../../i18n";

const OPTIONS: { value: Lang; labelKey: "language.zh" | "language.en" }[] = [
  { value: "zh-CN", labelKey: "language.zh" },
  { value: "en", labelKey: "language.en" },
];

/** Topbar language switch: 中文 / EN, persisted in `dp.demo.lang`. */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-line bg-sunken p-[3px]"
    >
      <Languages size={12} className="mx-1 hidden text-ink-faint sm:block" aria-hidden />
      {OPTIONS.map((option) => {
        const active = lang === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={t("language.switchTo", { lang: t(option.labelKey) })}
            onClick={() => setLang(option.value)}
            className={[
              "inline-flex h-[26px] items-center whitespace-nowrap rounded px-1.5 text-xs font-medium transition-all sm:px-2",
              active
                ? "bg-card text-navy-800 shadow-[0_1px_2px_rgba(15,23,42,0.10)]"
                : "text-ink-muted hover:text-ink",
            ].join(" ")}
          >
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
