import type { AuditEvent } from "../api/types";
import type { MessageKey, TranslateParams } from "../i18n";

type Translator = (key: MessageKey, params?: TranslateParams) => string;

/**
 * Audit titles are adapter-generated chrome: render the dictionary key when the
 * event carries one, otherwise keep the fixture text verbatim. The technical
 * event name (`action` / `backendEventType`) is rendered separately and is
 * never translated.
 */
export const auditSummary = (event: AuditEvent, t: Translator): string =>
  event.summaryKey
    ? t(event.summaryKey as MessageKey, event.summaryParams as TranslateParams | undefined)
    : event.summary;

export const auditDetail = (event: AuditEvent, t: Translator): string =>
  event.detailKey
    ? t(event.detailKey as MessageKey, event.detailParams as TranslateParams | undefined)
    : event.detail;
