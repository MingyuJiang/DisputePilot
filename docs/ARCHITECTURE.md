# Architecture and scope

React/TypeScript/Vite UI and FastAPI API share one local origin. SQLAlchemy
and SQLite persist cases, analyses, proposals, approvals, executions and audit.

V1–V12 validate dispute actions. A shared evidence-material policy is checked
at triage, single-case submission, approval and final execution. V13–V18
validate capture identity/status, exact amount/currency/balance, duplicates,
idempotency and separation from dispute adjudication.

The PayPal Sandbox adapters are in backend/app/adapters/paypal. Live hosts
are rejected by configuration. The release launcher always selects
offline_replay, disables writes and binds to 127.0.0.1. It ignores inherited
DP credentials, file overrides and database paths. No PayPal request is made.

The default AI provider replays four recorded model analyses (FROZEN_REPLAY).
The synthetic capture uses STUB_DETERMINISTIC. No fresh inference occurs;
model weights are not included. Local-model provider source and mocked
Sandbox integration tests are included for reproducibility and inspection.

REPLAYED is a local result, not a PayPal response. remote_readback=false means
remote confirmation is not applicable. Verification metadata is not a passing
validator finding. Frozen capture balances are not a live bank ledger.

Role headers simulate demo approval identities, not production authentication.
Public production deployment requires a separate security review.
