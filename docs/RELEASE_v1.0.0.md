## DisputePilot 1.0.0

An evidence-grounded dispute workspace with case analysis, evidence references,
action validation, exact-payload human approval, separate execution, and an
auditable history. React/TypeScript and FastAPI use SQLite persistence.

### Offline Demo

Download the source archive or clone this repository, then run `start.bat`
(Windows) or `bash start.sh`. Requirements: Python 3.11+ and Node.js 20.19+ or
22.12+ with npm; first setup downloads dependencies. Five synthetic cases,
four frozen analyses, and a deterministic capture planner run without payment
credentials, a GPU, or model weights. No real message, evidence submission,
refund, funds movement, or fresh model inference occurs in this mode.

### Connected integration from the same source

PayPal Sandbox adapters and the loopback Ollama AI provider remain included.
Use `.env.example` and `docs/LIVE_INTEGRATION.md` for the optional direct-backend
entry point. The default launchers enforce offline mode and do not enable
connected access through environment overrides. Use your own local credentials
and separately installed model; Sandbox access is read-only by default.
Real model inference and payment execution are distinct paths. Production
payment hosts are rejected; this is not a production merchant service.

### Validation

For publication on 27 October 2026: backend **428 passed, 1 real-model test
deselected**; frontend **236 passed**; TypeScript and Vite build passed; offline
and no-credential Sandbox configuration smoke checks passed. No real model or
PayPal request was made in those smoke checks.

Historical development reports record real local inference on 18 October and
one Sandbox evidence submission plus two readbacks on 20 October. The accepted
25 October offline build recorded backend 428 passed/1 skipped, frontend 236
passed, two browser walkthroughs, and 44 API checks. These are historical
results, not new remote operations. See `docs/VALIDATION.md` and
`docs/INTEGRATION_EVIDENCE.md` for evidence boundaries.

### Distribution and configuration

MIT license for project-owned code, with third-party notices. Source, tests,
contracts, dependency manifests, and two accepted clean synthetic fixtures are
included. No credentials, raw business databases/logs, model weights, video,
virtual environment, node_modules, or local build cache is attached. The two
fixture databases are intentional demo assets, not merchant runtime state.
Keep credentials only in your ignored local configuration and keep the demo
bound to loopback. No new Sandbox business write was performed for this release.

Native Linux/macOS, Docker, production authentication, and multi-tenant security
are not newly verified by this publication. No new business logic was developed
or replaced for this release.
