# SCHEMA_V1 — DisputePilot v2.0 五类核心数据结构（Agent A 提案）

> **status: DRAFT**（提议阶段；评审：Agent B / Agent C；冻结：协调者复制到 `contracts/v1/` 后只读）
> 版本：v1.0-draft + v1.1-candidate 增补（2026-10-17）｜权威参考：`reference/docs/schema.sql`、`S6_1_AI_ACTION_PLAN.md`、
> `S7_AI_BENCHMARK_PLAN.md`、`reference/cases/CANONICAL_CASES_OFFLINE_SNAPSHOT.json`
> 机器可读版本：`contracts_proposal/openapi.v1.yaml`（由运行中的服务导出，字段与此文档一致）

> **v1.1-candidate 增补**（2026-10-17，相对 v1.0-draft）：D-17 CaseOut 增补 `missing_evidence`；
> §1.1 两级哈希命名（D-13）；§6 audit payload 推荐键清单（D-14）；§8 五态→八态映射表（D-16）；
> §5 v1 无 approval TTL 声明（D-08/A-9）；§7 validation GET 返回 null 语义（E-4）；
> §9 统一错误模型与错误码表。详见 `CONTRACT_CHANGELOG.md`。

## 0. 全局硬性规则（写入每个结构的 `$comment`）

1. **溯源标签五选一，禁混写**：`PAYPAL_API_OBSERVED` / `HUMAN_OBSERVED_SANDBOX_UI` /
   `SCENARIO_DEFINED` / `AI_INFERRED` / `SIMULATED_COMPOSITE`。
2. **三个交易 ID 永不相依填充**（order ≠ capture ≠ buyer_transaction_id），除非有 API 明证；
   缺失一律 `UNKNOWN`，禁止 AI 自动填补。
3. **金额 = minor units（整数）+ ISO 4217 三位货币码**，禁止浮点金额。
4. **任何执行类字段必须携带 `execution_authorized`（默认 false）与人工批准引用**。
5. **禁止出现凭据、令牌、真实交易标识**（本工作区红线；脱敏案例的 ID 已删除）。
6. **AI 输出必须显式区分 `analysis_mode`**：`STUB_DETERMINISTIC`（当前唯一模式）或 `LLM`（预留）；
   不得把 Stub 结果报告为真实模型性能。
7. **执行记录必须显式 `execution_mode=REPLAY` + `simulated=true`**；Replay 成功不是 PayPal 成功。

---

## 1. CaseRecord（案件记录）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `case_id` | string | ✅ | 稳定案件标识（O4–O18），前端与 Agent C 引用键 |
| `scenario_id` | string | ✅ | 场景注册表 ID；未知为 `UNKNOWN` |
| `dispute_id` | string | ✅ | PayPal 争议 ID；脱敏案例为 `UNKNOWN`（不重填） |
| `family` | enum | ✅ | `INR` / `SNAD` / `BILLING` |
| `reason` | enum | ✅ | 官方 reason 逐字枚举（含 `UNAUTHORISED` 拼写） |
| `status` | enum | ✅ | **本系统离线工作流态**：IMPORTED/ANALYZED/PROPOSED/PENDING_APPROVAL/APPROVED/REJECTED/REPLAYED/BLOCKED |
| `dispute_status` | enum | ✅ | **观测到的 PayPal 案件状态**（fixture 视角，非 live） |
| `lifecycle_stage` | enum | ✅ | `INQUIRY` / `UNDER_PAYPAL_REVIEW` / `APPEAL` / `RESOLVED` / `UNKNOWN` |
| `amount` | Money | ✅ | `{value_minor:int, currency:"USD", display:"15.00 USD"}` |
| `transaction_reference` | object | ✅ | `{order_id, capture_id, buyer_transaction_id, dispute_id}`，缺失=UNKNOWN |
| `fulfillment_posture` | enum | ✅ | NONE / SHIPPED_NO_TRACKING / SIMULATED_FULFILLMENT / SHIPPED_WITH_TRACKING / REFUNDED |
| `seller_contacted` | bool | ✅ | 买家表单"已联系卖家"的保守映射（非 API 观测） |
| `evidence[]` | EvidenceRecord[] | ✅ | 见 §2 |
| `missing_evidence[]` | string[] | ✅ | 快照逐字保留的缺口描述 |
| `available_actions[]` | object[] | ✅ | `{rel, method, basis}`；`basis` ∈ THEORETICAL_DOC/FIXTURE_SNAPSHOT/LIVE_HATEOAS |
| `evidence_requirements[]` | object[] | ✅ | `{evidence_type, source, open}` |
| `provenance` | enum | ✅ | 案件内容来源标签 |
| `verification_level` | enum | ✅ | FROZEN_SANDBOX_E1_VERIFIED / SCENARIO_DEFINED_OFFLINE_CONTENT / NEGATIVE_CONTROL_REJECTION_TEST_ONLY / UNKNOWN |
| `case_version` | int | ✅ | 案件版本（导入=1） |
| `snapshot_hash` | string | ✅ | 案件事实规范化 JSON 的 sha256 |
| `live_status_note` | string | — | 快照的 live 状态提示（ Sol 独占，勿当当前状态） |
| `created_at` / `updated_at` | string(ISO) | ✅ | UTC |

**证据 ID 规则**：`EV-{case_id}-{BUYER|AV|REQ}-{nnn}`，导入时确定性生成，全生命周期稳定。

**CaseOut（API 投影）说明**：`GET /api/v1/cases/{case_id}` 返回上表字段的 API 投影。
v1.1-candidate 起 CaseOut 增补 `missing_evidence: string[]`（D-17）——与 CaseRecord 一致，
逐字来自快照：`evidence.missing` 列表元素 + `seller_side_expectation.missing_evidence`
单字符串（**作为单个列表项，绝不按字符拆分**；空值 → `[]`）。stub 分析的
`AIAnalysis.missing_evidence` 透传该列表，禁改写。

## 1.1 两级哈希命名约定（D-13）

工作区内存在两种 sha256，命名与语义不得混淆：

| 哈希 | 出现位置 | 计算输入 | 语义 |
|---|---|---|---|
| **案件快照哈希** `CaseRecord.snapshot_hash` | CaseOut.snapshot_hash | 案件事实字段（排除 status/时间戳/版本/自身）的规范化 JSON | 案件内容指纹；重导入不变 |
| **决策上下文哈希** `decision_hash(case, state)` | ProposalOut.snapshot_hash、AIAnalysis.case_snapshot_hash、ApprovalOut.case_snapshot_hash | `{case: 案件快照哈希, state: 运行时状态哈希, state_version}` | 决策时绑定；PayPal 侧状态变化（链接/阶段/状态）即使之失效 |

ApprovalOut.case_snapshot_hash 是**决策上下文哈希**（提交时的绑定值），不是案件快照哈希——
执行期重算比对，漂移即阻断（V9）。

## 2. EvidenceRecord（证据记录）

| 字段 | 类型 | 说明 |
|---|---|---|
| `evidence_id` | string | 稳定 ID（上方规则） |
| `case_id` | string | 所属案件 |
| `evidence_type` | enum | PROOF_OF_FULFILLMENT / PROOF_OF_REFUND / OTHER / BUYER_STATEMENT / ORDER_RECORD / CAPTURE_RECORD / SELLER_COMMUNICATION / CASE_NOTE |
| `content` | string | 证据内容/摘录（投诉文本全文对 BUYER_STATEMENT 生效） |
| `source_type` | string | DISPUTE_BUYER_MESSAGE / CASE_SNAPSHOT / EXPECTED_EVIDENCE_REQUIREMENT 等 |
| `provenance` | enum | 五选一 |
| `verification_level` | enum | 继承案件验证等级 |
| `source_reference` | string | 来源引用（锚点/标签原文），缺失=UNKNOWN |
| `observed_at` | string? | 观测时间；未知为空（不编造） |
| `integrity_hash` | string? | 源材料提供的完整性哈希；快照未提供则为空 |

## 3. AIAnalysis（AI 分析）

| 字段 | 类型 | 说明 |
|---|---|---|
| `analysis_id` | string | `ANL-{case_id}-{ts}-{hash6}` |
| `case_id` / `case_snapshot_hash` | string | 绑定**决策上下文哈希**（案件事实+运行时状态），非仅案件哈希 |
| `factual_summary` | string | 事实摘要 |
| `grounded_facts[]` | object[] | `{fact_id, statement, fact_type, evidence_ids[], provenance}`；**fact_type** ∈ OBSERVED_FACT/SUPPORTED_INFERENCE/UNVERIFIED_CLAIM/MISSING_EVIDENCE；**每条必须引用存在的 Evidence ID** |
| `missing_evidence[]` | string[] | 缺口（逐字来自快照） |
| `contradictions[]` | string[] | 矛盾（无记录=空数组，禁编造） |
| `recommendation` | string | 推荐动作枚举值 |
| `safety_flags[]` | string[] | 安全标记（含"STUB 非真实 LLM"） |
| `model_provider` / `model_name` | string | `deterministic-stub` / `evidence-planner-v1` |
| `analysis_mode` | enum | **STUB_DETERMINISTIC（当前）/ LLM（预留）** |
| `plan` | object | S7 Plan schema 镜像：`{recommended_action, rationale[], gaps[{gap,severity}], alternatives[], wait_rule_applies}` |
| `created_at` | string | UTC |

## 4. ActionProposal（行动提议）

| 字段 | 类型 | 说明 |
|---|---|---|
| `proposal_id` | string | `PRP-{case_id}-{action}-{hash10}`（内容寻址→天然幂等） |
| `case_id` / `analysis_id` | string | 关联 |
| `action_type` | string | V2 白名单枚举值（refund 等不在白名单） |
| `action_payload` | object | **严格 Schema 白名单字段**（V7）；禁内部字段 `_note/_scenario/source/provenance/debug/comment/metadata/internal_label`；写动作必含 `idempotency_key` |
| `expected_preconditions[]` | string[] | 前置条件（含 state basis） |
| `required_evidence[]` | string[] | 所需证据类型 |
| `rationale[]` | string[] | 理由（可审计） |
| `evidence_ids[]` | string[] | 引用证据（必须存在于案件） |
| `risk_level` | enum | LOW/MEDIUM/HIGH |
| `validation_status` | enum | NOT_RUN/PASSED/FAILED |
| `state` | enum | DRAFT/VALIDATED/PENDING_APPROVAL/APPROVED/REJECTED/BLOCKED/REPLAY_EXECUTED/FAILED |
| `snapshot_hash` | string | **决策上下文哈希**（案件+运行时状态） |
| `payload_hash` | string | payload 规范化 sha256 |
| `policy_version` | string | 策略版本 |
| `execution_authorized` | bool | **默认 false**；仅 Manager 批准后为 true |

**动作 payload 离线 Schema（V7 白名单，未来 live adapter 须对照官方规范复核）**：

| action | 允许字段 | 必填 |
|---|---|---|
| send-message | message, idempotency_key | 两者 |
| provide-evidence | evidence_type, notes, idempotency_key | 三者（notes 分支；合成值禁入结构化 tracking_info） |
| make-offer | offer_types, amount, note_to_buyer, idempotency_key | offer_types, idempotency_key |
| accept-claim | accept_claim_types, amount, note_to_buyer, idempotency_key | accept_claim_types, idempotency_key |
| escalate | note, idempotency_key | idempotency_key |
| provide-supporting-info | notes, idempotency_key | idempotency_key |
| wait | （无） | — |

## 5. Approval（审批）

| 字段 | 类型 | 说明 |
|---|---|---|
| `approval_id` | string | `APR-{proposal_id}` |
| `proposal_id` | string | **精确绑定**（DB UNIQUE：一提案一审批） |
| `action_payload_hash` | string | 批准时的 payload 哈希 |
| `case_snapshot_hash` | string | 批准时的决策上下文哈希 |
| `policy_version` | string | 批准时的策略版本 |
| `decision` | enum | PENDING → APPROVED / REJECTED（条件更新，恰好一次） |
| `reason` | string | 决策理由（必填） |
| `actor_id` / `actor_role` | string/enum | MANAGER（决策）；SPECIALIST（提交） |
| `decided_at` | string? | 决策时间（PENDING 时为空） |

**TTL（D-08 / A-9）**：v1 **不设 approval TTL**。审批有效性由哈希绑定保证
（payload/snapshot/policy 任一漂移即执行期阻断），不引入过期时间；
未来若加 TTL 属于 v2 决策，需同步 schema 与错误码。

## 6. AuditEvent（审计事件，append-only）

| 字段 | 类型 | 说明 |
|---|---|---|
| `event_id` | string | 每次事件唯一 |
| `case_id` | string | 可追溯到案件 |
| `event_type` | enum | CASE_IMPORTED / ANALYSIS_CREATED / PROPOSAL_CREATED / VALIDATION_RECORDED / PROPOSAL_SUBMITTED / APPROVAL_DECIDED / EXECUTION_REPLAYED / EXECUTION_BLOCKED / CASE_STATE_CHANGED |
| `actor_type` | enum | HUMAN / SYSTEM / AI（schema.sql 词汇） |
| `actor_id` | string | 操作者 |
| `payload` | object | 事件明细（含验证报告/哈希绑定） |
| `created_at` | string | UTC |

**append-only 执行**：仓库层仅 INSERT；无更新/删除 HTTP 路径（测试断言）。

**9 类事件 payload 推荐键清单（D-14，推荐而非强制；异构 payload 允许附加键）**：

| event_type | actor_type | payload 推荐键 |
|---|---|---|
| CASE_IMPORTED | SYSTEM | `provenance`, `verification_level`, `snapshot_hash`, `evidence_count`, `dispute_id` |
| ANALYSIS_CREATED | AI | `analysis_id`, `analysis_mode`, `case_snapshot_hash` |
| PROPOSAL_CREATED | AI/HUMAN | `proposal_id`, `action_type`, `payload_hash`, `snapshot_hash`, `risk_level`, `analysis_mode` |
| VALIDATION_RECORDED | SYSTEM | `passed`, `findings[{validator_id, status, detail, basis, doc_reference}]`, `blocked_reasons` |
| PROPOSAL_SUBMITTED | HUMAN | `proposal_id`, `approval_id`, `validation_report_id` |
| APPROVAL_DECIDED | HUMAN | `approval_id`, `proposal_id`, `decision`, `reason`, `action_payload_hash`, `case_snapshot_hash`, `policy_version` |
| EXECUTION_REPLAYED | SYSTEM | `execution_id`, `execution_mode`, `simulated`, `approval_id`, `verification`, `artifact` |
| EXECUTION_BLOCKED | SYSTEM | `reasons[]`, `stage` |
| CASE_STATE_CHANGED | SYSTEM | `changes`, `state_version`, `state_hash`, `note` |

## 7. 扩展结构（ExecutionRecord / ValidationReport）

- **ExecutionRecord**：`{execution_id, proposal_id, case_id, execution_mode=REPLAY, simulated=true, result, gateway, request_snapshot, response_snapshot, verification}`；`verification` 含 O4/O5 观测模式（字节级消息比对 / evidences[] diff）与 `basis=FIXTURE_SNAPSHOT`。
  - `result` 为枚举 `REPLAYED` / `BLOCKED` / `FAILED`（v1.1 追加 `EXECUTED` / `UNVERIFIED`，见下）。
  - `request_snapshot` 键：`{action_type, action_payload, idempotency_key, case_snapshot_hash, approval_id, state_version}`。
  - `response_snapshot` 键（离线）：`{simulated: true, execution_mode: "REPLAY", gateway, action, note, …按动作的明细}`。
  - `verification` 键：`{method, basis: "FIXTURE_SNAPSHOT", …按动作的证明字段}`。

### 7.1 v1.1 追加：LIVE 执行结果（向后兼容，仅追加字符串值）

| result | 语义 | 适用 |
|---|---|---|
| `REPLAYED` | 离线回放完成；**绝不是** PayPal 响应 | `execution_mode=REPLAY` |
| `BLOCKED` | 执行前校验/绑定/权限拒绝，未发请求 | 两者 |
| `FAILED` | 网关层失败（4xx/5xx/协议错误） | 两者 |
| `EXECUTED` | 单次 live 请求被接受，且**后续 GET 已确认远端状态** | `execution_mode=LIVE` |
| `UNVERIFIED` | live 请求结果未知（超时/断连/GET 未能确认）；**需人工复核，不自动重试** | `execution_mode=LIVE` |

LIVE 的 `response_snapshot` 键：`{simulated: false, execution_mode: "LIVE", http_status, request_id, remote_summary, raw_sha256}`。
LIVE 的 `verification` 键：`{method: "LIVE_GET", basis: "LIVE_HATEOAS"|"REMOTE_GET", confirmed: bool, checked_at, remote_status, observations}`。

> 兼容性：仅新增两个字符串枚举值；既有 `REPLAYED/BLOCKED/FAILED` 语义、字段、路径均不变。旧客户端遇到未知值应降级展示为"未知结果"，不得当作成功。

### 7.2 v1.2 追加：PENDING 与动作族（向后兼容）

| result | 语义 | 适用 |
|---|---|---|
| `PENDING` | live 请求已被接受，远端状态为处理中（如退款 `PENDING`）；**不得显示为成功**，需后续回查 | `execution_mode=LIVE`，支付类动作 |

### 7.3 v1.3 追加：Frozen AI 模式

`AnalysisMode` 增加 `FROZEN_REPLAY`：表示**预先录制并核实**的分析结果在离线演示中重放，不调用任何模型。UI 必须标注 **Frozen AI Output / Offline Replay**，不得显示为实时推理。

`ProposalOut.action_family`（可选，默认 `DISPUTE`）：`DISPUTE` = 争议侧动作（provide-evidence、send-message 等）；`PAYMENT` = Capture 级资金动作（partial-refund、full-refund）。
**业务规则**：退款成功不等于争议解决；不得自动 accept-claim、关闭争议或推断 Buyer 接受。
- **ValidationReport**：`{report_id, proposal_id, case_id, action_type, passed, blocked_reasons[], findings[V1..V12]}`；每 finding 含 `{validator_id, status, detail, basis, doc_reference}`。
  - `GET /api/v1/proposals/{proposal_id}/validation` 返回 **null = 该提议从未被校验**（NOT_RUN，E-4）；
    返回报告对象时 `passed=false` 表示曾被阻断。

## 8. 与 schema.sql 的差异说明（需评审确认）

| # | schema.sql（Phase 2.2） | 本提案 v1 | 原因 |
|---|---|---|---|
| D1 | action_proposals.state: DRAFT/APPROVED/REJECTED/EXECUTED/CANCELLED | 八态状态机（含 VALIDATED/PENDING_APPROVAL/BLOCKED/FAILED） | 审批与执行分离；安全不变量需要中间态 |
| D2 | 无独立 approvals 表 | 新增 Approval（payload/snapshot/policy 哈希绑定） | M4：审批必须绑定精确提议与快照 |
| D3 | 无 executions 表 | 新增 ExecutionRecord（UNIQUE(proposal_id)） | 重复/并发执行数据库级防御 |
| D4 | 无幂等键表 | 新增 idempotency_keys | 状态变更 POST 幂等 |
| D5 | dispute_status/lifecycle_stage 未分离 | 分离为观测态字段 | 离线工作流态 ≠ PayPal 观测态 |

**D16 — schema.sql 五态 → v1 八态映射表**（评审确认用；旧五值为子集，迁移无损）：

| schema.sql（Phase 2.2） | v1 八态 | 说明 |
|---|---|---|
| DRAFT | DRAFT | 创建后未校验 |
| —（无对应） | VALIDATED | 新增：V1–V12 通过、待提交 |
| —（无对应） | PENDING_APPROVAL | 新增：已提交、等待 Manager |
| APPROVED | APPROVED | Manager 批准 |
| REJECTED | REJECTED | Manager 拒绝 |
| —（无对应） | BLOCKED | 新增：校验/绑定漂移阻断（终态） |
| EXECUTED | REPLAY_EXECUTED | 离线回放完成（终态） |
| CANCELLED | FAILED | 取消/失败统一入 FAILED（终态）；CANCELLED 不再单设 |

---

## 9. 统一错误模型（v1.1-candidate）

所有 4xx 响应使用同一信封（`ErrorResponse` schema）：

```json
{ "error": { "code": "…", "message": "…", "details"?: [...], "validation_report"?: {...} } }
```

| code | HTTP | 触发条件 | 附带字段 |
|---|---|---|---|
| `UNAUTHORIZED` | 401 | 缺少 `X-Actor-Id` demo 身份头 | — |
| `FORBIDDEN` | 403 | 角色不符 / 未知角色 | — |
| `NOT_FOUND` | 404 | 资源 id 不存在 | — |
| `CONFLICT` | 409 | 重复执行 / 已决策 / 状态冲突 | — |
| `ILLEGAL_STATE_TRANSITION` | 409 | 提议状态机非法迁移 | — |
| `VALIDATION_FAILED` | 422 | **业务策略阻断**（V1–V12 / grounding） | `validation_report` |
| `REQUEST_INVALID` | 422 | **请求格式错误**（请求体/参数解析失败） | `details` |
| `DOMAIN_ERROR` | 400 | 未分类域错误（兜底，正常不出现） | — |

**VALIDATION_FAILED 与 REQUEST_INVALID 的区分**：前者是业务规则拒绝（请求格式合法、
策略不合法），带 `validation_report`；后者是请求格式非法（无法进入业务逻辑），带
`details`（FastAPI/pydantic 校验错误列表）。两者均为 422 但语义与附带字段不同。

**认证说明（Demo，非生产）**：身份来自 `X-Actor-Id` / `X-Actor-Role` 请求头，
仅用于演示角色边界（Specialist 不能审批；只有 MANAGER 决策生效）。这是**演示身份头，
不是生产认证**；生产认证（OAuth2/session）是未来端口，已预留 `Authenticator` 协议
（`app/security/authorization.py`）。禁在生产环境信任该头。
