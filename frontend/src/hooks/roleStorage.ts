export const ROLE_STORAGE_KEY = "dp.demo.role";

export type StoredRole = "SPECIALIST" | "MANAGER";

const isRole = (value: string | null): value is StoredRole =>
  value === "SPECIALIST" || value === "MANAGER";

/** Persisted demo role; defaults to SPECIALIST, never throws. */
export const readStoredRole = (): StoredRole => {
  try {
    const stored = window.localStorage.getItem(ROLE_STORAGE_KEY);
    return isRole(stored) ? stored : "SPECIALIST";
  } catch {
    return "SPECIALIST";
  }
};
