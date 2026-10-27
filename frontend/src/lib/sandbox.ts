/**
 * Sandbox provenance helpers (pure, testable).
 *
 * The UI may only quote timestamps the backend actually supplied:
 *  - `live_status_note` (contract §2) for a sandbox read;
 *  - otherwise the latest CASE_IMPORTED audit event.
 * Nothing here invents a read time.
 */

import type { AuditEvent, CaseRecord } from "../api/types";

const ISO_RE =
  /(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))/;

export const extractIsoTimestamp = (text?: string): string | undefined => {
  if (!text) return undefined;
  return text.match(ISO_RE)?.[1];
};

const LAST_SUCCESSFUL_READ_RE = /last_successful_read\s*=\s*([^\s;,]+)/i;

/** Backend-reported remote read time (`last_successful_read=<ISO>`), if any. */
export const extractLastSuccessfulRead = (note?: string): string | undefined => {
  const raw = note?.match(LAST_SUCCESSFUL_READ_RE)?.[1];
  if (!raw) return undefined;
  return extractIsoTimestamp(raw);
};

export const remoteStatusFromNote = (note?: string): string | undefined => {
  if (!note) return undefined;
  return note.match(/remote\s+status\s*=\s*([A-Z0-9_]+)/i)?.[1];
};

export type ReadTimeSource = "live_status_note" | "case_imported" | "none";

export interface CaseReadTime {
  at?: string;
  source: ReadTimeSource;
}

/** live_status_note wins; the newest CASE_IMPORTED event is the fallback. */
export const latestCaseReadTime = (
  record: Pick<CaseRecord, "liveStatusNote">,
  audit: AuditEvent[],
): CaseReadTime => {
  const fromNote = extractIsoTimestamp(record.liveStatusNote);
  if (fromNote) return { at: fromNote, source: "live_status_note" };

  const imported = audit
    .filter((event) => event.action === "CASE_IMPORTED")
    .map((event) => event.at)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));

  return imported[0]
    ? { at: imported[0], source: "case_imported" }
    : { source: "none" };
};

/** Newest CASE_IMPORTED across the workspace (health fallback is separate). */
export const latestImportedAt = (audit: AuditEvent[]): string | undefined =>
  audit
    .filter((event) => event.action === "CASE_IMPORTED")
    .map((event) => event.at)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0];
