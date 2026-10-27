# PayPal and AI integration: implementation and evidence

Prepared on 27 October 2026 from the project's existing development reports and the accepted 1.0.0 release. This is a curated summary, not a new API trace or a new live test.

## What is included

The application combines a React merchant workspace, a FastAPI backend, evidence references, deterministic action validation, exact-payload human approval, a separate execution step, and a persistent audit trail.

The source contains the PayPal Sandbox adapters in `backend/app/adapters/paypal/` and the local model provider in `backend/app/adapters/local_llm/`. These are application components, not merely screenshots or test stubs. Mock transports are used separately in automated tests.

The public demo launcher intentionally runs offline. Four dispute analyses replay recorded model output; the synthetic payment capture uses a deterministic planner. The launcher disables payment writes, clears payment credentials, and selects its own local database. Setting provider or payment environment variables does not override this launcher. The offline demo is not a demonstration of a fresh PayPal request or model inference.

## Historical PayPal Sandbox integration

A development acceptance report dated 20 October 2026 records one `provide-evidence` Sandbox POST, HTTP 200, followed by two independent GET readbacks that matched the submitted seller notes. The report records the exact-payload approval, action validation, a single-attempt execution, and the subsequent audit events. Payment writes were disabled again afterward.

Recorded fingerprints:

- Approved payload SHA-256: `0c7d7218dd12e003c294ad75746a5b0598e752314f70bf4925b8e3038b8b9439`.
- Submitted body SHA-256: `37dc78b0ec2dfc256b2ee0b496aa3f1b4308acb0c15599e338ee74eb994d1873`.
- Response fingerprint SHA-256: `470c4a09c99fd32a30275ec361729d480b7d2efe2e77539bd4829715a22db470`.

These fingerprints identify records described in the internal acceptance report; hashes alone do not independently prove a remote event. Raw responses, account credentials, and merchant runtime databases are not included in this summary. This historical test demonstrates evidence submission and readback, not a won dispute, adjudication, production readiness, or verified real refunds or messages in the public demo.

## Historical local AI integration

A development report dated 18 October 2026 records real inference through FastAPI using a loopback Ollama provider and the model tag `qwen3.6:35b-a3b-q4_K_M`. One reported warm request completed in 13.4 seconds and produced 1,499 output tokens. This is a single development observation, not a general latency guarantee or an accuracy benchmark.

The model drafts an analysis. Application code validates its structure and evidence references and derives trusted safety fields outside the model. The grounding layer checks reference existence and verbatim support; this is not a proof of semantic entailment. A deterministic validator can reject an illegal action, but cannot guarantee the model selected the best legal action.

The AI provider is optional. The accepted release's real-model smoke test was skipped when Ollama was unavailable. The separately maintained synthetic holdout's rule-based scores must not be presented as model accuracy.

## Reproduction and access

For the default working demo, follow the repository README. Python and Node are needed; first setup downloads dependencies. PayPal credentials, model weights, and a GPU are not needed for offline replay.

For integration review, inspect the local-provider configuration and PayPal configuration modules and their tests. Optional real inference requires a separately installed Ollama runtime and the model; optional Sandbox access requires the reviewer's own authorized Sandbox application. Credentials and weights are not distributed with the application. The safe demo launcher is not a real-integration launcher. See the [integration guide](LIVE_INTEGRATION.md) for direct-backend configuration and [validation status](VALIDATION.md) for what was checked in this publication. Current publication checks do not rerun remote Sandbox operations or real inference.

## Evidence provenance

This summary was prepared from internal development acceptance reports dated
18 October (local AI), 20 October (PayPal Sandbox), and 25 October 2026
(offline release). Those reports and raw traces are retained privately and
are not included in this repository. The fingerprints above identify records
described in those reports; they are not a substitute for independently
inspectable remote responses. This repository's automated tests use mocked
payment transports, and the default demo runs offline.
