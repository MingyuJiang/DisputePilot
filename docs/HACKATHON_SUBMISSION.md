# Hackathon handoff

Check the [official rules](https://paypalaihackathon.devpost.com/rules) before
submission. They require public open-source code, a working PayPal + AI
project, English materials and a public YouTube demonstration under three
minutes. Complete local run instructions can provide demo access; public
hosting is optional. Deadline: 12 November 2026 at noon PST, or 13 November
at 04:00 China Standard Time. Keep access available through judging.

## Prepared in this release

- MIT LICENSE approved by the project owner, source, fixtures and tests.
- English run instructions, scope explanation and reproducible workflows.
- No credentials, private browser sessions or model weights needed.

## Entrant actions still required

- Use this repository's public URL in the submission form.
- Publish the final application video on YouTube and provide its public URL.
- Complete Devpost submission and confirm authorship and entry eligibility.
- Substantiate real PayPal Sandbox and AI integration with your approved
  development evidence. This build replays frozen AI outputs and synthetic
  payments; do not represent them as fresh model/API calls.

This source release does not upload a video, accept entrant agreements, or
submit a Devpost entry. Those submission steps remain separate.

## English project description

DisputePilot helps small merchants handle payment disputes while keeping
human approval between an AI recommendation and a financial action. It
separates buyer claims from supporting evidence, prepares exact response
payloads, applies deterministic validation and records an audit trail.

The included offline edition demonstrates five cases. A missing-proof case
is blocked, a clarification message remains available, and a 10 USD partial
refund is simulated against a 42 USD capture with 12 USD already refunded.
Four case analyses replay frozen model output; the capture uses a deterministic
planner. A replay does not move money or adjudicate a dispute.

The source also includes Sandbox adapters and local-model analysis components.
The default launcher deliberately isolates them from external payment access.

## Suggested video outline (2:40)

| Time | Show |
|---|---|
| 0:00–0:20 | Merchant problem, clean overview, offline scope |
| 0:20–0:45 | Analyze five cases, evidence gaps and decisions |
| 0:45–1:15 | Edit O7 message, approve exact text, replay |
| 1:15–1:35 | O9 missing-proof validator refusal |
| 1:35–2:10 | CAP 10 USD draft, approval and simulated refund |
| 2:10–2:30 | Execution history, batch source and audit |
| 2:30–2:40 | Reset to five clean cases |

Identify any separate Sandbox/model footage explicitly. A message, evidence
submission or refund is never proof that a dispute was won or closed.
