# Offline demo and connected integration from the same source

Both modes use the same backend and frontend in this repository. There is no
separate connected codebase. The normal launchers intentionally enforce the
offline configuration; optional integration runs the existing backend directly.

## Default: Offline Demo

Follow the root README and run `start.bat` or `bash start.sh`. Five synthetic
cases, four frozen AI analyses, and a deterministic capture planner make the
walkthrough reproducible without credentials or model weights. No PayPal call
is made. A frozen analysis is not new inference, and replay is not remote
confirmation, evidence submission, messaging, a refund, or a won dispute.

## Prepare the optional connected backend

Requirements: the same Python/Node dependencies as the demo. Run the normal
launcher once with `--prepare-only` to install dependencies and build the HTTP
frontend. Then stop it if it is running. All commands below are PowerShell,
starting at the repository root; choose a free loopback port if 8157 is occupied.

```powershell
.\start.bat --prepare-only
Copy-Item .env.example .env
```

Edit the local `.env` for the chosen mode. It is ignored by Git. The file is
loaded explicitly by uvicorn's `--env-file` option; it is not automatically read
by application code. Relative database and static paths below assume the backend
working directory. The normal `start.bat`/`start.sh` deliberately ignores these
overrides, so use the direct command:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --env-file ../.env --host 127.0.0.1 --port 8157
```

Open `http://127.0.0.1:8157`. The prebuilt frontend calls `/api/v1` on the same
origin. Existing process-level `DP_*` variables take precedence over dotenv;
use a fresh terminal without prior application overrides. The direct backend
has demo identity headers, not production authentication. Keep it on loopback.

## Real AI on synthetic cases, with PayPal offline

Install Ollama and a compatible model through the runtime/model distributor.
The historically tested local tag is `qwen3.6:35b-a3b-q4_K_M`. Set
`DP_LLM_MODEL` to the exact installed tag shown by your runtime; this repository
does not bundle weights or promise that a custom historical tag can be pulled
from a public registry. Smaller or different models are not quality-validated
by the historical 35B integration report. Only loopback Ollama HTTP is supported;
there is no general cloud-model endpoint adapter in this release.

From the repository root, create a separate working copy of the synthetic data:

```powershell
Copy-Item data/demo.golden.sqlite3 backend/data/integration.sqlite3
```

Use these values in the local `.env`, retaining the other template defaults:

```dotenv
DP_DATA_MODE=offline_replay
DP_AI_PROVIDER=ollama_local
DP_AUTO_IMPORT=0
DP_DATABASE_URL=sqlite:///data/integration.sqlite3
DP_PAYPAL_WRITES_ENABLED=0
DP_PAYPAL_WRITE_ALLOW=
```

Start your loopback Ollama runtime and then the direct backend as above.
`GET /api/v1/llm/status` reports runtime availability; a successful status ping
does not itself prove inference. Requesting a new case analysis through the UI
uses the model. Connection or output failures surface explicitly rather than
silently falling back to a stub. All execution remains offline in this mode.

## PayPal Sandbox reads, independently of AI

Create/use your own authorized PayPal Developer Sandbox app and merchant test
account. Enter the app's client ID and secret only in the ignored local `.env`.
Never use production credentials, publish credentials, or reuse a real merchant
database. Use a separate new database; do not copy the offline Golden into it.

```dotenv
DP_DATA_MODE=paypal_sandbox
DP_AI_PROVIDER=stub
DP_AUTO_IMPORT=1
DP_DATABASE_URL=sqlite:///data/sandbox.sqlite3
DP_PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
DP_PAYPAL_WRITES_ENABLED=0
DP_PAYPAL_WRITE_ALLOW=
```

Set the two blank credential fields locally, then start the direct backend.
Startup imports authorized disputes via remote GETs. `stub` explicitly selects
deterministic analysis, not real AI. To combine real inference with Sandbox
reads, independently set `DP_AI_PROVIDER=ollama_local` and configure the runtime.
Do not use `frozen` as though synthetic prerecorded outputs apply to arbitrary
new Sandbox cases.

`GET /api/v1/health` should identify `PAYPAL_SANDBOX_READ_ONLY`; it may show an
unavailable source or upstream error if credentials, permissions, or account
data do not support the request. No disputes can mean the app/account has none;
the application does not create disputes to manufacture a successful demo.
Sandbox mode does not silently substitute offline cases after import failure.

## Existing Sandbox write capability and verification boundaries

Write-capable adapters are retained in the source. They require the separate
write switch, a case/action allow-list, current action availability, validation,
and exact-payload human approval. Those gates are not enabled by this guide.
No new Sandbox write operation was performed for this source release.

The historical accepted connected action is one `provide-evidence` request
followed by two readbacks on 20 October 2026. This does not establish that every
send-message or refund path has been verified against PayPal. Payment refunds
in the five-case public demo are synthetic offline replay. See
[validation status](VALIDATION.md) and [historical evidence](INTEGRATION_EVIDENCE.md).

The AI runtime request and a PayPal execution are different network paths:
model inference does not authorize or execute a payment action. A successful
PayPal request does not prove model quality, adjudication, or a business outcome.
