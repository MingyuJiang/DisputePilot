import { useSyncExternalStore } from "react";
import { getRuntime, subscribeRuntime, type RuntimeState } from "../api/runtime";

/** Sandbox mode / connection state reported by GET /health (or the local bundle). */
export const useRuntime = (): RuntimeState =>
  useSyncExternalStore(subscribeRuntime, getRuntime, getRuntime);
