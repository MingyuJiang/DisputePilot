# Integration options and troubleshooting

Start with the [README](../README.md): it contains the full Windows quick start
for both the offline demo and PayPal Sandbox with real AI. This page covers
optional combinations, settings, and recovery. All combinations use the same
application source.

## Choose what to connect

| Goal | `DP_DATA_MODE` | `DP_AI_PROVIDER` | Data |
|---|---|---|---|
| Default offline walkthrough | `offline_replay` | `frozen` | Default launcher uses five synthetic cases |
| Real AI, no PayPal access | `offline_replay` | `ollama_local` | A separate copy of the synthetic cases |
| Sandbox reads, no model required | `paypal_sandbox` | `stub` | Your authorized Sandbox disputes |
| Sandbox reads + real AI | `paypal_sandbox` | `ollama_local` | Your authorized Sandbox disputes |

`frozen` is recorded analysis; `stub` is deterministic planning;
`ollama_local` performs real inference. Do not select `frozen` for arbitrary
Sandbox cases as though prerecorded outputs described those cases.

The default `start.bat`/`start.sh` enforce offline mode. Optional combinations
use `.env` and the direct uvicorn command below. `.env` is loaded explicitly;
the application does not load it automatically.

## Real AI on synthetic data

First run the README's preparation command and create `.env` if needed. From
the repository root, create a new working copy without overwriting an existing
AI evaluation database:

```powershell
if (!(Test-Path backend/data/ai-demo.sqlite3)) {
    Copy-Item data/demo.golden.sqlite3 backend/data/ai-demo.sqlite3
}
```

Edit these settings in `.env`, retaining its static-directory and loopback
model settings. Set `DP_LLM_MODEL` to the exact tag installed in your runtime:

```dotenv
DP_DATA_MODE=offline_replay
DP_AI_PROVIDER=ollama_local
DP_AUTO_IMPORT=0
DP_DATABASE_URL=sqlite:///data/ai-demo.sqlite3
DP_PAYPAL_WRITES_ENABLED=0
DP_PAYPAL_WRITE_ALLOW=
```

Start Ollama, then use the direct-backend command below. This configuration
uses real AI but keeps all payment execution offline. It requires no PayPal
credentials. Leave the two credential fields blank.

The historical model tag is `qwen3.6:35b-a3b-q4_K_M`. Obtain model weights from
their distributor and install/import them in your own runtime. This repository
does not guarantee that a historical local tag is available for a registry
pull. Other models are not quality-validated by the historical 35B report.

## Sandbox without a model

Follow the README's online configuration, but set `DP_AI_PROVIDER=stub`.
Dispute reads still use your authorized Sandbox app; analysis is deterministic,
not real AI. Keep `DP_PAYPAL_WRITES_ENABLED=0` and an empty write allow-list.
Use a new Sandbox database and never seed it with synthetic cases.

With `DP_AUTO_IMPORT=1`, startup reads the account's disputes. Failed reads are
reported and do not cause a silent fixture fallback. This application does not
create an order or dispute to populate an otherwise empty account.

## Direct startup commands

In PowerShell, from the repository root:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --env-file ../.env --host 127.0.0.1 --port 8157
```

On Linux/macOS/Git Bash, the corresponding preparation and entry point are:

```sh
bash start.sh --prepare-only
test -f .env || cp .env.example .env
# Edit .env for the selected combination before starting.
cd backend
.venv/bin/python -m uvicorn app.main:app --env-file ../.env --host 127.0.0.1 --port 8157
```

Native Windows Python environments under Git Bash may instead use
`.venv/Scripts/python.exe`. Native Linux/macOS and Docker are not verified by
the release checks. Stop a running server with Ctrl+C before switching modes;
after stopping, return to the repository root before following root-level
commands again.

## Configuration reference

Paths in `.env.example` are interpreted with `backend/` as the working directory.
The frontend must already be built by `--prepare-only`.

| Setting | Purpose |
|---|---|
| `DP_DATA_MODE` | `offline_replay` or `paypal_sandbox` |
| `DP_AI_PROVIDER` | `frozen`, `stub`, or `ollama_local` |
| `DP_AUTO_IMPORT` | `0` for existing synthetic data; `1` for opt-in Sandbox startup reads |
| `DP_DATABASE_URL` | Separate working database for the selected mode |
| `DP_STATIC_DIR` | `../frontend/dist` serves the built UI on the API origin |
| `DP_LLM_BASE_URL` | Loopback Ollama, normally `http://127.0.0.1:11434` |
| `DP_LLM_MODEL` | Exact installed model tag |
| `DP_PAYPAL_CLIENT_ID` / `DP_PAYPAL_CLIENT_SECRET` | Your authorized Sandbox app credentials, only in local configuration |
| `DP_PAYPAL_WRITES_ENABLED` / `DP_PAYPAL_WRITE_ALLOW` | Keep `0` / empty for these read-only instructions |

Existing process environment variables override dotenv values. Use a fresh
terminal or remove only your previous application overrides when changing mode.
Never commit `.env`, credentials, working merchant databases, or model weights.

## Troubleshooting

| Symptom | Check |
|---|---|
| Editing `.env` still shows frozen analysis | Use direct uvicorn, not the offline launcher; check old process-level overrides |
| Model unavailable or analysis returns 503 | Check Ollama is running on loopback and `DP_LLM_MODEL` matches an installed tag; no silent stub fallback occurs |
| Sandbox list is empty | Check account permissions and whether that account has disputes; inspect the health note for import errors |
| Health says `REPLAY` in Sandbox mode | Expected with writes disabled; `network_access` distinguishes real Sandbox reads from offline data |
| UI is missing | Build via `--prepare-only`, use the backend working directory, and keep `DP_STATIC_DIR=../frontend/dist` |
| Port already in use | Stop your previous server or choose another uvicorn `--port`; the default launcher's `PORT` variable does not control uvicorn |

## Execution and evidence boundaries

AI inference and PayPal execution are distinct network paths. The model cannot
grant write permission. Existing write adapters require explicit configuration,
case/action allow-listing, current action availability, deterministic validation,
and exact-payload human approval. This guide does not enable them.

Historical evidence records one Sandbox `provide-evidence` submission with two
readbacks, not general validation of every message/refund path. The public demo's
refund is simulated. See [Validation status](VALIDATION.md) and
[Integration evidence](INTEGRATION_EVIDENCE.md). No new real model call or PayPal
operation is implied by this documentation update.
