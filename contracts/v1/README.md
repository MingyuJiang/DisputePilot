# contracts/v1/ — 冻结契约目录（v1.0，2026-10-18 已冻结）

> **状态：FROZEN（v1.0）**。冻结报告：`integration/reviews/2026-10-17/FREEZE_REPORT.md`。
> 冻结后本目录**只读**；唯一写入者是协调者。

## 规则

1. **唯一写入者**：协调者。Agent A/B/C 对本目录只读。
2. **内容来源**：Agent A 在 `A-backend/contracts_proposal/` 提议 → B/C 只读评审 → 协调者冻结（附 CHANGELOG + sha256）→ 同步到本目录。
3. **冻结前历史**：Phase 1.5 评审档案在 `integration/reviews/2026-10-17/`（含候选契约 v1.0-candidate/v1.1-candidate、复验报告、决策记录）。冻结前任何 Agent 不得把本目录内容当作稳定接口依据。
4. **变更**：规则见 `../CONTRACT_WORKFLOW.md`；v1.x 向后兼容追加（协调者批准 + CHANGELOG 记录）；v2.0 破坏性变更需三方书面确认 + 协调者批准；禁止并发修改，禁止就地改写已冻结文件。
5. 当前版本内容（v1.0，以 OpenAPI 单一机器可读源 + 人类可读说明的形式交付，替代 Phase 0 预期的五份独立 JSON Schema）：
   - `openapi.v1.yaml` — 机器可读契约（21 paths / 51 schemas；含统一错误模型与 4xx 声明）
   - `SCHEMA_V1.md` — 五类核心数据结构 + 全局硬性规则 + 错误码表 + 认证说明 + 各裁定文档项
   - `API_EXAMPLES.md` — 实跑捕获的完整链路 + 负面示例
   - `CHANGELOG.md` — 版本、日期、变更摘要、与候选版的差异
   - `MANIFEST.sha256` — 逐文件 sha256（校验命令：`sha256sum -c MANIFEST.sha256`）
6. 运行时一致性基准：A-backend commit `6c9e2ca` + `4b9ad67`（79 项测试通过；`openapi()` 导出与本目录 yaml 语义 0 差异——路径集合、schema 集合、逐 schema 内容三重比对）。

## 消费须知（A/B/C）

- **Agent A**：契约变更只能走提案流程；本目录是 API 行为的对账基准。
- **Agent B**：HTTP Adapter 以本目录为唯一契约依据；契约演进经适配层吸收（`src/api/http/types.ts` + `src/api/mapping.ts`）。
- **Agent C**：结构化输出与 M1–M5 取数以本目录 + `EVALUATION_INTERFACE_REQUIREMENTS.md` 为准；Stub/Scenario 纪律不变。
