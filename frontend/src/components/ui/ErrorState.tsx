import type { ReactNode } from "react";
import { RefreshCw, ShieldX } from "lucide-react";
import { useI18n } from "../../i18n";

/**
 * A failed read must never be rendered as an empty list. The retry button is
 * offered because the call itself failed — it is not a retry of an execution.
 */
export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title: ReactNode;
  detail?: ReactNode;
  onRetry?: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="rounded-lg border border-stop-line bg-stop-bg/60 px-4 py-3.5"
      role="alert"
      data-testid="error-state"
    >
      <div className="flex items-start gap-2">
        <ShieldX size={15} className="mt-0.5 shrink-0 text-stop" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-6 text-stop">{title}</p>
          {detail ? <p className="mt-0.5 text-xs leading-5 text-ink">{detail}</p> : null}
        </div>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-card px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
          >
            <RefreshCw size={11} aria-hidden />
            {t("connection.retry")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
