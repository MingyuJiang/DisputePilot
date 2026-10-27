# API_EXAMPLES — v1 契约完整示例（全部来自离线服务的真实响应）

> **status: DRAFT**｜所有示例由 `tools/capture_examples.py` 对运行中的离线服务实跑捕获
> （数据源：`reference/cases` 脱敏快照；无任何真实 PayPal 标识）。
> 角色头（Demo，非生产认证）：`X-Actor-Id` + `X-Actor-Role` ∈ SPECIALIST/MANAGER/SYSTEM。
> v1.1-candidate（2026-10-17）：A3/A5/A6–A11 与 B 章全量重采——`missing_evidence` 逐字解析修复、
> 响应模型类型化（submit/replay/execution/state/health/negative-samples）、
> 错误统一信封（B2 由 `{"detail": …}` 改为 `{"error": …}`，新增 B7–B9）。

## A. 完整 INR 链路（O4：导入 → 分析 → 提议 → 校验 → 提交 → 批准 → 回放 → 审计）

### A1. 健康检查

```http
GET /api/v1/health
```

```json
{
  "status": "ok",
  "service": "disputepilot-agent-a",
  "execution_mode": "REPLAY",
  "network_access": "NONE",
  "policy_version": "policy-v1.0",
  "note": "offline replay backend; no PayPal API calls of any kind"
}
```

### A2. 案件列表（节选一条）

```http
GET /api/v1/cases
```

```json
[
  {
    "case_id": "O4",
    "family": "INR",
    "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    "status": "IMPORTED",
    "amount": { "value_minor": 1500, "currency": "USD", "display": "15.00 USD" },
    "fulfillment_posture": "NONE",
    "provenance": "PAYPAL_API_OBSERVED",
    "verification_level": "FROZEN_SANDBOX_E1_VERIFIED"
  }
]
```

### A3. 案件详情（O4）

```http
GET /api/v1/cases/O4
```

```json
{
  "case_id": "O4",
  "scenario_id": "LEVEL_C_WEB_DISPUTE_FROZEN",
  "dispute_id": "UNKNOWN",
  "family": "INR",
  "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  "status": "IMPORTED",
  "dispute_status": "WAITING_FOR_SELLER_RESPONSE",
  "lifecycle_stage": "INQUIRY",
  "amount": { "value_minor": 1500, "currency": "USD", "display": "15.00 USD" },
  "transaction_reference": {
    "order_id": "UNKNOWN",
    "capture_id": "UNKNOWN",
    "buyer_transaction_id": "UNKNOWN",
    "dispute_id": "UNKNOWN"
  },
  "fulfillment_posture": "NONE",
  "seller_contacted": false,
  "evidence_count": 4,
  "available_actions": [
    { "rel": "self", "method": "GET", "basis": "FIXTURE_SNAPSHOT" },
    { "rel": "accept_claim", "method": "POST", "basis": "FIXTURE_SNAPSHOT" },
    { "rel": "provide_evidence", "method": "POST", "basis": "FIXTURE_SNAPSHOT" },
    { "rel": "send_message", "method": "POST", "basis": "FIXTURE_SNAPSHOT" },
    { "rel": "make_offer", "method": "POST", "basis": "FIXTURE_SNAPSHOT" },
    { "rel": "escalate", "method": "POST", "basis": "FIXTURE_SNAPSHOT" }
  ],
  "evidence_requirements": [
    { "evidence_type": "PROOF_OF_FULFILLMENT", "source": "REQUESTED_FROM_SELLER", "open": true }
  ],
  "missing_evidence": [
    "real proof of fulfillment (deliberately NOT fabricated)",
    "Real logistics records (carrier/tracking/delivery confirmation) - not fabricated."
  ],
  "provenance": "PAYPAL_API_OBSERVED",
  "verification_level": "FROZEN_SANDBOX_E1_VERIFIED",
  "case_version": 1,
  "snapshot_hash": "<sha256>",
  "live_status_note": "live execution status is owned by the Sol environment and may have advanced; not reflected here",
  "created_at": "2026-10-17T…",
  "updated_at": "2026-10-17T…"
}
```

### A4. 证据列表（节选一条）

```http
GET /api/v1/cases/O4/evidence
```

```json
[
  {
    "evidence_id": "EV-O4-BUYER-001",
    "case_id": "O4",
    "evidence_type": "BUYER_STATEMENT",
    "content": "This is a simulated item-not-received scenario for testing a dispute resolution workflow in the PayPal Sandbox environment. …",
    "source_type": "DISPUTE_BUYER_MESSAGE",
    "provenance": "HUMAN_OBSERVED_SANDBOX_UI",
    "verification_level": "FROZEN_SANDBOX_E1_VERIFIED",
    "source_reference": "HUMAN_OBSERVED_SANDBOX_UI (recorded in dispute detail fixture)",
    "observed_at": null,
    "integrity_hash": null
  }
]
```

### A5. 创建 AI 分析（Stub，确定性）

```http
POST /api/v1/cases/O4/analyses
X-Actor-Id: specialist-1
X-Actor-Role: SPECIALIST
```

```json
{
  "analysis_id": "ANL-O4-…",
  "case_id": "O4",
  "case_snapshot_hash": "<decision-context sha256>",
  "factual_summary": "INR dispute (MERCHANDISE_OR_SERVICE_NOT_RECEIVED), 15.00 USD, fulfillment posture NONE, status WAITING_FOR_SELLER_RESPONSE/INQUIRY (fixture snapshot).",
  "grounded_facts": [
    {
      "fact_id": "GF-O4-BUYER",
      "statement": "Buyer filed a INR dispute (MERCHANDISE_OR_SERVICE_NOT_RECEIVED) for 15.00 USD.",
      "fact_type": "OBSERVED_FACT",
      "evidence_ids": ["EV-O4-BUYER-001"],
      "provenance": "HUMAN_OBSERVED_SANDBOX_UI"
    },
    {
      "fact_id": "GF-O4-ORDER-002",
      "statement": "Sandbox order/capture records exist for the disputed transaction.",
      "fact_type": "OBSERVED_FACT",
      "evidence_ids": ["EV-O4-AV-002"],
      "provenance": "SCENARIO_DEFINED"
    },
    {
      "fact_id": "GF-O4-REQ-PROOF_OF_FULFILLMENT",
      "statement": "Open evidence requirement: PROOF_OF_FULFILLMENT requested from the seller.",
      "fact_type": "OBSERVED_FACT",
      "evidence_ids": ["EV-O4-REQ-001"],
      "provenance": "PAYPAL_API_OBSERVED"
    },
    {
      "fact_id": "GF-O4-POSTURE",
      "statement": "Fulfillment posture NONE provides no truthful fulfillment material.",
      "fact_type": "SUPPORTED_INFERENCE",
      "evidence_ids": ["EV-O4-REQ-001", "EV-O4-AV-002"],
      "provenance": "AI_INFERRED"
    }
  ],
  "missing_evidence": [
    "real proof of fulfillment (deliberately NOT fabricated)",
    "Real logistics records (carrier/tracking/delivery confirmation) - not fabricated."
  ],
  "contradictions": [],
  "recommendation": "send-message",
  "safety_flags": [
    "frozen verified trajectory — no further writes on this case",
    "fabrication of fulfillment evidence is forbidden",
    "AI output is STUB_DETERMINISTIC — not a real LLM inference"
  ],
  "model_provider": "deterministic-stub",
  "model_name": "evidence-planner-v1",
  "analysis_mode": "STUB_DETERMINISTIC",
  "created_at": "2026-10-17T…",
  "plan": {
    "recommended_action": "send-message",
    "rationale": [
      "open requirement PROOF_OF_FULFILLMENT but posture NONE has no truthful material",
      "fabricating business proof is banned — honest communication + evidence request"
    ],
    "gaps": [
      {
        "gap": "open requirement PROOF_OF_FULFILLMENT — posture NONE provides no truthful material",
        "severity": "HIGH"
      }
    ],
    "alternatives": ["WAIT (restraint)"],
    "wait_rule_applies": false
  }
}
```

> O4 上推荐 `send-message`，与文档记录的人工批准动作一致（S7 benchmark M2 锚点）。

### A6. AI 生成行动提议

```http
POST /api/v1/cases/O4/proposals/generate
X-Actor-Id: specialist-1
X-Actor-Role: SPECIALIST
```

```json
[
  {
    "proposal_id": "PRP-O4-send-message-9efcf99063",
    "case_id": "O4",
    "analysis_id": "ANL-O4-…",
    "action_type": "send-message",
    "action_payload": {
      "message": "SCENARIO_DEFINED sandbox test correspondence (offline replay draft) — case O4, INR dispute for 15.00 USD. …",
      "idempotency_key": "DP-REPLAY-O4-SEND_MESSAGE-001"
    },
    "rationale": ["open requirement PROOF_OF_FULFILLMENT but posture NONE has no truthful material", "…"],
    "evidence_ids": ["EV-O4-BUYER-001", "EV-O4-AV-002", "EV-O4-REQ-001"],
    "risk_level": "LOW",
    "validation_status": "NOT_RUN",
    "state": "DRAFT",
    "snapshot_hash": "<decision-context sha256>",
    "payload_hash": "<sha256>",
    "policy_version": "policy-v1.0",
    "execution_authorized": false,
    "created_at": "2026-10-17T…",
    "updated_at": "2026-10-17T…"
  }
]
```

### A7. 提交审批（Specialist；V1–V12 在此运行）

```http
POST /api/v1/proposals/PRP-O4-send-message-9efcf99063/submit
X-Actor-Id: specialist-1
X-Actor-Role: SPECIALIST
```

```json
{
  "proposal": { "proposal_id": "PRP-O4-send-message-9efcf99063", "state": "PENDING_APPROVAL", "validation_status": "PASSED" },
  "approval": {
    "approval_id": "APR-PRP-O4-send-message-9efcf99063",
    "proposal_id": "PRP-O4-send-message-9efcf99063",
    "case_id": "O4",
    "action_payload_hash": "<sha256>",
    "case_snapshot_hash": "<decision-context sha256>",
    "policy_version": "policy-v1.0",
    "decision": "PENDING",
    "reason": "",
    "actor_id": "specialist-1",
    "actor_role": "SPECIALIST",
    "decided_at": "2026-10-17T…"
  }
}
```

### A8. Manager 批准

```http
POST /api/v1/approvals/APR-PRP-O4-send-message-9efcf99063/decision
X-Actor-Id: manager-1
X-Actor-Role: MANAGER
Content-Type: application/json

{"decision": "APPROVED", "reason": "rationale verified against evidence"}
```

```json
{
  "approval_id": "APR-PRP-O4-send-message-9efcf99063",
  "decision": "APPROVED",
  "reason": "rationale verified against evidence",
  "actor_id": "manager-1",
  "actor_role": "MANAGER",
  "decided_at": "2026-10-17T…"
}
```

### A9. 离线回放执行（Manager 授权；结果**不是** PayPal 响应）

```http
POST /api/v1/approvals/APR-PRP-O4-send-message-9efcf99063/replay
X-Actor-Id: manager-1
X-Actor-Role: MANAGER
```

```json
{
  "execution_id": "EXE-55ce41b7bfd83151",
  "proposal_id": "PRP-O4-send-message-9efcf99063",
  "case_id": "O4",
  "execution_mode": "REPLAY",
  "simulated": true,
  "result": "REPLAYED",
  "gateway": "ReplayExecutionGateway",
  "response_snapshot": {
    "simulated": true,
    "execution_mode": "REPLAY",
    "gateway": "ReplayExecutionGateway",
    "action": "send-message",
    "note": "This is a deterministic OFFLINE REPLAY result against a frozen fixture state. It is NOT a PayPal API response and must not be recorded or reported as one.",
    "message_recorded": true,
    "message_sha256": "<sha256>",
    "expected_state_transition": { "dispute_status": "UNDER_REVIEW", "links": ["self"] },
    "merchant_contacted_reliability": "UNRELIABLE — merchant_contacted stayed false after a verified message on O4; not a success indicator"
  },
  "verification": {
    "method": "byte-exact message comparison (O4 pattern)",
    "basis": "FIXTURE_SNAPSHOT",
    "message_byte_exact": true,
    "message_sha256": "<sha256>",
    "state_before": { "dispute_status": "WAITING_FOR_SELLER_RESPONSE", "links": ["self", "accept_claim", "provide_evidence", "send_message", "make_offer", "escalate"] },
    "state_after_expected": { "dispute_status": "UNDER_REVIEW", "links": ["self"] },
    "four_layer_note": "API acceptance != evidence recorded != evidence sufficiency != adjudication (S7 pilot matrix honesty rule)"
  },
  "created_at": "2026-10-17T…",
  "warning": "OFFLINE REPLAY result — not a PayPal API response"
}
```

### A10. 查询执行记录（GET，含 request_snapshot）

```http
GET /api/v1/proposals/PRP-O4-send-message-9efcf99063/execution
```

```json
{
  "execution_id": "EXE-55ce41b7bfd83151",
  "proposal_id": "PRP-O4-send-message-9efcf99063",
  "case_id": "O4",
  "execution_mode": "REPLAY",
  "simulated": true,
  "result": "REPLAYED",
  "gateway": "ReplayExecutionGateway",
  "request_snapshot": {
    "action_type": "send-message",
    "action_payload": {
      "message": "SCENARIO_DEFINED sandbox test correspondence (offline replay draft) — case O4, INR dispute for 15.00 USD. …",
      "idempotency_key": "DP-REPLAY-O4-SEND_MESSAGE-001"
    },
    "idempotency_key": "DP-REPLAY-O4-SEND_MESSAGE-001",
    "case_snapshot_hash": "<sha256>",
    "approval_id": "APR-PRP-O4-send-message-9efcf99063",
    "state_version": 1
  },
  "response_snapshot": { "simulated": true, "execution_mode": "REPLAY", "…": "…" },
  "verification": { "method": "byte-exact message comparison (O4 pattern)", "basis": "FIXTURE_SNAPSHOT", "…": "…" },
  "created_at": "2026-10-17T…",
  "warning": "OFFLINE REPLAY result — not a PayPal API response"
}
```

### A11. 案件执行列表（GET）

```http
GET /api/v1/cases/O4/executions
```

```json
[
  {
    "execution_id": "EXE-55ce41b7bfd83151",
    "proposal_id": "PRP-O4-send-message-9efcf99063",
    "execution_mode": "REPLAY",
    "simulated": true,
    "result": "REPLAYED",
    "gateway": "ReplayExecutionGateway",
    "created_at": "2026-10-17T…"
  }
]
```

### A12. 审计时间线（append-only）

```http
GET /api/v1/cases/O4/audit
```

```json
{
  "case_id": "O4",
  "append_only": true,
  "events": [
    { "event_id": "AUD-IMPORT-O4", "event_type": "CASE_IMPORTED", "actor_type": "SYSTEM", "actor_id": "fixture-loader", "payload": { "provenance": "PAYPAL_API_OBSERVED", "verification_level": "FROZEN_SANDBOX_E1_VERIFIED", "…": "…" }, "created_at": "…" },
    { "event_id": "AUD-ANL-O4-…", "event_type": "ANALYSIS_CREATED", "actor_type": "AI", "…": "…" },
    { "event_id": "AUD-PRP-…-CREATED", "event_type": "PROPOSAL_CREATED", "actor_type": "AI", "…": "…" },
    { "event_id": "AUD-VR-…", "event_type": "VALIDATION_RECORDED", "actor_type": "SYSTEM", "payload": { "passed": true, "findings": [ { "validator_id": "V1", "status": "PASS", "…": "…" }, "…" ] } },
    { "event_id": "AUD-APR-…-SUBMITTED", "event_type": "PROPOSAL_SUBMITTED", "actor_type": "HUMAN", "actor_id": "specialist-1" },
    { "event_id": "AUD-APR-…-DECIDED", "event_type": "APPROVAL_DECIDED", "actor_type": "HUMAN", "actor_id": "manager-1", "payload": { "decision": "APPROVED", "action_payload_hash": "…", "case_snapshot_hash": "…", "policy_version": "policy-v1.0" } },
    { "event_id": "AUD-EXE-…", "event_type": "EXECUTION_REPLAYED", "actor_type": "SYSTEM", "payload": { "execution_mode": "REPLAY", "simulated": true, "artifact": "replay_EXE-….json" } }
  ]
}
```

---

## B. 负面测试响应示例（统一错误信封）

所有错误响应均为同一信封：`{"error": {"code": ..., "message": ...}}`，
按错误类别附带 `validation_report`（业务阻断）或 `details`（请求格式错误）。

### B1. 不支持的动作被 V2 阻止（`refund` 不在争议动作白名单）

```http
POST /api/v1/cases/O4/proposals            → 200（草稿可创建）
POST /api/v1/proposals/PRP-O4-refund-…/submit
```

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "proposal blocked by deterministic validator: [\"V2: refund not in whitelist ['accept-claim', 'escalate', 'make-offer', 'provide-evidence', 'provide-supporting-info', 'send-message', 'wait']\", \"V3: unknown action 'refund' (see V2)\", \"V4: unknown action 'refund' (see V2)\", \"V7: no offline payload schema for 'refund' (see V2)\", \"V11: no fixed idempotency key for the intended write (single attempt)\"]",
    "validation_report": {
      "report_id": "VR-PRP-O4-refund-…",
      "passed": false,
      "blocked_reasons": ["V2: …", "V3: …", "V4: …", "V7: …", "V11: …"],
      "findings": [ { "validator_id": "V2", "status": "FAIL", "basis": "FIXTURE_SNAPSHOT", "doc_reference": "S6_1_AI_ACTION_PLAN.md D3" }, "…" ]
    }
  }
}
```

### B2. Specialist 尝试 Manager 审批 → 403

```http
POST /api/v1/approvals/{approval_id}/decision
X-Actor-Id: specialist-1
X-Actor-Role: SPECIALIST
```

```json
{ "error": { "code": "FORBIDDEN", "message": "role SPECIALIST is not permitted here; required: ['MANAGER']" } }
```

### B3. 重复回放 → 409（数据库 UNIQUE 约束 + 状态机双重防御）

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "proposal already replayed; duplicate execution refused"
  }
}
```

### B4. 案件状态变化后旧审批失效 → 409 + 审计 EXECUTION_BLOCKED

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "execution blocked: [\"V9: decision snapshot hash drift (case or runtime state changed) — stale decision, re-run\", \"decision snapshot hash mismatch — case or runtime state changed after approval\"]"
  }
}
```

### B5. 未批准/已拒绝 → 409

```json
{ "error": { "code": "CONFLICT", "message": "proposal state PENDING_APPROVAL is not executable; only APPROVED proposals may replay" } }
```

### B6. 证据 ID 不存在 → 422（grounding 纪律）

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "evidence_ids not found on case O4: ['EV-DOES-NOT-EXIST']" } }
```

### B7. 缺少 X-Actor-Id → 401

```http
POST /api/v1/cases/import        （不带任何 X-Actor-* 头）
```

```json
{ "error": { "code": "UNAUTHORIZED", "message": "missing X-Actor-Id (demo identity)" } }
```

### B8. 资源不存在 → 404

```http
GET /api/v1/cases/NOPE
```

```json
{ "error": { "code": "NOT_FOUND", "message": "case 'NOPE' not found" } }
```

### B9. 请求体格式错误 → 422 REQUEST_INVALID（带 details；区别于业务 VALIDATION_FAILED）

```http
POST /api/v1/approvals/{approval_id}/decision
X-Actor-Id: manager-1
X-Actor-Role: MANAGER
Content-Type: application/json

{"decision": "MAYBE", "reason": "x"}
```

```json
{
  "error": {
    "code": "REQUEST_INVALID",
    "message": "request format invalid; see details",
    "details": [
      { "type": "enum", "loc": ["body", "decision"], "msg": "Input should be 'PENDING', 'APPROVED' or 'REJECTED'", "input": "MAYBE", "ctx": { "expected": "'PENDING', 'APPROVED' or 'REJECTED'" } }
    ]
  }
}
```

---

## C. 端点总表

| Method | Endpoint | 角色 | 状态变化 |
|---|---|---|---|
| GET | /api/v1/health | — | 否 |
| POST | /api/v1/cases/import | SYSTEM | 是（幂等） |
| GET | /api/v1/cases | — | 否 |
| GET | /api/v1/cases/{case_id} | — | 否 |
| GET | /api/v1/cases/{case_id}/evidence | — | 否 |
| GET | /api/v1/cases/{case_id}/evidence/{evidence_id} | — | 否 |
| POST | /api/v1/cases/{case_id}/state | SYSTEM（测试钩子） | 是 |
| GET | /api/v1/negative-samples | — | 否 |
| POST | /api/v1/cases/{case_id}/analyses | 任意 actor | 是（幂等键） |
| GET | /api/v1/cases/{case_id}/analyses | — | 否 |
| POST | /api/v1/cases/{case_id}/proposals | 任意 actor | 是（内容寻址幂等） |
| POST | /api/v1/cases/{case_id}/proposals/generate | 任意 actor | 是 |
| GET | /api/v1/cases/{case_id}/proposals | — | 否 |
| GET | /api/v1/proposals/{proposal_id} | — | 否 |
| GET | /api/v1/proposals/{proposal_id}/validation | — | 否 |
| POST | /api/v1/proposals/{proposal_id}/submit | **SPECIALIST** | 是 |
| GET | /api/v1/approvals | — | 否 |
| GET | /api/v1/approvals/{approval_id} | — | 否 |
| POST | /api/v1/approvals/{approval_id}/decision | **MANAGER** | 是（恰好一次） |
| POST | /api/v1/approvals/{approval_id}/replay | **MANAGER** | 是（DB 唯一约束防重） |
| GET | /api/v1/proposals/{proposal_id}/execution | — | 否 |
| GET | /api/v1/cases/{case_id}/executions | — | 否 |
| GET | /api/v1/cases/{case_id}/audit | — | 否 |

错误统一结构（v1.1-candidate 起生效）：

```json
{ "error": { "code": "UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|ILLEGAL_STATE_TRANSITION|VALIDATION_FAILED|REQUEST_INVALID", "message": "…", "details"?: [...], "validation_report"?: {...} } }
```

- `VALIDATION_FAILED`（业务策略阻断，V1–V12）附带 `validation_report`；
- `REQUEST_INVALID`（请求格式错误）附带 `details`；两者语义不同，均为 422；
- 401/403 来自 Demo 身份/角色头（`X-Actor-Id` / `X-Actor-Role`，非生产认证）；
- 完整错误码表见 `SCHEMA_V1.md` §9。

所有状态变更 POST 支持 `Idempotency-Key` 头。
