import type { ReactNode } from "react";

/**
 * v2.1: no longer a gate.
 *
 * The Specialist/Manager split was a demo affordance, not a security boundary.
 * Authorization lives in the backend: every business write still requires the
 * role that operation demands (`X-Actor-Role`), the deterministic Validator
 * still runs before submit/execute, and the audit trail is unchanged. The
 * merchant is the single decision maker in the product, so manager-only
 * surfaces are simply part of the workspace now.
 */
export function ManagerOnly({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
