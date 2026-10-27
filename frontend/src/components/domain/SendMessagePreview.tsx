/**
 * Manager-side message preview.
 *
 * Renders the payload text verbatim (line breaks preserved, no truncation) so
 * the approval decision is made against the exact bytes that would be sent.
 * The verification note deliberately says "verbatim match in messages[]" —
 * never "buyer received" or "read".
 */

import type { ExecutionRecord, ProposalState } from "../../api/types";
import { countMessageChars } from "../../lib/sendMessage";
import { useI18n } from "../../i18n";
import { Card } from "../ui/Card";
import { ExecutionResultBadge, ProposalStateBadge } from "./Badges";

export function SendMessagePreview({
  message,
  payloadHash,
  requestId,
  state,
  execution,
}: {
  message: string;
  payloadHash?: string;
  requestId?: string;
  state?: ProposalState;
  execution?: ExecutionRecord;
}) {
  const { t } = useI18n();

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-strong">{t("approval.messageTitle")}</div>
          <div className="mt-0.5 text-base text-ink-muted">{t("approval.messageSubtitle")}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {state ? <ProposalStateBadge state={state} /> : null}
          {execution ? <ExecutionResultBadge execution={execution} /> : null}
        </div>
      </div>

      <div className="px-4 py-3">
        {message ? (
          <pre
            data-testid="send-message-preview-text"
            className="max-h-none overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-subtle px-3 py-2.5 font-sans text-base leading-5 text-ink"
          >
            {message}
          </pre>
        ) : (
          <p className="rounded-md border border-stop-line bg-stop-bg px-3 py-2.5 text-base leading-4 text-stop">
            {t("approval.messageEmpty")}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
          <span className="num">{t("approval.messageChars", { count: countMessageChars(message) })}</span>
          {payloadHash ? (
            <span className="break-all font-mono" title={t("sendMessage.hashLabel")}>
              {t("sendMessage.hashLabel")}: {payloadHash}
            </span>
          ) : null}
          {requestId ? <span className="break-all font-mono">{requestId}</span> : null}
        </div>

        <p className="mt-2 border-t border-line pt-2 text-xs leading-4 text-ink-muted">
          {t("sendMessage.verificationNote")}
        </p>
      </div>
    </Card>
  );
}
