import { getActiveLang, intlLocale, type Lang } from "../i18n/locale";
import { translate } from "../i18n/messages";

export const formatMoney = (minor: number, currency = "USD", lang: Lang = getActiveLang()): string =>
  new Intl.NumberFormat(intlLocale(lang), {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);

export const formatDateTime = (iso: string, lang: Lang = getActiveLang()): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(lang), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

export const formatDate = (iso: string, lang: Lang = getActiveLang()): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(lang), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

/** HH:mm:ss only — used for "last read" where the full timestamp stays in title. */
export const formatClock = (iso: string, lang: Lang = getActiveLang()): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(lang), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
};

export const formatRelative = (iso: string, lang: Lang = getActiveLang()): string => {
  const date = new Date(iso).getTime();
  if (Number.isNaN(date)) return iso;
  const diffMinutes = Math.round((Date.now() - date) / 60000);
  if (diffMinutes < 1) return translate(lang, "time.justNow");
  if (diffMinutes < 60) return translate(lang, "time.minutesAgo", { count: diffMinutes });
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return translate(lang, "time.hoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  return translate(lang, "time.daysAgo", { count: days });
};

/** Duration shown in the approval queue (queued time), localised units. */
export const formatWaiting = (minutes: number, lang: Lang = getActiveLang()): string => {
  if (minutes < 60) return translate(lang, "time.minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? translate(lang, "time.hours", { hours })
    : translate(lang, "time.hoursMinutes", { hours, minutes: rest });
};

export const percent = (value: number, total: number): number =>
  total <= 0 ? 0 : Math.min(100, Math.round((value / total) * 100));

export const FAMILY_LABEL: Record<string, string> = {
  INR: "INR",
  SNAD: "SNAD",
  BILLING: "Billing",
};

export const FAMILY_LONG: Record<string, string> = {
  INR: "Item not received",
  SNAD: "Not as described",
  BILLING: "Billing issue",
};

export const ACTION_SHORT: Record<string, string> = {
  "send-message": "Send message",
  "provide-evidence": "Provide evidence",
  "make-offer": "Make offer",
  "accept-claim": "Accept claim",
  escalate: "Escalate",
  "provide-supporting-info": "Provide info",
  wait: "Wait",
};
