# DisputePilot 1.0.0

An AI-assisted dispute workspace for small merchants. Inspect a claim and its
evidence, prepare a precise response, review deterministic validation, approve
the exact payload, and run a separate audited execution step.

React/TypeScript/Vite and FastAPI share one local origin; SQLAlchemy and SQLite
persist the workflow. The same source includes optional PayPal Sandbox and local
Ollama integration. The default launchers run the reproducible **Offline Demo**.
See [Live Integration](docs/LIVE_INTEGRATION.md), the safe [.env.example](.env.example),
and [validation status](docs/VALIDATION.md) for connected configuration and evidence.

**The default Offline Demo runs offline replay. No PayPal request, real message, evidence
submission or refund is sent. No real funds move.** Four analyses are recorded
model outputs; the synthetic capture uses a deterministic planner. These are
identified in the UI, not presented as live inference or remote confirmation.

## Run locally

Requirements: Python 3.11+ and Node.js 20.19+ or 22.12+ (with npm). First setup
downloads Python/npm dependencies. No PayPal account, credentials, GPU or
model download is required. On later starts unchanged dependencies and frontend
builds are reused, so registry access is not needed.

Windows, from an extracted folder (paths with spaces supported):

```bat
start.bat
set PORT=8157
start.bat
```

If Python is not on PATH, set `DP_PYTHON` to your Python executable first.
Open http://127.0.0.1:8000, or the selected port. Stop with Ctrl+C.

Linux/macOS/Git Bash:

```sh
./start.sh
PORT=8157 ./start.sh
```

Windows is tested in the release report. macOS, native Linux and Docker are
not verified here. On a filesystem that loses executable permissions, use
`bash start.sh`. Set DP_PYTHON to select another Python executable.

Both launchers delegate to scripts/launcher.py. The server uses one loopback
port for UI and API, with its own data/demo.sqlite3. It does not accept inherited
DP database, credential or execution-mode overrides. Do not expose this demo
as a production merchant service; role headers are simulated identities.

Useful controls:

```bat
start.bat --prepare-only
start.bat --rebuild
start.bat --no-install
```

Exit codes: 0 = normal stop/preparation, 1 = install/build/runtime failure,
2 = missing/unsupported runtime or invalid PORT, 3 = occupied port. Changing
frontend sources or locked dependencies invalidates the relevant cache.

## Five-case walkthrough

1. Overview starts with five awaiting analysis and no business records.
2. AI Assistant → Analyze my disputes. O7 and O13 are ready for review; O9 is
   blocked for missing proof; O16 waits; CAP requires a human payment decision.
3. Submit eligible proposals. The batch records two pending approvals; approval
   does not execute anything.
4. Open O7 authoring, edit a clarification message and submit it. A new draft
   does not rewrite a previous pending text. Review its exact payload, approve,
   then return to the case to execute an offline replay.
5. Open O9 and inspect V5 / EVIDENCE_MATERIAL_MISSING. No approval or execution
   should exist for its missing-proof action. Missing proof does not ban a
   legitimate clarification message in another permitted workflow.
6. Open CAP-DEMO-9001: 42.00 USD captured, 12.00 already refunded, 30.00 remaining.
   Select Partial, enter 10.00 USD and a reason, create and submit. Review and
   approve that exact 10.00 payload, then replay. The displayed expected 20.00
   remainder is a review calculation; the capture snapshot remains frozen.
7. Review history, batch origin and audit. REPLAYED never means adjudicated,
   dispute won, remote confirmation or real financial settlement.
8. Help → Guided demo → Reset. A consistent backup is created in data/backups,
   Golden restores five cases and zero analyses/proposals/approvals/executions,
   and a DEMO_RESET audit event is added. The workspace refreshes immediately.

Refresh/restart preserves business state. Reset replaces current demo state;
previous audit and business rows remain recoverable in its backup.

## Tests and contract

Full tests are included rather than relying on an external development tree.
After first preparation:

```bat
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
backend\.venv\Scripts\python.exe -m pytest backend\tests
cd frontend
npm test
npm run typecheck
npm run build
```

On Unix use backend/.venv/bin/python. Tests use isolated temporary databases
and mocked payment transports. The real local Ollama probe is skipped when
no local model is available. Read contracts/v1/MANIFEST.sha256 for frozen
OpenAPI hashes; demo-only operational endpoints are outside that contract.

## Source and submission

See [Architecture and scope](docs/ARCHITECTURE.md),
[PayPal and AI integration evidence](docs/INTEGRATION_EVIDENCE.md), and
[Hackathon handoff](docs/HACKATHON_SUBMISSION.md) for integration boundaries,
historical validation, and the English pitch.
The Sandbox and local-model adapters are source components, not external
services enabled by this launcher. The [integration guide](docs/LIVE_INTEGRATION.md)
documents the separate direct backend entry point for real inference and read-only
Sandbox access. Never relabel fixtures as API observations. Video hosting and
Devpost submission are separate from this source release.

MIT License for entrant-owned code, approved by the project owner. Third-party
software retains its own terms; see THIRD_PARTY_NOTICES.md. PayPal is a
third-party service; this project does not claim endorsement.

## Source snapshot

This repository starts from the accepted 25 October 2026 offline release.
Publication preparation on 27 October adds the integration-evidence summary,
safe configuration and connected-mode/validation guides, updates ignore rules,
preserves source bytes through Git attributes, normalizes the Unix launcher to LF,
and regenerates MANIFEST.sha256.
Application logic, tests, dependencies, and synthetic fixtures are unchanged.
The accepted test records report 428 backend tests passed with one real-model
test skipped, and 236 frontend tests passed. These are historical software
checks, not new live integration tests or model-quality scores. Current publication
checks are listed separately in [Validation status](docs/VALIDATION.md).
