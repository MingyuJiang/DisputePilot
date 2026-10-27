/**
 * UI dictionary (zh-CN + en).
 *
 * Every entry is a pair so the two languages cannot drift apart by key. Only
 * UI chrome lives here: case text, evidence excerpts, model output, validator
 * findings and audit summaries are backend/fixture data and are rendered
 * verbatim in both languages.
 */

export type Lang = "zh-CN" | "en";

export const messages = {
  /* ---------------------------------- common --------------------------------- */
  "common.cancel": { en: "Cancel", zh: "取消" },
  "common.close": { en: "Close", zh: "关闭" },
  "common.open": { en: "Open", zh: "打开" },
  "common.review": { en: "Review", zh: "审核" },
  "common.all": { en: "All", zh: "全部" },
  "common.done": { en: "Done", zh: "完成" },
  "common.yes": { en: "Yes", zh: "是" },
  "common.no": { en: "No", zh: "否" },
  "common.notAvailable": { en: "—", zh: "—" },
  "common.technicalDetails": { en: "Technical details", zh: "技术细节" },
  "common.code": { en: "code", zh: "代码" },
  "common.detailCodes": { en: "details", zh: "明细" },
  "common.originalMessage": { en: "Original message", zh: "原始报文" },
  "common.updated": { en: "updated {at}", zh: "更新于 {at}" },
  "common.of": { en: "of", zh: "/" },
  "common.closeDialog": { en: "Close dialog", zh: "关闭对话框" },
  "common.dialog": { en: "Dialog", zh: "对话框" },
  "common.closeEvidencePanel": { en: "Close evidence panel", zh: "关闭证据面板" },
  "common.closePanel": { en: "Close panel", zh: "关闭面板" },
  "common.detailPanel": { en: "Detail panel", zh: "详情面板" },
  "common.loadingWorkspace": { en: "Loading workspace…", zh: "正在加载工作区…" },

  /* ------------------------------- app / nav -------------------------------- */
  "app.name": { en: "DisputePilot", zh: "DisputePilot" },
  "app.subtitle": { en: "Dispute operations", zh: "争议运营" },
  "app.documentTitle": {
    en: "DisputePilot — Dispute Operations",
    zh: "DisputePilot — 争议运营",
  },
  "nav.primary": { en: "Primary", zh: "主导航" },
  "nav.workspace": { en: "Workspace", zh: "工作区" },
  "nav.overview": { en: "Overview", zh: "概览" },
  "nav.cases": { en: "Cases", zh: "案件" },
  "nav.approvals": { en: "Approvals", zh: "审批" },
  "nav.audit": { en: "Executions & audit", zh: "执行与审计" },
  "nav.demo": { en: "Demo", zh: "演示" },
  "nav.guidedDemo": { en: "Guided demo", zh: "引导演示" },
  "nav.flows": { en: "5 scenarios", zh: "5 个场景" },
  "nav.offlineReplay": { en: "Offline replay", zh: "离线回放" },
  "nav.executionMode": { en: "Execution mode", zh: "运行模式" },
  "nav.offlineNote": {
    en: "All cases, evidence and execution results are local fixtures. No PayPal API is connected.",
    zh: "所有案件、证据与执行结果均为本地固定数据，未连接 PayPal API。",
  },
  "nav.reset": { en: "Reset demo data", zh: "重置演示数据" },
  "nav.resetUnavailable": {
    en: "Demo reset lives in the guided demo and only works against the offline replay backend.",
    zh: "演示重置位于引导演示中，且仅在离线回放后端可用。",
  },
  "nav.footer": { en: "DisputePilot v2.0 · Offline Demo", zh: "DisputePilot v2.0 · 离线演示" },
  "nav.footerBuild": { en: "Local replay · no live API", zh: "本地回放 · 无实时 API" },
  "nav.footerSandbox": { en: "DisputePilot v2.0 · Sandbox", zh: "DisputePilot v2.0 · Sandbox" },
  "nav.footerBuildSandbox": {
    en: "PayPal Sandbox · controlled execution",
    zh: "PayPal Sandbox · 受控执行",
  },
  "nav.footerBuildSandboxReadOnly": {
    en: "PayPal Sandbox · read-only (execution disabled)",
    zh: "PayPal Sandbox · 只读（未启用执行）",
  },
  "nav.footerBuildSandboxUnconfirmed": {
    en: "PayPal Sandbox · execution status unconfirmed",
    zh: "PayPal Sandbox · 执行状态未确认",
  },

  /* --------------------------------- topbar --------------------------------- */
  "topbar.openNav": { en: "Open navigation", zh: "打开导航" },
  "topbar.closeNav": { en: "Close navigation", zh: "关闭导航" },
  "topbar.breadcrumb": { en: "Breadcrumb", zh: "面包屑" },
  "topbar.crumbOverview": { en: "Overview", zh: "概览" },
  "topbar.crumbCases": { en: "Cases", zh: "案件" },
  "topbar.crumbApprovals": { en: "Approvals", zh: "审批" },
  "topbar.crumbAudit": { en: "Executions & audit", zh: "执行与审计" },
  "topbar.crumbDemo": { en: "Guided demo", zh: "引导演示" },
  "topbar.demoGuide": { en: "Demo guide", zh: "演示指南" },
  "topbar.offlineReplay": { en: "Offline replay", zh: "离线回放" },
  "topbar.demoNoticeLabel": { en: "Demo data.", zh: "演示数据。" },
  "topbar.demoNotice": {
    en: "Cases, AI output, approvals and execution results are local fixtures. No PayPal API is called. Approving an action authorizes a simulated replay attempt only.",
    zh: "案件、AI 输出、审批与执行结果均为本地固定数据，未调用 PayPal API。批准操作仅授权一次模拟回放尝试。",
  },
  "topbar.dismissNotice": { en: "Dismiss demo notice", zh: "关闭演示提示" },
  "topbar.currentRole": { en: "Current role: {role}", zh: "当前角色：{role}" },

  /* ---------------------------------- role ---------------------------------- */
  "role.specialist": { en: "Specialist", zh: "专员" },
  "role.manager": { en: "Manager", zh: "经理" },
  "role.specialistTitle": { en: "Dispute Operations Specialist", zh: "争议运营专员" },
  "role.managerTitle": { en: "Dispute Operations Manager", zh: "争议运营经理" },
  "role.switchGroup": { en: "Switch demo role", zh: "切换演示角色" },

  /* -------------------------------- language -------------------------------- */
  "language.label": { en: "Language", zh: "语言" },
  "language.zh": { en: "中文", zh: "中文" },
  "language.en": { en: "EN", zh: "EN" },
  "language.switchTo": { en: "Switch language to {lang}", zh: "切换语言为{lang}" },

  /* -------------------------------- case queue ------------------------------- */
  "queue.eyebrow": { en: "Case queue", zh: "案件队列" },
  "queue.title": { en: "My disputes", zh: "我的争议" },
  "queue.description": {
    en: "Every case is analysed against its own evidence, and every proposed action is checked against the capability snapshot before it can run. Missing evidence stays visible.",
    zh: "每个案件都基于自身证据进行分析；每个拟执行操作都必须先通过能力快照校验。缺失的证据始终可见。",
  },
  "queue.guidedDemo": { en: "Guided demo", zh: "引导演示" },
  "queue.kpi.openCases": { en: "Open cases", zh: "待处理案件" },
  "queue.kpi.awaitingApproval": { en: "Awaiting approval", zh: "待审批" },
  "queue.kpi.awaitingDetail": {
    en: "Manager decision required before any execution",
    zh: "任何执行前均需经理决策",
  },
  "queue.kpi.blockedActions": { en: "Blocked actions", zh: "受阻操作" },
  "queue.kpi.blockedDetail": {
    en: "Policy, evidence or capability constraint",
    zh: "政策、证据或能力约束",
  },
  "queue.kpi.gaps": { en: "Cases with evidence gaps", zh: "存在证据缺口的案件" },
  "queue.kpi.gapsDetail": {
    en: "At least one requested item is missing",
    zh: "至少一项所需材料缺失",
  },
  "queue.searchPlaceholder": { en: "Search case, item or claim", zh: "搜索案件、商品或主张" },
  "queue.searchLabel": { en: "Search cases", zh: "搜索案件" },
  "queue.filterType": { en: "Filter by dispute type", zh: "按争议类型筛选" },
  "queue.allTypes": { en: "All types", zh: "全部类型" },
  "queue.typeInr": { en: "INR — item not received", zh: "INR — 未收到商品" },
  "queue.typeSnad": { en: "SNAD — not as described", zh: "SNAD — 与描述不符" },
  "queue.typeBilling": { en: "Billing", zh: "账单问题" },
  "queue.filterStatus": { en: "Filter by status", zh: "按状态筛选" },
  "queue.allStatuses": { en: "All statuses", zh: "全部状态" },
  "queue.filterRisk": { en: "Filter by risk", zh: "按风险筛选" },
  "queue.allRisk": { en: "All risk levels", zh: "全部风险等级" },
  "queue.riskLow": { en: "Low", zh: "低" },
  "queue.riskMedium": { en: "Medium", zh: "中" },
  "queue.riskHigh": { en: "High", zh: "高" },
  "queue.riskBlocked": { en: "Blocked", zh: "受阻" },
  "queue.clearCount": { en: "Clear {count}", zh: "清除 {count} 项" },
  "queue.showing": { en: "{shown} of {total} cases", zh: "共 {total} 个案件，显示 {shown} 个" },
  "queue.sortedBy": { en: "Sorted by {key}", zh: "排序：{key}" },
  "queue.sort.caseId": { en: "Case", zh: "案件" },
  "queue.sort.amount": { en: "Amount", zh: "金额" },
  "queue.sort.readiness": { en: "Evidence", zh: "证据" },
  "queue.sort.updated": { en: "Updated", zh: "更新时间" },
  "queue.colCase": { en: "Case", zh: "案件" },
  "queue.colType": { en: "Type", zh: "类型" },
  "queue.colStatus": { en: "Status", zh: "状态" },
  "queue.colAmount": { en: "Amount", zh: "金额" },
  "queue.colEvidence": { en: "Evidence", zh: "证据" },
  "queue.colAi": { en: "AI review", zh: "AI 分析" },
  "queue.colRisk": { en: "Risk", zh: "风险" },
  "queue.colNext": { en: "Next action", zh: "下一步" },
  "queue.colOpen": { en: "Open", zh: "打开" },
  "queue.noMatchTitle": { en: "No cases match these filters", zh: "没有符合筛选条件的案件" },
  "queue.noMatchBody": {
    en: "Clear a filter or search for a different case reference. The queue contains {count} fixture cases.",
    zh: "请清除筛选条件或搜索其他案件编号。队列中共有 {count} 个固定演示案件。",
  },
  "queue.noMatchBodyConnected": {
    en: "Clear a filter or search for a different case reference. The queue contains {count} cases.",
    zh: "请清除筛选条件或搜索其他案件编号。队列中共有 {count} 个案件。",
  },
  "queue.clearFilters": { en: "Clear filters", zh: "清除筛选" },
  "queue.fixtureLine": {
    en: "Showing {shown} of {total} cases · fixture set 2026-10-17",
    zh: "共 {total} 个案件，显示 {shown} 个 · 固定数据集 2026-10-17",
  },
  "queue.legendE1": { en: "E1 verified reference", zh: "E1 已核验参考" },
  "queue.legendScenario": { en: "Scenario-defined", zh: "场景定义" },
  "queue.legendNotRun": { en: "AI not run", zh: "AI 未运行" },
  "queue.aiAnalysed": { en: "Analysed", zh: "已分析" },
  "queue.aiRunning": { en: "Running", zh: "运行中" },
  "queue.aiNotStarted": { en: "Not started", zh: "未开始" },

  /* --------------------------------- overview -------------------------------- */
  "overview.eyebrow": { en: "Workspace", zh: "工作区" },
  "overview.title": { en: "Overview", zh: "概览" },
  "overview.description": {
    en: "What is true, what is missing and what needs a decision next. Counts are derived from the currently loaded cases — the backend exposes no global queue.",
    zh: "当前事实、缺失内容与下一步决策。队列数量由已加载的案件推导——后端没有全局队列接口。",
  },
  "overview.derived": {
    en: "Derived from {count} loaded cases. Not a backend aggregate.",
    zh: "由已加载的 {count} 个案件推导，并非后端聚合结果。",
  },
  "overview.notLoaded": {
    en: "The workspace has not loaded, so counts are unavailable.",
    zh: "工作区尚未加载，无法给出数量。",
  },
  "overview.viewAll": { en: "View all", zh: "查看全部" },
  "overview.queueEmpty": { en: "Nothing in this queue", zh: "此队列为空" },
  "overview.showingTop": { en: "First {shown} of {total}", zh: "共 {total} 项，显示前 {shown} 项" },
  "overview.recentTitle": { en: "Recent activity", zh: "最近活动" },
  "overview.recentDescription": {
    en: "Last 8 audit events across the loaded cases.",
    zh: "已加载案件的最近 8 条审计事件。",
  },
  "overview.recentEmpty": {
    en: "No audit events are loaded yet.",
    zh: "尚未加载审计事件。",
  },

  /* ------------------------------ cases (redesign) --------------------------- */
  "cases.eyebrow": { en: "My disputes", zh: "我的争议" },
  "cases.description": {
    en: "Every case answers the same questions: what state is it in, what does the AI know, what is the next step and where did the facts come from?",
    zh: "每个案件都回答同样的问题：处于什么状态、AI 掌握了什么、下一步做什么、事实来自哪里。",
  },
  "cases.kpi.open": { en: "Open cases", zh: "待处理案件" },
  "cases.kpi.openDetail": { en: "Loaded in this workspace", zh: "当前工作区已加载" },
  "cases.kpi.approvalDetail": { en: "Needs a manager decision", zh: "需要经理决策" },
  "cases.kpi.blockedDetail": { en: "Validator or execution block", zh: "校验或执行阻断" },
  "cases.searchPlaceholder": { en: "Search case id or title", zh: "搜索案件编号或标题" },
  "cases.searchLabel": { en: "Search cases", zh: "搜索案件" },
  "cases.filterFamily": { en: "Filter by family", zh: "按案件类型筛选" },
  "cases.allFamilies": { en: "All families", zh: "全部类型" },
  "cases.filterState": { en: "Filter by case state", zh: "按案件状态筛选" },
  "cases.allStates": { en: "All case states", zh: "全部案件状态" },
  "cases.filterSource": { en: "Filter by source", zh: "按来源筛选" },
  "cases.allSources": { en: "All sources", zh: "全部来源" },
  "cases.sortLabel": { en: "Sort cases", zh: "案件排序" },
  "cases.sort.updated": { en: "Recently updated", zh: "最近更新" },
  "cases.sort.amount": { en: "Amount", zh: "金额" },
  "cases.sort.caseId": { en: "Case id", zh: "案件编号" },
  "cases.colCase": { en: "Case", zh: "案件" },
  "cases.colFamilyAmount": { en: "Family · amount", zh: "类型 · 金额" },
  "cases.colState": { en: "Case state", zh: "案件状态" },
  "cases.colAi": { en: "AI status", zh: "AI 状态" },
  "cases.colNext": { en: "Next step", zh: "下一步" },
  "cases.colSource": { en: "Source", zh: "来源" },
  "cases.showing": { en: "{shown} of {total} cases", zh: "共 {total} 个案件，显示 {shown} 个" },
  "cases.clearFilters": { en: "Clear filters", zh: "清除筛选" },
  "cases.clearCount": { en: "Clear {count}", zh: "清除 {count} 项" },
  "cases.emptyTitle": { en: "No cases are loaded", zh: "没有加载到案件" },
  "cases.emptyBody": {
    en: "A successful read returned zero cases. This is not a filter result.",
    zh: "读取成功但返回 0 个案件；这不是筛选结果。",
  },
  "cases.noMatchTitle": { en: "No cases match these filters", zh: "没有符合筛选条件的案件" },
  "cases.noMatchBody": {
    en: "Clear the filters or search a different case reference.",
    zh: "请清除筛选条件，或搜索其他案件编号。",
  },
  "cases.loadFailedTitle": { en: "The case list could not be loaded", zh: "无法加载案件列表" },
  "cases.loadFailedBody": {
    en: "The request failed, so no rows are shown. This is not an empty queue.",
    zh: "请求失败，因此不显示任何行；这不代表队列为空。",
  },

  /* ------------------------------- case workspace ---------------------------- */
  "workspace.notFoundTitle": { en: "Case not found", zh: "未找到案件" },
  "workspace.notFoundBody": {
    en: "There is no fixture case with reference {caseId}.",
    zh: "固定数据集中不存在编号为 {caseId} 的案件。",
  },
  "workspace.backToQueue": { en: "Back to case queue", zh: "返回案件队列" },
  "workspace.disputedAmount": { en: "Disputed amount", zh: "争议金额" },
  /* PAYMENT cases refund a capture; they are not disputes. */
  "workspace.captureAmount": { en: "Capture amount", zh: "Capture 金额" },
  "workspace.validationFrozen": { en: "Frozen E1 reference", zh: "冻结 E1 参考" },
  "workspace.validationScenario": { en: "Scenario-defined fixture", zh: "场景定义数据" },
  "workspace.toast.analysisDone": { en: "Analysis completed", zh: "分析完成" },
  "workspace.toast.analysisDoneHttp": {
    en: "The backend result is loaded. Check the analysis mode, model label and unverified claims before acting.",
    zh: "已加载后端结果。操作前请检查分析模式、模型标识与未经核实的声明。",
  },
  "workspace.toast.analysisDoneMock": {
    en: "The fixture analysis is loaded. Facts, gaps and the recommendation are ready for review.",
    zh: "已加载固定分析结果。事实、缺口与建议可供审阅。",
  },
  "workspace.toast.generated": { en: "Proposal generated", zh: "已生成处理建议" },
  "workspace.toast.generatedDetail": {
    en: "The backend created a draft proposal. Review the action, evidence and validator result before submitting.",
    zh: "后端已创建草稿提案。提交前请审阅操作、证据与校验结果。",
  },
  "workspace.toast.generateFailed": { en: "Proposal generation failed", zh: "生成处理建议失败" },
  "workspace.toast.submitted": { en: "Submitted for manager approval", zh: "已提交经理审批" },
  "workspace.toast.submittedDetail": {
    en: "{action} is now in the approval queue. Nothing has been executed.",
    zh: "{action} 已进入审批队列，尚未执行任何操作。",
  },
  "workspace.toast.snapshotRefreshed": { en: "Snapshot refreshed", zh: "已刷新快照" },
  "workspace.toast.snapshotRefreshedDetail": {
    en: "The freshness check now passes. The proposal is back in draft.",
    zh: "时效校验已通过，提案已回到草稿状态。",
  },
  "workspace.toast.nothingToRefresh": { en: "Nothing to refresh", zh: "无可刷新内容" },
  "workspace.toast.nothingToRefreshDetail": {
    en: "This case has no blocked proposal that can be refreshed.",
    zh: "该案件没有可刷新的受阻提案。",
  },
  "workspace.toast.evidenceRequested": {
    en: "Evidence request recorded in the demo",
    zh: "已在演示中记录证据请求",
  },
  "workspace.toast.evidenceRequestedDetail": {
    en: "No message is sent from this prototype. In production this becomes a send-message proposal.",
    zh: "此原型不会发送任何消息。生产环境中这会成为一条“发送消息”提案。",
  },

  /* ------------------------------ AI intelligence ---------------------------- */
  "ai.title": { en: "AI intelligence", zh: "AI 分析" },
  "ai.status.processing": { en: "Processing", zh: "处理中" },
  "ai.status.failed": { en: "Failed", zh: "失败" },
  "ai.status.notStarted": { en: "Not started", zh: "未开始" },
  "ai.emptyTitle": { en: "No analysis for {caseId} yet", zh: "{caseId} 尚无分析" },
  "ai.emptyBody": {
    en: "The analysis extracts grounded facts, lists every evidence gap, and produces a recommendation that the policy validator can check. Facts without a source stay labelled as unverified.",
    zh: "分析会提取有依据的事实、列出所有证据缺口，并生成可由政策校验器检查的建议。无来源的事实始终标注为未经核实。",
  },
  "ai.run": { en: "Run AI analysis", zh: "运行 AI 分析" },
  "ai.emptyFootnote": {
    en: "No result is generated in this browser · no PayPal request · nothing is executed",
    zh: "浏览器内不生成结果 · 不请求 PayPal · 不执行任何操作",
  },
  "ai.reRun": { en: "Re-run", zh: "重新运行" },
  "ai.frozen": { en: "Frozen", zh: "已冻结" },
  "ai.frozenTitle": {
    en: "Frozen E1 reference — the fixture analysis is fixed to the verified trace.",
    zh: "冻结的 E1 参考 — 固定分析结果绑定已核验轨迹。",
  },
  "ai.reRunTitle": {
    en: "Run the analysis again (one request per click; never automatic)",
    zh: "再次运行分析（每次点击一次请求，绝不自动重试）",
  },
  "ai.liveAi": { en: "Live AI", zh: "实时 AI" },
  "ai.liveAiTitle": {
    en: "Check /llm/status and ask the backend for a live model run. No live model means an explicit error — never a silent stub.",
    zh: "先检查 /llm/status，再请求后端执行实时模型分析。无可用模型时明确报错，绝不静默降级为桩。",
  },
  "ai.liveAiChecking": { en: "Checking the live model…", zh: "正在检查实时模型…" },
  "ai.frozenOutput": {
    en: "Frozen AI output — a pre-recorded analysis replayed offline. No model was called for this screen.",
    zh: "冻结 AI 输出 — 预先录制的分析在离线回放，本页面未调用任何模型。",
  },
  "ai.caseSummary": { en: "Case summary", zh: "案件摘要" },
  "ai.localInference": {
    en: "local model inference — no PayPal call",
    zh: "本地模型推理 — 不调用 PayPal",
  },
  "ai.stub": { en: "deterministic stub — no model call", zh: "确定性桩 — 不调用模型" },
  "ai.fixtureLabel": { en: "fixture model label", zh: "固定数据模型标识" },
  "ai.uncertaintyLabel": { en: "Model-reported uncertainty:", zh: "模型自报不确定性：" },
  "ai.uncertaintyNote": {
    en: "(self-reported, not a calibrated probability or a policy signal)",
    zh: "（自报值，非校准概率，也非政策信号）",
  },
  "ai.paypalRequested": { en: "PayPal requested", zh: "PayPal 要求材料" },
  "ai.reqOpen": { en: "Open", zh: "待提供" },
  "ai.reqSatisfied": { en: "Satisfied", zh: "已满足" },
  "ai.tabFacts": { en: "Grounded facts", zh: "有依据事实" },
  "ai.tabGaps": { en: "Evidence gaps", zh: "证据缺口" },
  "ai.tabContradictions": { en: "Contradictions", zh: "矛盾" },
  "ai.tabIntegrity": { en: "Unverified / missing", zh: "未核实 / 缺失" },
  "ai.noFacts": {
    en: "No grounded facts were extracted. This is a signal, not an empty panel.",
    zh: "未提取到有依据的事实。这是一个信号，而非空面板。",
  },
  "ai.noGaps": {
    en: "No evidence gaps were found in the current record set.",
    zh: "当前记录集中未发现证据缺口。",
  },
  "ai.noContradictions": {
    en: "No contradiction detected across the records on file.",
    zh: "已存档记录中未发现矛盾。",
  },
  "ai.unverifiedNote": {
    en: "Unverified claim — no supporting record was matched. This must not be read as a verified fact.",
    zh: "未经核实的声明 — 未匹配到支持记录。不得将其视为已核实事实。",
  },
  "ai.basis": { en: "Basis: {basis}", zh: "依据：{basis}" },
  "ai.claimsNoRecord": { en: "Claims without a supporting record", zh: "无支持记录的声明" },
  "ai.noUnverified": {
    en: "No unverified or missing facts were returned by the backend.",
    zh: "后端未返回未核实或缺失的事实。",
  },
  "ai.missingTitle": { en: "Missing evidence reported by the backend", zh: "后端报告的缺失证据" },
  "ai.noMissing": { en: "No missing_evidence entries were returned.", zh: "未返回 missing_evidence 条目。" },
  "ai.validatorNote": {
    en: "Validator findings (V1–V12) are deterministic and appear under Action safety. The model cannot set validation, approval or execution state.",
    zh: "校验结论（V1–V12）是确定性结果，显示于“操作安全”面板。模型无法设置校验、审批或执行状态。",
  },
  "ai.sourceLabels": {
    en: "Source labels: AI_INFERRED = model inference · SCENARIO_DEFINED = authored fixture · REPLAY_SIMULATED = offline replay, not a PayPal response or adjudication.",
    zh: "来源标签：AI_INFERRED = 模型推理 · SCENARIO_DEFINED = 场景编写数据 · REPLAY_SIMULATED = 离线回放，非 PayPal 响应或裁决。",
  },
  "ai.legendToggle": { en: "How to read these labels", zh: "如何理解这些标签" },
  "ai.legend.VERIFIED_OBSERVATION": {
    en: "Recorded in a frozen API trace or sandbox fixture.",
    zh: "记录于冻结的 API 轨迹或沙箱固定数据。",
  },
  "ai.legend.SCENARIO_DEFINED": {
    en: "Authored for the scenario; not observed from PayPal.",
    zh: "为场景编写，并非来自 PayPal 的观测。",
  },
  "ai.legend.AI_INFERENCE": {
    en: "Derived by the analysis; never treated as evidence.",
    zh: "由分析推导，绝不作为证据。",
  },
  "ai.legend.UNVERIFIED_CLAIM": {
    en: "Asserted without a supporting record; shown as unverified.",
    zh: "无支持记录的声明，标注为未核实。",
  },
  "ai.legend.MISSING": {
    en: "Requested but absent. No value is invented.",
    zh: "已要求但缺失，不虚构任何值。",
  },
  "ai.legend.UNKNOWN": { en: "Not requested and not available.", zh: "未要求且不可用。" },
  "ai.recommended": { en: "Recommended action", zh: "建议操作" },
  "ai.strengthStrong": { en: "{strength} basis", zh: "{strength} 依据" },
  "ai.strengthConditional": { en: "{strength} basis", zh: "{strength} 依据" },
  "ai.backendPlan": { en: "Backend plan", zh: "后端方案" },
  "ai.alternatives": { en: "Alternatives, ranked", zh: "备选方案（排序）" },
  "ai.waitRule": { en: "WAIT rule:", zh: "WAIT 规则：" },
  "ai.waitApplies": { en: "applies — ", zh: "适用 — " },
  "ai.waitNotApplied": { en: "not applied — ", zh: "不适用 — " },
  "ai.disclaimer": {
    en: "AI recommendation only — not a PayPal decision, adjudication or execution. Any action still needs the deterministic validator and a manager approval.",
    zh: "仅为 AI 建议 — 不是 PayPal 决定、裁决或执行。任何操作仍需确定性校验与经理审批。",
  },

  /* ------------------------------ analysis phases ---------------------------- */
  "phase.requesting.title": { en: "Sending the analysis request", zh: "正在发送分析请求" },
  "phase.requesting.detail": {
    en: "The case snapshot is being handed to the backend. No mock result is generated locally.",
    zh: "案件快照正提交给后端，本地不生成任何模拟结果。",
  },
  "phase.inferring.title": { en: "Local model reasoning", zh: "本地模型推理中" },
  "phase.inferring.detail": {
    en: "The local model is reading the records and drafting grounded facts. A real run typically takes 15–30 seconds.",
    zh: "本地模型正在阅读记录并起草有依据的事实。真实运行通常需要 15–30 秒。",
  },
  "phase.validating.title": { en: "Grounding and validation", zh: "依据校验中" },
  "phase.validating.detail": {
    en: "The backend is checking evidence spans and running the deterministic validator. The model never decides validation.",
    zh: "后端正在检查证据片段并运行确定性校验器。模型绝不决定校验结果。",
  },
  "phase.localModelTiming": { en: "Local model · typically 15–30 s", zh: "本地模型 · 通常 15–30 秒" },
  "phase.noAutoRetry": { en: "No auto-retry · no mock fallback", zh: "不自动重试 · 不降级为模拟结果" },

  /* ------------------------------- action safety ----------------------------- */
  "action.title": { en: "Action safety", zh: "操作安全" },
  "action.noProposal": { en: "No proposal", zh: "无提案" },
  "action.emptyTitle": { en: "No action has been proposed yet", zh: "尚未生成处理建议" },
  "action.emptyWithAnalysis": {
    en: "The analysis is ready, but the backend has not generated a proposal for this case. Generate one to review the action, its evidence references and the validator result.",
    zh: "分析已完成，但后端尚未为该案件生成处理建议。生成后可审阅操作、证据引用与校验结果。",
  },
  "action.emptyNoAnalysis": {
    en: "Run the AI analysis to extract facts, gaps and a policy-checked recommendation.",
    zh: "运行 AI 分析以提取事实、缺口和经政策校验的建议。",
  },
  "action.generate": { en: "Generate proposal", zh: "生成处理建议" },
  "action.generating": { en: "Generating…", zh: "生成中…" },
  "action.generateMockNote": {
    en: "The fixture set contains no proposal for this case.",
    zh: "固定数据集中该案件没有提案。",
  },
  "action.runAi": { en: "Run AI analysis", zh: "运行 AI 分析" },
  "action.protected": { en: "Protected", zh: "受保护" },
  "action.proposedAction": { en: "Proposed action", zh: "拟执行操作" },
  "action.cannotProceed": { en: "This action cannot proceed", zh: "此操作无法继续" },
  "action.blockExplain": {
    en: "The block is explained, not hidden. A disabled button without a reason would hide the safety decision from the operator.",
    zh: "受阻原因已说明而非隐藏。无理由的禁用按钮会让操作员看不到安全决策。",
  },
  "action.rejectedBy": { en: "Rejected by {name}", zh: "已被 {name} 拒绝" },
  "action.noExecution": { en: "no execution attempted", zh: "未尝试执行" },
  "action.executed": { en: "Executed once and verified by GET", zh: "已执行一次并经 GET 核验" },
  "action.unverifiedResult": {
    en: "Execution result unknown",
    zh: "执行结果未知",
  },
  "action.executedLive": {
    en: "Sandbox execution request recorded",
    zh: "Sandbox 执行请求已记录",
  },
  "action.executedLiveDetail": {
    en: "{at} · one request · result depends on the separate remote verification.",
    zh: "{at} · 仅一次请求 · 结果以独立的远端回查为准。",
  },
  "action.executedDetail": {
    en: "{at} · replay fixture · status advanced to UNDER_REVIEW.",
    zh: "{at} · 回放固定数据 · 状态已推进至 UNDER_REVIEW。",
  },
  "action.policyValidation": { en: "Policy validation", zh: "政策校验" },
  "action.evidenceRefs": { en: "Evidence references · {count}", zh: "证据引用 · {count}" },
  "action.labelsTravel": { en: "Labels travel with every reference:", zh: "每个引用都带有标签：" },
  "action.onlyCited": {
    en: "Only records listed here are cited by the proposal. Missing items are never attached as if they existed.",
    zh: "提案仅引用此处列出的记录。缺失项绝不会被当作已存在而附加。",
  },
  "action.hateoas": { en: "HATEOAS availability", zh: "HATEOAS 可用性" },
  "action.approvalRequirement": { en: "Approval requirement", zh: "审批要求" },
  "action.approvalBlocked": {
    en: "Approval cannot override a failed validator check. The block must be resolved first.",
    zh: "审批不能推翻失败的校验项。必须先解除阻断。",
  },
  "action.approvalNote": {
    en: "This MVP requires manager approval for every protected write. Approval authorises one replay attempt; it does not mean PayPal accepted the action or that the dispute will be won.",
    zh: "本 MVP 要求所有受保护写操作都经经理审批。审批仅授权一次回放尝试，不代表 PayPal 已接受该操作，也不代表争议会胜诉。",
  },
  "action.approvalNoteLive": {
    en: "This MVP requires manager approval for every protected write. Approval authorises one Sandbox execution attempt; it does not mean the dispute will be won, and there is no automatic retry.",
    zh: "本 MVP 要求所有受保护写操作都经经理审批。审批仅授权一次 Sandbox 执行尝试，不代表争议会胜诉，也不会自动重试。",
  },
  "action.specialistView": {
    en: "Specialist view · only a manager can approve a protected action.",
    zh: "专员视图 · 仅经理可批准受保护操作。",
  },
  "action.managerView": {
    en: "Manager view · every decision is recorded against your name.",
    zh: "经理视图 · 每项决策都会记录在你的名下。",
  },
  "action.refreshSnapshot": { en: "Refresh snapshot and re-check", zh: "刷新快照并重新校验" },
  "action.blockedCta": { en: "Blocked — cannot submit", zh: "受阻 — 无法提交" },
  "action.submit": { en: "Submit for approval", zh: "提交审批" },
  "action.awaitingSpecialist": { en: "Awaiting specialist submission", zh: "等待专员提交" },
  "action.awaitingSpecialistTitle": {
    en: "A specialist must submit this proposal before a manager can review it.",
    zh: "专员须先提交此提案，经理才能审核。",
  },
  "action.reviewDecide": { en: "Review and decide", zh: "审核并决策" },
  "action.awaitingManager": { en: "Awaiting manager approval", zh: "等待经理审批" },
  "action.rejectedReplan": { en: "Rejected — re-plan required", zh: "已拒绝 — 需重新规划" },
  "action.approvedQueued": { en: "Approved — replay queued", zh: "已批准 — 回放已排队" },
  "action.approvedQueuedLive": {
    en: "Approved — execution request pending",
    zh: "已批准 — 执行请求待发出",
  },
  "action.viewExecution": { en: "View execution record", zh: "查看执行记录" },
  "action.generateErrorTitle": { en: "Could not generate a proposal", zh: "无法生成处理建议" },

  /* ------------------------------ send message ------------------------------ */
  "sendMessage.title": { en: "Send message", zh: "发送消息" },
  "sendMessage.subtitle": {
    en: "Draft the exact text the buyer would receive. A manager approves this text; nothing is sent from this screen.",
    zh: "起草将发送给买家的逐字文本。由经理审批该文本；本页面不会发送任何内容。",
  },
  "sendMessage.available": { en: "Available in this snapshot", zh: "当前快照可用" },
  "sendMessage.unavailable": { en: "Unavailable", zh: "不可用" },
  "sendMessage.reason.stage": {
    en: "Current stage {stage} does not support sending messages.",
    zh: "当前阶段 {stage}，不支持发送消息。",
  },
  "sendMessage.reason.noLink": {
    en: "send_message is not present in the current link set.",
    zh: "当前链接集中没有 send_message。",
  },
  "sendMessage.reason.linkUnavailable": {
    en: "send_message is present but marked unavailable in this snapshot.",
    zh: "send_message 存在，但在当前快照中标记为不可用。",
  },
  "sendMessage.basisNote": {
    en: "Link basis: {basis}. An offline fixture is not a live PayPal observation.",
    zh: "链接依据：{basis}。离线固定数据不等于 PayPal 实时观测。",
  },
  "sendMessage.managerOnly": {
    en: "Manager view · specialists create and submit the proposal; you approve the exact text in the approval queue.",
    zh: "经理视图 · 由专员创建并提交提案；你在审批队列中批准该逐字文本。",
  },
  "sendMessage.draftTitle": { en: "AI draft", zh: "AI 草稿" },
  "sendMessage.draftFrom": { en: "Loaded from proposal {proposalId}", zh: "来自提案 {proposalId}" },
  "sendMessage.draftNone": {
    en: "No draft available — the editor starts blank.",
    zh: "暂无草稿 — 编辑框为空，可自行输入。",
  },
  "sendMessage.loadDraft": { en: "Load draft", zh: "载入草稿" },
  "sendMessage.editorLabel": { en: "Message text", zh: "消息正文" },
  "sendMessage.editorHint": {
    en: "Line breaks are preserved. The text is sent verbatim.",
    zh: "保留换行，文本按原样发送。",
  },
  "sendMessage.placeholder": {
    en: "Write the message to the buyer…",
    zh: "填写要发送给买家的消息…",
  },
  "sendMessage.counter": { en: "{count}/{max} characters", zh: "{count}/{max} 字符" },
  "sendMessage.error.empty": { en: "A message is required.", zh: "消息不能为空。" },
  "sendMessage.error.tooLong": {
    en: "The message exceeds {max} characters.",
    zh: "消息超过 {max} 字符。",
  },
  "sendMessage.factsTitle": { en: "Grounded facts", zh: "事实依据" },
  "sendMessage.factsEmpty": {
    en: "No grounded facts were returned for this case.",
    zh: "该案件没有返回有依据的事实。",
  },
  "sendMessage.evidenceTitle": { en: "Cited evidence", zh: "证据引用" },
  "sendMessage.gapsTitle": { en: "Evidence gaps", zh: "证据缺口" },
  "sendMessage.gapsBody": {
    en: "The analysis reports missing evidence: {items}. The message must not imply these records exist.",
    zh: "分析报告指出证据缺失：{items}。消息不得暗示这些材料已存在。",
  },
  "sendMessage.previewTitle": { en: "Preview (plain text)", zh: "预览（纯文本）" },
  "sendMessage.previewEmpty": { en: "Nothing to preview yet.", zh: "暂无可预览内容。" },
  "sendMessage.previewNote": {
    en: "Rendered as plain text with line breaks preserved.",
    zh: "以纯文本呈现并保留换行。",
  },
  "sendMessage.submitNote": {
    en: "Submitting creates a new proposal with a payload hash for this exact text. Editing the text again creates another proposal; an approved text is never rewritten.",
    zh: "提交会针对该逐字文本创建新提案并生成载荷哈希。再次编辑会再创建提案；已批准的文本绝不会被改写。",
  },
  "sendMessage.pendingWarning": {
    en: "A proposal for this case is already awaiting approval. Submitting again creates a new proposal; the pending one is not modified.",
    zh: "该案件已有等待审批的提案。再次提交会创建新提案，不会修改待审批的那一份。",
  },
  "sendMessage.lockedTitle": { en: "Approved text is locked", zh: "已批准文案已锁定" },
  "sendMessage.lockedBody": {
    en: "A manager approved the exact text of {proposalId}. The UI will not edit it; create a revised proposal to change the message.",
    zh: "经理已批准 {proposalId} 的逐字文本。界面不会修改它；如需更改消息，请创建修订提案。",
  },
  "sendMessage.revise": { en: "Create revised proposal", zh: "创建修订提案" },
  "sendMessage.cancelRevise": { en: "Cancel revision", zh: "取消修订" },
  "sendMessage.noAnalysis": {
    en: "Run the AI analysis first: the backend requires an analysis before a proposal can be created.",
    zh: "请先运行 AI 分析：后端要求先有分析才能创建提案。",
  },
  "sendMessage.toast.created": { en: "Message submitted for approval", zh: "消息已提交审批" },
  "sendMessage.toast.createdDetail": {
    en: "Proposal {proposalId} · payload hash {hash}.",
    zh: "提案 {proposalId} · 载荷哈希 {hash}。",
  },
  "sendMessage.toast.failed": {
    en: "Could not create the message proposal",
    zh: "无法创建消息提案",
  },
  "sendMessage.errorTitle": { en: "The proposal was not created", zh: "提案未创建" },
  "sendMessage.hashLabel": { en: "Payload hash", zh: "载荷哈希" },
  "sendMessage.submitAria": {
    en: "Send message: submit for approval",
    zh: "发送消息：提交审批",
  },
  "sendMessage.verificationNote": {
    en: "A send-message result is confirmed only when the remote messages[] contains this exact text. It does not mean the buyer received or read it.",
    zh: "仅在远端 messages[] 中找到逐字一致的消息时才确认发送结果；不代表买家已收到或已读。",
  },

  /* --------------------------------- badges --------------------------------- */
  "badge.status.WAITING_FOR_SELLER_RESPONSE": { en: "Waiting for seller", zh: "等待卖家" },
  "badge.status.WAITING_FOR_BUYER_RESPONSE": { en: "Waiting for buyer", zh: "等待买家" },
  "badge.status.UNDER_REVIEW": { en: "Under review", zh: "审核中" },
  "badge.status.REQUIRED_ACTION": { en: "Action required", zh: "需操作" },
  "badge.status.RESOLVED": { en: "Resolved", zh: "已解决" },
  "badge.status.OTHER": { en: "Other", zh: "其他" },
  "badge.status.UNKNOWN": { en: "Unknown", zh: "未知" },
  "badge.risk.LOW": { en: "Low risk", zh: "低风险" },
  "badge.risk.MEDIUM": { en: "Medium risk", zh: "中风险" },
  "badge.risk.HIGH": { en: "High risk", zh: "高风险" },
  "badge.risk.BLOCKED": { en: "Blocked", zh: "受阻" },
  "badge.risk.notRated": { en: "Not rated", zh: "未评级" },
  "badge.proposal.DRAFT": { en: "Draft", zh: "草稿" },
  "badge.proposal.AWAITING_APPROVAL": { en: "Awaiting approval", zh: "待审批" },
  "badge.proposal.APPROVED": { en: "Approved", zh: "已批准" },
  "badge.proposal.REJECTED": { en: "Rejected", zh: "已拒绝" },
  "badge.proposal.EXECUTED": {
    en: "Executed (remote confirmed)",
    zh: "已执行（远端已确认）",
  },
  "badge.proposal.REPLAYED": { en: "Replayed (offline)", zh: "已回放（离线）" },
  "badge.proposal.UNVERIFIED": {
    en: "Unverified (result unknown)",
    zh: "待核验（结果未知）",
  },
  "badge.proposal.PENDING": { en: "Pending (not settled)", zh: "处理中（未结算）" },
  "badge.proposal.FAILED": { en: "Execution failed", zh: "执行失败" },
  "badge.proposal.UNKNOWN": { en: "Unknown state", zh: "未知状态" },
  "badge.proposal.CANCELLED": { en: "Cancelled", zh: "已取消" },
  "badge.proposal.BLOCKED": { en: "Blocked", zh: "受阻" },
  "badge.executionResult.EXECUTED": {
    en: "Executed (remote confirmed)",
    zh: "已执行（远端已确认）",
  },
  "badge.executionResult.UNVERIFIED": {
    en: "Unverified (result unknown)",
    zh: "待核验（结果未知）",
  },
  "badge.executionResult.PENDING": { en: "Pending (not settled)", zh: "处理中（未结算）" },
  "badge.executionResult.REPLAYED": { en: "Replayed (offline)", zh: "已回放（离线）" },
  "badge.executionResult.BLOCKED": { en: "Blocked", zh: "已阻断" },
  "badge.executionResult.FAILED": { en: "Failed", zh: "失败" },
  "badge.executionResult.UNKNOWN": { en: "Unknown result", zh: "未知结果" },
  "badge.outcome.SUCCEEDED": { en: "Succeeded", zh: "成功" },
  "badge.outcome.FAILED": { en: "Failed", zh: "失败" },
  "badge.outcome.BLOCKED": { en: "Blocked", zh: "受阻" },
  "badge.outcome.EXPIRED": { en: "Expired", zh: "已过期" },
  "badge.outcome.DUPLICATE_SUPPRESSED": { en: "Duplicate suppressed", zh: "重复已抑制" },
  "badge.outcome.INFO": { en: "Recorded", zh: "已记录" },
  "badge.grounding.VERIFIED_OBSERVATION": { en: "Verified observation", zh: "已核验观察" },
  "badge.grounding.SCENARIO_DEFINED": { en: "Scenario-defined", zh: "场景定义" },
  "badge.grounding.AI_INFERENCE": { en: "AI inference", zh: "AI 推断" },
  "badge.grounding.MISSING": { en: "Missing", zh: "缺失" },
  "badge.grounding.UNKNOWN": { en: "Unknown", zh: "未知" },
  "badge.grounding.UNVERIFIED_CLAIM": { en: "Unverified claim", zh: "未经核实声明" },
  "badge.grounding.desc.VERIFIED_OBSERVATION": {
    en: "Directly recorded in a frozen API trace or sandbox fixture.",
    zh: "直接记录于冻结的 API 轨迹或沙箱固定数据。",
  },
  "badge.grounding.desc.SCENARIO_DEFINED": {
    en: "Authored for the scenario; not observed from PayPal.",
    zh: "为场景编写，并非来自 PayPal 的观测。",
  },
  "badge.grounding.desc.AI_INFERENCE": {
    en: "Derived by the analysis. Never treated as evidence.",
    zh: "由分析推导，绝不作为证据。",
  },
  "badge.grounding.desc.MISSING": {
    en: "Requested but not on file. No value is invented.",
    zh: "已要求但未存档，不虚构任何值。",
  },
  "badge.grounding.desc.UNKNOWN": {
    en: "Not requested and not available.",
    zh: "未要求且不可用。",
  },
  "badge.grounding.desc.UNVERIFIED_CLAIM": {
    en: "Asserted without a supporting record; never treated as evidence.",
    zh: "无支持记录的声明，绝不作为证据。",
  },
  "badge.analysisFixture": { en: "Fixture analysis", zh: "固定数据分析" },
  "badge.analysisFixtureTitle": {
    en: "Fixture mode: no analysis_mode was reported by the backend.",
    zh: "固定数据模式：后端未报告 analysis_mode。",
  },
  "badge.localLlmTitle": {
    en: "analysis_mode={mode} · local model inference, not a PayPal model",
    zh: "analysis_mode={mode} · 本地模型推理，非 PayPal 模型",
  },
  "badge.stubTitle": {
    en: "analysis_mode={mode} · deterministic stub, no model call",
    zh: "analysis_mode={mode} · 确定性桩，不调用模型",
  },
  "badge.frozenTitle": {
    en: "analysis_mode=FROZEN_REPLAY · pre-recorded analysis replayed offline; no model is called",
    zh: "analysis_mode=FROZEN_REPLAY · 预先录制的分析在离线回放；不调用任何模型",
  },
  "badge.replayTitle": {
    en: "Offline replay against a frozen fixture — not a PayPal API response",
    zh: "基于冻结数据的离线回放 — 非 PayPal API 响应",
  },
  "badge.severity.HIGH": { en: "High", zh: "高" },
  "badge.severity.MEDIUM": { en: "Medium", zh: "中" },
  "badge.severity.LOW": { en: "Low", zh: "低" },

  /* ------------------------------- case context ------------------------------ */
  "context.title": { en: "Case context", zh: "案件背景" },
  "context.openedUpdated": {
    en: "Opened {opened} · updated {updated}",
    zh: "开启于 {opened} · 更新于 {updated}",
  },
  "context.dispute": { en: "Dispute", zh: "争议" },
  "context.type": { en: "Type", zh: "类型" },
  "context.amount": { en: "Amount", zh: "金额" },
  "context.status": { en: "Status", zh: "状态" },
  "context.lifecycle": { en: "Lifecycle stage", zh: "生命周期阶段" },
  "context.sellerProtection": { en: "Seller protection", zh: "卖家保障" },
  "context.buyerClaim": { en: "Buyer claim", zh: "买家主张" },
  /* PAYMENT cases: capture wording, never dispute wording. */
  "context.payment": { en: "Payment", zh: "支付" },
  "context.typePayment": { en: "Transaction type", zh: "交易类型" },
  "context.statusPayment": { en: "Transaction status", zh: "交易状态" },
  "context.lifecyclePayment": { en: "Payment lifecycle", zh: "支付生命周期" },
  "context.claimNote": {
    en: "Complaint text from the offline case fixture. Not a real consumer statement.",
    zh: "来自离线案件固定数据的投诉文本，并非真实消费者陈述。",
  },
  "context.transaction": { en: "Transaction", zh: "交易" },
  "context.order": { en: "Order", zh: "订单" },
  "context.capture": { en: "Capture", zh: "收款" },
  "context.captureStatus": { en: "Capture status", zh: "收款状态" },
  "context.evidenceOnFile": { en: "Evidence on file", zh: "已存档证据" },
  "context.availableMissing": {
    en: "{available} available · {missing} missing",
    zh: "{available} 可用 · {missing} 缺失",
  },
  "context.timeline": { en: "Case timeline", zh: "案件时间线" },
  "context.fullAudit": { en: "Full audit", zh: "完整审计" },
  "context.sourceSnapshot": { en: "Source & snapshot", zh: "来源与快照" },
  "context.frozenSandbox": { en: "Frozen sandbox E1", zh: "冻结沙箱 E1" },
  "context.snapshotHash": { en: "snapshot hash: {hash}", zh: "快照哈希：{hash}" },

  /* ------------------------------ evidence drawer ---------------------------- */
  "evidence.footerMissing": {
    en: "A missing record is shown as missing. It is never replaced by a generated value.",
    zh: "缺失记录会明确显示为缺失，绝不用生成值替代。",
  },
  "evidence.footerVerbatim": {
    en: "Evidence content is displayed verbatim from the fixture.",
    zh: "证据内容按固定数据原文展示。",
  },
  "evidence.addRequest": { en: "Add to evidence request", zh: "加入证据请求" },
  "evidence.type": { en: "Evidence type", zh: "证据类型" },
  "evidence.source": { en: "Source", zh: "来源" },
  "evidence.direction": { en: "Direction", zh: "方向" },
  "evidence.collected": { en: "Collected", zh: "采集时间" },
  "evidence.verification": { en: "Verification", zh: "核实结果" },
  "evidence.provenance": { en: "Provenance tag", zh: "来源标签" },
  "evidence.directionFromBuyer": { en: "from buyer", zh: "来自买家" },
  "evidence.directionFromPaypal": { en: "from paypal", zh: "来自 PayPal" },
  "evidence.directionFromMerchant": { en: "from merchant", zh: "来自卖家" },
  "evidence.excerpt": { en: "Relevant excerpt", zh: "相关摘录" },
  "evidence.verbatimSpan": {
    en: "Verbatim evidence span · {factId}",
    zh: "证据原文片段 · {factId}",
  },
  "evidence.highlightSupports": {
    en: "Highlighted text supports the selected claim",
    zh: "高亮文本支持所选声明",
  },
  "evidence.noRecord": { en: "No record exists", zh: "无此记录" },
  "evidence.noRecordBody": {
    en: "This item was requested but never provided. The system keeps it visible so the gap cannot be mistaken for a verified fact.",
    zh: "该项已被要求但从未提供。系统保持其可见，以免缺口被误认为已核实事实。",
  },
  "evidence.notRequested": { en: "Not requested — unknown", zh: "未要求 — 未知" },
  "evidence.derived": { en: "Derived, not observed", zh: "推导结果，非观测" },
  "evidence.supported": { en: "Supported claims", zh: "支持的声明" },
  "evidence.notCited": {
    en: "This record is not cited by any grounded fact. It remains available for review.",
    zh: "该记录未被任何有依据事实引用，仍可供审阅。",
  },
  "evidence.fixtureHash": { en: "· fixture integrity hash", zh: "· 固定数据完整性哈希" },

  /* -------------------------------- audit ---------------------------------- */
  "audit.empty": { en: "No audit events recorded for this case yet.", zh: "该案件尚无审计事件。" },
  "audit.revalidation": { en: "Replay revalidation", zh: "回放重新校验" },
  "audit.localSimulation": { en: "local simulation", zh: "本地模拟" },

  /* --------------------------- domain label tables --------------------------- *
   * Enum/label vocabulary only. Backend data (excerpts, summaries of model
   * output, validator details) is never routed through this table.            */
  "evidenceType.PROOF_OF_FULFILLMENT": { en: "Proof of fulfillment", zh: "履约证明" },
  "evidenceType.PROOF_OF_REFUND": { en: "Proof of refund", zh: "退款证明" },
  "evidenceType.OTHER": { en: "Other document", zh: "其他文件" },
  "evidenceType.BUYER_STATEMENT": { en: "Buyer statement", zh: "买家陈述" },
  "evidenceType.ORDER_RECORD": { en: "Order record", zh: "订单记录" },
  "evidenceType.CAPTURE_RECORD": { en: "Capture record", zh: "收款记录" },
  "evidenceType.SELLER_COMMUNICATION": { en: "Seller communication", zh: "卖家沟通记录" },
  "evidenceType.CASE_NOTE": { en: "Case note", zh: "案件备注" },
  "evidenceType.BUYER_MESSAGE": { en: "Buyer message (dispute thread)", zh: "买家消息（争议对话）" },
  "evidenceType.TRANSACTION_RECORD": { en: "Order & capture record", zh: "订单与收款记录" },
  "evidenceType.FULFILLMENT_RECORD": { en: "Fulfillment record", zh: "履约记录" },
  "evidenceType.MERCHANT_POLICY": { en: "Merchant shipping policy", zh: "卖家发货政策" },
  "evidenceType.DERIVED_SIGNAL": {
    en: "Derived signal (not an observation)",
    zh: "推导信号（非观测）",
  },
  "evidenceType.BUYER_RECEIPT": { en: "Buyer receipt reference", zh: "买家收据引用" },
  "evidenceType.CANCELLATION_REFERENCE": {
    en: "Cancellation confirmation (buyer-cited)",
    zh: "取消确认（买家引用）",
  },

  "actionKind.send-message": { en: "Send message to buyer", zh: "向买家发送消息" },
  "actionKind.provide-evidence": { en: "Provide evidence", zh: "提供证据" },
  "actionKind.make-offer": { en: "Make offer", zh: "提出方案" },
  "actionKind.accept-claim": { en: "Accept claim", zh: "接受索赔" },
  "actionKind.escalate": { en: "Escalate", zh: "升级处理" },
  "actionKind.provide-supporting-info": { en: "Provide supporting info", zh: "提供补充信息" },
  "actionKind.wait": { en: "Wait", zh: "等待" },
  "actionKind.partial-refund": { en: "Partial refund", zh: "部分退款" },
  "actionKind.full-refund": { en: "Full refund", zh: "全额退款" },
  "actionLabel.sendMessage": { en: "Send message", zh: "发送消息" },
  "actionLabel.provideEvidenceNotes": {
    en: "Provide evidence (notes branch)",
    zh: "提供证据（备注分支）",
  },
  "actionLabel.provideEvidencePhotos": { en: "Provide evidence (photos)", zh: "提供证据（照片）" },
  "actionLabel.provideEvidenceFreshSnapshot": {
    en: "Provide evidence (requires fresh snapshot)",
    zh: "提供证据（需刷新快照）",
  },
  "actionLabel.waitForBuyerResponse": { en: "Wait for buyer response", zh: "等待买家回复" },
  "actionLabel.requestReceiptDocuments": { en: "Request receipt documents", zh: "索取收据文件" },
  "actionLabel.notAnalysed": { en: "Not analysed", zh: "未分析" },

  /* ------------------------------- refund (PAYMENT) ------------------------- */
  "refund.title": { en: "Capture refund", zh: "Capture 退款" },
  "refund.subtitle": {
    en: "Refunds move money out of the capture. A refund is not dispute resolution and does not close the case.",
    zh: "退款会从该 Capture 划出资金。退款不等于争议解决，也不会关闭案件。",
  },
  "refund.mode": { en: "Refund mode", zh: "退款模式" },
  "refund.mode.partial": { en: "Partial", zh: "部分退款" },
  "refund.mode.full": { en: "Full", zh: "全额退款" },
  "refund.mode.partialLabel": { en: "Partial refund", zh: "部分退款" },
  "refund.mode.fullLabel": { en: "Full refund", zh: "全额退款" },
  "refund.amount": { en: "Refund amount", zh: "退款金额" },
  "refund.amountHint": {
    en: "Decimal string with 2 places (13.00). This is a format hint only — the backend re-validates the amount against the capture.",
    zh: "2 位小数金额字符串（13.00）。此处仅为格式提示，后端会按 Capture 余额再次校验。",
  },
  "refund.amountRequired": { en: "Enter the amount to refund.", zh: "请输入退款金额。" },
  "refund.amountFormat": {
    en: "Use a decimal amount with exactly 2 places, e.g. 13.00.",
    zh: "请使用恰好 2 位小数的金额，例如 13.00。",
  },
  "refund.amountPositive": { en: "The amount must be greater than 0.", zh: "金额必须大于 0。" },
  "refund.amountExceeds": {
    en: "The amount exceeds the refundable remaining balance.",
    zh: "金额超过剩余可退余额。",
  },
  "refund.nothingRefundable": {
    en: "This capture has no refundable balance left.",
    zh: "该 Capture 已无可退余额。",
  },
  "refund.reasonRequired": { en: "A refund reason is required.", zh: "必须填写退款原因。" },
  "refund.captureUnavailable": {
    en: "The capture reference is unavailable, so no refund can be drafted.",
    zh: "Capture 引用不可用，无法创建退款提案。",
  },
  "refund.fullAmount": {
    en: "Refunds the remaining refundable amount.",
    zh: "退还剩余可退金额。",
  },
  "refund.fullAmountUnknown": {
    en: "Refunds the remaining refundable amount — the backend reads the capture and fills the exact figure.",
    zh: "退还剩余可退金额 — 由后端读取 Capture 后回填确切金额。",
  },
  "refund.fullNotEditable": {
    en: "The amount is not editable in Full mode.",
    zh: "全额模式下金额不可编辑。",
  },
  "refund.currency": { en: "Currency", zh: "币种" },
  "refund.currencyReadOnly": {
    en: "Currency is fixed by the capture and cannot be edited.",
    zh: "币种由 Capture 固定，不可编辑。",
  },
  "refund.captureId": { en: "Capture ID", zh: "Capture ID" },
  "refund.originalAmount": { en: "Original capture amount", zh: "Capture 原始金额" },
  "refund.totalRefunded": { en: "Total refunded", zh: "已退款总额" },
  "refund.remaining": { en: "Refundable remaining", zh: "剩余可退金额" },
  "refund.proposed": { en: "Proposed refund", zh: "本次拟退金额" },
  "refund.reason": { en: "Refund reason", zh: "退款原因" },
  "refund.reasonPlaceholder": {
    en: "Why is this capture being refunded? The reason is bound to the proposal.",
    zh: "为什么要退这笔 Capture？原因会绑定到提案。",
  },
  "refund.risk": { en: "Risk level", zh: "风险等级" },
  "refund.financialImpact": { en: "Financial impact", zh: "财务影响" },
  "refund.financialImpactValue": {
    en: "Moves {amount} {currency} out of {captureId}. A completed refund cannot be reversed at the gateway.",
    zh: "从 {captureId} 划出 {amount} {currency}。已完成的退款无法在网关撤销。",
  },
  "refund.financialImpactUnknown": {
    en: "Moves funds out of {captureId}; the exact amount is confirmed by the backend.",
    zh: "从 {captureId} 划出资金；确切金额以后端核定为准。",
  },
  "refund.warning": {
    en: "This action may move funds and cannot be treated as a reversible preview.",
    zh: "此操作可能实际划转资金，不能视为可撤销的预览。",
  },
  "refund.warningLabel": { en: "Funds move on execution", zh: "执行即划转资金" },
  "refund.specialistNote": {
    en: "Specialists can create and revise this draft but cannot execute it. A manager approves first; execution is a separate, audited step.",
    zh: "专员可创建和修改提案，但不能执行。须先由经理审批，执行是独立且留痕的步骤。",
  },
  "refund.managerNote": {
    en: "Managers approve or reject the exact amount shown. Approval binds the payload hash; a later change is a new proposal.",
    zh: "经理仅对所示确切金额批准或拒绝。批准会绑定 payload 哈希；后续修改需新建提案。",
  },
  "refund.create": { en: "Create refund proposal", zh: "创建退款提案" },
  "refund.submit": { en: "Submit for approval", zh: "提交审批" },
  "refund.created": { en: "Refund draft created", zh: "退款提案已创建" },
  "refund.createdDetail": {
    en: "Proposal {proposalId} · payload {hash}",
    zh: "提案 {proposalId} · payload {hash}",
  },
  "refund.createFailed": { en: "Refund draft was not created", zh: "退款提案创建失败" },
  "refund.submitted": { en: "Refund submitted for approval", zh: "退款已提交审批" },
  "refund.locked": { en: "Submitted refund amount is locked", zh: "已提交的退款金额已锁定" },
  "refund.lockedBody": {
    en: "Proposal {proposalId} binds this exact amount. Changing it requires a new proposal.",
    zh: "提案 {proposalId} 已绑定该确切金额，修改需新建提案。",
  },
  "refund.revise": { en: "Create revised proposal", zh: "创建修改提案" },
  "refund.cancelRevise": { en: "Cancel revision", zh: "取消修改" },
  "refund.snapshotTitle": { en: "Server-confirmed capture snapshot", zh: "服务端回填 Capture 快照" },
  "refund.caseSnapshotTitle": { en: "Capture snapshot (case record)", zh: "Capture 快照（案件记录）" },
  "refund.snapshotNote": {
    en: "These values come back from the server after the draft is created; the client never derives them.",
    zh: "以下数值由服务端在创建提案后回填，客户端不做推算。",
  },
  "refund.caseLevelNote": {
    en: "The refundable remaining balance is confirmed by the backend when the draft is created.",
    zh: "剩余可退余额在创建提案后由后端确认。",
  },
  "refund.executionTitle": { en: "Refund execution", zh: "退款执行" },
  "refund.pendingBody": {
    en: "The refund was accepted but has not settled. This is not a completed refund and is not a success.",
    zh: "退款已被受理但尚未结算。这不是已完成的退款，也不属于成功。",
  },
  "refund.executedBody": {
    en: "Confirmed: the refund is COMPLETED and the amount, currency and capture match this proposal.",
    zh: "已确认：退款状态为 COMPLETED，且金额、币种与 Capture 与本提案一致。",
  },
  "refund.unverifiedBody": {
    en: "The execution record does not confirm a COMPLETED refund that matches this amount, currency and capture. Treat it as unverified — do not retry automatically.",
    zh: "执行记录未能确认与该金额、币种和 Capture 一致的 COMPLETED 退款。按待核验处理，不要自动重试。",
  },
  "refund.noExecution": {
    en: "No execution yet. Creating or approving a proposal does not move funds.",
    zh: "尚未执行。创建或批准提案本身不会划转资金。",
  },
  "refund.approvalTitle": { en: "Refund approval summary", zh: "退款审批摘要" },
  "refund.approvalAmount": { en: "Amount to approve", zh: "待批准金额" },
  "refund.riskNote": {
    en: "Approving authorises a capture-level refund. It moves funds out of the capture and does not resolve the dispute.",
    zh: "批准即授权对该 Capture 退款。这会划出资金，但不解决争议。",
  },
  "refund.boundNote": {
    en: "The approved wording and amount are bound to the payload hash; they cannot be changed silently after approval.",
    zh: "已批准的文案与金额绑定 payload 哈希，批准后不可静默修改。",
  },
  "refund.modeBadge": { en: "Mode", zh: "模式" },
  "refund.noRealFunds": { en: "No real funds moved.", zh: "未划转任何真实资金。" },
  "refund.syntheticNote": {
    en: "Synthetic offline fixture (SIMULATED_COMPOSITE) — no real capture exists and no real funds moved.",
    zh: "合成离线固定数据（SIMULATED_COMPOSITE）— 不存在真实 Capture，也不会划转真实资金。",
  },

  /* ------------------------------- capture status ---------------------------- */
  "capture.title": { en: "Capture status", zh: "Capture 状态" },
  "capture.subtitle": {
    en: "Read from the backend capture record. Amounts are shown exactly as decimal strings — the UI never recomputes them.",
    zh: "来自后端 Capture 记录。金额按十进制字符串原样展示，界面不做任何重算。",
  },
  "capture.loading": { en: "Reading the capture…", zh: "正在读取 Capture…" },
  "capture.failedTitle": { en: "Capture status unavailable", zh: "无法读取 Capture 状态" },
  "capture.failedBody": {
    en: "The capture read failed, so no capture state is shown. No value is inferred from the dispute.",
    zh: "Capture 读取失败，因此不展示 Capture 状态，也不会用争议状态推断。",
  },
  "capture.retry": { en: "Read again", zh: "重新读取" },
  "capture.captureId": { en: "Capture ID", zh: "Capture ID" },
  "capture.status": { en: "Capture Status", zh: "Capture 状态" },
  "capture.originalAmount": { en: "Original Amount", zh: "原始金额" },
  "capture.totalRefunded": { en: "Total Refunded", zh: "已退款总额" },
  "capture.refundableRemaining": { en: "Refundable Remaining", zh: "剩余可退金额" },
  "capture.currency": { en: "Currency", zh: "币种" },
  "capture.source": { en: "Record source", zh: "记录来源" },
  "capture.synthetic": { en: "Synthetic Offline Fixture", zh: "合成离线固定数据" },
  "capture.syntheticNote": {
    en: "This capture exists only in the offline demo fixture. It is not a PayPal capture.",
    zh: "该 Capture 仅存在于离线演示固定数据中，并非 PayPal Capture。",
  },
  "capture.notRead": { en: "Capture not read", zh: "未读取 Capture" },
  "capture.notReported": { en: "Not reported", zh: "未报告" },
  "capture.refundArea": { en: "Refund", zh: "退款" },
  "capture.refundAreaBody": {
    en: "The refund path is simulated offline. Amounts are validated by the backend, and the refund status is tracked separately from the capture status.",
    zh: "退款路径为离线模拟。金额由后端校验，退款状态与 Capture 状态分别跟踪。",
  },

  "nextAction.runAiAnalysis": { en: "Run AI analysis", zh: "运行 AI 分析" },
  "nextAction.startAiReview": { en: "Start AI review", zh: "开始 AI 分析" },
  "nextAction.reviewRecommendation": { en: "Review recommendation", zh: "审核处理建议" },
  "nextAction.submitForApproval": { en: "Submit for approval", zh: "提交审批" },
  "nextAction.awaitingApproval": { en: "Awaiting approval", zh: "待审批" },
  "nextAction.runReplayRevalidation": { en: "Run replay revalidation", zh: "运行回放重新校验" },
  "nextAction.replanResponse": { en: "Re-plan response", zh: "重新规划响应" },
  "nextAction.monitorBuyerResponse": { en: "Monitor buyer response", zh: "关注买家回复" },
  "nextAction.resolveValidatorBlock": { en: "Resolve validator block", zh: "解除校验阻断" },
  "nextAction.resolveEvidenceGap": { en: "Resolve evidence gap", zh: "补齐证据缺口" },
  "nextAction.actionUnavailable": { en: "Action unavailable", zh: "操作不可用" },
  "nextAction.refreshCaseSnapshot": { en: "Refresh case snapshot", zh: "刷新案件快照" },
  "nextAction.reviewCase": { en: "Review case", zh: "审核案件" },

  "auditEvent.CASE_IMPORTED.summary": {
    en: "Case imported from the frozen fixture snapshot",
    zh: "已从冻结固定数据快照导入案件",
  },
  "auditEvent.CASE_IMPORTED.detail": {
    en: "Import is deterministic and idempotent; the snapshot hash binds the case facts used for every later decision.",
    zh: "导入过程确定且幂等；快照哈希绑定后续所有决策所依据的案件事实。",
  },
  "auditEvent.ANALYSIS_CREATED.summary": {
    en: "AI analysis created ({mode})",
    zh: "已创建 AI 分析（{mode}）",
  },
  "auditEvent.ANALYSIS_CREATED.detailLlm": {
    en: "Local LLM inference result. Safety flags, validation and approval fields are attached by the backend trust layer — never by the model.",
    zh: "本地 LLM 推理结果。安全标记、校验与审批字段由后端信任层附加，绝不由模型设置。",
  },
  "auditEvent.ANALYSIS_CREATED.detailStub": {
    en: "Deterministic stub analysis — explicitly not a real LLM inference (safety flags travel with the record).",
    zh: "确定性桩分析 — 明确不是真实 LLM 推理（安全标记随记录一并保存）。",
  },
  "auditEvent.PROPOSAL_CREATED.summary": {
    en: "Proposal drafted: {action}",
    zh: "已起草提案：{action}",
  },
  "auditEvent.PROPOSAL_CREATED.detail": {
    en: "The proposal is a recommendation object only; nothing is executed at this point.",
    zh: "提案仅为建议对象，此时不会执行任何操作。",
  },
  "auditEvent.VALIDATION_PASSED.summary": {
    en: "Validator V1–V12 passed",
    zh: "校验器 V1–V12 通过",
  },
  "auditEvent.VALIDATION_PASSED.summaryRefund": {
    en: "Validator V13–V18 passed",
    zh: "校验器 V13–V18 通过",
  },
  "auditEvent.VALIDATION_BLOCKED.summary": {
    en: "Validator blocked the proposal",
    zh: "校验器阻断了该提案",
  },
  "auditEvent.VALIDATION_RECORDED.detail": {
    en: "The deterministic validator runs at submit time; blocked proposals never reach PENDING_APPROVAL.",
    zh: "确定性校验器在提交时运行；受阻提案绝不会进入 PENDING_APPROVAL。",
  },
  "auditEvent.PROPOSAL_SUBMITTED.summary": {
    en: "Submitted for manager approval",
    zh: "已提交经理审批",
  },
  "auditEvent.PROPOSAL_SUBMITTED.detail": {
    en: "The specialist submission binds the action, payload and evidence references to the approval.",
    zh: "专员提交时将操作、载荷与证据引用绑定至审批。",
  },
  "auditEvent.APPROVAL_GRANTED.summary": {
    en: "Manager approved the action",
    zh: "经理已批准该操作",
  },
  "auditEvent.APPROVAL_REJECTED.summary": {
    en: "Manager rejected the proposal",
    zh: "经理已拒绝该提案",
  },
  "auditEvent.APPROVAL_DECIDED.detail": {
    en: "The approval binds the exact payload hash, decision-context hash and policy version.",
    zh: "审批绑定精确载荷哈希、决策上下文哈希与政策版本。",
  },
  "auditEvent.EXECUTION_REPLAYED.summary": {
    en: "Offline replay executed (simulated — not a PayPal response)",
    zh: "离线回放已执行（模拟 — 非 PayPal 响应）",
  },
  "auditEvent.EXECUTION_REPLAYED.detail": {
    en: "Single deterministic replay against the frozen fixture state. Revalidation ran immediately before the attempt.",
    zh: "针对冻结固定数据状态执行一次确定性回放。执行前已立即重新校验。",
  },
  "auditEvent.EXECUTION_BLOCKED.summary": {
    en: "Execution blocked at replay time",
    zh: "回放时执行被阻断",
  },
  "auditEvent.EXECUTION_BLOCKED.detail": {
    en: "Revalidation refused the attempt (hash drift, state conflict or duplicate execution). No request was issued.",
    zh: "重新校验拒绝了本次尝试（哈希漂移、状态冲突或重复执行），未发出任何请求。",
  },
  "auditEvent.CASE_STATE_CHANGED.summary": {
    en: "Case state changed (demo/test hook)",
    zh: "案件状态已变更（演示/测试钩子）",
  },
  "auditEvent.CASE_STATE_CHANGED.detail": {
    en: "A SYSTEM-role hook simulated a PayPal-side state change; not a PayPal call.",
    zh: "SYSTEM 角色的钩子模拟了 PayPal 侧状态变更，并非 PayPal 调用。",
  },
  "auditEvent.GENERIC.detail": {
    en: "Backend event without a dedicated projector; payload fields are shown verbatim.",
    zh: "后端事件无专用投影器；载荷字段按原文显示。",
  },

  /* --------------------------------- policy -------------------------------- */
  "policy.passed": { en: "Validator passed", zh: "校验通过" },
  "policy.blocked": { en: "Validator blocked", zh: "校验受阻" },
  "policy.review": { en: "Manager review", zh: "经理复核" },
  "policy.counts": {
    en: "{passed} pass · {failed} fail · {na} n/a",
    zh: "{passed} 通过 · {failed} 失败 · {na} 不适用",
  },
  "policy.hide": { en: "Hide checks", zh: "收起校验项" },
  "policy.show": { en: "Show all 12 checks", zh: "显示全部 12 项校验" },
  "policy.notApplicable": { en: "Not applicable", zh: "不适用" },

  /* -------------------------------- hateoas -------------------------------- */
  "hateoas.link": { en: "Link (rel)", zh: "链接（rel）" },
  "hateoas.method": { en: "Method", zh: "方法" },
  "hateoas.present": { en: "Present", zh: "存在" },
  "hateoas.frozen": { en: "Frozen fixture", zh: "冻结数据" },
  "hateoas.readAt": { en: "read {at}", zh: "读取于 {at}" },
  "hateoas.note": {
    en: "Links are the permission source. A missing link blocks the action even when the case is fully understood.",
    zh: "链接是权限来源。即使完全理解案件，缺失链接也会阻断操作。",
  },

  /* -------------------------------- readiness ------------------------------- */
  "readiness.ofRequested": { en: "{ratio}% of requested items", zh: "已提供所需材料的 {ratio}%" },
  "readiness.aria": {
    en: "Evidence readiness: {provided} of {requested} items on file",
    zh: "证据完备度：{provided}/{requested} 项已存档",
  },

  /* --------------------------------- toast ---------------------------------- */
  "toast.dismiss": { en: "Dismiss notification", zh: "关闭通知" },

  /* ------------------------------- manager gate ----------------------------- */
  "managerGate.title": { en: "Manager approval required", zh: "需要经理审批" },
  "managerGate.body": {
    en: "This workspace is restricted to the Dispute Operations Manager. Specialists prepare and submit proposals; they cannot approve their own work.",
    zh: "此工作区仅限争议运营经理访问。专员负责准备并提交提案，不能批准自己的工作。",
  },
  "managerGate.switch": { en: "Switch to Manager view", zh: "切换到经理视图" },
  "managerGate.note": {
    en: "Demo role switch · no authentication is simulated",
    zh: "演示角色切换 · 未模拟身份认证",
  },

  /* ------------------------------- demo guide -------------------------------- */
  "guide.title": { en: "Guided demo — five scenarios", zh: "引导演示 — 五个场景" },
  "guide.description": {
    en: "Five seeded cases, one per demo job. Everything runs on the offline replay backend; no PayPal API is called and no funds move.",
    zh: "五个预置案件，每个对应一项演示任务。全部运行在离线回放后端，不调用 PayPal API，也不会划转资金。",
  },
  "guide.demoData": {
    en: "Demo data · offline replay",
    zh: "演示数据 · 离线回放",
  },
  "guide.case": { en: "Case {id}", zh: "案件 {id}" },
  "guide.openCase": { en: "Open case", zh: "打开案件" },
  "guide.card.caseType": { en: "Case Type", zh: "案件类型" },
  "guide.card.dataSource": { en: "Data Source", zh: "数据来源" },
  "guide.card.mainProblem": { en: "Main Problem", zh: "主要问题" },
  "guide.card.aiRecommendation": { en: "AI Recommendation", zh: "AI 建议" },
  "guide.card.expectedAction": { en: "Expected User Action", zh: "预期用户操作" },
  "guide.card.demonstrates": { en: "What This Demo Demonstrates", zh: "本演示说明了什么" },
  "guide.card.proof": { en: "Proof of success", zh: "成功证明" },
  "guide.mockFixture": {
    en: "Mock mode: opens local fixture {id}",
    zh: "Mock 模式：打开本地固定数据 {id}",
  },
  "guide.noRealFunds": { en: "No real funds moved.", zh: "未划转任何真实资金。" },
  "guide.boundaryTitle": { en: "Demo boundaries:", zh: "演示边界：" },
  "guide.boundaryBody": {
    en: "Proposals cannot be edited by hand. A manager can only approve or reject, and approval authorises one offline replay attempt — never a dispute outcome.",
    zh: "本 Demo 不支持人工改写提案。经理只能批准或拒绝；审批仅授权一次离线回放尝试，不代表争议结果。",
  },
  "guide.reset.button": { en: "Reset demo", zh: "重置演示" },
  "guide.reset.title": { en: "Reset demo data?", zh: "重置演示数据？" },
  "guide.reset.body": {
    en: "This restores the five seeded demo cases from the golden backup and discards local demo changes. It does not touch PayPal and moves no funds.",
    zh: "将从 golden 备份恢复 5 条预置演示案件，并丢弃本地演示改动。不会触碰 PayPal，也不会划转资金。",
  },
  "guide.reset.confirm": { en: "Yes, reset demo data", zh: "确认重置演示数据" },
  "guide.reset.cancel": { en: "Cancel", zh: "取消" },
  "guide.reset.running": { en: "Resetting…", zh: "正在重置…" },
  "guide.reset.success": { en: "Demo data reset — {count} cases restored", zh: "演示数据已重置 — 恢复 {count} 个案件" },
  "guide.reset.successDetail": { en: "Backup written before the reset: {backup}", zh: "重置前已写入备份：{backup}" },
  "guide.reset.failed": { en: "Demo reset failed", zh: "演示重置失败" },
  "guide.reset.mockOnly": {
    en: "Reset is disabled in mock mode: the fixtures live in memory and are rebuilt by a reload.",
    zh: "Mock 模式下重置不可用：固定数据位于内存中，刷新页面即可重建。",
  },
  "guide.reset.offlineOnly": {
    en: "Reset is available only when the backend runs in offline replay mode.",
    zh: "仅当后端处于离线回放模式时才能重置。",
  },
  "guide.reset.sandboxOnly": {
    en: "Sandbox mode cannot be reset from the UI: the demo database is not the sandbox dataset.",
    zh: "Sandbox 模式无法从界面重置：演示数据库并非 Sandbox 数据集。",
  },

  /* -------------------------------- demo page -------------------------------- */
  "demo.eyebrow": { en: "Guided demo", zh: "引导演示" },
  "demo.title": { en: "Guided demo — five scenarios", zh: "引导演示 — 五个场景" },
  "demo.description": {
    en: "Five seeded cases, one per demo job. Each card states the data source, the AI recommendation, the expected action and the observable proof that the scenario ran.",
    zh: "五个预置案件，每个对应一项演示任务。每张卡都说明数据来源、AI 建议、预期操作，以及可观察的成功证明。",
  },
  "demo.boundaryTitle": { en: "Offline replay only.", zh: "仅离线回放。" },
  "demo.boundaryBody": {
    en: "No PayPal API is called and no real funds move. Source labels are shown verbatim: OFFLINE_REPLAY and SIMULATED_COMPOSITE.",
    zh: "不调用 PayPal API，不划转真实资金。来源标签按原值显示：OFFLINE_REPLAY 与 SIMULATED_COMPOSITE。",
  },
  "demo.noRealFunds": { en: "No real funds moved.", zh: "未划转任何真实资金。" },
  "demo.resetTitle": { en: "Reset demo data", zh: "重置演示数据" },
  "demo.resetDescription": {
    en: "Restores the five seeded cases from the golden backup. Only available against the offline replay backend in HTTP mode.",
    zh: "从 golden 备份恢复 5 条预置案件。仅在 HTTP 模式连接离线回放后端时可用。",
  },
  "demo.resetRefreshed": {
    en: "The loaded case list was refreshed after the reset.",
    zh: "重置完成后已刷新已加载的案件列表。",
  },
  "demo.openCase": { en: "Open case", zh: "打开案件" },
  "demo.backToCases": { en: "Back to cases", zh: "返回案件" },
  "demo.boundaryFootnote": {
    en: "Proposals are generated by the backend. Approval authorises one offline replay attempt, never a dispute outcome.",
    zh: "提案由后端生成。审批仅授权一次离线回放尝试，不裁决争议。",
  },

  /* --------------------------- scenario 1 · send message -------------------- */
  "guide.s1.title": { en: "Send Message", zh: "发送消息" },
  "guide.s1.caseType": { en: "INR · Item not received · 19.00 USD", zh: "INR · 未收到商品 · 19.00 USD" },
  "guide.s1.problem": {
    en: "The buyer paid 19.00 USD and no fulfillment record exists. Nothing proves the item was shipped.",
    zh: "买家已支付 19.00 USD，但不存在履约记录，没有任何证据证明商品已发出。",
  },
  "guide.s1.ai": {
    en: "Send message to buyer — ask for the missing details without inventing a shipment or promising a refund.",
    zh: "向买家发送消息 — 询问缺失信息，不编造物流记录，也不承诺退款。",
  },
  "guide.s1.action": {
    en: "Review the exact message text, submit it, then approve as Manager. Execution is one offline replay.",
    zh: "核对消息逐字内容后提交，再以经理身份批准。执行仅一次离线回放。",
  },
  "guide.s1.demo": {
    en: "AI output is grounded: it does not fabricate tracking, and the approval gate still binds the exact text.",
    zh: "AI 输出有依据：不虚构物流；审批仍绑定逐字文案。",
  },
  "guide.s1.proof": {
    en: "After the manager approves, the audit row shows EXECUTION_ATTEMPT · simulated=true · REPLAYED — never a PayPal success.",
    zh: "经理批准后，审计行显示 EXECUTION_ATTEMPT · simulated=true · REPLAYED，绝不会显示为 PayPal 成功。",
  },

  /* ------------------------- scenario 2 · provide evidence ------------------ */
  "guide.s2.title": { en: "Provide Evidence", zh: "提供证据" },
  "guide.s2.caseType": { en: "SNAD · Not as described · 13.00 USD", zh: "SNAD · 与描述不符 · 13.00 USD" },
  "guide.s2.problem": {
    en: "Wrong size delivered, shipped without tracking, and no buyer photos are on file.",
    zh: "收到的尺码不符，发货无追踪，且没有买家照片存档。",
  },
  "guide.s2.ai": {
    en: "Provide evidence — the open requirement is proof of fulfillment; the gap is stated, not filled with invented material.",
    zh: "提供证据 — 未满足要求为履约证明；缺口被如实标注，不用虚构材料填补。",
  },
  "guide.s2.action": {
    en: "Attach evidence that matches the requested type, submit, and approve as Manager.",
    zh: "附上与所要求类型一致的证据，提交后以经理身份批准。",
  },
  "guide.s2.demo": {
    en: "Evidence-type matching and an honest evidence gap; replay records which artifact was submitted.",
    zh: "证据类型匹配与诚实的证据缺口；回放记录实际提交的材料。",
  },
  "guide.s2.proof": {
    en: "The approval payload lists the exact evidence type and file name; the audit event records the same submission, with no claim that the dispute was decided.",
    zh: "审批载荷列出确切的证据类型与文件名；审计事件记录同一次提交，且不声称争议已被裁决。",
  },

  /* ------------------------ scenario 3 · unsafe action blocked --------------- */
  "guide.s3.title": { en: "Unsafe Action Blocked", zh: "危险操作被阻断" },
  "guide.s3.caseType": { en: "INR · Item not received · 21.00 USD", zh: "INR · 未收到商品 · 21.00 USD" },
  "guide.s3.problem": {
    en: "The case asks for proof of fulfillment, but no fulfillment evidence exists, so the action cannot proceed.",
    zh: "案件要求履约证明，但不存在履约证据，因此该操作无法执行。",
  },
  "guide.s3.ai": {
    en: "Provide evidence — the AI suggestion is not executable here.",
    zh: "提供证据 — 该 AI 建议在当前状态下不可执行。",
  },
  "guide.s3.action": {
    en: "Read the validator block (V5) and stop. Do not submit an action the snapshot does not permit.",
    zh: "阅读校验器（V5）阻断原因并停止，不提交快照不允许的操作。",
  },
  "guide.s3.demo": {
    en: "AI advice is not permission: a missing precondition blocks the action even when a link exists.",
    zh: "AI 建议不等于权限：即使存在链接，缺失前置条件仍会阻断操作。",
  },
  "guide.s3.proof": {
    en: "The validator reports V5 FAIL with EVIDENCE_MATERIAL_MISSING, the backend refuses submission with HTTP 422, and the audit trail contains no approval, execution attempt or request id.",
    zh: "校验器报告 V5 FAIL 与 EVIDENCE_MATERIAL_MISSING，后端正拒绝提交（HTTP 422），审计轨迹中不存在审批、执行尝试或请求编号。",
  },

  /* -------------------------- scenario 4 · partial refund ------------------- */
  "guide.s4.title": { en: "Partial Refund", zh: "部分退款" },
  "guide.s4.caseType": {
    en: "PAYMENT · Capture refund · 42.00 USD captured, 12.00 USD already refunded, 30.00 USD still refundable",
    zh: "PAYMENT · Capture 退款 · 已收 42.00 USD，已退 12.00 USD，剩余可退 30.00 USD",
  },
  "guide.s4.problem": {
    en: "The order was only partially fulfilled; the merchant agreed to return part of the captured amount.",
    zh: "订单仅部分履约，商家同意退回部分已收金额。",
  },
  "guide.s4.ai": {
    en: "Partial refund of 10.00 USD — a refund is not dispute resolution and does not close the case.",
    zh: "部分退款 10.00 USD — 退款不等于争议解决，也不会关闭案件。",
  },
  "guide.s4.action": {
    en: "Enter 10.00 USD, submit it, then approve it yourself. The backend re-checks amount, currency and remaining balance before the offline replay.",
    zh: "输入 10.00 USD 并提交，然后由你本人批准。后端会在离线回放前重新校验金额、币种与剩余可退余额。",
  },
  "guide.s4.demo": {
    en: "Triple validation before a money-moving action, the refund/capture status split, and no real funds moved.",
    zh: "资金操作的金额、币种、余额三重校验；退款状态与 Capture 状态严格区分；不划转真实资金。",
  },
  "guide.s4.proof": {
    en: "The payload shows capture, original, already refunded and remaining amounts; the synthetic capture is labelled SIMULATED_COMPOSITE and “No real funds moved.”",
    zh: "载荷显示 capture、原始金额、已退金额与剩余可退金额；合成 capture 标注 SIMULATED_COMPOSITE 与“未划转任何真实资金”。",
  },

  /* -------------------------- scenario 5 · billing dispute ----------------- */
  "guide.s5.title": { en: "Billing Dispute", zh: "账单争议" },
  "guide.s5.caseType": {
    en: "BILLING · Duplicate charge · 18.00 USD",
    zh: "BILLING · 重复扣款 · 18.00 USD",
  },
  "guide.s5.problem": {
    en: "The buyer holds two receipts for one annual subscription; the second charge was never refunded.",
    zh: "买家持有一笔年费订阅的两张收据，第二笔扣款从未退款。",
  },
  "guide.s5.ai": {
    en: "Clarify the duplicate charge first; the AI plan is not automatically the permitted action.",
    zh: "先澄清重复扣款；AI 的方案并不自动等于当前允许的操作。",
  },
  "guide.s5.action": {
    en: "Wait: the snapshot allows no legal write for this dispute, so the assistant stops instead of guessing.",
    zh: "等待：当前快照不允许对该争议执行任何合法写操作，因此助手会停下而不是猜测。",
  },
  "guide.s5.demo": {
    en: "Billing-path handling and the Specialist's judgement over an AI plan that the snapshot does not permit.",
    zh: "账单类争议路径，以及专员对快照不允许的 AI 方案作出人工判断。",
  },
  "guide.s5.proof": {
    en: "The capability snapshot permits only the clarification message; the audit trail shows that message and no refund was created.",
    zh: "能力快照仅允许澄清消息；审计轨迹显示该消息，且没有创建任何退款。",
  },

  /* ----------------------------- submit dialog ------------------------------ */
  "submit.title": { en: "Submit action for manager approval", zh: "提交操作以供经理审批" },
  "submit.description": {
    en: "This queues a proposal. Nothing is executed at this step.",
    zh: "此操作会将提案加入队列，本步骤不执行任何操作。",
  },
  "submit.case": { en: "Case", zh: "案件" },
  "submit.amount": { en: "Disputed amount", zh: "争议金额" },
  "submit.snapshot": { en: "Snapshot", zh: "Snapshot / 快照" },
  "submit.evidenceAttached": { en: "Evidence attached", zh: "已附证据" },
  "submit.refs": { en: "{count} references", zh: "{count} 条引用" },
  "submit.validator": { en: "Policy validator: {decision}", zh: "政策校验：{decision}" },
  "submit.next": { en: "What happens next", zh: "后续步骤" },
  "submit.step1": {
    en: "A manager reviews the action, evidence and validator result.",
    zh: "经理审核操作、证据与校验结果。",
  },
  "submit.step2": {
    en: "If approved, the decision is revalidated against a fresh snapshot.",
    zh: "若获批准，将基于最新快照重新校验。",
  },
  "submit.step3": {
    en: "One replay attempt runs with a fixed request id. No retry.",
    zh: "以固定请求编号执行一次回放尝试，不重试。",
  },
  "submit.step3Live": {
    en: "One Sandbox execution attempt runs with a fixed request id. No retry.",
    zh: "以固定请求编号发出一次 Sandbox 执行请求，不重试。",
  },
  "submit.step4": {
    en: "A GET re-query verifies the result and writes the audit trail.",
    zh: "通过 GET 重新查询核验结果并写入审计轨迹。",
  },
  "submit.note": {
    en: "Submitting is not approval and not execution. The proposal stays bound to {snapshot}; if the case changes, replay revalidation fails instead of sending a stale payload.",
    zh: "提交不等于批准或执行。提案绑定 {snapshot}；若案件发生变化，回放重新校验会失败，而不会发送过期载荷。",
  },
  "submit.noteLive": {
    en: "Submitting is not approval and not execution. The proposal stays bound to {snapshot}; if the case changes, the pre-execution check fails instead of sending a stale payload.",
    zh: "提交不等于批准或执行。提案绑定 {snapshot}；若案件发生变化，执行前校验会失败，而不会发送过期载荷。",
  },
  "submit.managerRequired": { en: "Manager approval required", zh: "需要经理审批" },
  "submit.mvp": { en: "MVP: all protected writes", zh: "MVP：所有受保护写操作" },

  /* ------------------------------ replay dialog ------------------------------ */
  "replay.title": { en: "Replay revalidation", zh: "回放重新校验" },
  "replay.description": {
    en: "A manager approval does not bypass validation. Every check runs again immediately before the single attempt.",
    zh: "经理审批不会跳过校验。每次尝试前都会重新运行全部检查。",
  },
  "replay.openAudit": { en: "Open audit trail", zh: "打开审计轨迹" },
  "replay.revalidating": { en: "Revalidating…", zh: "重新校验中…" },
  "replay.check1": { en: "Snapshot freshness", zh: "快照时效" },
  "replay.check1Note": {
    en: "Decision must be inside the 30-minute window.",
    zh: "决策必须处于 30 分钟时效窗口内。",
  },
  "replay.check2": { en: "Case status unchanged", zh: "案件状态未变更" },
  "replay.check2Note": { en: "No lifecycle transition since approval.", zh: "批准后未发生生命周期变更。" },
  "replay.check3": { en: "HATEOAS action available", zh: "HATEOAS 操作可用" },
  "replay.check3Note": {
    en: "The rel link must still be present with POST.",
    zh: "rel 链接必须仍以 POST 存在。",
  },
  "replay.check4": { en: "Idempotency key bound", zh: "幂等键已绑定" },
  "replay.check4Note": { en: "Fixed request id; exactly one attempt.", zh: "固定请求编号；仅一次尝试。" },
  "replay.queued": { en: "queued", zh: "排队中" },
  "replay.passed": { en: "passed", zh: "通过" },
  "replay.failed": { en: "failed", zh: "失败" },
  "replay.info": { en: "info", zh: "说明" },
  "replay.running": { en: "running", zh: "运行中" },
  "replay.verified": { en: "Replay verified", zh: "回放已核验" },
  "replay.blocked": { en: "Execution blocked", zh: "执行受阻" },
  "replay.checksPassed": { en: "{passed}/{total} checks passed", zh: "{passed}/{total} 项检查通过" },
  "replay.simulatedNote": {
    en: "Simulated offline replay — not a PayPal API response, not an adjudication.",
    zh: "模拟离线回放 — 非 PayPal API 响应，也非裁决。",
  },
  "replay.fixtureNote": {
    en: "Local replay fixture · one attempt · no retry · result written to the audit trail.",
    zh: "本地回放固定数据 · 仅一次尝试 · 不重试 · 结果写入审计轨迹。",
  },
  "replay.waiting": {
    en: "Revalidating against the bound snapshot. No request is sent until every check passes.",
    zh: "正在针对绑定快照重新校验。所有检查通过前不会发送请求。",
  },
  "replay.toastSuccess": { en: "Replay succeeded and was verified", zh: "回放成功并已核验" },
  "replay.toastBlocked": { en: "Replay blocked", zh: "回放受阻" },

  /* ------------------------------ approval queue ----------------------------- */
  "approvals.eyebrow": { en: "Prepared by the AI assistant", zh: "AI 助手已准备" },
  "approvals.title": { en: "Needs your confirmation", zh: "待我确认" },
  "approvals.description": {
    en: "These are steps the AI assistant prepared for you. Nothing has been sent, refunded or closed — confirming authorises one attempt, and an offline replay never moves real money.",
    zh: "这些是 AI 助手为你准备好的步骤。尚未发送、退款或结案 — 确认只授权一次尝试，离线回放不会产生真实资金变动。",
  },
  "approvals.kpi.pending": { en: "Pending approvals", zh: "待审批" },
  "approvals.kpi.pendingDetail": {
    en: "Oldest first · single-action decisions",
    zh: "最早优先 · 单次操作决策",
  },
  "approvals.kpi.highRisk": { en: "Priority items", zh: "优先事项" },
  "approvals.kpi.highRiskDetail": { en: "High risk or near expiry", zh: "高风险或临近过期" },
  "approvals.kpi.gaps": { en: "With evidence gaps", zh: "存在证据缺口" },
  "approvals.kpi.gapsDetail": { en: "The proposal does not hide them", zh: "提案不会隐藏缺口" },
  "approvals.kpi.longest": { en: "Longest waiting", zh: "最长等待" },
  "approvals.kpi.since": { en: "Since {at}", zh: "自 {at}" },
  "approvals.kpi.empty": { en: "Queue is empty", zh: "队列为空" },
  "approvals.notGuaranteeTitle": { en: "Approval is not a guarantee.", zh: "审批不是保证。" },
  "approvals.notGuarantee": {
    en: "A manager decision authorises a single local replay attempt. Revalidation runs immediately before execution, and PayPal may still reject the action. Approval never means the dispute is won.",
    zh: "经理决策仅授权一次本地回放尝试。执行前会立即重新校验，PayPal 仍可能拒绝该操作。审批绝不意味着争议胜诉。",
  },
  "approvals.searchPlaceholder": { en: "Search case, proposal or action", zh: "搜索案件、提案或操作" },
  "approvals.searchLabel": { en: "Search pending approvals", zh: "搜索待审批项" },
  "approvals.filterRisk": { en: "Filter by risk", zh: "按风险筛选" },
  "approvals.allRisk": { en: "All risk levels", zh: "全部风险等级" },
  "approvals.mediumRisk": { en: "Medium risk", zh: "中风险" },
  "approvals.highRisk": { en: "High risk", zh: "高风险" },
  "approvals.count": { en: "{shown} of {total} pending", zh: "待审批 {total} 项，显示 {shown} 项" },
  "approvals.colCase": { en: "Case", zh: "案件" },
  "approvals.colAction": { en: "Proposed action", zh: "拟执行操作" },
  "approvals.colRisk": { en: "Risk", zh: "风险" },
  "approvals.colPriority": { en: "Priority", zh: "优先级" },
  "approvals.colValidator": { en: "Validator", zh: "校验器" },
  "approvals.colApproval": { en: "Approval state", zh: "审批状态" },
  "approvals.colSource": { en: "Source", zh: "来源" },
  "approvals.filterAction": { en: "Filter by action", zh: "按操作筛选" },
  "approvals.allActions": { en: "All actions", zh: "全部操作" },
  "approvals.priority.urgent": { en: "Priority", zh: "优先" },
  "approvals.priority.pending": { en: "Pending", zh: "待审批" },
  "approvals.priority.decided": { en: "Decided", zh: "已决策" },
  "approvals.priority.riskNote": { en: "High risk · decide first", zh: "高风险 · 优先决策" },
  "approvals.priority.expiryNote": {
    en: "Snapshot at/over {minutes} min freshness window",
    zh: "快照已达/超过 {minutes} 分钟新鲜度窗口",
  },
  "approvals.validatorCounts": { en: "{passed} passed · {failed} failed", zh: "{passed} 通过 · {failed} 失败" },
  "approvals.sortNote": {
    en: "Pending first · risk · longest wait",
    zh: "待审批优先 · 风险 · 等待最久",
  },
  "approvals.derived": {
    en: "Derived from {count} loaded cases. Not a backend aggregate.",
    zh: "由已加载的 {count} 个案件派生，非后端聚合。",
  },
  "approvals.loadFailedTitle": { en: "The approval queue could not be loaded", zh: "无法加载审批队列" },
  "approvals.loadFailedBody": {
    en: "The workspace request failed. Retry the read; no cached queue is presented as current.",
    zh: "工作区请求失败。请重试读取；不会把缓存队列当作当前数据。",
  },
  "approvals.noMatchTitle": { en: "No approvals match these filters", zh: "没有符合筛选条件的审批" },
  "approvals.noMatchBody": {
    en: "Clear the action, risk or search filter to see the full queue.",
    zh: "清除操作、风险或搜索筛选以查看完整队列。",
  },
  "approvals.clearFilters": { en: "Clear filters", zh: "清除筛选" },
  "approvals.waitingUnknown": { en: "No submitted time", zh: "无提交时间" },
  "approvals.openHint": { en: "Open approval detail", zh: "打开审批详情" },
  "approvals.colEvidence": { en: "Evidence", zh: "证据" },
  "approvals.colSpecialist": { en: "Specialist", zh: "专员" },
  "approvals.colWaiting": { en: "Waiting", zh: "等待时长" },
  "approvals.colAmount": { en: "Amount", zh: "金额" },
  "approvals.refsCited": { en: "{count} references cited", zh: "引用 {count} 条证据" },
  "approvals.emptyTitle": { en: "No proposals waiting", zh: "暂无待审批提案" },
  "approvals.emptyBody": {
    en: "When a specialist submits an action, it appears here with its evidence, validator result and snapshot binding.",
    zh: "专员提交操作后，将连同证据、校验结果与快照绑定显示在此处。",
  },
  "approvals.footer": {
    en: "Oldest first · decisions are recorded with a required reason",
    zh: "最早优先 · 决策须记录理由",
  },
  "approvals.mvp": { en: "MVP", zh: "MVP" },
  "approvals.mvpNote": {
    en: "All protected actions require manager approval",
    zh: "所有受保护操作都需经理审批",
  },

  /* ----------------------------- approval detail ----------------------------- */
  "approval.notFound": { en: "Proposal not found", zh: "未找到提案" },
  "approval.notFoundBody": {
    en: "No proposal with reference {proposalId} exists in the fixture set.",
    zh: "固定数据集中不存在编号为 {proposalId} 的提案。",
  },
  "approval.backToQueue": { en: "Back to approval queue", zh: "返回审批队列" },
  "approval.openWorkspace": { en: "Open full case workspace", zh: "打开完整案件工作区" },
  "approval.eyebrow": { en: "Approval review · {proposalId}", zh: "审批审核 · {proposalId}" },
  "approval.snapshotBadge": { en: "Snapshot {version}", zh: "Snapshot / 快照 {version}" },
  "approval.amount": { en: "Disputed amount", zh: "争议金额" },
  "approval.whyTitle": { en: "Why this action was proposed", zh: "为何提出此操作" },
  "approval.whySubtitle": {
    en: "Recommendation from the case analysis, bound to {snapshot}.",
    zh: "来自案件分析的建议，绑定 {snapshot}。",
  },
  "approval.uncertainty": { en: "model uncertainty {value}", zh: "模型不确定性 {value}" },
  "approval.unverifiedBadge": {
    en: "Contains unverified claims — read before approving",
    zh: "含未经核实声明 — 批准前请阅读",
  },
  "approval.contradiction": { en: "Contradiction on record", zh: "记录中存在矛盾" },
  "approval.gapTitle": { en: "Evidence gap remains.", zh: "证据缺口仍存在。" },
  "approval.gapBody": {
    en: "{label}. The proposal does not present missing items as verified.",
    zh: "{label}。提案不会将缺失项呈现为已核实。",
  },
  "approval.evidenceTitle": { en: "Evidence behind the decision", zh: "决策依据证据" },
  "approval.cited": { en: "{count} cited", zh: "引用 {count} 条" },
  "approval.claimsSupported": { en: "Claims these records support", zh: "这些记录支持的声明" },
  "approval.messageTitle": { en: "Message text (exact)", zh: "消息正文（逐字）" },
  "approval.messageSubtitle": {
    en: "Approval binds this exact payload. Any edit creates a new proposal.",
    zh: "审批绑定此载荷的逐字内容；任何编辑都会创建新提案。",
  },
  "approval.messageChars": { en: "{count} characters", zh: "{count} 字符" },
  "approval.messageEmpty": {
    en: "The payload contains no message body.",
    zh: "载荷中没有消息正文。",
  },
  "approval.lifecycle": { en: "Lifecycle {stage}", zh: "生命周期 {stage}" },
  "approval.captureStatus": { en: "Capture {status}", zh: "Capture 状态 {status}" },
  "approval.paramsTitle": { en: "Action parameters", zh: "操作参数" },
  "approval.paramsSubtitle": {
    en: "What would be sent on the single attempt, if revalidation passes.",
    zh: "若重新校验通过，单次尝试将发送的内容。",
  },
  "approval.policyTitle": { en: "Policy validation", zh: "政策校验" },
  "approval.policySubtitle": { en: "Deterministic checks, not model judgement.", zh: "确定性检查，非模型判断。" },
  "approval.capabilityTitle": { en: "Capability snapshot", zh: "能力快照" },
  "approval.capabilitySubtitle": {
    en: "Availability at proposal time. Re-read at execution time.",
    zh: "提案时的可用性，执行时会重新读取。",
  },
  "approval.auditTitle": { en: "Audit trail", zh: "审计轨迹" },
  "approval.openTrail": { en: "Open full trail", zh: "打开完整轨迹" },
  "approval.decision": { en: "Decision", zh: "决策" },
  "approval.submittedBy": { en: "Submitted by", zh: "提交人" },
  "approval.submitted": { en: "Submitted", zh: "提交时间" },
  "approval.snapshotBound": { en: "Snapshot bound", zh: "绑定快照" },
  "approval.evidenceStatus": { en: "Evidence status", zh: "证据状态" },
  "approval.approve": { en: "Approve action", zh: "批准操作" },
  "approval.reject": { en: "Reject with reason", zh: "拒绝并说明理由" },
  "approval.recordedAgainst": {
    en: "Approval is recorded against {name} and binds this exact payload.",
    zh: "审批将记录在 {name} 名下，并绑定此精确载荷。",
  },
  "approval.cannotApprove": { en: "Cannot be approved", zh: "无法批准" },
  "approval.refreshSnapshot": { en: "Refresh snapshot", zh: "刷新快照" },
  "approval.refreshToast": { en: "Snapshot refreshed", zh: "快照已刷新" },
  "approval.refreshToastDetail": {
    en: "The proposal is back in draft. A specialist submits it again for approval.",
    zh: "提案已回到草稿，需专员重新提交审批。",
  },
  "approval.notSubmitted": { en: "Not submitted yet", zh: "尚未提交" },
  "approval.notSubmittedBody": {
    en: "A specialist must submit this proposal before a manager can record a decision.",
    zh: "专员须先提交此提案，经理才能记录决策。",
  },
  "approval.rejected": { en: "Rejected", zh: "已拒绝" },
  "approval.approved": { en: "Approved", zh: "已批准" },
  "approval.by": { en: "by {name}", zh: "由 {name}" },
  "approval.replayResult": { en: "Replay result", zh: "回放结果" },
  "approval.replayRecorded": { en: "Replay recorded", zh: "已记录回放" },
  "approval.simulatedReplay": {
    en: "Simulated offline replay — not a PayPal acceptance or adjudication.",
    zh: "模拟离线回放 — 非 PayPal 接受或裁决。",
  },
  "approval.infoFooter": {
    en: "Approval authorises one local replay attempt. It does not mean PayPal accepted the action, and it does not decide the dispute. Revalidation runs immediately before execution.",
    zh: "审批授权一次本地回放尝试，不代表 PayPal 接受该操作，也不裁决争议。执行前会立即重新校验。",
  },
  "approval.infoFooterLive": {
    en: "Approval authorises one Sandbox execution attempt. It does not mean the dispute is decided. Checks run immediately before the single request; there is no automatic retry.",
    zh: "审批授权一次 Sandbox 执行尝试，不代表争议已被裁决。单次请求前会立即重新校验；不会自动重试。",
  },
  "approval.snapshotBinding": { en: "Snapshot binding", zh: "快照绑定" },
  "approval.snapshotBindingNote": {
    en: "If the case changes after approval, replay revalidation fails instead of sending a stale payload.",
    zh: "若批准后案件发生变化，回放重新校验会失败，而不会发送过期载荷。",
  },
  "approval.snapshotBindingNoteLive": {
    en: "If the case changes after approval, the pre-execution check fails instead of sending a stale payload.",
    zh: "若批准后案件发生变化，执行前校验会失败，而不会发送过期载荷。",
  },
  "approval.dialog.approveTitle": { en: "Approve this action?", zh: "批准此操作？" },
  "approval.dialog.rejectTitle": { en: "Reject this proposal?", zh: "拒绝此提案？" },
  "approval.dialog.approveDesc": {
    en: "The decision is recorded with your name, the payload and the case snapshot.",
    zh: "决策将连同你的姓名、载荷与案件快照一并记录。",
  },
  "approval.dialog.rejectDesc": {
    en: "The specialist will see the reason and can re-plan. No execution will be attempted.",
    zh: "专员将看到理由并可重新规划，不会尝试执行。",
  },
  "approval.dialog.reason": { en: "Decision reason", zh: "决策理由" },
  "approval.dialog.reasonPlaceholderApprove": {
    en: "State what you checked. This is stored in the audit trail.",
    zh: "说明你核查了什么，此内容将写入审计轨迹。",
  },
  "approval.dialog.reasonPlaceholderReject": {
    en: "Explain what must change before this action can be proposed again.",
    zh: "说明需改变什么才能再次提出此操作。",
  },
  "approval.dialog.required": { en: "Required · minimum 8 characters", zh: "必填 · 至少 8 个字符" },
  "approval.dialog.approveWarning": {
    en: "Approving does not execute anything by itself. Replay revalidation runs next, and it can still block the attempt.",
    zh: "批准本身不会执行任何操作。接下来进行回放重新校验，仍可能阻断尝试。",
  },
  "approval.dialog.approveWarningLive": {
    en: "Approving does not execute anything by itself. A single Sandbox request is sent next after the precheck, and the precheck can still block it.",
    zh: "批准本身不会执行任何操作。接下来会在执行前校验后发出一次 Sandbox 请求，校验仍可能阻断。",
  },
  "approval.dialog.approveCta": { en: "Approve and revalidate", zh: "批准并重新校验" },
  "approval.dialog.recordCta": { en: "Record approval", zh: "记录批准" },
  "approval.dialog.rejectCta": { en: "Reject proposal", zh: "拒绝提案" },
  "approval.defaultApproveReason": {
    en: "Evidence reviewed against the open requirement. Payload is limited to what the records support.",
    zh: "已对照未满足要求核查证据。载荷仅限于记录支持的内容。",
  },
  "approval.toast.approved": { en: "Approved — revalidation running", zh: "已批准 — 正在重新校验" },
  "approval.toast.approvedDetail": {
    en: "The decision is recorded. Execution still depends on the replay checks.",
    zh: "决策已记录。执行仍取决于回放检查。",
  },
  "approval.toast.approvedDetailLive": {
    en: "The decision is recorded. Execution still depends on the pre-execution checks.",
    zh: "决策已记录。执行仍取决于执行前校验。",
  },
  "approval.toast.rejected": { en: "Proposal rejected", zh: "提案已拒绝" },
  "approval.toast.rejectedDetail": {
    en: "No execution was attempted. The specialist can re-plan the response.",
    zh: "未尝试执行。专员可重新规划响应。",
  },

  /* ------------------------------- audit page -------------------------------- */
  "auditPage.eyebrow": { en: "Activity", zh: "操作记录" },
  "auditPage.title": { en: "What happened", zh: "发生了什么" },
  "auditPage.description": {
    en: "Everything that happened to your disputes, in plain language. Every outcome keeps its reason — including the ones that never reached PayPal.",
    zh: "你的争议发生的所有事情，用易懂的语言呈现。每个结果都保留原因 — 包括从未到达 PayPal 的结果。",
  },
  "auditPage.localReplay": { en: "Local replay · no live API", zh: "本地回放 · 无实时 API" },
  "auditPage.replayed": { en: "Replayed (offline)", zh: "已回放（离线）" },
  "auditPage.replayedDetail": {
    en: "Offline replay accepted — no GET verification was run",
    zh: "离线回放已接受 — 未执行 GET 核验",
  },
  "auditPage.executed": { en: "Executed (remote confirmed)", zh: "已执行（远端已确认）" },
  "auditPage.executedDetail": {
    en: "LIVE request accepted and the follow-up GET confirmed the remote state",
    zh: "LIVE 请求被接受，且后续 GET 已确认远端状态",
  },
  "auditPage.unverified": { en: "Unverified (result unknown)", zh: "待核验（结果未知）" },
  "auditPage.unverifiedDetail": {
    en: "Not counted as success; human review required, no automatic retry",
    zh: "不计入成功；需人工核对，不会自动重试",
  },
  "auditPage.verified": { en: "Verified executions", zh: "已核验执行" },
  "auditPage.verifiedDetail": {
    en: "GET confirmation recorded (0 in offline replays)",
    zh: "已记录 GET 确认（离线回放为 0）",
  },
  "auditPage.blocked": { en: "Blocked by policy", zh: "被政策阻断" },
  "auditPage.blockedDetail": { en: "HATEOAS or evidence constraint", zh: "HATEOAS 或证据约束" },
  "auditPage.failed": { en: "Failed or expired", zh: "失败或过期" },
  "auditPage.failedDetail": {
    en: "Stale decision or state change",
    zh: "过期决策或状态变更",
  },
  "auditPage.duplicates": { en: "Duplicate suppressed", zh: "重复已抑制" },
  "auditPage.duplicatesDetail": { en: "Idempotency guard fired", zh: "幂等保护已触发" },
  "auditPage.ledger": { en: "Execution ledger", zh: "执行台账" },
  "auditPage.ledgerSubtitle": {
    en: "One row per proposal that reached approval or execution. Offline replays are counted as replayed, not as GET-verified executions.",
    zh: "每个进入审批或执行的提案一行。离线回放计入“已回放”，不计入 GET 核验执行。",
  },
  "auditPage.offlineNote": {
    en: "Offline replay — no GET verification was performed.",
    zh: "离线回放，未做 GET 核验。",
  },
  "auditPage.sandboxNote": {
    en: "Sandbox requests and GET verification are separate events. A sent request is never shown as a confirmed result.",
    zh: "Sandbox 请求与 GET 回查是独立事件；已发出的请求不会显示为已确认结果。",
  },
  "auditPage.state.REPLAYED": { en: "Replayed (offline)", zh: "已回放（离线）" },
  "auditPage.state.EXECUTED": {
    en: "Executed (remote confirmed)",
    zh: "已执行（远端已确认）",
  },
  "auditPage.state.VERIFIED": { en: "Verified", zh: "已核验" },
  "auditPage.state.FAILED": { en: "Failed", zh: "失败" },
  "auditPage.state.BLOCKED": { en: "Blocked", zh: "受阻" },
  "auditPage.state.EXPIRED": { en: "Expired", zh: "已过期" },
  "auditPage.state.REJECTED": { en: "Not attempted", zh: "未尝试" },
  "auditPage.state.PENDING": { en: "Awaiting approval", zh: "待审批" },
  "auditPage.colCase": { en: "Case", zh: "案件" },
  "auditPage.colAction": { en: "Action", zh: "操作" },
  "auditPage.colState": { en: "Execution state", zh: "执行状态" },
  "auditPage.colMode": { en: "Mode", zh: "模式" },
  "auditPage.colVerified": { en: "Remote verified", zh: "远端核验" },
  "auditPage.colReason": { en: "Reason / result", zh: "原因 / 结果" },
  "auditPage.colRequestId": { en: "Request id", zh: "请求编号" },
  "auditPage.colWhen": { en: "Time", zh: "时间" },
  "auditPage.modeFilter": { en: "Filter by run mode", zh: "按运行模式筛选" },
  "auditPage.allModes": { en: "All modes", zh: "全部模式" },
  "auditPage.modeLive": { en: "LIVE", zh: "LIVE（真实请求）" },
  "auditPage.modeReplay": { en: "REPLAY", zh: "REPLAY（离线回放）" },
  "auditPage.modeNotReported": { en: "Mode not reported", zh: "模式未上报" },
  "auditPage.resultFilter": { en: "Filter by result", zh: "按结果筛选" },
  "auditPage.allResults": { en: "All results", zh: "全部结果" },
  "auditPage.verifiedFilter": { en: "Filter by remote verification", zh: "按远端核验筛选" },
  "auditPage.allVerification": { en: "Any verification", zh: "全部核验状态" },
  "auditPage.confirmed": { en: "Confirmed", zh: "已核验" },
  "auditPage.notConfirmed": { en: "Not confirmed", zh: "未核验" },
  "auditPage.notReported": { en: "Not reported", zh: "未上报" },
  "auditPage.verifiedYes": { en: "Confirmed", zh: "已核验" },
  "auditPage.verifiedNo": { en: "Not confirmed", zh: "未核验" },
  "auditPage.verifiedReplay": { en: "n/a · replay", zh: "不适用 · 回放" },
  "auditPage.expand": { en: "Show details", zh: "展开详情" },
  "auditPage.collapse": { en: "Hide details", zh: "收起详情" },
  "auditPage.payloadHash": { en: "Payload hash", zh: "载荷哈希" },
  "auditPage.snapshotHash": { en: "Snapshot hash", zh: "快照哈希" },
  "auditPage.verificationTitle": { en: "Verification evidence", zh: "核验证据" },
  "auditPage.method": { en: "Method", zh: "方法" },
  "auditPage.basis": { en: "Basis", zh: "依据" },
  "auditPage.checkedAt": { en: "Checked at", zh: "核验时间" },
  "auditPage.observations": { en: "Observations", zh: "观测结果" },
  "auditPage.remoteStatus": { en: "Remote status", zh: "远端状态" },
  "auditPage.linkedEvents": { en: "Linked audit events", zh: "关联审计事件" },
  "auditPage.noLinkedEvents": { en: "No audit event is linked to this proposal.", zh: "该提案没有关联审计事件。" },
  "auditPage.derived": {
    en: "Derived from {count} loaded cases — no global execution API. Not a backend aggregate.",
    zh: "由已加载的 {count} 个案件派生 — 无全局执行 API，非后端聚合。",
  },
  "auditPage.notLoaded": {
    en: "Workspace not loaded; counts are shown as — instead of 0.",
    zh: "工作区尚未加载；计数显示为 —，而非 0。",
  },
  "auditPage.loadFailedTitle": { en: "Executions could not be loaded", zh: "无法加载执行记录" },
  "auditPage.loadFailedBody": {
    en: "The workspace request failed. Retry the read; cached rows are not presented as current.",
    zh: "工作区请求失败。请重试读取；不会把缓存记录当作当前数据。",
  },
  "auditPage.replayDisclosure": {
    en: "Simulated offline replay — no PayPal request was sent and no funds moved.",
    zh: "模拟离线回放 — 未发送 PayPal 请求，也未划转资金。",
  },
  "auditPage.liveDisclosure": {
    en: "A real Sandbox request. Green is only used when a follow-up GET confirmed the remote state.",
    zh: "真实 Sandbox 请求。仅当后续 GET 确认远端状态时才使用绿色。",
  },
  "auditPage.noAttempt": { en: "No execution attempt recorded", zh: "未记录执行尝试" },
  "auditPage.trail": { en: "Audit trail", zh: "审计轨迹" },
  "auditPage.trailSubtitle": {
    en: "Newest first · expand an event for full detail",
    zh: "最新优先 · 展开事件查看详情",
  },
  "auditPage.searchPlaceholder": { en: "Search event, action or actor", zh: "搜索事件、操作或执行人" },
  "auditPage.searchLabel": { en: "Search audit events", zh: "搜索审计事件" },
  "auditPage.filterCase": { en: "Filter audit by case", zh: "按案件筛选审计" },
  "auditPage.allCases": { en: "All cases", zh: "全部案件" },
  "auditPage.filterOutcome": { en: "Filter audit by outcome", zh: "按结果筛选审计" },
  "auditPage.allOutcomes": { en: "All outcomes", zh: "全部结果" },
  "auditPage.outcomeSucceeded": { en: "Succeeded", zh: "成功" },
  "auditPage.outcomeFailed": { en: "Failed", zh: "失败" },
  "auditPage.outcomeBlocked": { en: "Blocked", zh: "受阻" },
  "auditPage.outcomeExpired": { en: "Expired", zh: "已过期" },
  "auditPage.outcomeDuplicate": { en: "Duplicate suppressed", zh: "重复已抑制" },
  "auditPage.events": { en: "{count} events", zh: "{count} 个事件" },
  "auditPage.rows": { en: "{count} rows", zh: "{count} 行" },
  "auditPage.noRowsTitle": { en: "No execution rows match these filters", zh: "没有符合筛选条件的执行行" },
  "auditPage.noRowsBody": {
    en: "Clear the mode, result, verification, case or search filter to see the full ledger.",
    zh: "清除模式、结果、核验、案件或搜索筛选以查看完整台账。",
  },
  "auditPage.noLedgerTitle": { en: "No execution rows yet", zh: "暂无执行记录" },
  "auditPage.noLedgerBody": {
    en: "No proposal has reached execution. Approval alone does not create an execution record.",
    zh: "尚无提案进入执行。审批本身不会创建执行记录。",
  },
  "auditPage.duplicateGuard": { en: "duplicate guard", zh: "重复保护" },
  "auditPage.noEvents": {
    en: "No audit events match these filters.",
    zh: "没有符合筛选条件的审计事件。",
  },
  "auditPage.footer": {
    en: "Every event is written by the local replay engine. No PayPal request was made.",
    zh: "所有事件均由本地回放引擎写入，未发出任何 PayPal 请求。",
  },
  "auditPage.timezone": { en: "Times shown in local timezone", zh: "时间按本地时区显示" },
  "auditPage.ariaTrail": { en: "Audit trail for {caseId}", zh: "{caseId} 的审计轨迹" },

  /* ---------------------------------- time ----------------------------------- */
  "time.justNow": { en: "just now", zh: "刚刚" },
  "time.minutesAgo": { en: "{count}m ago", zh: "{count} 分钟前" },
  "time.hoursAgo": { en: "{count}h ago", zh: "{count} 小时前" },
  "time.daysAgo": { en: "{count}d ago", zh: "{count} 天前" },
  "time.hoursMinutes": { en: "{hours}h {minutes}m", zh: "{hours} 小时 {minutes} 分" },
  "time.hours": { en: "{hours}h", zh: "{hours} 小时" },
  "time.minutes": { en: "{minutes}m", zh: "{minutes} 分" },

  /* --------------------------------- errors ---------------------------------- */
  "error.title.timeout": { en: "Analysis timed out", zh: "分析超时" },
  "error.title.unavailable": { en: "Local model unavailable", zh: "本地模型不可用" },
  "error.title.network": { en: "Backend unreachable", zh: "无法连接后端" },
  "error.title.server": { en: "Analysis failed", zh: "分析失败" },
  "error.title.request": { en: "Analysis request rejected", zh: "分析请求被拒绝" },
  "error.code.VALIDATION_FAILED": {
    en: "The backend rejected the request because one or more deterministic checks failed.",
    zh: "一项或多项确定性校验失败，后端拒绝了该请求。",
  },
  "error.code.CONFLICT": {
    en: "The resource changed since it was loaded. Refresh before retrying.",
    zh: "资源在加载后已变更，重试前请刷新。",
  },
  "error.code.FORBIDDEN": {
    en: "This demo identity is not allowed to perform the action.",
    zh: "当前演示身份无权执行此操作。",
  },
  "error.code.NOT_AUTHORIZED": {
    en: "The request is missing a valid demo identity.",
    zh: "请求缺少有效的演示身份。",
  },
  "error.code.NOT_FOUND": {
    en: "The backend has no record with this reference.",
    zh: "后端不存在此编号的记录。",
  },
  "error.code.DOMAIN_ERROR": {
    en: "A backend business rule blocked the request.",
    zh: "后端业务规则阻止了该请求。",
  },
  "error.code.TIMEOUT": {
    en: "The UI stopped waiting; the backend may still be working.",
    zh: "界面已停止等待，后端可能仍在处理。",
  },
  "error.code.NETWORK_ERROR": { en: "The backend could not be reached.", zh: "无法连接后端。" },
  "error.code.EMPTY_RESULT": {
    en: "The backend returned success but no record. The UI does not synthesize a result.",
    zh: "后端返回成功但无记录。界面不会合成结果。",
  },
  "error.code.CLIENT_ERROR": { en: "The request failed in the browser.", zh: "浏览器内请求失败。" },
  "error.code.SERVICE_UNAVAILABLE": {
    en: "The backend is temporarily unavailable.",
    zh: "后端暂时不可用。",
  },
  "error.code.PROPOSAL_NOT_GENERATED": {
    en: "The backend did not return a proposal for this case.",
    zh: "后端未返回该案件的处理建议。",
  },
  "error.noResultTitle": { en: "No result was invented.", zh: "未虚构任何结果。" },
  "error.noResultBody": {
    en: "The analysis panel keeps the previous state, no analysis record is written by this screen, and submit / approval / replay are never retried automatically.",
    zh: "分析面板保留原状态，此界面不会写入分析记录，提交 / 审批 / 回放绝不自动重试。",
  },
  "error.retry": { en: "Retry analysis", zh: "重试分析" },
  "error.retryUnavailable": {
    en: "Retry is not offered for this error; fix the request or identity first.",
    zh: "此类错误不提供重试，请先修正请求或身份。",
  },
  "error.manualOnly": {
    en: "Manual retry only · one new request is sent per click",
    zh: "仅手动重试 · 每次点击发送一次新请求",
  },
  "error.after": { en: "after {elapsed}", zh: "耗时 {elapsed}" },
  "error.processing": { en: "Processing", zh: "处理中" },
  "error.elapsed": { en: "{elapsed} elapsed", zh: "已用时 {elapsed}" },

  /* ------------------------- phase 4 · sandbox mode ------------------------- */
  "mode.replayNone": { en: "Offline replay", zh: "离线回放" },
  "mode.sandboxReadOnly": {
    en: "Sandbox · read-only",
    zh: "PayPal Sandbox · 只读",
  },
  "mode.sandboxExecutable": {
    en: "Sandbox · execution enabled (approval required)",
    zh: "Sandbox · 可执行（需审批）",
  },
  "mode.liveUnconfirmed": {
    en: "Sandbox · execution mode unconfirmed",
    zh: "Sandbox · 执行模式未确认",
  },
  "mode.notReported": { en: "Mode not reported", zh: "模式未报告" },
  "mode.title": {
    en: "execution_mode={mode} · network_access={access}",
    zh: "execution_mode={mode} · network_access={access}",
  },
  "mode.stripLabel": { en: "Runtime & source", zh: "运行与来源" },
  "mode.stripOffline": {
    en: "No PayPal API is called in this mode; cases, AI output and results are fixtures.",
    zh: "此模式下不会调用 PayPal API；案件、AI 输出与结果均为固定数据。",
  },
  "mode.stripSandbox": {
    en: "Runtime is read from /health. Capability and analysis sources are labelled per record.",
    zh: "运行模式来自 /health；能力与分析的来源按记录单独标注。",
  },

  "provenance.PAYPAL_API_OBSERVED": {
    en: "Sandbox live data",
    zh: "Sandbox 实时数据",
  },
  "provenance.SCENARIO_DEFINED": {
    en: "Offline de-identified data",
    zh: "离线脱敏数据",
  },
  "provenance.HUMAN_OBSERVED_SANDBOX_UI": {
    en: "Sandbox UI observation",
    zh: "Sandbox 界面观测",
  },
  "provenance.AI_INFERRED": { en: "AI inferred", zh: "AI 推断" },
  "provenance.SIMULATED_COMPOSITE": {
    en: "Simulated composite",
    zh: "模拟组合数据",
  },
  "provenance.unknown": { en: "Source not reported", zh: "来源未报告" },

  "readTime.label": { en: "Last read: {time}", zh: "最近读取：{time}" },
  "readTime.fromNote": {
    en: "Read time from the live status note",
    zh: "读取时间来自实时状态说明",
  },
  "readTime.fromImport": {
    en: "Read time from the latest CASE_IMPORTED audit event",
    zh: "读取时间来自最新 CASE_IMPORTED 审计事件",
  },
  "readTime.none": { en: "No read recorded", zh: "尚无读取记录" },

  "connection.retry": { en: "Read again", zh: "重新读取" },
  "connection.retrying": { en: "Reading…", zh: "读取中…" },
  "connection.loading": {
    en: "Reading Sandbox status…",
    zh: "正在读取 Sandbox 状态…",
  },
  "connection.lastRead": {
    en: "Last successful read: {time}",
    zh: "最近成功读取：{time}",
  },
  "connection.lastRefresh": {
    en: "Last refresh: {time}",
    zh: "上次刷新：{time}",
  },
  "connection.noRemoteRead": {
    en: "No remote data read yet",
    zh: "尚未读取远端数据",
  },
  "connection.stale": {
    en: "Showing data from the last successful read.",
    zh: "当前显示的是上次成功读取的数据。",
  },
  "connection.unconfigured.title": {
    en: "PayPal Sandbox not configured",
    zh: "PayPal Sandbox 未配置",
  },
  "connection.unconfigured.body": {
    en: "Set DP_PAYPAL_CLIENT_ID / DP_PAYPAL_CLIENT_SECRET and restart the backend.",
    zh: "设置 DP_PAYPAL_CLIENT_ID / DP_PAYPAL_CLIENT_SECRET 后重启后端。",
  },
  "connection.unconfigured.offline": {
    en: "Offline capabilities remain available: local fixture cases, AI analysis (when the local model is available) and simulated replay do not require PayPal.",
    zh: "仍可使用离线能力：本地固定案件、AI 分析（本地模型可用时）与模拟回放不依赖 PayPal。",
  },
  "connection.credentials.title": {
    en: "Sandbox credentials invalid or expired",
    zh: "Sandbox 凭据无效/过期",
  },
  "connection.credentials.body": {
    en: "The request was rejected (HTTP {status}). Check the credentials in the backend environment; there is no automatic retry.",
    zh: "请求被拒绝（HTTP {status}）。请检查后端环境变量中的凭据；不会自动重试。",
  },
  "connection.permission.title": {
    en: "The app lacks this permission",
    zh: "应用缺少该权限",
  },
  "connection.permission.body": {
    en: "Rejected (HTTP 403). Enable the permission in the PayPal app settings; retrying will not fix a configuration problem.",
    zh: "请求被拒绝（HTTP 403）。请在 PayPal 应用后台开通所需权限；重试不会解决配置问题。",
  },
  "connection.rate.title": { en: "Too many requests", zh: "请求过于频繁" },
  "connection.rate.body": {
    en: "PayPal asks you to retry later. Retry-After: {seconds}s.",
    zh: "PayPal 要求稍后重试。Retry-After：{seconds} 秒。",
  },
  "connection.rate.bodyNoWait": {
    en: "PayPal asks you to retry later; no Retry-After was returned.",
    zh: "PayPal 要求稍后重试；未返回 Retry-After。",
  },
  "connection.unavailable.title": {
    en: "Sandbox temporarily unavailable",
    zh: "Sandbox 暂不可用",
  },
  "connection.unavailable.body": {
    en: "HTTP {status}. Offline replay is unaffected; writes are never retried automatically.",
    zh: "HTTP {status}。不影响离线回放；写操作不会自动重试。",
  },
  "connection.network.title": { en: "Backend unreachable", zh: "无法连接后端" },
  "connection.network.body": {
    en: "Sandbox status could not be read. Offline data is still available.",
    zh: "无法读取 Sandbox 状态；离线数据仍可用。",
  },
  "connection.notFound.title": {
    en: "Remote case not found or closed",
    zh: "远端案件不存在/已关闭",
  },
  "connection.notFound.body": {
    en: "The remote case is no longer available. No local copy is invented.",
    zh: "远端案件已不可用；不会在本地补造案件。",
  },
  "connection.protocol.title": {
    en: "Unexpected response format",
    zh: "响应格式异常",
  },
  "connection.protocol.body": {
    en: "The backend returned a response the UI could not parse. Missing fields are not guessed.",
    zh: "后端返回了无法解析的响应；不会猜测缺失字段。",
  },
  "connection.unknown.title": {
    en: "Connection status unknown",
    zh: "连接状态未知",
  },
  "connection.unknown.body": {
    en: "The last request failed without a recognised error class.",
    zh: "上次请求失败，但未能识别错误类别。",
  },
  "connection.failedTitle": {
    en: "Could not load the case list",
    zh: "无法读取案件列表",
  },
  "connection.failedBody": {
    en: "The request failed and the list was not updated. Do not read this state as “no cases”.",
    zh: "请求失败，列表未更新。请勿把此状态当作“没有案件”。",
  },
  "connection.emptyTitle": { en: "No disputes on the remote side", zh: "远端没有争议" },
  "connection.emptyBody": {
    en: "PayPal returned an empty list. This is a successful empty result, not a load failure.",
    zh: "PayPal 返回了空列表。这是成功的空结果，不是加载失败。",
  },
  "connection.sourceHealth": {
    en: "Source: GET /health",
    zh: "来源：GET /health",
  },

  "execution.title": { en: "Execution & verification", zh: "执行与回查" },
  "execution.subtitle": {
    en: "The request and the GET re-read are recorded separately; they are never merged into one success.",
    zh: "执行请求与远端回查分开记录，绝不合并为一次“成功”。",
  },
  "execution.requestTitle": { en: "Execution request", zh: "执行请求" },
  "execution.verifyTitle": { en: "Remote verification", zh: "远端回查" },
  "execution.mode": { en: "Execution mode", zh: "执行模式" },
  "execution.simulated": { en: "Simulated", zh: "模拟" },
  "execution.yes": { en: "Yes", zh: "是" },
  "execution.no": { en: "No", zh: "否" },
  "execution.notProvided": { en: "Not provided", zh: "未提供" },
  "execution.http": { en: "HTTP status", zh: "HTTP 状态" },
  "execution.requestId": { en: "Request id", zh: "请求编号" },
  "execution.at": { en: "Time", zh: "时间" },
  "execution.result": { en: "Execution result", zh: "执行结果" },
  "execution.basis": { en: "Verification basis", zh: "回查依据" },
  "execution.method": { en: "Verification method", zh: "回查方式" },
  "execution.confirmed": { en: "Remote confirmed", zh: "远端已确认" },
  "execution.noRemoteReadback": {
    en: "Not applicable — offline replay",
    zh: "不适用 — 离线回放",
  },
  "execution.remoteStatus": { en: "Remote status", zh: "远端状态" },
  "execution.checkedAt": { en: "Checked at", zh: "回查时间" },
  "execution.observations": { en: "Observations", zh: "观测" },
  "execution.sentLive": {
    en: "One Sandbox request was sent",
    zh: "已发出一次 Sandbox 请求",
  },
  "execution.replayAttempt": {
    en: "One simulated attempt recorded (not a PayPal request)",
    zh: "已记录一次模拟尝试（非 PayPal 请求）",
  },
  "execution.attemptRecorded": {
    en: "An execution attempt is on record",
    zh: "已有执行尝试记录",
  },
  "execution.noVerifyLive": {
    en: "No verification record yet",
    zh: "尚无可用的回查记录",
  },
  "execution.noVerifyReplay": {
    en: "Offline replay performs no remote verification",
    zh: "离线回放不执行远端回查",
  },
  "execution.sendMessageRule": {
    en: "Send-message verification: confirmation requires a verbatim match in the remote messages[]; the UI never reports that the buyer received or read the message.",
    zh: "发送消息核验：仅在远端 messages[] 中逐字匹配时才确认；界面不会报告买家已收到或已读。",
  },
  "execution.unverifiedTitle": { en: "Result unknown", zh: "待核验" },
  "execution.unverifiedBody": {
    en: "No automatic retry; verify the remote state manually.",
    zh: "不会自动重试；请人工核对远端状态。",
  },
  "execution.unverifiedReason": { en: "Reason: {reason}", zh: "原因：{reason}" },
  "execution.pendingTitle": { en: "Pending (not settled)", zh: "处理中（未结算）" },
  "execution.pendingBody": {
    en: "The gateway accepted the request but the payment has not settled. This is not a completed action and is never counted as success.",
    zh: "网关已受理请求，但款项尚未结算。这不是已完成的操作，也不计入成功。",
  },
  "execution.noAutoRetry": {
    en: "No automatic retry; verify the remote state manually.",
    zh: "不会自动重试，请人工核对。",
  },
  "execution.unknownResultBody": {
    en: "Unrecognised result value — treat it as unknown, not as success.",
    zh: "无法识别的结果值，按未知结果处理，不得视为成功。",
  },
  "execution.dialogTitle": { en: "Execution precheck", zh: "执行前复核" },
  "execution.dialogDescription": {
    en: "Checks run immediately before a single request; there is no automatic retry.",
    zh: "执行前会重新校验；仅一次请求，不会自动重试。",
  },
  "execution.dialogChecking": { en: "Checking…", zh: "复核中…" },
  "execution.dialogWaiting": {
    en: "Revalidating against the bound snapshot. No request is sent until every check passes.",
    zh: "正在针对绑定快照重新校验。所有检查通过前不会发送请求。",
  },
  "execution.requestRecorded": {
    en: "Execution request recorded",
    zh: "执行请求已记录",
  },
  "execution.resultUnknown": { en: "Result unknown", zh: "结果待核验" },
  "execution.failed": { en: "Execution failed", zh: "执行失败" },
  "execution.blocked": { en: "Execution blocked", zh: "执行受阻" },
  "execution.dialogNote": {
    en: "One request only; request and verification are recorded separately.",
    zh: "仅一次请求；执行与回查分别记录。",
  },

  "policy.basis.label": { en: "Validation basis: ", zh: "校验依据：" },
  "policy.basis.live": {
    en: "Based on the current remote response",
    zh: "基于当前远端响应",
  },
  "policy.basis.frozen": {
    en: "Based on the frozen snapshot",
    zh: "基于冻结快照",
  },
  "policy.basis.mixed": {
    en: "Mixed live and snapshot basis",
    zh: "包含实时与快照两类依据",
  },

  "hateoas.live": { en: "Current remote response", zh: "当前远端响应" },
  "hateoas.liveNote": {
    en: "Links are read from the current response. A missing link still blocks the action.",
    zh: "链接来自当前远端响应；缺失链接仍会阻断操作。",
  },

  "context.dataSource": { en: "Data source", zh: "数据来源" },
  "context.readAt": { en: "Read time", zh: "读取时间" },
  "context.remoteStatus": { en: "Remote status", zh: "远端状态" },
  "context.remoteActions": { en: "Remote available actions", zh: "远端可用操作" },
  "context.remoteActionsLive": {
    en: "{count} links · LIVE_HATEOAS",
    zh: "{count} 个链接 · LIVE_HATEOAS",
  },
  "context.remoteActionsFrozen": {
    en: "{count} links · FIXTURE_SNAPSHOT",
    zh: "{count} 个链接 · FIXTURE_SNAPSHOT",
  },
  "context.liveNote": { en: "Live status note", zh: "实时状态说明" },
  "context.notReported": { en: "Not reported", zh: "未报告" },
  "context.sandboxSource": { en: "Sandbox source", zh: "Sandbox 来源" },

  "auditEvent.EXECUTION_ATTEMPT.summary": {
    en: "Execution request recorded (single attempt)",
    zh: "已记录执行请求（单次尝试）",
  },
  "auditEvent.EXECUTION_ATTEMPT.detail": {
    en: "A single request was about to be sent. The outcome is derived from the follow-up GET, never from this event alone.",
    zh: "即将发出一次请求。结果由后续 GET 回查得出，绝不以此事件单独判定。",
  },
  "auditEvent.EXECUTION_VERIFIED.summary": {
    en: "Remote verification confirmed the result",
    zh: "远端回查已确认结果",
  },
  "auditEvent.EXECUTION_VERIFIED.unconfirmedSummary": {
    en: "Remote verification could not confirm the result",
    zh: "远端回查无法确认结果",
  },
  "auditEvent.EXECUTION_VERIFIED.detail": {
    en: "The GET re-read is a separate step from the request. A confirmed GET is not an adjudication.",
    zh: "GET 回查是独立于请求的步骤。确认回查不等于争议裁决。",
  },
  "auditEvent.EXECUTION_UNKNOWN.summary": {
    en: "Execution result unknown — human review required",
    zh: "执行结果未知 — 需人工核对",
  },
  "auditEvent.EXECUTION_UNKNOWN.detail": {
    en: "The outcome could not be determined (timeout, disconnect or ambiguous response). No automatic retry was performed; a human must reconcile it.",
    zh: "无法判定结果（超时、断连或响应不明确）。未执行自动重试，需人工核对。",
  },
  "audit.sandboxEvent": {
    en: "Sandbox execution · not a local replay",
    zh: "Sandbox 执行 · 非本地回放",
  },
  "auditPage.state.UNVERIFIED": {
    en: "Unverified (result unknown)",
    zh: "待核验（结果未知）",
  },
  "auditPage.sandboxBadge": {
    en: "Sandbox · request and verification separated",
    zh: "Sandbox · 执行与回查分离",
  },
  "auditPage.sandboxFooter": {
    en: "Events are written by the backend. Sandbox requests and local replays are labelled separately.",
    zh: "事件由后端写入；Sandbox 请求与本地回放分别标注。",
  },
  "auditPage.unverifiedNote": {
    en: "{count} execution(s) awaiting verification",
    zh: "{count} 条执行待核验",
  },

  "topbar.sandboxNoticeLabel": { en: "SANDBOX.", zh: "SANDBOX。" },
  "topbar.sandboxNoticeReadOnly": {
    en: "Reading PayPal Sandbox disputes. The write path is disabled.",
    zh: "正在读取 PayPal Sandbox 争议；写路径已关闭。",
  },
  "topbar.sandboxNoticeExecutable": {
    en: "Write path enabled: every execution needs manager approval, one request, no automatic retry.",
    zh: "写路径已启用：每次执行需经理审批、单次请求、不自动重试。",
  },
  "nav.sandboxReadOnlyNote": {
    en: "Cases are read from PayPal Sandbox. The write path is disabled.",
    zh: "案件来自 PayPal Sandbox 实时读取；写路径关闭。",
  },
  "nav.sandboxExecutableNote": {
    en: "Cases are read from PayPal Sandbox. Execution needs approval, one request, no automatic retry.",
    zh: "案件来自 PayPal Sandbox；执行需审批，单次请求，不自动重试。",
  },
  "nav.modeUnknownNote": {
    en: "The backend did not report an execution mode. The UI does not infer one.",
    zh: "后端未报告运行模式，界面不会推断。",
  },
  "nav.modeNotConfiguredNote": {
    en: "Sandbox credentials are not configured. Offline capabilities remain available.",
    zh: "Sandbox 凭据未配置；离线能力仍可使用。",
  },

  /* -------------------- B2 redesign: shared vocabulary ---------------------- */
  "rd.notProvided": { en: "Not provided", zh: "未提供" },
  "rd.derived": { en: "Derived value", zh: "派生值" },
  "rd.readOnly": { en: "Read-only", zh: "只读" },
  "rd.managerOnly": { en: "Manager only", zh: "仅经理可操作" },
  "rd.switchManager": { en: "Switch to Manager to decide", zh: "切换到经理后决策" },
  "rd.specialistView": {
    en: "You are viewing this as a specialist. Decisions are recorded by a manager.",
    zh: "当前为专员视图；决策由经理记录。",
  },
  "rd.sourceLabel": { en: "Source", zh: "来源" },
  "rd.caseLink": { en: "Open case", zh: "打开案件" },
  "rd.auditLink": { en: "Open audit trail", zh: "打开审计轨迹" },

  /* ------------------------- B2 approval: summary bar ----------------------- */
  "approval.summary.label": { en: "Approval summary", zh: "审批摘要" },
  "approval.summary.request": { en: "Approval request", zh: "审批请求" },
  "approval.summary.case": { en: "Case", zh: "案件" },
  "approval.summary.action": { en: "Proposed action", zh: "拟执行操作" },
  "approval.summary.amount": { en: "Amount", zh: "金额" },
  "approval.summary.approval": { en: "Approval status", zh: "审批状态" },
  "approval.summary.caseState": { en: "Case state", zh: "案件状态" },
  "approval.summary.validator": { en: "Validator", zh: "校验器" },
  "approval.summary.counts": { en: "{passed} passed · {failed} failed", zh: "{passed} 通过 · {failed} 失败" },
  "approval.summary.noValidator": {
    en: "No validation report recorded",
    zh: "未记录校验报告",
  },
  "approval.summary.runtime": { en: "Runtime & source", zh: "运行模式与来源" },

  /* ------------------------- B2 approval: exact payload --------------------- */
  "approval.payload.title": { en: "Exact payload", zh: "精确载荷" },
  "approval.payload.subtitle": {
    en: "What the backend would receive, verbatim. The approval binds this payload.",
    zh: "后端将收到的逐字内容；审批绑定此载荷。",
  },
  "approval.payload.primaryBadge": { en: "Decision basis", zh: "决策依据" },
  "approval.payload.fullBody": { en: "Full message body", zh: "完整消息正文" },
  "approval.payload.recipient": { en: "Recipient", zh: "收件对象" },
  "approval.payload.recipientBuyer": { en: "Buyer conversation on this case", zh: "本案买家会话" },
  "approval.payload.recipientNote": {
    en: "The action targets the buyer conversation; this payload carries no explicit recipient field.",
    zh: "该操作面向买家会话；此载荷本身不含显式收件人字段。",
  },
  "approval.payload.chars": { en: "{count} characters", zh: "{count} 字符" },
  "approval.payload.hash": { en: "Payload hash", zh: "载荷哈希" },
  "approval.payload.hashNote": {
    en: "This hash is what the manager approves. Any edit produces a new proposal.",
    zh: "经理批准的正是此哈希；任何编辑都会生成新提案。",
  },
  "approval.payload.evidenceType": { en: "Evidence type", zh: "证据类型" },
  "approval.payload.notes": { en: "Notes (verbatim)", zh: "说明（逐字）" },
  "approval.payload.notesNone": {
    en: "This payload carries no notes field.",
    zh: "此载荷不含说明字段。",
  },
  "approval.payload.attachment": { en: "Attachment", zh: "附件" },
  "approval.payload.attachmentPresent": { en: "Present: {name}", zh: "存在：{name}" },
  "approval.payload.attachmentAbsent": {
    en: "No attachment in this payload.",
    zh: "此载荷中没有附件。",
  },
  "approval.payload.fields": { en: "Payload fields", zh: "载荷字段" },
  "approval.payload.note": { en: "Payload note", zh: "载荷说明" },
  "approval.payload.empty": { en: "This payload has no fields.", zh: "此载荷没有字段。" },
  "approval.payload.refund": { en: "Refund payload", zh: "退款载荷" },
  "approval.payload.capture": { en: "Capture", zh: "Capture" },
  "approval.payload.original": { en: "Original captured", zh: "原始 capture 金额" },
  "approval.payload.refunded": { en: "Already refunded", zh: "已退款" },
  "approval.payload.remaining": { en: "Refundable remaining", zh: "可退余额" },
  "approval.payload.proposed": { en: "Proposed refund", zh: "本次退款金额" },
  "approval.payload.afterBalance": {
    en: "Expected balance after refund",
    zh: "退款后预期余额",
  },
  "approval.payload.afterBalanceNote": {
    en: "Computed from the backend snapshot for review only; the backend re-reads the capture.",
    zh: "由后端快照计算，仅供审阅；后端会重新读取 capture。",
  },
  "approval.payload.noRealFunds": { en: "No real funds moved.", zh: "未划转任何真实资金。" },
  "approval.payload.syntheticNote": {
    en: "Synthetic capture. No real funds moved.",
    zh: "合成 capture，未划转任何真实资金。",
  },
  "approval.payload.currency": { en: "Currency", zh: "币种" },

  /* --------------------- B2 approval: why / evidence ------------------------ */
  "approval.why.raw": { en: "AI raw recommendation", zh: "AI 原始建议" },
  "approval.why.effective": { en: "Effective recommendation", zh: "生效建议" },
  "approval.why.gate": { en: "Gate reason", zh: "闸门原因" },
  "approval.why.noRaw": {
    en: "The backend did not provide a raw recommendation; no difference is inferred.",
    zh: "后端未提供原始建议；界面不会推断差异。",
  },
  "approval.why.same": {
    en: "The effective recommendation matches the raw AI output.",
    zh: "生效建议与 AI 原始输出一致。",
  },
  "approval.why.facts": { en: "Facts used", zh: "使用的事实" },
  "approval.why.gaps": { en: "Gaps", zh: "缺口" },
  "approval.why.citedEvidence": { en: "Cited evidence", zh: "引用证据" },
  "approval.why.noFacts": { en: "No grounded facts recorded.", zh: "未记录有依据事实。" },
  "approval.why.noGaps": { en: "No gaps recorded.", zh: "未记录缺口。" },
  "approval.why.noEvidence": {
    en: "This proposal cites no evidence.",
    zh: "此提案未引用任何证据。",
  },
  "approval.why.rationale": { en: "Proposal rationale", zh: "提案理由" },

  /* ----------------------- B2 approval: policy summary ---------------------- */
  "approval.policy.summary.passed": { en: "Validation passed", zh: "校验通过" },
  "approval.policy.summary.blocked": { en: "Validation blocked", zh: "校验阻断" },
  "approval.policy.summary.review": { en: "Validation needs review", zh: "校验需人工复核" },
  "approval.policy.failed": { en: "Failed checks", zh: "未通过项" },
  "approval.policy.noFailed": { en: "No failed checks.", zh: "没有未通过项。" },
  "approval.policy.details": { en: "All checks", zh: "全部检查项" },
  "approval.policy.notHidden": {
    en: "Failures are always listed above; details are collapsed by default.",
    zh: "失败项始终列在上方；明细默认折叠。",
  },

  /* --------------------- B2 approval: capability / decision ----------------- */
  "approval.capability.basis": { en: "Basis", zh: "依据" },
  "approval.capability.readAt": { en: "Read at", zh: "读取时间" },
  "approval.capability.drift": { en: "Drift risk", zh: "漂移风险" },
  "approval.capability.driftFixture": {
    en: "Frozen capability snapshot: it may already differ from the live link set. The backend re-reads before any execution.",
    zh: "能力快照已冻结，可能与实时链接集不同；执行前后端会重新读取。",
  },
  "approval.capability.driftLive": {
    en: "Live HATEOAS read. Links can still change before execution; the backend re-checks them.",
    zh: "实时 HATEOAS 读取；执行前链接仍可能变化，后端会重新校验。",
  },
  "approval.capability.links": { en: "Raw link table", zh: "原始链接表" },
  "approval.decision.note": {
    en: "Approving does not execute. Execution is a separate gated step.",
    zh: "批准不等于执行；执行是独立的受控步骤。",
  },
  "approval.decision.managerOnly": {
    en: "Only a manager can record a decision on this request.",
    zh: "只有经理可以对此请求记录决策。",
  },
  "approval.toast.recorded": { en: "Approval recorded", zh: "已记录批准" },
  "approval.decision.noRecord": {
    en: "No approval decision on file",
    zh: "没有在案的审批决策",
  },
  "approval.decision.noRecordBody": {
    en: "This proposal is not awaiting a decision. Its proposal state is shown above; execution is tracked separately.",
    zh: "此提案当前不在等待决策；提案状态见上方，执行状态单独记录。",
  },
  "approval.decision.awaiting": {
    en: "A manager decision is required before any execution.",
    zh: "执行前必须由经理做出决策。",
  },
  "approval.decision.approvedNext": {
    en: "Approved. Nothing was executed on this page.",
    zh: "已批准。本页未执行任何操作。",
  },
  "approval.decision.rejectedNext": {
    en: "Rejected. Nothing was executed.",
    zh: "已拒绝。未执行任何操作。",
  },
  "approval.decision.toExecution": { en: "Execution step", zh: "执行步骤" },
  "approval.decision.toAudit": { en: "Audit trail", zh: "审计轨迹" },
  "approval.decision.unverified": {
    en: "Result unknown. Review the audit trail; no retry is offered.",
    zh: "结果未知。请查看审计轨迹；界面不提供重试。",
  },
  "approval.decision.executionBelow": {
    en: "Execution status is recorded separately and shown below.",
    zh: "执行状态单独记录，并显示在下方。",
  },
  "approval.technical": { en: "Snapshot binding", zh: "快照绑定" },

  /* ------------------------------ B2 case page ----------------------------- */
  "case.claim.title": { en: "Buyer claim", zh: "买家主张" },
  "case.claim.note": {
    en: "Buyer statement as filed. It is not a verified fact.",
    zh: "买家提交的陈述，并非已核实事实。",
  },
  "case.ai.title": { en: "AI assessment", zh: "AI 评估" },
  "case.ai.summary": { en: "Assessment summary", zh: "评估摘要" },
  "case.ai.verified": { en: "Verified facts", zh: "已核实事实" },
  "case.ai.unverified": { en: "Unverified claims", zh: "未核实声明" },
  "case.ai.gaps": { en: "Gaps", zh: "缺口" },
  "case.ai.recommendation": { en: "Recommendation", zh: "处理建议" },
  "case.ai.notExecutable": { en: "Not executable", zh: "不可执行" },
  "case.ai.notExecutableReason": {
    en: "This recommendation is advisory only. See Next step for the blocking rule.",
    zh: "此建议仅供参考，具体阻断规则见“下一步”。",
  },
  "case.ai.rationale": { en: "Rationale", zh: "理由" },
  "case.ai.raw": { en: "AI raw recommendation", zh: "AI 原始建议" },
  "case.ai.effective": { en: "Effective recommendation", zh: "生效建议" },
  "case.ai.gate": { en: "Gate reason", zh: "闸门原因" },
  "case.ai.frozen": { en: "Frozen AI Output", zh: "冻结 AI 输出" },
  "case.ai.live": { en: "Live AI output", zh: "实时 AI 输出" },
  "case.ai.none": { en: "No analysis yet", zh: "尚无分析" },
  "case.ai.noFacts": { en: "No verified facts recorded.", zh: "未记录已核实事实。" },
  "case.ai.noGaps": { en: "No gaps recorded.", zh: "未记录缺口。" },
  "case.ai.noUnverified": { en: "No unverified claims.", zh: "没有未核实声明。" },
  "case.ai.noRaw": {
    en: "The backend did not provide a raw recommendation; no difference is inferred.",
    zh: "后端未提供原始建议；界面不会推断差异。",
  },
  "case.ai.same": {
    en: "The effective recommendation matches the raw AI output.",
    zh: "生效建议与 AI 原始输出一致。",
  },
  "case.evidence.title": { en: "Evidence review", zh: "证据审阅" },
  "case.evidence.onFile": { en: "On file", zh: "在案证据" },
  "case.evidence.required": { en: "Required for this action", zh: "本次操作所需" },
  "case.evidence.assessment": { en: "Assessment", zh: "评估结论" },
  "case.evidence.satisfies": { en: "Satisfies this action", zh: "满足本次操作" },
  "case.evidence.stillOpen": { en: "Still open", zh: "仍待补齐" },
  "case.evidence.cited": { en: "Cited by the proposal", zh: "被提案引用" },
  "case.evidence.notCited": { en: "Not cited", zh: "未被引用" },
  "case.evidence.noRequired": {
    en: "No evidence requirement is recorded for the current action.",
    zh: "当前操作未记录证据要求。",
  },
  "case.evidence.noOnFile": { en: "No evidence records on file.", zh: "没有在案证据记录。" },
  "case.evidence.countsNote": {
    en: "Counts describe records only. They do not prove sufficiency.",
    zh: "数量只描述记录条数，不能证明证据充分。",
  },
  "case.evidence.missing": { en: "Missing", zh: "缺失" },
  "case.evidence.fixture": { en: "Fixture record", zh: "固定数据记录" },
  "case.evidence.recordOnFile": { en: "Record on file: {id}", zh: "在案记录：{id}" },
  "case.evidence.noRecord": {
    en: "No record of this type is on file.",
    zh: "没有此类型的在案记录。",
  },
  "case.timeline": { en: "Timeline", zh: "时间线" },
  "case.stage.import": { en: "Import", zh: "导入" },
  "case.stage.analysis": { en: "Analysis", zh: "分析" },
  "case.stage.proposal": { en: "Proposal", zh: "提案" },
  "case.stage.validation": { en: "Validation", zh: "校验" },
  "case.stage.approval": { en: "Approval", zh: "审批" },
  "case.stage.execution": { en: "Execution", zh: "执行" },
  "case.stage.verification": { en: "Verification", zh: "核验" },
  "case.technical.disputeRef": { en: "Dispute reference", zh: "争议编号" },
  "case.next.title": { en: "Next step", zh: "下一步" },
  "case.next.why": { en: "Why this step", zh: "为何是这一步" },
  "case.next.blockers": { en: "Blocking reasons", zh: "阻断原因" },
  "case.next.noBlockers": { en: "No blocking reason is recorded.", zh: "未记录阻断原因。" },
  "case.next.single": {
    en: "This is the only primary action on this page.",
    zh: "这是本页唯一的主操作。",
  },
  "case.next.asSpecialist": {
    en: "Switch to Manager to record a decision or to see the manager step.",
    zh: "切换到经理后可记录决策或查看经理步骤。",
  },
  "case.proposal.title": { en: "Proposal state", zh: "提案状态" },
  "case.proposal.none": { en: "No proposal yet", zh: "尚无提案" },
  "case.proposal.note": {
    en: "Approved is not executed. The two states are tracked separately.",
    zh: "已批准不等于已执行，两种状态分别记录。",
  },
  "case.execution.title": { en: "Execution state", zh: "执行状态" },
  "case.execution.none": {
    en: "No execution record. Not executed.",
    zh: "没有执行记录，未执行。",
  },
  "case.capability.title": { en: "Capability snapshot", zh: "能力快照" },
  "case.capability.noLinks": {
    en: "No capability snapshot is loaded for this case.",
    zh: "此案件未加载能力快照。",
  },
  "case.authoring.title": { en: "Action authoring", zh: "操作起草" },
  "case.authoring.body": {
    en: "Drafts written here still need submission and a manager decision.",
    zh: "在此起草的内容仍需提交并经经理决策。",
  },
  "case.authoring.open": { en: "Open authoring", zh: "打开发起区" },
  "case.authoring.close": { en: "Close authoring", zh: "收起发起区" },
  "case.capture.title": { en: "Capture states", zh: "Capture 状态" },
  "case.capture.group": { en: "Capture", zh: "Capture" },
  "case.capture.refundGroup": { en: "Refund", zh: "退款" },
  "case.capture.disputeGroup": { en: "Dispute", zh: "争议" },
  "case.capture.captureStatus": { en: "Capture status", zh: "Capture 状态" },
  "case.capture.refundState": { en: "Refund state", zh: "退款状态" },
  "case.capture.disputeState": { en: "Dispute state", zh: "争议状态" },
  "case.capture.noRefund": {
    en: "No refund proposal for this capture.",
    zh: "此 capture 没有退款提案。",
  },
  "case.capture.disputeUnreported": {
    en: "Not reported for a capture case. A capture status is never a dispute status.",
    zh: "capture 案件不上报争议状态；capture 状态不能当作争议状态。",
  },
  "case.capture.synthetic": { en: "Synthetic capture", zh: "合成 capture" },
  "case.capture.noRealFunds": { en: "No real funds moved.", zh: "未划转任何真实资金。" },
  "case.technical": { en: "Technical details", zh: "技术细节" },
  "case.technical.hash": { en: "Snapshot hash", zh: "快照哈希" },
  "case.technical.version": { en: "Snapshot version", zh: "快照版本" },
  "case.technical.family": { en: "Family / reason", zh: "类型 / 原因" },
  "case.technical.liveNote": { en: "Live status note", zh: "实时状态说明" },
  "case.why.analyze": {
    en: "No analysis is on record, so no action can be proposed yet.",
    zh: "尚无分析记录，因此还不能提出操作。",
  },
  "case.why.propose": {
    en: "An analysis exists but no proposal was drafted for this case.",
    zh: "已有分析，但此案件尚未起草处理建议。",
  },
  "case.why.submit": {
    en: "The proposal is a draft; it must be submitted before a manager can decide.",
    zh: "提案仍为草稿，须先提交后经理才能决策。",
  },
  "case.why.awaitingManager": {
    en: "The request is waiting for a manager; a specialist cannot record this decision.",
    zh: "请求等待经理处理；专员不能记录此决策。",
  },
  "case.why.reviewApproval": {
    en: "A manager decision is required. Approving does not execute.",
    zh: "需要经理决策；批准不等于执行。",
  },
  "case.why.executeGated": {
    en: "The request is approved but not executed. Execution is a separate gated step.",
    zh: "请求已批准但未执行；执行是独立的受控步骤。",
  },
  "case.why.blocked": {
    en: "A validator blocked this action; nothing can execute until the cause is fixed.",
    zh: "校验器阻断了此操作；修复原因前无法执行。",
  },
  "case.why.unverified": {
    en: "The execution result could not be confirmed. No retry is offered.",
    zh: "执行结果无法确认；界面不提供重试。",
  },
  "case.why.monitor": {
    en: "An outcome is recorded; the next step is to watch the buyer response.",
    zh: "已记录结果；下一步是跟踪买家回复。",
  },
  "case.why.replan": {
    en: "The proposal was rejected or superseded, so a new plan is needed.",
    zh: "提案已被拒绝或替代，需要重新制定方案。",
  },
  "case.why.generic": {
    en: "No further action is available to this role.",
    zh: "当前角色没有可执行的进一步操作。",
  },
  "case.why.pending": {
    en: "The payment is accepted but not settled; execution stays unavailable.",
    zh: "支付已受理但未结算；此时不可执行。",
  },
  "case.why.analysis": {
    en: "The analysis is on record; the next step follows from its recommendation.",
    zh: "已有分析记录；下一步依据其建议确定。",
  },
  "case.next.refresh": { en: "Refresh snapshot", zh: "刷新快照" },
  "case.next.openAuthoring": { en: "Draft a proposal", zh: "起草处理建议" },
  "case.next.submit": { en: "Submit for approval", zh: "提交审批" },
  "case.next.review": { en: "Review approval", zh: "审核审批" },
  "case.next.execute": { en: "Execute · gated step", zh: "执行 · 受控步骤" },
  "case.next.audit": { en: "Review in the audit trail", zh: "在审计轨迹中复核" },
  "case.next.generate": { en: "Generate proposal", zh: "生成处理建议" },

  /* ------------------------------- autopilot -------------------------------- */
  "nav.autopilot": { en: "Autopilot", zh: "自动处理" },
  "autopilot.eyebrow": { en: "AUTOPILOT", zh: "自动处理" },
  "autopilot.title": { en: "Batch triage and review submission", zh: "批量分析与提交复核" },
  "autopilot.description": {
    en: "Analyse several cases in one pass, see which ones are reviewable, and send every eligible proposal to the review queue without opening each case.",
    zh: "一次分析多条案件，查看哪些可以进入复核，并把符合条件的处理建议一次性送入复核队列，无需逐条打开案件。",
  },
  "autopilot.run": { en: "Run autopilot", zh: "运行 Autopilot" },
  "autopilot.inputTitle": { en: "Cases in this run", zh: "本次运行的案件" },
  "autopilot.inputHint": {
    en: "One case id per line (or comma separated).",
    zh: "每行一个案件 ID（也可用逗号分隔）。",
  },
  "autopilot.inputLabel": { en: "Case ids", zh: "案件 ID" },
  "autopilot.inputFootnote": {
    en: "The five offline demo cases are prefilled as a convenience. Decisions always come from the backend, never from this list.",
    zh: "默认填入五条离线演示案件，仅为方便操作。最终决策始终由后端给出，与本列表无关。",
  },
  "autopilot.safetyTitle": { en: "What this does — and does not do", zh: "能做什么，不能做什么" },
  "autopilot.safetyTriage": {
    en: "TRIAGE_ONLY: analyse, plan, validate and decide. Nothing leaves the system.",
    zh: "TRIAGE_ONLY：只做分析、规划、校验与决策，不产生任何对外动作。",
  },
  "autopilot.safetySubmit": {
    en: "Submitting for review creates a PENDING approval through the existing approval service.",
    zh: "提交复核会通过既有审批服务创建一条待处理（PENDING）审批记录。",
  },
  "autopilot.safetyBoundary": {
    en: "Submitted is not approved and not executed. Approval stays with a manager.",
    zh: "“已提交复核”既不是批准，也不是执行。批准仍由经理决定。",
  },
  "autopilot.runFailed": { en: "The run could not be created", zh: "无法创建本次运行" },
  "autopilot.runTitle": { en: "Run result", zh: "运行结果" },
  "autopilot.resultsTitle": { en: "Per-case decisions", zh: "逐案决策" },
  "autopilot.resultsHint": {
    en: "Validator, evidence sufficiency and policy stop are three separate facts.",
    zh: "校验结果、证据充分性与策略阻断是三件独立的事实。",
  },
  "autopilot.validator.passed": { en: "Validator passed", zh: "校验通过" },
  "autopilot.validator.failed": { en: "Validator failed", zh: "校验未通过" },
  "autopilot.validator.notRun": { en: "Validator not run", zh: "未运行校验" },
  "autopilot.policyBlocked": { en: "Policy block", zh: "策略阻断" },
  "autopilot.needsHumanBadge": { en: "Needs human", zh: "需人工处理" },
  "autopilot.executedBadge": { en: "Executed", zh: "已执行" },
  "autopilot.candidateLine": {
    en: "candidate: {action} · {state}",
    zh: "候选动作：{action} · {state}",
  },
  "autopilot.stat.total": { en: "Cases", zh: "案件数" },
  "autopilot.stat.analyzed": { en: "Analyzed", zh: "已分析" },
  "autopilot.stat.ready": { en: "Ready", zh: "可复核" },
  "autopilot.stat.needsHuman": { en: "Need human", zh: "需人工" },
  "autopilot.stat.blocked": { en: "Blocked", zh: "已阻断" },
  "autopilot.stat.wait": { en: "Wait", zh: "等待" },
  "autopilot.stat.failed": { en: "Failed", zh: "失败" },
  "autopilot.stat.eligible": { en: "Eligible", zh: "符合条件" },
  "autopilot.stat.notEligible": { en: "Not eligible", zh: "不符合条件" },
  "autopilot.stat.proposals": { en: "Proposals", zh: "处理建议" },
  "autopilot.stat.alreadySubmitted": { en: "Already submitted", zh: "已提交过" },
  "autopilot.stat.submitted": { en: "Submitted", zh: "已提交" },
  "autopilot.stat.skipped": { en: "Skipped", zh: "已跳过" },
  "autopilot.submissionCounts": {
    en: "{submitted} of {total} cases in this run are now waiting for your confirmation.",
    zh: "本次运行的 {total} 个案件中，有 {submitted} 个已进入待你确认的状态。",
  },
  "autopilot.executedNone": {
    en: "External actions executed: {count}. TRIAGE_ONLY never executes.",
    zh: "已执行的外部动作：{count}。TRIAGE_ONLY 永不执行。",
  },
  "autopilot.submitTitle": { en: "Submit eligible proposals", zh: "提交可复核的处理建议" },
  "autopilot.submitHint": {
    en: "Each case is revalidated at submit time; the batch result reports every case separately.",
    zh: "提交时会逐案重新校验；批量结果会逐条报告每个案件。",
  },
  "autopilot.submitAction": { en: "Submit all eligible", zh: "提交全部可复核" },
  "autopilot.noEligibleTitle": { en: "No case is eligible right now", zh: "当前没有符合条件的案件" },
  "autopilot.noEligibleHint": {
    en: "Blocked, waiting and human-review cases are never submitted automatically.",
    zh: "已阻断、等待和需人工的案件不会被自动提交。",
  },
  "autopilot.submissionTitle": { en: "Submission result", zh: "提交结果" },
  "autopilot.submitFailed": { en: "The batch submission failed", zh: "批量提交失败" },
  "autopilot.confirmTitle": { en: "Submit for review?", zh: "确认提交复核？" },
  "autopilot.confirmIntro": {
    en: "These proposals will be revalidated and sent to the approval queue as PENDING. Nothing is approved or executed.",
    zh: "以下处理建议将重新校验后以 PENDING 状态进入审批队列。不会批准，也不会执行。",
  },
  "autopilot.confirmCounts": {
    en: "{eligible} eligible case(s); {other} case(s) blocked, waiting or needing human input will be skipped.",
    zh: "{eligible} 条案件符合条件；另有 {other} 条被阻断、等待或需人工补充信息，将被跳过。",
  },
  "autopilot.confirmList": { en: "Proposals to submit", zh: "即将提交的处理建议" },
  "autopilot.confirmAction": { en: "Submit for review", zh: "提交复核" },
  "autopilot.confirmWarning": {
    en: "Submitted is not approved. Each approval still needs a manager decision, and execution remains a separate gated step.",
    zh: "“已提交”不等于“已批准”。每条审批仍需经理决策，执行仍是独立的受控步骤。",
  },
  "autopilot.decision.ready": { en: "Ready for review", zh: "可复核" },
  "autopilot.decision.needsHuman": { en: "Needs human", zh: "需人工处理" },
  "autopilot.decision.blocked": { en: "Blocked", zh: "已阻断" },
  "autopilot.decision.wait": { en: "Wait", zh: "等待" },
  "autopilot.decision.failed": { en: "Failed", zh: "失败" },
  "autopilot.submitStatus.submitted": { en: "Submitted for review", zh: "已提交复核" },
  "autopilot.submitStatus.already": { en: "Already submitted", zh: "已提交过" },
  "autopilot.submitStatus.skipped": { en: "Skipped — not eligible", zh: "已跳过 · 不符合条件" },
  "autopilot.submitStatus.blockedValidation": { en: "Blocked by validation", zh: "被校验阻断" },
  "autopilot.submitStatus.blockedStale": { en: "Blocked — stale decision", zh: "被阻断 · 决策已过期" },
  "autopilot.submitStatus.failed": { en: "Failed", zh: "失败" },
  "autopilot.historyTitle": { en: "Submission history", zh: "提交批次历史" },
  "autopilot.historyHint": {
    en: "Stored batches for this run, read back from the backend (not from this page's memory).",
    zh: "本次运行已持久化的提交批次，数据来自后端查询接口，而非页面内存。",
  },
  "autopilot.historyRefresh": { en: "Refresh", zh: "刷新" },
  "autopilot.historyEmpty": { en: "No submission batch yet", zh: "还没有提交批次" },
  "autopilot.historyEmptyHint": {
    en: "Submitting eligible proposals records a batch that stays queryable after a restart.",
    zh: "提交符合条件的处理建议后会生成批次记录，服务重启后仍可查询。",
  },
  "autopilot.historyLoadFailed": { en: "Could not load batches", zh: "无法加载批次" },
  "autopilot.historyCounts": {
    en: "{submitted} submitted · {already} already · {skipped} skipped · {blocked} blocked · {failed} failed",
    zh: "已提交 {submitted} · 已存在 {already} · 跳过 {skipped} · 阻断 {blocked} · 失败 {failed}",
  },
  "autopilot.historyProposal": { en: "proposal {proposal}", zh: "提案 {proposal}" },
  "autopilot.historyApproval": { en: "approval {approval}", zh: "审批 {approval}" },
  "autopilot.restoredRun": {
    en: "Restored the last run and its stored batches from the backend.",
    zh: "已从后端恢复上一次运行及其已保存的批次。",
  },
  "origin.title": { en: "Submission origin", zh: "提交来源" },
  "origin.subtitle": {
    en: "Read from stored batch records — where this approval entered the review queue.",
    zh: "读取自已存储的批次记录：这条审批是如何进入复核队列的。",
  },
  "origin.loading": { en: "Loading submission origin…", zh: "正在加载提交来源…" },
  "origin.failed": { en: "Could not load the submission origin", zh: "无法加载提交来源" },
  "origin.retry": { en: "Retry", zh: "重试" },
  "origin.typeBatch": { en: "Autopilot batch", zh: "Autopilot 批次" },
  "origin.typeSingle": { en: "Single submission — no batch", zh: "单条提交 · 无批次" },
  "origin.submitValidationPassed": {
    en: "Submit-time validation passed",
    zh: "提交时校验通过",
  },
  "origin.submitValidationFailed": {
    en: "Submit-time validation failed",
    zh: "提交时校验未通过",
  },
  "origin.batch": { en: "Submission batch", zh: "提交批次" },
  "origin.run": { en: "Autopilot run", zh: "Autopilot 运行" },
  "origin.proposal": { en: "Proposal", zh: "处理建议" },
  "origin.report": { en: "Validation report", zh: "校验报告" },
  "origin.reason": { en: "Reason code", zh: "原因码" },
  "origin.submittedAt": { en: "Submitted at", zh: "提交时间" },
  "origin.none": { en: "—", zh: "—" },
  "origin.openBatch": { en: "View submission batch", zh: "查看提交批次" },
  "origin.stateNote": {
    en: "Provenance explains how the proposal reached review; it never changes the approval state.",
    zh: "来源只说明提案如何进入复核，不改变审批状态。",
  },
  "approvals.originBatch": { en: "Autopilot · {batch}", zh: "自动处理 · {batch}" },
  "approvals.originSingle": { en: "Single submission", zh: "单条提交" },
  "approvals.originUnavailable": { en: "Source unavailable", zh: "来源不可用" },
  "approvals.originLoading": { en: "Checking source…", zh: "正在核对来源…" },
  "autopilot.batchLoadFailed": {
    en: "Could not open the submission batch",
    zh: "无法打开该提交批次",
  },
  "approvals.waitingChecking": { en: "Checking…", zh: "正在核对…" },
  "approvals.waitingNoCreatedTime": {
    en: "Creation time unavailable",
    zh: "创建时间不可用",
  },
  "origin.created": { en: "Approval created", zh: "审批创建时间" },
  "origin.decision": { en: "Decision", zh: "审批决定" },
  "origin.unknownTime": { en: "— (not recorded)", zh: "—（未记录）" },
  "origin.decisionPending": { en: " · awaiting manager", zh: " · 等待经理决策" },
  "merchant.name": { en: "My store", zh: "我的店铺" },
  "merchant.title": { en: "Merchant account", zh: "商户账户" },
  "merchant.identityHint": {
    en: "You are signed in as the merchant. Every action is recorded under this identity.",
    zh: "你以商户身份登录，所有操作都会记录在该身份下。",
  },
  "merchant.status.ready": { en: "Ready for your confirmation", zh: "已准备好，等待你确认" },
  "merchant.status.readyMeaning": {
    en: "AI finished the analysis and prepared a safe next step. Nothing has been sent yet.",
    zh: "AI 已完成分析并准备好了安全的下一步。尚未发送任何内容。",
  },
  "merchant.status.wait": { en: "No safe action right now", zh: "暂无安全可执行的操作" },
  "merchant.status.waitMeaning": {
    en: "The rules do not allow an automatic step for this dispute yet.",
    zh: "当前规则暂不允许对这个争议执行自动操作。",
  },
  "merchant.status.blocked": { en: "Blocked — action needed first", zh: "已阻止 — 需要先处理" },
  "merchant.status.blockedMeaning": {
    en: "A required check failed. Fix the listed problem before anything can be sent.",
    zh: "有必要的检查未通过。请先解决列出的问题，否则无法发送。",
  },
  "merchant.status.needsHuman": { en: "Needs your judgement", zh: "需要你作出判断" },
  "merchant.status.needsHumanMeaning": {
    en: "AI prepared the options, but this one needs a person to decide.",
    zh: "AI 已准备好选项，但这一项需要你来决定。",
  },
  "merchant.status.failed": { en: "Could not be analysed", zh: "无法完成分析" },
  "merchant.status.failedMeaning": {
    en: "Something went wrong while processing this dispute. Nothing was changed.",
    zh: "处理这个争议时出错。没有做任何修改。",
  },
  "merchant.status.unknown": { en: "Status unknown", zh: "状态未知" },
  "merchant.status.unknownMeaning": {
    en: "The backend did not report a status for this item.",
    zh: "后端没有返回这一项的状态。",
  },
  "merchant.submit.submitted": { en: "Sent for your confirmation", zh: "已提交待你确认" },
  "merchant.submit.submittedMeaning": {
    en: "Added to your confirmation list. Still nothing sent to the buyer.",
    zh: "已加入待确认列表。尚未向买家发送任何内容。",
  },
  "merchant.submit.already": { en: "Already waiting for you", zh: "已在待确认列表" },
  "merchant.submit.alreadyMeaning": {
    en: "This dispute is already in your confirmation list — no duplicate was created.",
    zh: "这个争议已经在待确认列表中，没有创建重复项。",
  },
  "merchant.submit.skipped": { en: "Not ready to confirm", zh: "暂不满足确认条件" },
  "merchant.submit.skippedMeaning": {
    en: "AI did not prepare a confirmable step for this dispute.",
    zh: "AI 没有为这个争议准备好可确认的步骤。",
  },
  "merchant.submit.blocked": { en: "Stopped by a safety check", zh: "被安全检查阻止" },
  "merchant.submit.blockedMeaning": {
    en: "The re-check before submission did not pass, so nothing was added.",
    zh: "提交前的复查未通过，因此没有加入任何内容。",
  },
  "merchant.submit.stale": { en: "Out of date — please re-run", zh: "已过期 — 请重新分析" },
  "merchant.submit.staleMeaning": {
    en: "The dispute changed after the analysis. Run the assistant again to refresh it.",
    zh: "分析后争议发生了变化。请重新运行助手以刷新。",
  },
  "merchant.submit.failed": { en: "Submission failed", zh: "提交失败" },
  "merchant.submit.failedMeaning": {
    en: "A technical error stopped this item. The other items were unaffected.",
    zh: "技术错误阻止了这一项。其他项不受影响。",
  },
  "merchant.batch.completed": { en: "All items sent for confirmation", zh: "全部已提交待确认" },
  "merchant.batch.completedMeaning": {
    en: "Every dispute in this run is now waiting for your confirmation.",
    zh: "本次运行的所有争议都已进入待确认状态。",
  },
  "merchant.batch.partial": { en: "Partly sent for confirmation", zh: "部分已提交待确认" },
  "merchant.batch.partialMeaning": {
    en: "Some disputes are waiting for you; the rest need attention first.",
    zh: "部分争议在等待你确认，其余需要先处理。",
  },
  "merchant.batch.nothing": { en: "Nothing needed confirming", zh: "没有需要确认的内容" },
  "merchant.batch.nothingMeaning": {
    en: "No dispute in this run produced a confirmable step.",
    zh: "本次运行没有产生可确认的步骤。",
  },
  "merchant.batch.failed": { en: "Submission failed", zh: "提交失败" },
  "merchant.batch.failedMeaning": {
    en: "A technical error stopped the submission. Nothing was sent.",
    zh: "技术错误阻止了提交。没有发送任何内容。",
  },
  "merchant.exec.executed": { en: "Done — result confirmed", zh: "已完成 — 结果已确认" },
  "merchant.exec.executedMeaning": {
    en: "The action was carried out and the result was read back and confirmed.",
    zh: "操作已执行，并且已回读确认结果。",
  },
  "merchant.exec.replayed": { en: "Simulated offline — no money moved", zh: "离线模拟 — 未发生资金变动" },
  "merchant.exec.replayedMeaning": {
    en: "This ran against recorded demo data. No real PayPal action was taken.",
    zh: "这是针对录制的演示数据运行的。没有执行任何真实 PayPal 操作。",
  },
  "merchant.exec.unverified": { en: "Result not confirmed yet", zh: "结果尚未确认" },
  "merchant.exec.unverifiedMeaning": {
    en: "The action was attempted but the result could not be confirmed. Please check your records.",
    zh: "操作已尝试，但结果无法确认。请查看你的记录。",
  },
  "merchant.exec.blocked": { en: "Not executed", zh: "未执行" },
  "merchant.exec.blockedMeaning": {
    en: "A safety check stopped this action before it reached PayPal.",
    zh: "安全检查在到达 PayPal 之前阻止了该操作。",
  },
  "merchant.exec.failed": { en: "Execution failed", zh: "执行失败" },
  "merchant.exec.failedMeaning": {
    en: "The action could not be completed. Nothing was changed.",
    zh: "操作未能完成。没有做任何修改。",
  },
  "merchant.exec.pending": { en: "Not executed yet", zh: "尚未执行" },
  "merchant.exec.pendingMeaning": {
    en: "Waiting for your confirmation before anything happens.",
    zh: "等待你确认后才会执行。",
  },
  "merchant.origin.batch": { en: "From AI assistant run", zh: "来自 AI 助手运行" },
  "merchant.origin.batchMeaning": {
    en: "Prepared by an AI assistant run over several disputes at once.",
    zh: "由 AI 助手一次性分析多个争议生成。",
  },
  "merchant.origin.single": { en: "Prepared for this dispute", zh: "针对此争议单独生成" },
  "merchant.origin.singleMeaning": {
    en: "Prepared individually for this dispute, not by a batch run.",
    zh: "针对这个争议单独准备，不是批量运行生成的。",
  },
  "merchant.reason.validatorPassed": { en: "All required checks passed", zh: "所有必要检查已通过" },
  "merchant.reason.evidenceInsufficient": {
    en: "The evidence needed to support this action is missing",
    zh: "缺少支持该操作所需的证据",
  },
  "merchant.reason.noSafeAction": {
    en: "No action is allowed for this dispute at the moment",
    zh: "当前不允许对这个争议执行操作",
  },
  "merchant.reason.paymentNeedsYou": {
    en: "A refund always needs your explicit confirmation",
    zh: "退款始终需要你明确确认",
  },
  "merchant.reason.noCandidate": { en: "No suitable action was found", zh: "未找到合适的操作" },
  "merchant.reason.validationNotRun": { en: "Checks have not run yet", zh: "尚未执行检查" },
  "merchant.reason.validatorBlocked": { en: "A required check did not pass", zh: "有必要的检查未通过" },
  "merchant.reason.technicalError": { en: "A technical error occurred", zh: "发生技术错误" },
  "merchant.reason.triageOnly": { en: "This run only analyses; it never acts", zh: "本次运行只做分析，不会执行操作" },
  "merchant.reason.submittedForReview": { en: "Sent for your confirmation", zh: "已提交待你确认" },
  "merchant.reason.alreadyPending": { en: "Already waiting for your confirmation", zh: "已在等待你确认" },
  "merchant.reason.caseNotInRun": { en: "This dispute was not part of the run", zh: "该争议不在本次运行中" },
  "merchant.reason.notReviewable": { en: "Not ready for confirmation", zh: "暂不满足确认条件" },
  "merchant.reason.noCandidateProposal": { en: "No prepared step exists yet", zh: "尚无准备好的步骤" },
  "merchant.reason.proposalMissing": { en: "The prepared step no longer exists", zh: "准备好的步骤已不存在" },
  "merchant.reason.payloadChanged": { en: "The dispute changed after analysis", zh: "分析后争议发生了变化" },
  "merchant.reason.stateIneligible": { en: "This step is no longer open", zh: "该步骤已不再开放" },
  "merchant.reason.validatorRejected": { en: "A required check did not pass", zh: "有必要的检查未通过" },
  "merchant.reason.unknown": { en: "See the technical details", zh: "请查看技术详情" },
  "nav.myDisputes": { en: "My disputes", zh: "我的争议" },
  "nav.needsConfirmation": { en: "Needs your confirmation", zh: "待我确认" },
  "nav.assistant": { en: "AI assistant", zh: "AI 助手" },
  "nav.activity": { en: "Activity", zh: "操作记录" },
  "nav.help": { en: "Help", zh: "帮助" },
  "app.tagline": {
    en: "Your AI assistant for PayPal disputes",
    zh: "你的 PayPal 争议 AI 助手",
  },
  "overview.merchantTitle": { en: "Good to see you", zh: "欢迎回来" },
  "overview.merchantDescription": {
    en: "Here is where your disputes stand and what needs you next.",
    zh: "这里显示你的争议进展，以及接下来需要你处理的事项。",
  },
  "overview.q.needsAttention": { en: "Need your attention", zh: "需要关注" },
  "overview.q.analyzed": { en: "Analysed by AI", zh: "AI 已分析" },
  "overview.q.awaitingYou": { en: "Waiting for your confirmation", zh: "等待你确认" },
  "overview.q.blocked": { en: "Blocked or need more information", zh: "被阻止或需补充材料" },
  "overview.tasks.title": { en: "What needs you now", zh: "当前需要你处理" },
  "overview.tasks.empty": { en: "Nothing needs you right now", zh: "当前没有需要你处理的事项" },
  "overview.tasks.emptyBody": {
    en: "Run the AI assistant to analyse your disputes, or open a dispute to see its details.",
    zh: "运行 AI 助手分析你的争议，或打开某个争议查看详情。",
  },
  "overview.tasks.canContinue": { en: "You can continue", zh: "可以继续" },
  "overview.tasks.needMaterial": { en: "Needs more information", zh: "需要补充材料" },
  "overview.tasks.needJudgement": { en: "Needs your judgement", zh: "需要你判断" },
  "overview.tasks.done": { en: "Already handled", zh: "已处理" },
  "overview.activity.title": { en: "Recent activity", zh: "最近动态" },
  "overview.activity.empty": { en: "No activity yet", zh: "暂无动态" },
  "assistant.title": { en: "AI assistant", zh: "AI 助手" },
  "assistant.merchantSubtitle": {
    en: "Analyse several disputes at once. The assistant checks the facts, prepares a safe next step for each one, and leaves every decision to you.",
    zh: "一次性分析多个争议。助手会核实事实、为每个争议准备安全的下一步，并由你作出所有决定。",
  },
  "assistant.runCta": { en: "Analyse my disputes", zh: "分析我的争议" },
  "assistant.resultTitle": { en: "What the assistant found", zh: "助手发现了什么" },
  "assistant.readyLead": { en: "Ready for your confirmation", zh: "已准备好待你确认" },
  "assistant.blockedLead": { en: "Blocked until fixed", zh: "修复前无法继续" },
  "assistant.waitLead": { en: "No safe action right now", zh: "暂无安全操作" },
  "assistant.judgementLead": { en: "Needs your judgement", zh: "需要你判断" },
  "assistant.failedLead": { en: "Could not be analysed", zh: "无法分析" },
  "assistant.noExecHint": {
    en: "This run only analyses and prepares. It never messages buyers, issues refunds or closes disputes.",
    zh: "本次运行只做分析和准备，不会给买家发消息、退款或结案。",
  },
  "assistant.submitCta": { en: "Send the ready ones for confirmation", zh: "将准备好的争议提交待确认" },
  "cases.merchantTitle": { en: "My disputes", zh: "我的争议" },
  "cases.filterAll": { en: "All", zh: "全部" },
  "cases.filterNeedsMe": { en: "Needs me", zh: "待我处理" },
  "cases.filterReady": { en: "Ready to confirm", zh: "待确认" },
  "cases.filterDone": { en: "Handled", zh: "已处理" },
  "activity.merchantTitle": { en: "Activity", zh: "操作记录" },
  "activity.merchantSubtitle": {
    en: "Everything that happened to your disputes, in plain language. Technical details are available under each entry.",
    zh: "你的争议发生的所有事情，用易懂的语言呈现。技术详情可在每条记录下展开。",
  },
  "confirm.merchantTitle": { en: "Needs your confirmation", zh: "待我确认" },
  "confirm.merchantSubtitle": {
    en: "Steps the assistant prepared for you. Nothing has been sent, refunded or closed yet.",
    zh: "助手为你准备好的步骤。尚未发送、退款或结案。",
  },
  "autopilot.groupCount": { en: "{count} dispute(s)", zh: "{count} 个争议" },
  "autopilot.technicalDetails": { en: "Technical details", zh: "技术详情" },
  "autopilot.caseId": { en: "Case", zh: "案件" },
  "autopilot.missingEvidence": { en: "Missing {count} required item(s)", zh: "缺少 {count} 项必需材料" },
  "nav.demoControls": { en: "Demo controls", zh: "演示控制" },
  "replay.notRun": { en: "Not run", zh: "未执行" },
  "replay.noReportYet": { en: "No report yet", zh: "暂无报告" },
  "replay.noChecksReported": { en: "No check report returned", zh: "后端未返回检查报告" },
  "replay.errorForbidden": { en: "Not permitted", zh: "无权限" },
  "replay.errorConflict": { en: "State conflict", zh: "状态冲突" },
  "replay.errorRejected": { en: "Rejected by the validator", zh: "被校验器拒绝" },
  "replay.errorNetwork": { en: "Cannot reach the backend", zh: "无法连接后端" },
  "replay.errorServer": { en: "Backend error", zh: "后端错误" },
  "replay.retry": { en: "Retry revalidation", zh: "重新校验" },
  "replay.checksTitle": { en: "Backend verification details", zh: "后端核验明细" },
  "replay.errorHint": {
    en: "Nothing was recorded as executed. Retrying would create a second attempt only if the backend accepts it.",
    zh: "本次未记录为已执行。只有在后端接受时重试才会产生第二次尝试。",
  },
  "overview.q.awaitingAnalysis": { en: "Awaiting analysis", zh: "待分析" },
  "overview.tasks.authorized": { en: "Authorised — waiting to run", zh: "已授权 — 待执行" },
  "ai.replayOnlyNote": {
    en: "Pre-recorded analysis · no model call, no network",
    zh: "预录分析 · 不调用模型、不联网",
  },
  "ai.replayHint": {
    en: "Replays the recorded analysis for this case. No inference happens.",
    zh: "回放该案件已录制的分析，不进行推理。",
  },
} as const;

export type MessageKey = keyof typeof messages;

export type TranslateParams = Record<string, string | number>;

/** Pure translator — usable from formatters and tests without React. */
export const translate = (lang: Lang, key: MessageKey, params?: TranslateParams): string => {
  const entry = messages[key];
  if (!entry) return key;
  let value: string = lang === "zh-CN" ? entry.zh : entry.en;
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.split(`{${name}}`).join(String(replacement));
    }
  }
  return value;
};

/** Backend error codes that have a readable explanation. */
export const errorCodeKey = (code: string): MessageKey | undefined => {
  const key = `error.code.${code}`;
  return key in messages ? (key as MessageKey) : undefined;
};
