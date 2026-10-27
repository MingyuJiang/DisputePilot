# DisputePilot

An AI-assisted PayPal dispute workspace for small merchants. Review a buyer's
claim and its evidence, prepare a response, approve the exact payload, and inspect
the execution history. Built with React, TypeScript, FastAPI, and SQLite.

**One codebase, two ways to run:**

| | Offline demo | Online integration |
|---|---|---|
| Case data | Five synthetic demo cases | Your authorized PayPal Sandbox disputes |
| AI | Four recorded analyses; deterministic capture planner | Your local Ollama model |
| Credentials / model | Neither needed | Your Sandbox app credentials and installed model |
| Start command | `start.bat` or `bash start.sh` | Run the backend directly with `.env` |
| Payment actions | Simulated replay | Sandbox reads; writes disabled by default |

Here, **online means PayPal Sandbox integration**, while the UI and model run
locally. This is not a publicly hosted production payment service.

## Requirements and download

- Python **3.11+**.
- Node.js **20.19+ or 22.12+**, including npm.
- Internet access for the first dependency installation.
- Windows is verified; native Linux/macOS and Docker remain unverified.

Clone the repository, or download and extract the source from
[Releases](https://github.com/MingyuJiang/DisputePilot/releases).

```powershell
git clone https://github.com/MingyuJiang/DisputePilot.git
Set-Location DisputePilot
```

All Windows commands below use **PowerShell**. Start each setup path from the
repository root. Do not run the two servers on the same port at the same time.

## 1. Offline demo — no credentials or model required

From the repository root:

```powershell
.\start.bat
```

Open **http://127.0.0.1:8000**. First start installs dependencies and builds the
frontend; later starts reuse them. Stop with **Ctrl+C**.

If port 8000 is occupied, set a different port before starting:

```powershell
$env:PORT = "8157"
.\start.bat
```

On Linux/macOS/Git Bash, the corresponding entry point is `bash start.sh`.
If Python is not on PATH, set `DP_PYTHON` to its executable before starting.

The default launcher always selects offline replay and frozen analysis, uses
`data/demo.sqlite3`, and disables PayPal access. It deliberately ignores `.env`
and inherited `DP_*` mode/credential overrides. **Editing `.env` does not turn
`start.bat` or `start.sh` into an online launcher.**

Try the workflow:

1. Open AI Assistant and analyze the five cases.
2. Review O7's message, submit it, approve its exact text, then replay it.
3. Inspect O9's missing-evidence block and O16's wait decision.
4. Create a 10 USD partial-refund proposal for the synthetic capture; approve
   and replay it, then inspect the audit history.
5. Use Help → Guided demo → Reset to restore a clean five-case workspace.

Recorded analysis is not fresh model inference. Replay does not send a message,
submit evidence, refund money, or resolve a dispute. Approval and execution are
separate steps.

## 2. Online integration — PayPal Sandbox + real AI

This path uses the **same backend and frontend**. You need your own authorized
PayPal Developer Sandbox app and merchant test account, plus a local Ollama
runtime with an installed model. No credentials or model weights are included.

### A. Prepare the application

From the repository root, install/build without starting the offline server:

```powershell
.\start.bat --prepare-only
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

### B. Configure PayPal and AI

In a separate terminal, start Ollama if it is not already running. Use
`ollama list` to find the exact installed model tag. The historically tested
tag is `qwen3.6:35b-a3b-q4_K_M`; use your runtime's actual tag.

```powershell
# Separate terminal; leave it running. Skip if Ollama is already running.
ollama serve
```

Edit the local **`.env`** file. Replace the three `YOUR_...` placeholders below,
and retain the other settings from `.env.example`:

```dotenv
DP_DATA_MODE=paypal_sandbox
DP_AI_PROVIDER=ollama_local
DP_AUTO_IMPORT=1
DP_DATABASE_URL=sqlite:///data/sandbox.sqlite3
DP_STATIC_DIR=../frontend/dist
DP_LLM_BASE_URL=http://127.0.0.1:11434
DP_LLM_MODEL=YOUR_INSTALLED_MODEL_TAG
DP_PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
DP_PAYPAL_CLIENT_ID=YOUR_SANDBOX_CLIENT_ID
DP_PAYPAL_CLIENT_SECRET=YOUR_SANDBOX_CLIENT_SECRET
DP_PAYPAL_WRITES_ENABLED=0
DP_PAYPAL_WRITE_ALLOW=
```

Keep `.env` local: it is ignored by Git. Use a **separate Sandbox database**;
do not copy the synthetic Golden into it. Use a fresh terminal without old
`DP_*` environment overrides, which take precedence over `.env`.

### C. Start the connected backend and UI

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --env-file ../.env --host 127.0.0.1 --port 8157
```

Open **http://127.0.0.1:8157**. The backend serves the prebuilt frontend and API
on the same port. `PORT` applies only to the default launcher; change uvicorn's
`--port` here if necessary.

- Startup reads authorized Sandbox disputes. It does not create disputes.
- Requesting a case analysis uses the configured Ollama model.
- `GET /api/v1/health` identifies `PAYPAL_SANDBOX_READ_ONLY`; execution can still
  be labeled `REPLAY` because real payment writes are disabled.
- `GET /api/v1/llm/status` checks model-runtime availability. A successful ping
  is not itself proof that an analysis was generated.

An empty case list may mean the Sandbox account has no eligible disputes.
Import errors are reported rather than silently replaced with demo cases.
Real AI requests and PayPal execution are independent: inference does not
authorize a financial action.

Write-capable adapters remain in the source, behind explicit configuration,
per-action allow-listing, validation, and human approval. This quick start keeps
them disabled. See [Integration options](docs/LIVE_INTEGRATION.md) for AI-only
evaluation, Sandbox without a model, Unix commands, and troubleshooting.

## Validation and limitations

| Recorded check | Result / scope |
|---|---|
| Local checks, 27 October 2026 | Backend 428 passed, 1 real-model test deselected; frontend 236 passed; typecheck and build passed |
| Configuration smoke checks, 27 October | Offline five-case startup and no-credential Sandbox configuration passed; no remote API or real inference |
| Historical real AI, 18 October | Local Ollama inference through FastAPI; not a model-accuracy benchmark |
| Historical PayPal, 20 October | One Sandbox evidence submission and two GET readbacks; not verified real refunds/messages or a won dispute |

Details and provenance: [Validation status](docs/VALIDATION.md) and
[Integration evidence](docs/INTEGRATION_EVIDENCE.md). Documentation-only updates
do not represent new model calls, Sandbox operations, or full test reruns.

To run the local software checks after preparation:

```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
backend\.venv\Scripts\python.exe -m pytest backend/tests -k "not test_real_35b_smoke_case_o4"
Set-Location frontend
npm test
npm run typecheck
npm run build
```

The UI uses simulated identity headers, not production authentication. Keep the
application on loopback. Only loopback Ollama is supported for real AI; there is
no generic cloud-model adapter. Production PayPal hosts are rejected.

## Documentation

- [Documentation index](docs/README.md) — where to find each guide.
- [Architecture](docs/ARCHITECTURE.md) — components, providers, and safety gates.
- [Release notes](RELEASE_NOTES.md) — what 1.0.0 contains.
- [Hackathon handoff](docs/HACKATHON_SUBMISSION.md) — submission text and remaining entry steps.

MIT for project-owned code. See [LICENSE](LICENSE) and
[third-party notices](THIRD_PARTY_NOTICES.md). PayPal is a third-party service;
the project does not claim endorsement.
