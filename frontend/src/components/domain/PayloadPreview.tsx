/**
 * The exact payload an approval binds (FRONTEND_REDESIGN_PLAN §3.4 step 2).
 *
 * One component for every action so the manager always reads the same shape:
 * the literal content first, metadata second, binding hash collapsed last.
 * Nothing here truncates: a `send-message` body keeps every character and a
 * `provide-evidence` note keeps its line breaks.
 */

import { AlertTriangle, FileText, Paperclip, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import type { ActionProposal, CaseRecord } from "../../api/types";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { Disclosure } from "../ui/Disclosure";
import { countMessageChars, messageBodyOf, requestIdOf } from "../../lib/sendMessage";
import {
  captureViewOf,
  formatAmountMinor,
  isRefundAction,
  refundAmountMinorOf,
  refundModeOf,
} from "../../lib/refund";
import { useI18n } from "../../i18n";

const fieldOf = (proposal: ActionProposal, labels: string[]): string | undefined => {
  const field = proposal.payload.find((entry) =>
    labels.some((label) => entry.label.toLowerCase() === label.toLowerCase()),
  );
  return field?.value;
};

/** Placeholder values the backend writes when no attachment exists. */
const NO_ATTACHMENT = ["", "—", "-", "none", "n/a", "— none available —"];

const attachmentOf = (proposal: ActionProposal): string | undefined => {
  const value = fieldOf(proposal, ["File", "Attachment", "Filename", "File name"]);
  if (!value) return undefined;
  return NO_ATTACHMENT.includes(value.trim().toLowerCase()) ? undefined : value.trim();
};

const notesOf = (proposal: ActionProposal): string | undefined =>
  fieldOf(proposal, ["Notes", "Note", "Evidence notes", "Content label"]);

const Row = ({ label, value }: { label: ReactNode; value: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
    <dt className="shrink-0 text-base text-ink-faint">{label}</dt>
    <dd className="num min-w-0 break-words text-right text-base text-ink">{value}</dd>
  </div>
);

function Header({ proposal }: { proposal: ActionProposal }) {
  const { t } = useI18n();
  return (
    <div className="border-b border-line bg-navy-50/40 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-6 text-ink-strong">
            {t("approval.payload.title")}
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-ink-muted">
            {t("approval.payload.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="navy">{t("approval.payload.primaryBadge")}</Badge>
          <span className="font-mono text-xs text-ink-muted">{proposal.action}</span>
        </div>
      </div>
    </div>
  );
}

function Footer({ proposal }: { proposal: ActionProposal }) {
  const { t } = useI18n();
  const hash = proposal.payloadHash;
  const requestId = requestIdOf(proposal);
  if (!hash && !requestId) return null;

  return (
    <div className="border-t border-line bg-subtle px-4 py-2">
      <Disclosure summary={t("approval.payload.hash")}>
        {hash ? (
          <p className="break-all font-mono text-xs leading-5 text-ink">{hash}</p>
        ) : (
          <p className="text-xs text-ink-muted">{t("rd.notProvided")}</p>
        )}
        <p className="mt-1 text-xs leading-4 text-ink-muted">
          {t("approval.payload.hashNote")}
        </p>
        {requestId ? (
          <p className="mt-1 break-all font-mono text-xs text-ink-faint">{requestId}</p>
        ) : null}
      </Disclosure>
    </div>
  );
}

function ExtraFields({ proposal, skip }: { proposal: ActionProposal; skip: string[] }) {
  const { t } = useI18n();
  const rest = proposal.payload.filter(
    (field) => !skip.some((label) => label.toLowerCase() === field.label.toLowerCase()),
  );
  if (rest.length === 0) return null;

  return (
    <div className="border-t border-line px-4 py-2.5">
      <div className="eyebrow mb-1">{t("approval.payload.fields")}</div>
      <dl className="divide-y divide-line/70">
        {rest.map((field) => (
          <Row
            key={field.label}
            label={field.label}
            value={<span className="font-mono text-base">{field.value}</span>}
          />
        ))}
      </dl>
    </div>
  );
}

/** `send-message`: full body, recipient, character count. */
function SendMessagePayload({ proposal }: { proposal: ActionProposal }) {
  const { t } = useI18n();
  const body = messageBodyOf(proposal);

  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="eyebrow">{t("approval.payload.fullBody")}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <span className="num">{t("approval.payload.chars", { count: countMessageChars(body) })}</span>
          <span aria-hidden>·</span>
          <span>{t("approval.payload.recipient")}: {t("approval.payload.recipientBuyer")}</span>
        </div>
      </div>
      {body ? (
        <pre
          data-testid="send-message-preview-text"
          className="mt-1.5 max-h-none overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-subtle px-3.5 py-3 font-sans text-base leading-6 text-ink"
        >
          {body}
        </pre>
      ) : (
        <p className="mt-1.5 rounded-md border border-stop-line bg-stop-bg px-3 py-2 text-xs leading-5 text-stop">
          {t("approval.messageEmpty")}
        </p>
      )}
      <p className="mt-1.5 text-xs leading-4 text-ink-faint">
        {t("approval.payload.recipientNote")}
      </p>
      <ExtraFields
        proposal={proposal}
        skip={["Message body", "Message", "Request ID", "To", "Recipient"]}
      />
    </div>
  );
}

/** `provide-evidence`: type, full notes (line breaks kept), attachment presence. */
function EvidencePayload({ proposal }: { proposal: ActionProposal }) {
  const { t } = useI18n();
  const type =
    fieldOf(proposal, ["Evidence type", "Type"]) ??
    proposal.requiredEvidence?.[0] ??
    proposal.payload[0]?.value;
  const notes = notesOf(proposal);
  const attachment = attachmentOf(proposal);

  return (
    <div className="px-4 py-3.5">
      <dl>
        <Row
          label={t("approval.payload.evidenceType")}
          value={<span className="font-mono">{type ?? t("rd.notProvided")}</span>}
        />
      </dl>

      <div className="mt-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="eyebrow">{t("approval.payload.notes")}</div>
          {notes ? (
            <span className="num text-xs text-ink-faint">
              {t("approval.payload.chars", { count: countMessageChars(notes) })}
            </span>
          ) : null}
        </div>
        {notes ? (
          <pre
            data-testid="payload-evidence-notes"
            className="mt-1 max-h-none overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-subtle px-3 py-2.5 font-sans text-base leading-5 text-ink"
          >
            {notes}
          </pre>
        ) : (
          <p className="mt-1 rounded-md border border-dashed border-line bg-subtle px-3 py-2 text-base leading-4 text-ink-muted">
            {t("approval.payload.notesNone")}
          </p>
        )}
      </div>

      <div className="mt-2 flex items-start gap-2 rounded-md border border-line bg-card px-3 py-2">
        <Paperclip size={12} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
        <div className="min-w-0">
          <div className="text-base font-medium text-ink">{t("approval.payload.attachment")}</div>
          <p
            data-testid="payload-attachment"
            className={[
              "mt-0.5 break-all text-base leading-4",
              attachment ? "font-mono text-ink" : "text-warn",
            ].join(" ")}
          >
            {attachment
              ? t("approval.payload.attachmentPresent", { name: attachment })
              : t("approval.payload.attachmentAbsent")}
          </p>
        </div>
      </div>

      <ExtraFields
        proposal={proposal}
        skip={["Evidence type", "Type", "Notes", "Note", "Content label", "File", "Request ID"]}
      />
    </div>
  );
}

/** `partial-refund` / `full-refund`: capture, amounts, expected balance. */
function RefundPayload({
  proposal,
  record,
  synthetic,
}: {
  proposal: ActionProposal;
  record: CaseRecord;
  synthetic: boolean;
}) {
  const { t } = useI18n();
  const view = captureViewOf(record, proposal);
  const amountMinor = refundAmountMinorOf(proposal);
  const money = (minor?: number): string =>
    minor === undefined ? "—" : `${formatAmountMinor(minor)} ${view.currency}`;
  const after =
    view.remainingMinor !== undefined && amountMinor !== undefined
      ? view.remainingMinor - amountMinor
      : undefined;
  const mode = refundModeOf(proposal.action) ?? "partial";

  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">{t("approval.payload.proposed")}</div>
          <div className="num mt-0.5 text-[26px] font-semibold leading-9 text-ink-strong">
            {money(amountMinor)}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <Badge tone={mode === "full" ? "warn" : "info"}>
              {mode === "full" ? t("refund.mode.fullLabel") : t("refund.mode.partialLabel")}
            </Badge>
            <span className="font-mono text-xs text-ink-muted">{view.currency}</span>
          </div>
        </div>
        <Wallet size={18} className="text-ink-faint" aria-hidden />
      </div>

      <dl className="mt-2.5">
        <Row label={t("approval.payload.capture")} value={<span className="font-mono">{view.captureId || "—"}</span>} />
        <Row label={t("approval.payload.original")} value={money(view.originalMinor)} />
        <Row label={t("approval.payload.refunded")} value={money(view.totalRefundedMinor)} />
        <Row label={t("approval.payload.remaining")} value={money(view.remainingMinor)} />
        <Row
          label={t("approval.payload.afterBalance")}
          value={
            <span>
              {money(after)}{" "}
              <span className="text-xs font-normal text-ink-faint">({t("rd.derived")})</span>
            </span>
          }
        />
      </dl>
      <p className="mt-1 text-xs leading-4 text-ink-faint">
        {t("approval.payload.afterBalanceNote")}
      </p>

      {synthetic ? (
        <p className="mt-2 inline-flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-bg/60 px-2.5 py-1.5 text-base font-medium leading-4 text-warn">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />
          {t("approval.payload.syntheticNote")}
        </p>
      ) : null}

      <div className="mt-2 rounded-md border border-warn-line bg-warn-bg/40 px-2.5 py-2">
        <p className="text-xs leading-4 text-ink">{t("refund.riskNote")}</p>
        <p className="mt-1 text-xs leading-4 text-ink-muted">{t("refund.boundNote")}</p>
      </div>

      <ExtraFields
        proposal={proposal}
        skip={[
          "Amount",
          "Refund amount",
          "Capture ID",
          "Capture id",
          "Currency",
          "Currency code",
          "Mode",
          "Request ID",
        ]}
      />
    </div>
  );
}

function GenericPayload({ proposal }: { proposal: ActionProposal }) {
  const { t } = useI18n();
  return (
    <div className="px-4 py-3.5">
      {proposal.payload.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("approval.payload.empty")}</p>
      ) : (
        <dl>
          {proposal.payload.map((field) => (
            <Row
              key={field.label}
              label={field.label}
              value={<span className="font-mono text-base">{field.value}</span>}
            />
          ))}
        </dl>
      )}
    </div>
  );
}

export function PayloadPreview({
  proposal,
  record,
  synthetic = false,
}: {
  proposal: ActionProposal;
  record: CaseRecord;
  /** Synthetic capture / offline replay: the refund moves no real funds. */
  synthetic?: boolean;
}) {
  const { t } = useI18n();
  const isRefund = isRefundAction(proposal.action);

  return (
    <Card className="overflow-hidden border-navy-100 shadow-card" data-testid="payload-preview">
      <Header proposal={proposal} />

      {proposal.action === "send-message" ? <SendMessagePayload proposal={proposal} /> : null}
      {proposal.action === "provide-evidence" ? <EvidencePayload proposal={proposal} /> : null}
      {isRefund ? (
        <RefundPayload proposal={proposal} record={record} synthetic={synthetic} />
      ) : null}
      {proposal.action !== "send-message" && proposal.action !== "provide-evidence" && !isRefund ? (
        <GenericPayload proposal={proposal} />
      ) : null}

      {proposal.payloadNote ? (
        <div className="flex items-start gap-2 border-t border-line bg-subtle px-4 py-2.5">
          <FileText size={11} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
          <p className="text-xs leading-4 text-ink-muted">
            <span className="font-medium text-ink">{t("approval.payload.note")}: </span>
            {proposal.payloadNote}
          </p>
        </div>
      ) : null}

      <Footer proposal={proposal} />
    </Card>
  );
}
