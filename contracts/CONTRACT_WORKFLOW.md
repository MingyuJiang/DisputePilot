# 契约工作流（CONTRACT WORKFLOW）

> 适用范围：`DisputePilot-dev` 三个 Agent 之间及与协调者之间的所有共享数据结构。
> 目标：单一事实源、可版本化、可冻结、可复现；杜绝"多个 Agent 同时改接口"。

## 1. 契约范围（v1 首批五个）

| 契约 | 内容 | 权威参考 |
|---|---|---|
| Case Record | 争议案件 + 交易关联 + 状态快照 | `reference/docs/schema.sql`（9 表）、`reference/cases/CANONICAL_CASES_OFFLINE_SNAPSHOT.json` |
| AI Analysis | AI 事实提取、缺口分析、建议与理由 | `reference/docs/S6_1_AI_ACTION_PLAN.md`（D1/D2）、`S7_AI_BENCHMARK_PLAN.md` 的 `Plan` schema |
| Action Proposal | 建议动作 + 载荷 + 前置校验结论 | `S6_1_AI_ACTION_PLAN.md` D2/D3（V1–V12）、`API_CAPABILITY_MATRIX.md` §3 |
| Approval | 逐动作人工批准记录（批准人、时间、载荷哈希） | v2 路线图 §6 执行层原则 |
| Audit Event | 执行与验证审计事件 | `schema.sql` 的 `action_audit` 表 |

硬性要求（来自项目既有纪律，写入每个契约的 `$comment`）：

- 溯源标签五选一，禁混写：`PAYPAL_API_OBSERVED` / `HUMAN_OBSERVED_SANDBOX_UI` /
  `SCENARIO_DEFINED` / `AI_INFERRED` / `SIMULATED_COMPOSITE`；
- 三个交易 ID（order / capture / buyer_transaction）永不相依填充，除非有 API 明证；
- 任何执行类字段必须携带 `execution_authorized`（默认 false）与人工批准引用；
- 金额一律 minor units + ISO 货币码（与 schema.sql 一致）；
- 禁止出现凭据、令牌、真实交易标识字段（开发工作区红线）。

## 2. 生命周期

```text
提议（Agent A）→ 评审（B/C 只读评论）→ 冻结（协调者）→ 发布（contracts/v1/）→ 消费（A/B/C）
```

1. **提议**：Agent A 在 `A-backend/contracts_proposal/vX/` 维护 JSON Schema（draft 2020-12）
   + 人类可读说明 + `examples/`（必须来自 reference/cases 脱敏快照或等价自造数据）。
   每个提议文件头部注明 `status: DRAFT`。
2. **评审**：B/C 在各自目录内写评审笔记（`B-frontend/reviews/`、`C-evaluation/reviews/`），
   通过协调者转交 A；禁止直接改 A 的提议文件。
3. **冻结**：协调者确认无异议后，将整套文件复制到 `contracts/v1/`，
   写入 `CHANGELOG.md`（版本、日期、变更摘要、文件 sha256），并通知三个 Agent。
   冻结后 `contracts/v1/` 只读。
4. **消费**：A/B/C 只从 `contracts/v1/` 读取契约；代码中的类型/校验器必须由 schema 生成或
   与其一致，禁止手写漂移。

## 3. 版本规则

- `v1.x`：向后兼容的追加（新可选字段、新枚举值、说明修订）——协调者批准即可，CHANGELOG 记录。
- `v2.0`：任何破坏性变更（删除/重命名字段、收紧必填、改变语义）——需要三方 Agent 书面确认 +
  协调者批准，并在 CHANGELOG 中写明迁移说明。
- 热修复（安全/凭据相关）：协调者可直接冻结补丁版本，事后通知。

## 4. 禁止事项

- 禁止两个或以上 Agent 同时修改同一契约（含并行提议互相覆盖）；
- 禁止在未冻结的提议上开始联调代码的硬依赖（可用适配层隔离）；
- 禁止把真实 PayPal 标识、凭据、买家个人信息写入契约或示例；
- 禁止删除或改写 `contracts/v1/` 已发布文件（只能新增版本）。
