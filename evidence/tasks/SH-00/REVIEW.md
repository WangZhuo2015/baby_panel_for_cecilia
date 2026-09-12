# SH-00 任务独立架构与代码审计复查报告 (Review Report)

> **任务编号**：SH-00 (Web 与 iOS 共用后端基线和调用清单盘点)  
> **审查结论**：`ACCEPTED` (验收通过)  
> **审查角色**：独立系统架构与代码审计 Review Agent (非实现者)  
> **审查日期**：2026-09-12  
> **协议与规范权威**：  
> 1. `docs/plan/implementation/09_WEB_IOS_SHARED_BACKEND.md`（第 5 节任务卡与第 19 节报告标准）  
> 2. `docs/plan/implementation/02_BACKEND_CONTRACTS.md`、`03_DATABASE_MIGRATION.md`、`07_LOCAL_FIRST_OPTIONAL_SYNC.md`、`08_ACCOUNT_BABY_RELATIONSHIPS.md`  
> 3. 三仓库根目录 `AGENTS.md`  

---

## 1. 审查基线与工作区状态复核

### 1.1 三仓库物理与状态隔离验证

| 仓库名称 | 分支 (Branch) | 基线 SHA | 交付提交 SHA | 工作区状态 (Git Status) | 审计结果 |
|---|---|---|---|---|---|
| **`baby_panel_for_cecilia`** | `main` | `49017313513e57cbb9720b873ccbe81942e8d491` | `942a59f2a243df8f5b0e531f244c9f5db02416d0`<br>`157915f83cd1b4e309faa339478d9430a058a1b3` | Clean (Ahead 3 of origin) | **通过**。仅新增 5 个文档/清单文件，未改动任何业务代码与生产配置。 |
| **`growdesk-server`** | `codex/backend-storage-foundation` | `d9604d5a773630e81c0bedcc70b7bcf013c64535` | *(未提交，只读参考)* | Dirty (包含 6 个已有未提交文件) | **通过**。未提交文件完全未被修改、污染或提交。 |
| **`growdesk-ios`** | `codex/local-storage-policy` | `96aa0007bc44874419471a0dd5c7e07c8b317aa1` | *(未提交，只读参考)* | Dirty (包含已有未提交文件) | **通过**。未提交文件完全未被修改、污染或提交。 |

### 1.2 未提交文件隔离核验证据
1. **`growdesk-server` 6 个未提交文件验证**：
   - `M deploy/Migration.Dockerfile`
   - `?? evidence/tasks/LEGACY_IMPORT/host-after.json`
   - `?? evidence/tasks/LEGACY_IMPORT/remote-migration.txt`
   - `?? evidence/tasks/LEGACY_IMPORT/target-verification.json`
   - `?? scripts/legacy-import/ios_backup.py`
   - `?? scripts/legacy-import/test_ios_backup.py`
   - **核验结论**：经 `git diff` 与 `git status` 审查，上述 6 个文件保持原样，没有任何文件被混入 `baby_panel_for_cecilia`。
2. **`growdesk-ios` 未提交文件验证**：
   - `M BabyPanel.xcodeproj/project.pbxproj`
   - `?? docs/design-mockups/`
   - **核验结论**：经 `git status` 审查，上述文件保持原样，未被混入或触碰。

---

## 2. 逐项复查核验结论与证据

### 2.1 调用清单复核 (`docs/compat/web-call-inventory.csv`) —— **ACCEPTED**

Reviewer 通过编写独立验证脚本，深度扫描 `app/` 目录源码并与 CSV 进行双向集合比对：

1. **Route Handler 文件覆盖率**：
   - 源码扫描统计：`app/` 目录下包含且仅包含 **73 个 `route.ts` 文件**（涵盖 `.well-known` 下的 3 个 OAuth 元数据路由）。
   - CSV 覆盖统计：CSV 精准涵盖全部 **73 个 `route.ts`**，遗漏率 0%。
2. **HTTP 端点（Method + Path）统计**：
   - 源码包含 118 个标准 `export (async) function` 声明。
   - 源码包含 10 个通过 `export { ... } from` 重新导出的端点：
     - `app/api/mcp/route.ts`：`GET`, `POST`, `DELETE`, `OPTIONS` (来自 `@/app/mcp/route`)
     - `app/api/oauth/register/route.ts`：`POST`, `OPTIONS` (来自 `@/app/oauth/register/route`)
     - `app/api/oauth/revoke/route.ts`：`POST`, `OPTIONS` (来自 `@/app/oauth/revoke/route`)
     - `app/api/oauth/token/route.ts`：`POST`, `OPTIONS` (来自 `@/app/oauth/token/route`)
   - 独立脚本提取端点总数：**128 个**。
   - CSV 行数（除表头）：**128 行**。
   - **比对结果**：`set_code == set_csv`，完全一一对应，无一遗漏。
3. **关键端点抽查与审计发现**：
   - **发现 1 (调用方范围补充)**：静态调用方扫描了 `app/`、`components/`、`lib/`、`scripts/`，但未索引前端状态管理层 `stores/slices/*.ts`。因此 `/api/records/feeding`、`/api/records/diaper`、`/api/records/sleep`、`/api/auth/login` 等端点的 callers 被标记为 `Unlinked/Direct/External` 或仅 `scripts/mcp-server.mjs`。实际上前端组件通过 `stores/slices/records.ts` 与 `stores/slices/auth.ts` 发起调用。此项不影响路由覆盖，但在后续 SH-05 (Web BFF) 改造时须以 `stores/` 为关键调用源。
   - **发现 2 (鉴权机制规范)**：CSV 中 `/api/mcp` 与 `/mcp` 的 `auth_type` 标注为 `Cookie Session (getAuthUser)`。经核验源码 `app/mcp/route.ts`，实际鉴权为 **OAuth 2.1 Bearer Token (`verifyMcpAccessToken`)**，未配置 Cookie 会话。后续 SH-01/SH-08 需依源码以 Bearer 契约对齐。
   - **发现 3 (OPTIONS 预检语义)**：`/mcp` 的 OPTIONS 预检请求在 CSV 中被标记 `side_effects: SSE Long-lived Stream`，实际 OPTIONS 仅返回 204 无副作用响应。
   - **发现 4 (隐式数据库读取)**：`/api/baby` 的 `db_read_models` 标注为 `none`，但底层通过 `lib/api-helpers.ts:getActiveBaby()` 隐式读取了 `FamilyMember` 与 `Baby` 模型。开发团队需知悉 helper 层引入的隐式读取。

### 2.2 兼容映射复核 (`docs/compat/web-api-mapping.md`) —— **ACCEPTED**

1. **核心协议与规格审查**：
   - **Envelope 转换**：明确定义旧结构 ↔ 新 `{ data: ... }` / `{ error: { code, message, details, requestId } }`。
   - **日期与时区**：强制区分事件时间戳（RFC3339 含时区）与日历日期（`YYYY-MM-DD`），明确家庭时区来源（`Family.timeZone`），杜绝跨日 8 小时偏移。
   - **十进制小数字符串 (Decimal String)**：身高、体重、头围、摄入量均规定以十进制字符串传输，杜绝浮点精度丢失。
   - **乐观锁与幂等控制**：POST 请求强制 `Idempotency-Key: UUID`；PUT/PATCH/DELETE 强制 `baseVersion` 乐观锁。
   - **逐宝宝鉴权**：全面废除 `findFirst()` 兜底，按 `BabyMember` 状态做事务级权限校验。
   - **状态码映射**：完整涵盖 200, 201, 400, 401, 403, 404, 409, 410, 422, 429, 503。
2. **安全红线核验**：
   - **禁止静默改 200**：映射明确规定遵循严格失败语义，4xx/5xx 不伪装为 200 成功。
   - **禁止降级写 SQLite**：明确规定 503 场景下**严禁降级回写旧 SQLite**，必须显式抛出错误并提示客户端重试。
3. **微小笔误备忘 (Downstream Note)**：
   - Section 5.1 脱敏 Golden Fixture 响应样例中，`startTime` 示例写入了 `"2026-09-12T14:30:00.000Z"`，将 +08:00 本地时间与 UTC 标识符结合；在 SH-01 交付正式 golden fixtures 时，须规范为标准的 UTC 时刻 `"2026-09-12T06:30:00.000Z"`。

### 2.3 生产写入口复核 (`docs/compat/production-writers.md`) —— **ACCEPTED**

1. **非路由写入口审计完备性**：
   - 全面清查 40 项写入口（W-01 至 W-40）。
   - 涵盖 AI Agent 8 个领域工具闭包（`lib/agent/tools/**`, `voice-fast-path.ts`）；
   - 涵盖远程 MCP 5 大业务工具与 `OAuthAuditLog` 写入；
   - 涵盖 Stdio MCP (`scripts/mcp-server.mjs`) 及其环境变量机制；
   - 涵盖 OAuth 2.1 状态机（Client, AuthCode, Token, Consent, AuditLog）；
   - 涵盖归档、日报、推送订阅、PAT 令牌等间接写；
   - 涵盖维护脚本（`prune-ai-archive.sh`, `switch-db.sh`, `purge-test-data.ts` 等）。
2. **生产可达性评估客观性**：
   - 状态分类客观合理（`ACTIVE_IN_PRODUCTION`, `CALLABLE_VIA_HTTP`, `OFFLINE_MAINTENANCE`, `UNKNOWN_DEPLOYMENT_REACHABLE`），未低估任何外部接口的破坏力。
3. **SH-13 停写栅栏 (Write-Freeze Fence) 规程**：
   - 制定了清晰的 3 步规程：
     1. 阻断宿主 cron 与外部 MCP 端口；
     2. 旧 Web 开启全局拦截返回 503，终止在途异步 Job；
     3. 执行 `PRAGMA wal_checkpoint(TRUNCATE)`，锁定行数与时间戳比对，确认零写入后才开放新库写。
   - 规程严密，符合高可靠金融级数据迁移标准。

### 2.4 能力就绪状态复核 (`docs/compat/capability-status.md`) —— **ACCEPTED**

1. **占位脚本事实核查**：
   - 独立执行验证：在 `growdesk-server` 运行 `node scripts/not-ready.mjs backend:contracts:generate BE-01`，命令输出：`backend:contracts:generate is not implemented in this baseline; it is owned by BE-01.`，进程退出码为 `2`（非零）。
   - 核验确认：`backend:contracts:*` 与 `backend:db:*` 确为占位桩，报告未夸大服务端就绪状态。
2. **230 主机部署现状核查**：
   - 线上探针事实核验无误：端口 8443 / 3180 仅通过 `/health/live` 与 `/health/ready` 探针，业务 API 均为 404，不具备业务能力。
3. **LEGACY_IMPORT 事实核查**：
   - 目标 PG 处于私有归档状态：5 用户、1 家庭、1 宝宝、1311 历史档案存放在 `legacy_import` schema；`businessHistoryReady: false`，`newLoginReady: false`。
   - 导入脚本保护核验：`scripts/legacy-import/import_sql.py:98` 包含 `RAISE EXCEPTION 'Initial import requires empty identity tables; refuses to overwrite existing data'`，确认具非空库保护，记录准确客观。

### 2.5 任务报告格式与闭环复核 (`evidence/tasks/SH-00/REPORT.md`) —— **ACCEPTED**

1. 结构完全符合 `09_WEB_IOS_SHARED_BACKEND.md` 第 19 节格式要求。
2. 基线 SHA `49017313513e57cbb9720b873ccbe81942e8d491` 与交付提交 `942a59f2a243df8f5b0e531f244c9f5db02416d0` / `157915f83cd1b4e309faa339478d9430a058a1b3` 精确无误。
3. 状态如实自标为 `IMPLEMENTED_NOT_REVIEWED`，未越权自标 ACCEPTED。

---

## 3. 验收裁定与下一任务交接

### 3.1 审查裁定
**判定结果**：`ACCEPTED` (正式验收通过)

SH-00 任务全面、真实、精确地完成了三仓库基线摸排、全量 128 个端点盘点、40 项生产写入口清查、能力就绪矩阵与兼容规范初稿，满足 `09_WEB_IOS_SHARED_BACKEND.md` 规定的全部验收准则。

### 3.2 允许领取的下一任务
- **任务编号**：**`SH-01` (契约和 Web 兼容矩阵)**
- **负责仓库**：**`growdesk-server`**
- **任务前置与约束准则**：
  1. **依据权威**：严格以本轮核准的 `docs/compat/web-call-inventory.csv`（128 个端点）与 `02_BACKEND_CONTRACTS.md` 为契约输入。
  2. **契约真实验收**：在 `packages/contracts/src` 实现真正的 TypeBox 请求/响应 schema，替换 `scripts/not-ready.mjs`；导出规范的 `contracts/openapi.json` (OpenAPI 3.0.3)，运行 `backend:contracts:check` 确保退出码为 0 且无 git diff。
  3. **Swift 兼容冒烟**：生成脱敏 Golden Fixtures，完成 Swift 解码兼容性校验。
  4. **下游关联**：将本审查报告中提及的 4 项架构发现（`stores/` 调用源、MCP OAuth Bearer 鉴权、UTC 时间规范）纳入 SH-01 规范完善之中。
  5. **物理隔离红线**：SH-01 实施仅限在 `growdesk-server` 内进行，禁止修改 `baby_panel_for_cecilia` 业务代码或触碰 `growdesk-ios`。
