# CHANGELOG — contracts/v1 冻结契约变更记录

> 唯一写入者：协调者（Integration Coordinator）。冻结流程见 `../CONTRACT_WORKFLOW.md` §2。
> 冻结后本目录只读；变更只能通过新版本（v1.x 向后兼容追加 / v2.0 破坏性变更）。

## v1.3 — 2026-10-21（协调者，Final RC）

**变更类型**：向后兼容的追加式扩展。

| # | 文件 | 变更 |
|---|---|---|
| 1 | `openapi.v1.yaml` | `AnalysisMode` 追加 `FROZEN_REPLAY`；`info.version` 1.2.0 → 1.3.0 |
| 2 | `SCHEMA_V1.md` | §7.3 Frozen AI 标注要求 |
| 3 | `MANIFEST.sha256` | 重算 |

无路径变更；`FROZEN_REPLAY` 仅新增枚举值，旧客户端可降级显示。

---

## v1.2 — 2026-10-20（协调者，P0 多动作集成）

**变更类型**：向后兼容的**追加式**扩展。

| # | 文件 | 变更 |
|---|---|---|
| 1 | `openapi.v1.yaml` | `ExecutionResult` 追加 `PENDING`（live 支付处理中）；`ProposalOut` 追加可选 `action_family`（DISPUTE \| PAYMENT，默认 DISPUTE）；`info.version` 1.1.0 → 1.2.0 |
| 2 | `SCHEMA_V1.md` | §7.2：PENDING 语义与动作族规则（退款 ≠ 争议解决） |
| 3 | `MANIFEST.sha256` | 重算 |

### 兼容性

- 无路径变更；`PENDING` 仅新增值；`action_family` 非 required，旧客户端可忽略。
- 既有 `REPLAYED/BLOCKED/FAILED/EXECUTED/UNVERIFIED` 语义不变。

### 回归

- A：运行时 OpenAPI 与文件 0 差异；全量测试通过。
- B：类型/标签适配；全量测试通过。

---

## v1.1 — 2026-10-19（协调者，经用户书面批准）

**变更类型**：向后兼容的**追加式**枚举扩展（用户批准原文：追加 EXECUTED、UNVERIFIED，保持向后兼容）。
**触发**：PayPal Sandbox 真实写操作需要诚实区分"已执行并经 GET 确认"与"结果未知待核验"。

### 变更内容

| # | 文件 | 变更 |
|---|---|---|
| 1 | `openapi.v1.yaml` | `ExecutionResult` 追加 `EXECUTED`、`UNVERIFIED`；`info.version` 0.1.0 → 1.1.0；描述注明 v1.1 追加 |
| 2 | `SCHEMA_V1.md` | §7 增加 7.1 节（LIVE result 语义、response_snapshot/verification 键） |
| 3 | `MANIFEST.sha256` | 重算 openapi/SCHEMA 哈希（API_EXAMPLES 不变） |

### 兼容性

- 无路径/字段增删；既有枚举值语义不变；REPLAY 路径完全不受影响。
- 旧客户端遇到新值应显示"未知结果"，不得视为成功（前端已在类型注释中预留）。

### 回归要求（已执行）

- A：契约导出与文件逐 schema 比对 0 差异；全量测试通过。
- B：结果类型/台账/标签覆盖新值；全量测试通过。
- E2E：离线九场景 9/9 通过（REPLAY 语义不变）。

---

## v1.0 — 2026-10-18（协调者冻结）

**来源**：Agent A 提案（v1.0-draft → v1.0-candidate → v1.1-candidate 修复后定稿）
**冻结依据**：`integration/reviews/2026-10-17/FREEZE_REPORT.md`（四项阻断全部关闭 + B/C 评审回收）
**复验基线**：A-backend commit `6c9e2ca` + `4b9ad67`（79 项测试通过；OpenAPI 导出与运行时 0 差异）

### 本版内容

- `openapi.v1.yaml` — 21 paths / 51 schemas（含 ErrorResponse/ErrorBody/ErrorCode 统一错误模型、ExecutionOut/SubmitOut/StateUpdateOut/NegativeSamplesOut/HealthOut 等强类型响应、50 处 4xx 声明、demo 角色头非生产标注）
- `SCHEMA_V1.md` — 五类核心结构 + 全局硬性规则 + 错误码表（§9）+ 认证说明（demo，非生产）+ 两级哈希命名（§1.1）+ audit payload 推荐键清单（§6）+ 五态→八态映射表（§8）+ validation null 语义（§7）+ v1 无 approval TTL 声明（§5）+ CaseOut.missing_evidence
- `API_EXAMPLES.md` — 完整 INR 链路实跑捕获 + 负面示例（含统一错误信封形状）
- `MANIFEST.sha256` — 逐文件 sha256

### 相对 v1.0-candidate（2026-10-17 协调者存档版）的变更

| # | 变更 | 来源 |
|---|---|---|
| 1 | A-1：`missing_evidence` 逐字规范化（str→单元素，修复字符爆炸）；**全部案例 snapshot_hash 随之变化**（D-01 预期内） | A commit 6c9e2ca |
| 2 | A-2：7 个端点 200 响应由无约束 object 收窄为强类型模型（字段零增删）；新增 10 个 schema；`ExecutionRecord.result` 固化为枚举 | A commit 6c9e2ca |
| 3 | A-3：统一错误模型（8 错误码；401/403/404/409/422 全部入 OpenAPI；REQUEST_INVALID 与 VALIDATION_FAILED 明确区分）；ErrorResponse 注册进 components（消除悬空 $ref） | A commit 6c9e2ca + 4b9ad67 |
| 4 | 文档：D-13/D-14/D-16/D-08/E-4/A-10 裁定项落地；CONTRACT_CHANGELOG v1.1-candidate 条目 | A commit 6c9e2ca |
| 5 | Breaking changes：无路径/schema 增删；唯一消费方适配点为 401/403 响应体由 `{"detail":…}` 改为统一信封（B 适配器已双形状容错） | 协调者复验确认 |

### 已知非阻断项（v1.x backlog，详见 FREEZE_REPORT §5）

- `CaseSummaryOut` 补 `scenario_id`（C 评审 §7）
- `plan` schema 化为 `PlanOut`（C 评审 §3/§6）
- `validator_id` canonical 枚举 + V9 离线语义澄清（C 评审 §5）
- `ValidationFindingOut.status` canonical 值集合（C 评审 §5）
- `execution_authorized` 移入 ProposalOut.required（C 评审 §5）
- `evidence_id` 补 pattern（C 评审 §2）
- MISSING_EVIDENCE 的 evidence_ids 语义澄清（C 评审 §2）
- 案例级 provenance 为“最强来源摘要”的澄清（C 评审 §1）
- 历史分析 plan 持久化 / `plan_as_of`（A-6，C 时序评测前置）
- legacy CANCELLED 映射目标口径统一（A 的 D-16 表为 FAILED；B 笔记为 REJECTED+reason——UI 层表述，无运行时影响）
