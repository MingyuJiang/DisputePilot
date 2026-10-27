/**
 * Capture status (contract v1.3, hidden demo endpoint).
 *
 * `GET /api/v1/payments/captures/{capture_id}` returns the authoritative
 * capture snapshot for a PAYMENT case. Amounts are decimal strings — the UI
 * renders them verbatim and never re-computes them, so no float rounding can
 * drift between the backend snapshot and the screen.
 *
 * `source=SYNTHETIC_OFFLINE_FIXTURE` means the capture exists only in the
 * offline demo fixture: it is not a PayPal capture and no funds move.
 */

import type { CaseRecord } from "./types";

export const CAPTURE_SOURCE_SYNTHETIC = "SYNTHETIC_OFFLINE_FIXTURE";

export interface CaptureStatus {
  captureId: string;
  /** Backend capture status (COMPLETED / PENDING / REFUNDED / …). Never a refund status. */
  status: string;
  /** Decimal string, exactly as returned by the backend. */
  originalAmount: string;
  totalRefunded: string;
  refundableRemaining: string;
  currencyCode: string;
  /** Provenance of the capture record (SYNTHETIC_OFFLINE_FIXTURE / …). */
  source: string;
}

export interface CaptureStatusError {
  status: number;
  code: string;
  message: string;
}

export type CaptureStatusOutcome =
  | { ok: true; capture: CaptureStatus }
  | { ok: false; error: CaptureStatusError };

/** Contract v1.2 case-id form for a capture-level case. */
export const isCaptureCaseId = (caseId: string): boolean =>
  caseId.trim().toUpperCase().startsWith("CAP-");

export const isSyntheticCapture = (capture?: CaptureStatus): boolean =>
  (capture?.source ?? "").trim().toUpperCase() === CAPTURE_SOURCE_SYNTHETIC;

/** Amounts stay strings; the currency is appended, never parsed or converted. */
export const formatCaptureAmount = (amount: string, currency: string): string =>
  `${amount} ${currency}`;

/**
 * Capture id used for the read.
 *
 * The case's own capture reference wins (A's offline demo case
 * `CAP-DEMO-9001` points at capture `DEMO-CAP-9001`). Only when the backend
 * reported no usable reference does the `CAP-<capture_id>` case-id form apply.
 * Nothing is guessed beyond that contract form.
 */
export const captureReferenceFor = (
  record: Pick<CaseRecord, "caseId" | "transaction">,
): string => {
  const ref = (record.transaction.captureRef ?? "").trim();
  if (ref && ref.toUpperCase() !== "UNKNOWN") return ref;
  const caseId = record.caseId.trim();
  return isCaptureCaseId(caseId) ? caseId.slice(4) : caseId;
};

export interface WireCaptureStatus {
  capture_id?: string;
  status?: string;
  original_amount?: string;
  total_refunded?: string;
  refundable_remaining?: string;
  currency_code?: string;
  source?: string;
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

/**
 * Map the wire body. A missing field makes the record unusable — the panel
 * then says the capture was not read instead of inventing a value.
 */
export const mapCaptureStatus = (wire: WireCaptureStatus): CaptureStatus | undefined => {
  const captureId = text(wire.capture_id);
  const status = text(wire.status);
  const originalAmount = text(wire.original_amount);
  const totalRefunded = text(wire.total_refunded);
  const refundableRemaining = text(wire.refundable_remaining);
  const currencyCode = text(wire.currency_code);
  if (
    !captureId ||
    !status ||
    !originalAmount ||
    !totalRefunded ||
    !refundableRemaining ||
    !currencyCode
  ) {
    return undefined;
  }
  return {
    captureId,
    status,
    originalAmount,
    totalRefunded,
    refundableRemaining,
    currencyCode,
    source: text(wire.source),
  };
};
