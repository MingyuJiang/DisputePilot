# Release notes

## DisputePilot 1.0.0

One source tree contains the merchant workspace, PayPal Sandbox adapters, local
Ollama provider, offline demo, tests, and frozen API contract.

- Case analysis and evidence references with missing-material validation.
- Exact-payload human approval followed by a separate execution step.
- Message, evidence, and synthetic partial-refund walkthroughs with audit history.
- A resettable five-case offline demo that needs no payment credentials or model.
- Optional Sandbox and real-model configuration; Sandbox writes off by default.
- MIT license, third-party notices, and two reviewed synthetic demo databases.

Start with the [README](README.md). Configuration alternatives are in
[Integration options](docs/LIVE_INTEGRATION.md); recorded checks and their limits
are in [Validation status](docs/VALIDATION.md).

The [v1.0.0 release](https://github.com/MingyuJiang/DisputePilot/releases/tag/v1.0.0)
is a fixed source snapshot. Later documentation improvements appear on `main`;
they do not move the published tag or claim new API/model validation.
