/**
 * Phase 3 UI acceptance tests — real-LLM loading / error / labelling.
 *
 * No network, no dev server, no browser automation: fetch is mocked and the
 * components are rendered with jsdom.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIIntelligencePanel } from "../src/components/domain/AIIntelligencePanel";
import { EvidenceDrawer } from "../src/components/domain/EvidenceDrawer";
import { AnalysisRunStatus } from "../src/components/domain/AnalysisRunStatus";
import { disputePilot } from "../src/api";
import { createHttpFacade } from "../src/api/http";
import { mapAnalysis } from "../src/api/mapping";
import { collectLlmCodes, type AnalysisErrorInfo } from "../src/api/errors";
import type { AIAnalysis, CaseRecord, EvidenceRecord, GroundedFact } from "../src/api/types";
import type { AnalysisRunState } from "../src/hooks/useAnalysisRun";

const CASE_ID = "O10";

const noop = (): void => undefined;

const baseFact: GroundedFact = {
  factId: "GF-O10-01",
  statement: "The buyer opened an INR dispute for the captured payment.",
  grounding: "VERIFIED_OBSERVATION",
  evidenceIds: ["E-O10-01"],
  basis: "dispute detail fixture",
};

const buildAnalysis = (overrides: Partial<AIAnalysis> = {}): AIAnalysis => ({
  analysisId: "ANL-O10-LLM-01",
  caseId: CASE_ID,
  generatedAt: "2026-10-18T10:00:00Z",
  status: "READY",
  summary: "INR dispute over a captured payment with no fulfillment proof on file.",
  requirements: [],
  facts: [baseFact],
  gaps: [],
  contradictions: [],
  recommendation: {
    action: "send-message",
    actionLabel: "Send message to buyer",
    rationale: ["The open requirement has no truthful material yet."],
    alternatives: [],
  },
  waitRule: { applies: false, reason: "A permitted action exists." },
  modelLabel: "ollama-local / qwen2.5-7b-instruct",
  analysisMode: "LLM",
  ...overrides,
});

const relatedEvidence: EvidenceRecord = {
  evidenceId: "E-O10-01",
  caseId: CASE_ID,
  type: "BUYER_STATEMENT",
  typeLabel: "Buyer statement",
  source: "dispute detail fixture",
  direction: "FROM_BUYER",
  grounding: "VERIFIED_OBSERVATION",
  provenance: "SCENARIO_DEFINED",
  available: true,
  excerpt: "The buyer states the parcel never arrived and paid 22.00 USD for the order.",
  supportedFactIds: ["GF-O10-01"],
  collectedAt: "2026-10-16T05:20:00Z",
  note: "Displayed verbatim from the scenario fixture.",
};

const renderPanel = (
  analysis: AIAnalysis | undefined,
  runState?: AnalysisRunState,
  onRetry = vi.fn(),
) => {
  const record = disputePilot.getCase(CASE_ID) as CaseRecord;
  return render(
    <AIIntelligencePanel
      record={record}
      analysis={analysis}
      evidence={[relatedEvidence]}
      requesting={runState?.status === "running"}
      runState={runState}
      onRunAnalysis={noop}
      onRetry={onRetry}
      onOpenEvidence={noop}
    />,
  );
};

describe("phase 3 UI — analysis loading and failures", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("shows an explicit processing state with phase copy and elapsed time", () => {
    const state: AnalysisRunState = {
      status: "running",
      phase: "inferring",
      elapsedMs: 12_400,
    };
    renderPanel(undefined, state);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Local model reasoning");
    expect(status).toHaveTextContent("12s elapsed");
    expect(status).toHaveTextContent(/No auto-retry/i);
    expect(status).toHaveTextContent(/15–30 s/);
    // The empty-state CTA must not invite a second run while one is in flight.
    expect(screen.queryByRole("button", { name: /Run AI analysis/i })).not.toBeInTheDocument();
  });

  it("renders a 503 DOMAIN_ERROR card without fabricating a successful analysis", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const error: AnalysisErrorInfo = {
      status: 503,
      code: "DOMAIN_ERROR",
      message: "Local model inference failed: the model did not answer before the deadline.",
      detailCodes: ["LLM_TIMEOUT"],
      kind: "unavailable",
      retryable: true,
    };
    renderPanel(
      undefined,
      { status: "failed", phase: "validating", elapsedMs: 120_000, error },
      onRetry,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Local model unavailable");
    expect(alert).toHaveTextContent("HTTP 503");
    expect(alert).toHaveTextContent("DOMAIN_ERROR");
    expect(alert).toHaveTextContent("LLM_TIMEOUT");
    expect(alert).toHaveTextContent(/did not answer before the deadline/);
    expect(alert).toHaveTextContent(/No result was invented/i);

    // No success surface anywhere: the failed card is the only outcome.
    expect(screen.queryByText(/Analysis completed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Grounded facts/i)).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: /Retry analysis/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Waiting does not trigger an automatic retry.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("never retries a 503 analysis run on its own and returns the backend error", async () => {
    let analysisCalls = 0;
    const fetchMock = (async () => {
      analysisCalls += 1;
      return new Response(
        JSON.stringify({
          error: {
            code: "DOMAIN_ERROR",
            message: "Local model unavailable (LLM_MODEL_UNAVAILABLE).",
            details: { code: "LLM_MODEL_UNAVAILABLE", provider: "ollama_local" },
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const facade = createHttpFacade({ baseUrl: "http://dp.test/api/v1", fetch: fetchMock });
    const outcome = await facade.runAnalysisRequest(CASE_ID, "Dana Whitfield");

    expect(outcome.ok).toBe(false);
    expect(outcome.analysis).toBeUndefined();
    expect(outcome.error?.status).toBe(503);
    expect(outcome.error?.code).toBe("DOMAIN_ERROR");
    expect(outcome.error?.detailCodes).toEqual(["LLM_MODEL_UNAVAILABLE"]);
    expect(outcome.error?.retryable).toBe(true);
    expect(analysisCalls).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(analysisCalls).toBe(1); // no hidden retry loop
  });

  it("labels a timed-out wait as TIMEOUT without retrying", async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      return new Promise<Response>(() => undefined); // never settles
    }) as unknown as typeof fetch;

    const facade = createHttpFacade({ baseUrl: "http://dp.test/api/v1", fetch: fetchMock });
    const outcome = await facade.runAnalysisRequest(CASE_ID, "Dana Whitfield", { timeoutMs: 20 });

    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe("TIMEOUT");
    expect(outcome.error?.kind).toBe("timeout");
    expect(calls).toBe(1);
  });

  it("extracts nested LLM_* codes from an error details payload", () => {
    expect(
      collectLlmCodes({
        code: "LLM_OUTPUT_TRUNCATED",
        nested: [{ reason: "LLM_SCHEMA_INVALID: missing field" }],
        ignored: "DOMAIN_ERROR",
      }),
    ).toEqual(["LLM_OUTPUT_TRUNCATED", "LLM_SCHEMA_INVALID"]);
  });
});

describe("phase 3 UI — real LLM labelling", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("distinguishes LOCAL_LLM from STUB_DETERMINISTIC and shows the model", () => {
    const { rerender } = renderPanel(buildAnalysis());
    expect(screen.getByText("LOCAL_LLM")).toBeInTheDocument();
    expect(screen.getByText("ollama-local / qwen2.5-7b-instruct")).toBeInTheDocument();
    expect(screen.getByText(/local model inference/)).toBeInTheDocument();

    rerender(
      <AIIntelligencePanel
        record={disputePilot.getCase(CASE_ID) as CaseRecord}
        analysis={buildAnalysis({
          analysisMode: "STUB_DETERMINISTIC",
          modelLabel: "deterministic-stub / evidence-planner-v1",
        })}
        evidence={[relatedEvidence]}
        requesting={false}
        onRunAnalysis={noop}
        onOpenEvidence={noop}
      />,
    );

    expect(screen.getByText("STUB_DETERMINISTIC")).toBeInTheDocument();
    expect(screen.queryByText("LOCAL_LLM")).not.toBeInTheDocument();
    expect(screen.getByText(/deterministic stub/)).toBeInTheDocument();
  });

  it("renders an UNVERIFIED_CLAIM as unverified, never as a verified fact", () => {
    renderPanel(
      buildAnalysis({
        facts: [
          {
            ...baseFact,
            factId: "GF-O10-UNVERIFIED",
            statement: "The seller shipped the parcel on 12 October.",
            grounding: "UNVERIFIED_CLAIM",
            evidenceIds: [],
            basis: "",
          },
        ],
        missingEvidence: ["tracking number for the parcel"],
      }),
    );

    expect(screen.getByText("Unverified claim")).toBeInTheDocument();
    expect(screen.getByText(/no supporting record was matched/i)).toBeInTheDocument();
    expect(screen.getByText(/must not be read as a verified fact/i)).toBeInTheDocument();
    expect(screen.queryByText("Verified observation")).not.toBeInTheDocument();
    expect(screen.getByText(/The seller shipped the parcel/)).toBeInTheDocument();
  });

  it("surfaces model uncertainty verbatim and marks it non-probabilistic", () => {
    renderPanel(buildAnalysis({ uncertainty: "medium" }));
    expect(screen.getByText(/Model-reported uncertainty/)).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
    expect(screen.getByText(/not a calibrated probability/i)).toBeInTheDocument();
  });

  it("highlights the backend evidence_span inside the drawer excerpt", () => {
    const fact: GroundedFact = {
      ...baseFact,
      evidenceSpan: "paid 22.00 USD for the order",
    };
    const { container } = render(
      <EvidenceDrawer
        evidence={relatedEvidence}
        facts={[fact]}
        focusFactId={fact.factId}
        onClose={noop}
        onRequest={noop}
      />,
    );

    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("paid 22.00 USD for the order");
    expect(screen.getByText(/Verbatim evidence span · GF-O10-01/)).toBeInTheDocument();
    expect(screen.getByText(/Supported claims/i)).toBeInTheDocument();
  });

  it("keeps the drawer unchanged when no evidence_span is provided", () => {
    const { container } = render(
      <EvidenceDrawer
        evidence={relatedEvidence}
        facts={[baseFact]}
        focusFactId={baseFact.factId}
        onClose={noop}
        onRequest={noop}
      />,
    );
    expect(container.querySelector("mark")).toBeNull();
    expect(screen.queryByText(/Verbatim evidence span/)).not.toBeInTheDocument();
  });

  it("carries LLM mode, uncertainty and evidence_span through the wire mapper", () => {
    const mapped = mapAnalysis(
      {
        analysis_id: "ANL-O10-LLM-01",
        case_id: CASE_ID,
        case_snapshot_hash: "f".repeat(64),
        factual_summary: "Local model summary.",
        grounded_facts: [
          {
            fact_id: "GF-1",
            statement: "The seller shipped the parcel.",
            fact_type: "UNVERIFIED_CLAIM",
            evidence_ids: ["E-O10-01"],
            provenance: "AI_INFERRED",
            evidence_span: "parcel never arrived",
          },
        ],
        missing_evidence: ["tracking number"],
        contradictions: [],
        recommendation: "send-message",
        safety_flags: ["LLM output reviewed by the trust layer"],
        model_provider: "ollama_local",
        model_name: "qwen2.5-7b-instruct",
        analysis_mode: "LLM",
        uncertainty: 0.42,
        created_at: "2026-10-18T10:00:00Z",
      },
      { evidence: [], requirements: [] },
    );

    expect(mapped.analysisMode).toBe("LLM");
    expect(mapped.uncertainty).toBe(0.42);
    expect(mapped.modelLabel).toBe("ollama_local / qwen2.5-7b-instruct");
    expect(mapped.facts[0]?.grounding).toBe("UNVERIFIED_CLAIM");
    expect(mapped.facts[0]?.evidenceSpan).toBe("parcel never arrived");
    expect(mapped.missingEvidence).toEqual(["tracking number"]);
  });
});

describe("phase 3 UI — run status copy", () => {
  it("renders nothing for idle and success states", () => {
    const { container, rerender } = render(
      <AnalysisRunStatus state={{ status: "idle", phase: "requesting", elapsedMs: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <AnalysisRunStatus
        state={{ status: "succeeded", phase: "validating", elapsedMs: 18_000 }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
