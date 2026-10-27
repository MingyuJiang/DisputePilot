import { AlertTriangle } from "lucide-react";
import type { AnalysisErrorInfo } from "../../api/errors";
import { errorCodeKey, useI18n, type MessageKey } from "../../i18n";
import { Badge } from "../ui/Badge";

/**
 * Backend error surfaced in a panel.
 *
 * The code is mapped to a readable bilingual explanation; the backend message
 * is kept verbatim in an expandable block so nothing is hidden or rewritten.
 */
export function BackendErrorNotice({
  error,
  titleKey,
  retryableHint = false,
}: {
  error: AnalysisErrorInfo;
  titleKey: MessageKey;
  retryableHint?: boolean;
}) {
  const { t } = useI18n();
  const codeKey = errorCodeKey(error.code);

  return (
    <div
      role="alert"
      className="rounded-md border border-stop-line bg-stop-bg/40 px-3 py-2.5 text-left"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-stop" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] font-semibold text-stop">{t(titleKey)}</span>
            {error.status > 0 ? <Badge tone="stop">HTTP {error.status}</Badge> : null}
            <Badge tone="stop">{error.code}</Badge>
          </div>
          {codeKey ? (
            <p className="mt-1 text-[10.5px] leading-4 text-ink">{t(codeKey)}</p>
          ) : null}
          <p className="mt-1 break-words text-[10.5px] leading-4 text-ink-muted">{error.message}</p>
          {retryableHint && error.retryable ? (
            <p className="mt-1 text-[10px] text-ink-faint">{t("error.manualOnly")}</p>
          ) : null}
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[10px] font-medium text-ink-faint hover:text-ink">
              {t("common.technicalDetails")}
            </summary>
            <dl className="mt-1 space-y-1 rounded border border-line bg-card/70 px-2 py-1.5 text-[10px] leading-4">
              <div className="flex gap-2">
                <dt className="shrink-0 text-ink-faint">{t("common.code")}</dt>
                <dd className="break-all font-mono text-ink-muted">{error.code}</dd>
              </div>
              {error.detailCodes.length > 0 ? (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-ink-faint">{t("common.detailCodes")}</dt>
                  <dd className="break-all font-mono text-ink-muted">
                    {error.detailCodes.join(", ")}
                  </dd>
                </div>
              ) : null}
              <div className="flex gap-2">
                <dt className="shrink-0 text-ink-faint">{t("common.originalMessage")}</dt>
                <dd className="break-words text-ink-muted">{error.message}</dd>
              </div>
            </dl>
          </details>
        </div>
      </div>
    </div>
  );
}
