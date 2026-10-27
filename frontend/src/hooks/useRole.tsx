import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ROLE_STORAGE_KEY, readStoredRole } from "./roleStorage";

export type Role = "SPECIALIST" | "MANAGER";

export const ROLE_NAME: Record<Role, string> = {
  SPECIALIST: "Dana Whitfield",
  MANAGER: "Marcus Lindqvist",
};

interface RoleContextValue {
  role: Role;
  name: string;
  /** Localised role title key — components resolve it with `t()`. */
  setRole: (role: Role) => void;
}

const RoleContext = createContext<RoleContextValue>({
  role: "SPECIALIST",
  name: ROLE_NAME.SPECIALIST,
  setRole: () => undefined,
});

export function RoleProvider({ children }: { children: ReactNode }) {
  // The demo role is a presentation setting, persisted so a page reload (or a
  // full navigation) does not silently drop a manager back to specialist.
  const [role, setRole] = useState<Role>(() => readStoredRole());

  useEffect(() => {
    try {
      window.localStorage.setItem(ROLE_STORAGE_KEY, role);
    } catch {
      // A blocked storage must not break the demo.
    }
  }, [role]);

  const change = useCallback((next: Role) => setRole(next), []);

  const value = useMemo(
    () => ({
      role,
      name: ROLE_NAME[role],
      setRole: change,
    }),
    [role, change],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export const useRole = (): RoleContextValue => useContext(RoleContext);
