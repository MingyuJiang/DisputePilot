/**
 * Send-message action card (case workspace).
 *
 * This is the only place a specialist authors the buyer-facing text. It:
 *  - refuses to enable submission without a `send_message` link (reason shown);
 *  - blocks an empty or over-2000-character message;
 *  - shows the grounded facts / cited evidence and warns about missing evidence;
 *  - previews the plain text with line breaks preserved;
 *  - submits a NEW proposal for the exact text (never edits an approved one).
 *
 * Nothing here sends a message. A manager approves the payload hash, and the
 * execution result is confirmed only by a verbatim match in the remote
 * messages[] list (see `SendMessagePreview`).
 */

import { useEffect, useMemo, useState } from "react";
import {
  FileWarning,
  Lock,
  MessageSquare,
  PenLine,
  Send,
  Sparkles,
} from "lucide-react";
import type { AnalysisErrorInfo, ProposalGenerationOutcome } from "../../api/errors";
import type {
  ActionProposal,
  AIAnalysis,
  CaseRecord,
  EvidenceRecord,
  GroundedFact,
  HateoasLink,
} from "../../api/types";
import { canPrepare, type NextStepRole } from "../../lib/nextStep";
import {
  MESSAGE_MAX_LENGTH,
  countMessageChars,
  draftBasis,
  isSendMessageLocked,
  latestSendMessageProposal,
  messageBodyOf,
  sendMessageAvailability,
  validateMessage,
  type SendMessageComposerDraft,
} from "../../lib/sendMessage";
import { evidenceTypeLabel, useI18n } from "../../i18n";
import { BackendErrorNotice } from "./BackendErrorNotice";
import { GroundingBadge, ProposalStateBadge } from "./Badges";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { useToast } from "../ui/Toast";

const factBasis = (facts: GroundedFact[]): string[] =>
  facts
    .map((fact) => fact.statement)
    .filter((statement) => statement.trim().length > 0)
    .slice(0, 3);

export interface SendMessageCardProps {
  record: CaseRecord;
  analysis?: AIAnalysis;
  evidence: EvidenceRecord[];
  proposals: ActionProposal[];
  role: NextStepRole;
  /** Fallback link set when the case carries no `availableActions` (mock mode). */
  fallbackLinks?: HateoasLink[];
  onOpenEvidence: (evidenceId: string) => void;
  onSubmit: (draft: SendMessageComposerDraft) => Promise<ProposalGenerationOutcome>;
}

export function SendMessageCard({
  record,
  analysis,
  evidence,
  proposals,
  role,
  fallbackLinks = [],
  onOpenEvidence,
  onSubmit,
}: SendMessageCardProps) {
  const { t } = useI18n();
  const toast = useToast();

  const latest = latestSendMessageProposal(proposals);
  const draftFromProposal = messageBodyOf(latest);
  const linkSet = record.availableActions ?? (fallbackLinks.length > 0 ? fallbackLinks : latest?.hateoas.links ?? []);
  const availability = sendMessageAvailability(record, linkSet);

  const [text, setText] = useState(draftFromProposal);
  const [revision, setRevision] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AnalysisErrorInfo | undefined>(undefined);

  // A new proposal (or a new case) defines the draft; typing never resets it.
  useEffect(() => {
    setText(draftFromProposal);
    setRevision(false);
    setError(undefined);
  }, [record.caseId, latest?.proposalId, draftFromProposal]);

  const charCount = countMessageChars(text);
  const messageCheck = validateMessage(text);
  const locked = Boolean(latest && isSendMessageLocked(latest.state) && !revision);
  // RC-3: drafting needs `canPrepare`; approving needs `canAuthorize`. The
  // merchant holds both, so the form is editable and the approve path still
  // works. The backend keeps enforcing the role on each call.
  const mayPrepare = canPrepare(role);
  const canEdit = availability.enabled && !locked && mayPrepare;
  const canSubmit = canEdit && messageCheck.ok && Boolean(analysis) && !submitting;

  const facts = useMemo(
    () => draftBasis(latest, analysis?.facts ?? []).slice(0, 6),
    [latest, analysis],
  );
  const citedEvidenceIds = useMemo(() => {
    if (latest && latest.evidenceIds.length > 0) return latest.evidenceIds;
    return [...new Set(facts.flatMap((fact) => fact.evidenceIds))];
  }, [latest, facts]);
  const gaps = analysis?.missingEvidence ?? [];

  const unavailableReason = !availability.enabled
    ? availability.reason === "stage"
      ? t("sendMessage.reason.stage", { stage: availability.stage })
      : availability.reason === "link_unavailable"
        ? t("sendMessage.reason.linkUnavailable")
        : t("sendMessage.reason.noLink")
    : null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(undefined);
    const outcome = await onSubmit({
      message: text,
      rationale: factBasis(facts),
      evidenceIds: citedEvidenceIds,
    });
    setSubmitting(false);
    if (!outcome.ok || !outcome.proposal) {
      setError(outcome.error);
      toast.push({
        tone: "warning",
        title: t("sendMessage.toast.failed"),
        detail: outcome.error?.message,
      });
      return;
    }
    toast.push({
      tone: "success",
      title: t("sendMessage.toast.created"),
      detail: t("sendMessage.toast.createdDetail", {
        proposalId: outcome.proposal.proposalId,
        hash: outcome.proposal.payloadHash ?? "",
      }),
    });
    setRevision(false);
  };

  return (
    <Card className="overflow-hidden" data-testid="send-message-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-ink-muted" aria-hidden />
            <div className="text-sm font-semibold text-ink-strong">{t("sendMessage.title")}</div>
            <Badge tone={availability.enabled ? "pass" : "stop"} dot>
              {t(availability.enabled ? "sendMessage.available" : "sendMessage.unavailable")}
            </Badge>
          </div>
          <p className="mt-1 max-w-[720px] text-base leading-4 text-ink-muted">
            {t("sendMessage.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{record.lifecycleStage}</Badge>
          {latest ? <ProposalStateBadge state={latest.state} /> : null}
        </div>
      </div>

      {!availability.enabled ? (
        <div role="status" className="border-b border-stop-line bg-stop-bg px-4 py-3">
          <div className="flex items-start gap-2">
            <Lock size={14} className="mt-0.5 shrink-0 text-stop" aria-hidden />
            <div>
              <div className="text-base font-semibold text-stop">{t("sendMessage.unavailable")}</div>
              <p className="mt-0.5 text-base leading-4 text-ink">{unavailableReason}</p>
              {availability.link?.basis ? (
                <p className="mt-1 text-xs leading-4 text-ink-muted">
                  {t("sendMessage.basisNote", { basis: availability.link.basis })}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : availability.link.basis ? (
        <div className="border-b border-line bg-subtle px-4 py-1.5">
          <p className="text-xs leading-4 text-ink-faint">
            {t("sendMessage.basisNote", { basis: availability.link.basis })}
          </p>
        </div>
      ) : null}

      {!mayPrepare ? (
        <div className="border-b border-info-line bg-info-bg px-4 py-2.5">
          <p className="text-base leading-4 text-ink">{t("sendMessage.managerOnly")}</p>
        </div>
      ) : null}

      {locked && latest ? (
        <div className="border-b border-warn-line bg-warn-bg px-4 py-2.5">
          <div className="flex items-start gap-2">
            <Lock size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="min-w-0">
              <div className="text-base font-semibold text-warn">{t("sendMessage.lockedTitle")}</div>
              <p className="mt-0.5 text-base leading-4 text-ink">
                {t("sendMessage.lockedBody", { proposalId: latest.proposalId })}
              </p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => setRevision(true)}>
                <PenLine size={12} aria-hidden />
                {t("sendMessage.revise")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {revision ? (
        <div className="border-b border-line bg-subtle px-4 py-2">
          <button
            type="button"
            className="text-xs font-medium text-navy-700 hover:text-navy-800"
            onClick={() => {
              setRevision(false);
              setText(draftFromProposal);
            }}
          >
            {t("sendMessage.cancelRevise")}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 divide-y divide-line">
        <div className="min-w-0 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-infer" aria-hidden />
              <span className="eyebrow">{t("sendMessage.draftTitle")}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-ink-faint">
              {draftFromProposal ? (
                <>
                  <span className="num">
                    {t("sendMessage.draftFrom", { proposalId: latest?.proposalId ?? "" })}
                  </span>
                  {draftFromProposal !== text ? (
                    <button
                      type="button"
                      className="font-medium text-navy-700 hover:text-navy-800"
                      onClick={() => setText(draftFromProposal)}
                    >
                      {t("sendMessage.loadDraft")}
                    </button>
                  ) : null}
                </>
              ) : (
                <span>{t("sendMessage.draftNone")}</span>
              )}
            </div>
          </div>

          <label htmlFor="send-message-text" className="mt-3 block text-base font-medium text-ink">
            {t("sendMessage.editorLabel")}
          </label>
          <textarea
            id="send-message-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={9}
            disabled={!canEdit}
            placeholder={t("sendMessage.placeholder")}
            className="mt-1 w-full resize-y rounded-md border border-line bg-card px-3 py-2 text-base leading-5 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-navy-600 disabled:bg-subtle disabled:text-ink-muted"
          />

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span
              data-testid="send-message-counter"
              className={[
                "num text-xs",
                messageCheck.ok ? "text-ink-faint" : "text-stop",
              ].join(" ")}
            >
              {t("sendMessage.counter", { count: charCount, max: MESSAGE_MAX_LENGTH })}
            </span>
            <span className="text-xs text-ink-faint">{t("sendMessage.editorHint")}</span>
          </div>

          {!messageCheck.ok ? (
            <p className="mt-1 text-xs leading-4 text-stop">
              {messageCheck.reason === "empty"
                ? t("sendMessage.error.empty")
                : t("sendMessage.error.tooLong", { max: MESSAGE_MAX_LENGTH })}
            </p>
          ) : null}

          {!analysis ? (
            <p className="mt-2 rounded-md border border-warn-line bg-warn-bg/60 px-2.5 py-2 text-xs leading-4 text-ink">
              {t("sendMessage.noAnalysis")}
            </p>
          ) : null}

          {latest?.state === "AWAITING_APPROVAL" ? (
            <p className="mt-2 rounded-md border border-warn-line bg-warn-bg/60 px-2.5 py-2 text-xs leading-4 text-ink">
              {t("sendMessage.pendingWarning")}
            </p>
          ) : null}

          {error ? (
            <div className="mt-2">
              <BackendErrorNotice error={error} titleKey="sendMessage.errorTitle" />
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              loading={submitting}
              aria-label={t("sendMessage.submitAria")}
            >
              <Send size={13} aria-hidden />
              {t("action.submit")}
            </Button>
            <span className="text-xs text-ink-faint">{t("sendMessage.submitNote")}</span>
          </div>
        </div>

        <div className="min-w-0 px-4 py-3">
          <div className="eyebrow">{t("sendMessage.previewTitle")}</div>
          <div className="mt-1.5 min-h-[72px] rounded-md border border-line bg-subtle px-3 py-2.5">
            {text.trim().length > 0 ? (
              <p
                data-testid="send-message-preview"
                className="whitespace-pre-wrap break-words text-base leading-5 text-ink"
              >
                {text}
              </p>
            ) : (
              <p className="text-base text-ink-faint">{t("sendMessage.previewEmpty")}</p>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-faint">{t("sendMessage.previewNote")}</p>

          <div className="mt-3 border-t border-line pt-2.5">
            <div className="eyebrow">{t("sendMessage.factsTitle")}</div>
            {facts.length > 0 ? (
              <ul className="mt-1 space-y-1.5">
                {facts.map((fact) => (
                  <li key={fact.factId} className="flex items-start gap-1.5">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
                    <span className="min-w-0 flex-1 text-xs leading-4 text-ink">{fact.statement}</span>
                    <GroundingBadge grounding={fact.grounding} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs leading-4 text-ink-faint">{t("sendMessage.factsEmpty")}</p>
            )}
          </div>

          {citedEvidenceIds.length > 0 ? (
            <div className="mt-3 border-t border-line pt-2.5">
              <div className="eyebrow">{t("sendMessage.evidenceTitle")}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {citedEvidenceIds.map((id) => {
                  const item = evidence.find((entry) => entry.evidenceId === id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onOpenEvidence(id)}
                      className="inline-flex items-center gap-1.5 rounded border border-line bg-card px-1.5 py-1 text-xs text-ink transition-colors hover:border-navy-600 hover:bg-navy-50"
                      title={item ? evidenceTypeLabel(item.type, item.typeLabel, t) : id}
                    >
                      <span className="font-mono">{id}</span>
                      {item ? (
                        <>
                          <span className="text-ink-faint">·</span>
                          <span className="max-w-[110px] truncate text-ink-muted">
                            {evidenceTypeLabel(item.type, item.typeLabel, t)}
                          </span>
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {gaps.length > 0 ? (
            <div className="mt-3 rounded-md border border-warn-line bg-warn-bg/70 px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-base font-semibold text-warn">
                <FileWarning size={12} aria-hidden />
                {t("sendMessage.gapsTitle")}
              </div>
              <p className="mt-0.5 text-xs leading-4 text-ink">
                {t("sendMessage.gapsBody", { items: gaps.join("; ") })}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
