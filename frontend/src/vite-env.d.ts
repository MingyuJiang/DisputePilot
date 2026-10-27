/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Service mode switch: "mock" (default) or "http" (Agent A backend). */
  readonly VITE_DP_API_MODE?: string;
  /** Backend base URL; defaults to http://127.0.0.1:8100/api/v1. */
  readonly VITE_DP_API_BASE?: string;
  /** Demo identity headers (non-production auth). */
  readonly VITE_DP_ACTOR_ID?: string;
  readonly VITE_DP_ACTOR_ROLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
