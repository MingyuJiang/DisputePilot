import { useSyncExternalStore } from "react";
import { disputePilot } from "../api";
import type { WorkspaceState } from "../api/store";

export const useWorkspace = (): WorkspaceState =>
  useSyncExternalStore(disputePilot.subscribe, disputePilot.getWorkspace, disputePilot.getWorkspace);
