# Validation status

The default demo, real model inference, and real PayPal execution are separate
claims. This document distinguishes historical development acceptance from
the checks performed for this source publication on 27 October 2026.

## Checks performed for this publication

| Check | Actual result | Scope |
|---|---|---|
| Reviewed source archive | 297 files, ZIP integrity PASS; 296/296 original manifest entries matched | The archived baseline, not a new business-flow test |
| Application source and tests | Unchanged from the reviewed baseline | Documentation, safe config template, Git attributes/ignore rules, and manifest updated; Unix launcher line endings normalized earlier |
| Backend suite | **428 passed, 1 deselected**, no failures; one deprecation warning | Real-model smoke explicitly excluded; non-loopback Python connections blocked; local fake-server tests allowed |
| Frontend suite | **236 passed** | Existing 26-file suite in an independent checkout |
| TypeScript | PASS | Existing `tsc -b` check |
| Production frontend build | PASS | Existing Vite build |
| Direct offline entry point | PASS | Explicit dotenv loading, five synthetic cases, UI served, REPLAY/NONE |
| Direct Sandbox configuration entry point | PASS | No credentials, no auto-import, zero cases, UI served, REPLAY/PAYPAL_SANDBOX_READ_ONLY |

The configuration smoke checks used temporary databases and GETs to a local
server. They did not contact PayPal or generate model output. An initial local
attempt encountered process/temp-directory permission restrictions; the same
tests and build passed after rerunning with the necessary local permissions.
No application or test implementation was changed to obtain these results.

The backend warning concerns Starlette's deprecated httpx-based TestClient;
it did not fail the suite. Linux, macOS, Docker, production hosting,
authentication, and tenant isolation were not newly validated here.

## Historical evidence, not rerun remote tests

| Date | Recorded result | What it does not prove |
|---|---|---|
| 18 October 2026 | Real FastAPI-to-loopback-Ollama inference with `qwen3.6:35b-a3b-q4_K_M` | General model accuracy, robustness, or performance across cases |
| 20 October 2026 | One Sandbox `provide-evidence` POST returned HTTP 200; two independent GET readbacks matched seller notes | Winning a dispute, production readiness, or verified real refunds/messages in this release |
| 25 October 2026 | Backend **428 passed, 1 skipped**; frontend **236 passed**; two offline browser walkthroughs; 44/44 API acceptance checks | A new model/API call on the publication date |

The current backend run has **one deselection**, while the historical run had
**one skip**. Neither is a successful real-model test. The historical reports
are retained privately; the public [evidence summary](INTEGRATION_EVIDENCE.md)
describes their provenance and limitations without raw credentials or traces.

## Reproduce the local software checks

After normal dependency preparation, from the repository root on Windows:

```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
backend\.venv\Scripts\python.exe -m pytest backend/tests -k "not test_real_35b_smoke_case_o4"
Set-Location frontend
npm test
npm run typecheck
npm run build
```

Tests use temporary databases and mocked payment transports. The release QA
also applied a separate local-only network guard; that guard and raw QA logs
are not runtime components and are not distributed as application source.
Read the tests before opting into the real-model smoke test on your own runtime.

## Safety and scope

The published files and existing Git history were checked for credential
patterns, non-example contact data, local environment paths, private-key blocks,
unexpected databases, weights, runtime artifacts, and large files. The two
included databases match the accepted synthetic fixtures exactly and contain
zero execution records. `.env.example` has blank credential fields and disabled
payment writes. This is a bounded release audit, not a claim of exhaustive
security or supply-chain verification.

No new real `provide-evidence`, message, refund, order, dispute creation, or other
Sandbox business write was executed for publication. Offline replay is not
remote confirmation or a financial outcome.
