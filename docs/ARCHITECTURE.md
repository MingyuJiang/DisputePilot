# Architecture

React/TypeScript/Vite provides the merchant workspace. FastAPI serves the API
and prebuilt UI on one loopback origin. SQLAlchemy and SQLite persist cases,
analyses, proposals, approvals, execution records, and the audit trail.

## Independent data and AI providers

`DP_DATA_MODE` selects synthetic replay data or authorized PayPal Sandbox data.
`DP_AI_PROVIDER` independently selects recorded analysis (`frozen`), deterministic
planning (`stub`), or real loopback Ollama inference (`ollama_local`).

The default demo launcher selects offline data and frozen analysis, fixes its
own database path, and disables PayPal access. Optional combinations use the
same application directly with explicit environment configuration. The direct
backend's provider default is `stub`; the demo launcher overrides it to `frozen`.
See the [README](../README.md) and [Integration options](LIVE_INTEGRATION.md).

PayPal adapters live in `backend/app/adapters/paypal/`; the model provider lives
in `backend/app/adapters/local_llm/`. Production PayPal hosts are rejected and
the Ollama transport accepts only loopback URLs. Model weights and credentials
are not distributed.

## Approval and execution

The workflow separates analysis, proposal creation, deterministic validation,
exact-payload approval, execution, and readback/audit. V1–V12 validate dispute
actions; V13–V18 validate capture identity, amount/currency/balance, duplicates,
and idempotency. The shared evidence policy is checked again at submission,
approval, and execution.

PayPal writes require explicit settings and per-case/action allow-listing in
addition to approval. The documented Sandbox quick start leaves them disabled.
AI inference itself cannot authorize or execute a financial action.

## Result semantics

`REPLAYED` is a local simulated result. In the offline demo, remote readback is
not applicable, frozen capture balances are not a live ledger, and verification
metadata is not a passing validator finding. Four dispute analyses are recorded
outputs; the synthetic capture uses deterministic planning.

Role headers are simulated demo identities, not production authentication. Keep
the service on loopback. See [Validation status](VALIDATION.md) for supported and
unverified deployment/operation claims.
