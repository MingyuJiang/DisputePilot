/**
 * Analysis run state machine.
 *
 * Real local-model analysis takes 15–30 s (cold load longer), so the UI needs
 * an explicit, phase-labelled waiting state instead of a 650 ms fake timer.
 * The hook owns only presentation state:
 *
 *  - one run at a time; a second click while running is ignored;
 *  - a failed run stays failed until the operator clicks retry;
 *  - NO automatic retry, no mock fallback, no synthetic success.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeAnalysisError, type AnalysisErrorInfo, type AnalysisRunOutcome } from "../api/errors";

export type AnalysisPhase = "requesting" | "inferring" | "validating";

export interface AnalysisRunState {
  status: "idle" | "running" | "succeeded" | "failed";
  phase: AnalysisPhase;
  elapsedMs: number;
  error?: AnalysisErrorInfo;
  /** Timestamp of the last completed run (ms) — used to key success toasts. */
  finishedAt?: number;
}

export const IDLE_ANALYSIS_RUN: AnalysisRunState = {
  status: "idle",
  phase: "requesting",
  elapsedMs: 0,
};

/**
 * Phase copy is derived from elapsed time only. The backend does not stream
 * progress, so these are honest time bands, not invented server states.
 * The copy itself lives in the i18n dictionary (`phase.*`).
 */
export const phaseForElapsed = (elapsedMs: number): AnalysisPhase => {
  if (elapsedMs < 2_500) return "requesting";
  if (elapsedMs < 20_000) return "inferring";
  return "validating";
};

export interface UseAnalysisRunOptions {
  caseId: string;
  actor: string;
  run: (caseId: string, actor: string) => Promise<AnalysisRunOutcome>;
  onSuccess?: (outcome: AnalysisRunOutcome) => void;
}

export interface UseAnalysisRunResult {
  state: AnalysisRunState;
  start: () => Promise<void>;
  reset: () => void;
}

export const useAnalysisRun = ({
  caseId,
  actor,
  run,
  onSuccess,
}: UseAnalysisRunOptions): UseAnalysisRunResult => {
  const [state, setState] = useState<AnalysisRunState>(IDLE_ANALYSIS_RUN);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<number | undefined>(undefined);
  const generationRef = useRef(0);
  const runRef = useRef(run);
  const successRef = useRef(onSuccess);
  runRef.current = run;
  successRef.current = onSuccess;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== undefined) window.clearInterval(timerRef.current);
    };
  }, []);

  // A different case invalidates the previous run state (no stale error card).
  useEffect(() => {
    generationRef.current += 1;
    setState(IDLE_ANALYSIS_RUN);
  }, [caseId]);

  const clearTimer = (): void => {
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  };

  const start = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    const startedAt = Date.now();
    const generation = generationRef.current;

    setState({ status: "running", phase: "requesting", elapsedMs: 0 });
    timerRef.current = window.setInterval(() => {
      if (!mountedRef.current) return;
      const elapsedMs = Date.now() - startedAt;
      setState((current) =>
        current.status === "running"
          ? { status: "running", phase: phaseForElapsed(elapsedMs), elapsedMs }
          : current,
      );
    }, 500);

    try {
      const outcome = await runRef.current(caseId, actor);
      if (!mountedRef.current || generation !== generationRef.current) return;
      clearTimer();
      if (outcome.ok && outcome.analysis) {
        setState({
          status: "succeeded",
          phase: "validating",
          elapsedMs: Date.now() - startedAt,
          finishedAt: Date.now(),
        });
        successRef.current?.(outcome);
      } else {
        setState({
          status: "failed",
          phase: "validating",
          elapsedMs: Date.now() - startedAt,
          error:
            outcome.error ??
            normalizeAnalysisError(new Error("The analysis run failed without an error payload.")),
          finishedAt: Date.now(),
        });
      }
    } finally {
      runningRef.current = false;
      if (!mountedRef.current) clearTimer();
    }
  }, [caseId, actor]);

  const reset = useCallback((): void => {
    if (runningRef.current) return;
    clearTimer();
    setState(IDLE_ANALYSIS_RUN);
  }, []);

  return { state, start, reset };
};
