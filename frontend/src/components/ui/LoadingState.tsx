import { useI18n } from "../../i18n";

/** Loading placeholder with an announcement for screen readers. */
export function LoadingState({ label, rows = 3 }: { label?: string; rows?: number }) {
  const { t } = useI18n();
  const text = label ?? t("common.loadingWorkspace");

  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite" data-testid="loading-state">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-9 rounded-md border border-line bg-subtle" />
      ))}
      <span className="sr-only">{text}</span>
    </div>
  );
}
