import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

/**
 * Single merchant identity (v2.1 personal-merchant product mode).
 *
 * The product has exactly one user: the merchant. The previous
 * Specialist/Manager switch is gone from the UI — a merchant should not have to
 * understand internal roles to process a dispute.
 *
 * Safety is NOT weakened by this. The backend still enforces its role model per
 * operation (`X-Actor-Role`), and the HTTP service layer still attaches the
 * correct role to every call:
 *
 *   analysis / plan / submit      → SPECIALIST   (unchanged)
 *   approval decision / replay    → MANAGER      (unchanged)
 *   demo reset                    → SYSTEM       (unchanged)
 *
 * So the merchant sees one workspace while every business write keeps its
 * original authorization record, validator run and audit trail. `id` is the
 * actor id recorded in audit events for actions the merchant takes.
 */

export interface MerchantIdentity {
  /** Actor id recorded in audit events for merchant-initiated actions. */
  id: string;
  /** i18n key for the display name (resolved by components with `t()`). */
  nameKey: "merchant.name";
  /** Two-letter avatar initials. */
  initials: string;
}

export const MERCHANT: MerchantIdentity = {
  id: "merchant",
  nameKey: "merchant.name",
  initials: "ME",
};

interface MerchantContextValue {
  merchant: MerchantIdentity;
}

const MerchantContext = createContext<MerchantContextValue>({ merchant: MERCHANT });

export function MerchantProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => ({ merchant: MERCHANT }), []);
  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

/** The one and only product user. Never a role switch. */
export const useMerchant = (): MerchantContextValue => useContext(MerchantContext);
