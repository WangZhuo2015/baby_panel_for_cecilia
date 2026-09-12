# SH-00 任务执行报告：Web 与 iOS 共用后端基线和调用清单 (R0 修正版)

> 任务：SH-00 (Web 与 iOS 共用后端的基线和调用清单盘点)  
> 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING` (R0 修正已完成并通过自检，原 be71f9c ACCEPTED 废止，依据 REVIEW_CODEX.md 执行了全面语义修复)  
> 日期：2026-09-12  
> 执行规范：`docs/plan/implementation/09_WEB_IOS_SHARED_BACKEND.md` 与 `docs/plan/GEMINI_LONG_RUN_HANDOFF.md`。

---

## 1. 仓库基线与工作区状态核对

| 仓库名称 | 分支 (Branch) | 起始基线 HEAD | 本轮提交 HEAD | Working Tree 状态与未提交文件核验 |
|---|---|---|---|---|
| **`baby_panel_for_cecilia`**<br>(当前任务工作区) | `main` | `49017313513e57cbb9720b873ccbe81942e8d491` | *待本轮 R0 commit 后记录* | 本轮修复仅修改 `docs/compat/*`、`evidence/tasks/SH-00/REPORT.md` 及 `scripts/review/*`，未触碰任何业务代码与配置。 |
| **`growdesk-server`**<br>(只读参考仓库) | `codex/backend-storage-foundation` | `d9604d5a773630e81c0bedcc70b7bcf013c64535` | *(只读未动)* | **Dirty**。包含 6 个已有未提交文件：<br>- `M deploy/Migration.Dockerfile`<br>- `?? evidence/tasks/LEGACY_IMPORT/host-after.json`<br>- `?? evidence/tasks/LEGACY_IMPORT/remote-migration.txt`<br>- `?? evidence/tasks/LEGACY_IMPORT/target-verification.json`<br>- `?? scripts/legacy-import/ios_backup.py`<br>- `?? scripts/legacy-import/test_ios_backup.py`<br>**严格保留，未混入，未提交**。 |
| **`growdesk-ios`**<br>(只读参考仓库) | `codex/local-storage-policy` | `96aa0007bc44874419471a0dd5c7e07c8b317aa1` | *(只读未动)* | **Dirty**。包含已有未提交文件：<br>- `M BabyPanel.xcodeproj/project.pbxproj`<br>- `?? docs/design-mockups/`<br>**严格保留，未混入，未提交**。 |

---

## 2. R0 语义修正专项说明 (依据 REVIEW_CODEX.md)

| 编号 | 审查缺陷项 (REVIEW_CODEX.md) | 原错误事实 | R0 修复与交付证据 |
|---|---|---|---|
| **R0-01** | **F1/P1：喂养字段编造与时区错误** | 原 mapping 编造了 `startTime`/`endTime`/`amount`/`BOTTLE_BREAST`/`spitUpSeverity`，时区误算为 14:30Z | 从 `app/api/records/feeding/route.ts` 逐字段重建：使用真实 `timestamp`, `amountMl`, `leftMinutes`, `rightMinutes`, `spitUp`, `formulaProductId`, `notes` (上限 1000 字符), `clientId`, `source`, `sourceAgent`。修正时区换算：北京时间 `14:30+08:00` 对应 UTC `06:30Z`。 |
| **R0-02** | **F4/P1：睡眠旧规则与成长目标遗漏** | 旧睡眠 POST 被误描述为允许 null；使用编造的 `quality`/`awakeningCount`；成长遗漏 PATCH 与 chart | 明确旧 `app/api/records/sleep/route.ts` 严格要求非空 `startTime` 与 `endTime`，将目标 02 的进行中睡眠明确标为“新能力”；保留 `type`, `nightWakingCount`, `notes` 真实字段。成长补齐 canonical 02 要求的 PATCH 与 `growth-chart`。 |
| **R0-03** | **F2/P1：CSV 语义与调用源遗漏** | CSV 将 `/mcp` 误标为 Cookie Session，OPTIONS 误标为 SSE 流；遗漏前端状态管理层调用源；`/api/baby` 误标无 DB 读取 | 修正 `/mcp` 与 `/api/mcp` 为 `Bearer OAuth Token (Scoped)`；OPTIONS 修正为无副作用；将 `stores/slices/*.ts` 纳入扫描，55 个端点补齐真实前端调用方；`/api/baby` GET 补齐经 helper 隐式读取的 `baby;familyMember`。目标 operationId 统一前缀 `PROPOSED:`。 |
| **R0-04** | **S2/P1：非路由写者包含虚构模型与工具** | 原清单虚构了 `AiDailySummary`, `AiTip`, `OAuthToken` 表、`medical.ts` 工具文件及不符的 5 个 MCP 工具名 | 核对 `prisma/schema.prisma` 修正为真实 47 个模型：明确日报通过 `archiveText` 写入 `AiArchive` 与磁盘，贴士走内存 LRU 缓存，OAuth 模型为 `OAuthClient/OAuthAuthorizationCode/OAuthRefreshToken/OAuthConsent/OAuthAuditLog`；移除 `medical.ts`；校正 MCP 实际 5 工具：`get_baby_overview`, `record_baby_events`, `record_health_measurement`, `query_parenting_knowledge`, `web_search`。 |
| **R0-05** | **S3/P1：停写栅栏指引危险粗暴** | 原指引粗暴拦截非 GET 请求并以 WAL checkpoint 充当写锁，以行数比较充当收敛依据 | 重写为严密的四阶段停写规程：逐 Writer 冻结与在途排空 (Freeze & Drain) → Freeze Marker 标记 → 物理一致快照 (`src.backup(dst)` + `PRAGMA quick_check`) → 基于 ID 集合、规范化内容 Hash、删除集合与附件清单的对账。 |
| **R0-06** | **S1/P1：能力状态证据夸大与路径错误** | 原报告虚报 `packages/domain/src/baby-access.ts`；占位退出码误记为 1；未跑测试虚标 VERIFIED | 修正源码路径为 `packages/domain/src/index.ts`；实测校正占位脚本退出码准确为 2；将未执行测试诚实标为 `NOT_RUN`，引用旧测试标为 `HISTORICAL` 并注明出处。 |
| **R0-07** | **F3/P2：可复现验证脚本交付** | 原验收引用了 scratch 目录下的临时脚本，git 未跟踪 | 交付并提交 `scripts/review/generate-web-inventory.py`、`scripts/review/check-sh00-inventory.py` 与 `scripts/review/validate-sh00-semantics.py`，确保覆盖率与语义检查 100% 可复现。 |

---

## 3. 执行命令与可复现验证证据

| 执行命令 | 退出码 | 验证结果说明 |
|---|---|---|
| `python3 scripts/review/generate-web-inventory.py` | 0 | 成功提取全部 73 个 route 文件，生成 128 行 `web-call-inventory.csv`。 |
| `python3 scripts/review/check-sh00-inventory.py` | 0 | 路由覆盖率 128/128，漏项 0，额外项 0，重复项 0。 |
| `python3 scripts/review/validate-sh00-semantics.py` | 0 | **语义合规验证 100% 通过**：<br>- 验证 128 行 CSV 完整性；<br>- 验证 MCP Bearer OAuth 鉴权与 OPTIONS 无副作用；<br>- 验证 55 个端点包含 `stores/slices` 调用方；<br>- 验证所有引用的 DB 模型完全符合 `schema.prisma` 47 个实际模型；<br>- 验证所有目标 operationId 均带 `PROPOSED:` 前缀。 |
| `node ../growdesk-server/scripts/not-ready.mjs backend:contracts:generate BE-01` | 2 | 实测证明 `growdesk-server` 占位脚本退出码准确为 2。 |

---

## 4. 交付文件清单

本轮 R0 修正位于 `/Users/wangzhuo/Documents/GitHub/baby_panel_for_cecilia`：
1. `docs/compat/web-call-inventory.csv` (R0 修正：补齐 stores 调用源、Bearer OAuth、OPTIONS 无副作用、PROPOSED: 前缀)
2. `docs/compat/web-api-mapping.md` (R0 修正：真实喂养/睡眠/尿布/成长字段与时区换算)
3. `docs/compat/production-writers.md` (R0 修正：真实 Prisma 模型、真实 MCP 工具、严密四阶段停写规程)
4. `docs/compat/capability-status.md` (R0 修正：准确源码路径、退出码 2、诚实标注 HISTORICAL/NOT_RUN)
5. `scripts/review/generate-web-inventory.py` (新增：清单生成器)
6. `scripts/review/validate-sh00-semantics.py` (新增：语义校验器)
7. `evidence/tasks/SH-00/REPORT.md` (本报告)

---

## 5. 下一步行动 (根据 GEMINI_LONG_RUN_HANDOFF.md)

R0 修正已完成并完全通过自检验证，接下来将不等待人工确认，直接连续推进长程任务批次：
- **当前切换**：进入 **L1 阶段**，首先执行 **SH-01 (契约和 Web 兼容矩阵)**。
- **切换仓库**：进入 `/Users/wangzhuo/Documents/GitHub/growdesk-server`。
- **SH-01 目标**：在 `packages/contracts/src` 补齐 TypeBox 请求/响应 schema，替换 `scripts/not-ready.mjs`，导出 `contracts/openapi.json` 并通过无 diff 校验与 Swift 编译冒烟。
- **长程追踪**：将在 `baby_panel_for_cecilia/evidence/long-run/PROGRESS.md` 中持续同步最新批次进度。
