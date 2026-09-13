# SH-08 任务独立架构与代码审计复查报告 (Review Report)

> **任务编号**：SH-08 (Web 剩余业务路由适配与 MCP 端点收口)  
> **审查结论**：`ACCEPTED` (验收通过)  
> **审查角色**：独立系统架构与代码审计 Review Agent (非实现者)  
> **审查日期**：2026-09-13  
> **审查基线与提交**：  
> - `baby_panel_for_cecilia`：基线 `a0f66ff`，交付提交 `965e88a` 与 `afae355`  
> - `growdesk-server`：基线 `c9f2ef2` (只读参考与测试验证，无提交)  
> - `growdesk-ios`：基线 `96aa000` (只读参考，无提交)  
> **协议与规范权威**：  
> 1. `docs/plan/implementation/09_WEB_IOS_SHARED_BACKEND.md`（第 13 节 SH-08 任务卡与第 19 节报告格式标准）  
> 2. `docs/plan/implementation/02_BACKEND_CONTRACTS.md`、`06_AGENT_EXECUTION_PLAYBOOK.md` (BE-10, BE-11, BE-12)  
> 3. `docs/compat/web-call-inventory.csv`、`docs/compat/production-writers.md`  
> 4. 三仓库根目录 `AGENTS.md` (测试数据与环境硬隔离、防串号与权限规范)  

---

## 1. 审查基线与三仓库隔离复核

### 1.1 三仓库物理与状态隔离复核结果

| 仓库路径 | 当前分支 | 基线提交 SHA | 交付提交 SHA | 工作区状态 (Git Status) | 审计结论 |
|---|---|---|---|---|---|
| **`baby_panel_for_cecilia`** | `main` | `a0f66ff` | `965e88a`<br>`afae355` | Ahead 27 of origin, Working tree clean | **通过**。仅包含 BFF 业务路由、DTO compat、MCP 收口、防泄漏守护工具与任务报告/进度表。 |
| **`growdesk-server`** | `codex/backend-storage-foundation` | `c9f2ef2` | *(无新增提交)* | Dirty (6 个历史未提交文件严格隔离原样保留) | **通过**。未提交文件完全未被修改、污染或提交，HEAD 保持 `c9f2ef2`。 |
| **`growdesk-ios`** | `codex/local-storage-policy` | `96aa000` | *(无新增提交)* | Dirty (历史未提交文件严格原样保留) | **通过**。HEAD 保持 `96aa000`，未被触碰或混入。 |

### 1.2 关键历史未提交文件隔离验证
- **`growdesk-server` 6 个历史未提交文件**：
  1. `deploy/Migration.Dockerfile` (已核验 `git diff`，仅保留历史 Dockerfile 修改，未引入任何新修改)
  2. `evidence/tasks/LEGACY_IMPORT/host-after.json` (未跟踪，原样保留)
  3. `evidence/tasks/LEGACY_IMPORT/remote-migration.txt` (未跟踪，原样保留)
  4. `evidence/tasks/LEGACY_IMPORT/target-verification.json` (未跟踪，原样保留)
  5. `scripts/legacy-import/ios_backup.py` (未跟踪，原样保留)
  6. `scripts/legacy-import/test_ios_backup.py` (未跟踪，原样保留)
  - **核验结论**：经 `git status` 与 `git diff` 复核，上述 6 个文件完好无损，零篡改、零混入、零提交。
- **生产数据库 `prod.db` (权限 600) 防护**：
  - 经 `find . -name "*.db*"` 检查，工作区中仅存在自动化测试使用的 `dev_test.db`。生产库 `prod.db` 保持物理与配置隔离，零触碰。

---

## 2. 逐项复查核验结论与技术细节

### 2.1 业务路由与 DTO 兼容层复核 —— **ACCEPTED**

复核审查了全部 14 个照护与健康业务路由及 8 个领域 DTO 兼容模块：

1. **路由清单与方法审计**：
   1. `app/api/records/feeding/route.ts` [GET, POST, PUT, DELETE]（SH-05 基线）
   2. `app/api/records/diaper/route.ts` [GET, POST, PUT, DELETE]
   3. `app/api/records/sleep/route.ts` [GET, POST, PUT, DELETE, PATCH]
   4. `app/api/food/logs/route.ts` [GET, POST, PUT, DELETE]
   5. `app/api/food/items/route.ts` [GET, POST]
   6. `app/api/food/plans/route.ts` [GET, POST]
   7. `app/api/nutrition/records/route.ts` [GET, POST, DELETE]
   8. `app/api/growth/route.ts` [GET, POST, DELETE]
   9. `app/api/growth/chart/route.ts` [GET]
   10. `app/api/medical/reports/route.ts` [GET, POST]
   11. `app/api/vaccines/route.ts` [GET, POST]
   12. `app/api/records/timeline/route.ts` [GET]
   13. `app/api/notifications/route.ts` [GET]
   14. `app/api/push/subscribe/route.ts` [POST]

2. **安全防护与会话守卫**：
   - **CSRF 守卫**：所有写方法（POST, PUT, DELETE, PATCH）在进入业务逻辑前，首先执行 `const csrfErr = verifyBffCsrf(request); if (csrfErr) return csrfErr;`，对跨域非法请求直接返回 403。
   - **Session 凭据提取与校验**：所有路由在 `GROWDESK_CONFIG.enabled` 为 true 时，调用 `resolveBffSession(request)` 校验 HttpOnly 安全 Cookie；未登录或会话过期立即返回 401，绝不放行。
   - **乐观锁控制 (`baseVersion`)**：
     - 在 PUT/PATCH/DELETE 更新与删除操作中，Payload 和 URL Query 严格维护 `baseVersion: Number(body.baseVersion ?? body.version ?? 1)`，透传至 GrowDesk API，并发冲突时由服务端返回 409。
   - **零静默降级原则 (Zero Silent Fallback Guard)**：
     - 当 `GROWDESK_CONFIG.enabled` 开启且 `growdeskFetch` 失败时，直接向客户端返回标准 JSON 错误（保留原 HTTP 状态码），**绝不捕获异常后静默回退执行本地 Prisma/SQLite 读写**。

3. **8 大领域 DTO 兼容层 (`lib/growdesk/*-compat.ts`) 审查**：
   - 全部模块均声明首行服务端环境断言：`if (typeof window !== "undefined") throw new Error("This module can only be loaded on the server.");`。
   - `diaper-compat.ts`：准确映射 `wet/dirty/both` ↔ `pee/poop/both`，处理 `poopColor`, `poopConsistency`, `notes`。
   - `sleep-compat.ts`：处理跨午夜、夜醒次数 `nightWakingCount`，并采用 `"endedAt" in body` 显式属性探测以支持将正在进行的睡眠安全置为结束或清空。
   - `food-compat.ts`：映射餐点类型、食材 ID 数组、发生时间与反应评价。
   - `supplement-compat.ts`：映射补剂名称、剂量及时间戳。
   - `growth-compat.ts`：格式化体重（2 位小数）、身长（1 位小数）、头围（1 位小数），出参反解为数值。
   - `medical-compat.ts`：映射标题、科室、诊断及 S3 附件 ID 数组。
   - `vaccine-compat.ts`：映射疫苗编号、接种日期、机构，并通过正则从备注提取剂次。
   - `timeline-compat.ts`：统一将多领域投影转换为前端时间线数据项与中文标签。

### 2.2 远程 MCP 与 Stdio MCP 收口复核 —— **ACCEPTED**

1. **远程 MCP 服务端 (`app/mcp/route.ts` & `lib/mcp/server.ts`)**：
   - `app/mcp/route.ts` 验证 OAuth 2.1 Bearer Token 并注入 `createMcpServer(principal, { accessToken: token })`。
   - 在 `GROWDESK_CONFIG.enabled` 开启时，4 个核心高内聚工具：
     - `get_baby_overview`：通过 `growdeskFetch` 查询 baby profile、timeline、vaccines；
     - `record_baby_events`：通过 `growdeskFetch` 分发 feeding, sleep, diaper, food, foodPlan, supplement 写请求；
     - `record_health_measurement`：通过 `growdeskFetch` 分发 growth, vaccine, medicalReport 写请求及 deleteAction；
     - `query_parenting_knowledge`：通过 `growdeskFetch` 查询 food items, vaccine schedule, nutrition products；
   - 工具执行前严格断言 OAuth Scope：`checkScope(principal, "read")` 与 `checkScope(principal, "write")`，未授权时抛出 `McpError(ErrorCode.InvalidRequest)`。
2. **Stdio MCP 服务端 (`scripts/mcp-server.mjs`)**：
   - 经全文检索与静态代码审计，该脚本为纯 HTTP Proxy 实现：
     - 采用 `fetch(apiUrl(pathname, babyId, ...))` 发起 HTTP 请求；
     - 无任何 `@/lib/prisma` 引用，无任何直接数据库查询；
     - 随 Web 路由的网关适配自然收口至 GrowDesk API。

### 2.3 架构守护脚本 check:writers 校验 —— **ACCEPTED**

运行架构审计守护脚本：
```bash
npm run check:writers
```
**审计输出**：
```text
===============================================================================
 🛡️  SH-08 Production Writers & Zero Direct SQLite Leak Guard
===============================================================================

--- 1. Web Care & Health Business Routes Dual-Mode Audit ---
[✅ PASS] app/api/records/feeding/route.ts           [GET, POST, PUT, DELETE] BFF Guard: YES
[✅ PASS] app/api/records/diaper/route.ts            [GET, POST, PUT, DELETE] BFF Guard: YES
[✅ PASS] app/api/records/sleep/route.ts             [GET, POST, PUT, DELETE, PATCH] BFF Guard: YES
[✅ PASS] app/api/food/logs/route.ts                 [GET, POST, PUT, DELETE] BFF Guard: YES
[✅ PASS] app/api/food/items/route.ts                [GET, POST           ] BFF Guard: YES
[✅ PASS] app/api/food/plans/route.ts                [GET, POST           ] BFF Guard: YES
[✅ PASS] app/api/nutrition/records/route.ts         [GET, POST, DELETE   ] BFF Guard: YES
[✅ PASS] app/api/growth/route.ts                    [GET, POST, DELETE   ] BFF Guard: YES
[✅ PASS] app/api/growth/chart/route.ts              [GET                 ] BFF Guard: YES
[✅ PASS] app/api/medical/reports/route.ts           [GET, POST           ] BFF Guard: YES
[✅ PASS] app/api/vaccines/route.ts                  [GET, POST           ] BFF Guard: YES
[✅ PASS] app/api/records/timeline/route.ts          [GET                 ] BFF Guard: YES
[✅ PASS] app/api/notifications/route.ts             [GET                 ] BFF Guard: YES
[✅ PASS] app/api/push/subscribe/route.ts            [POST                ] BFF Guard: YES

--- 2. MCP Entry Points Audit ---
[✅ PASS] lib/mcp/server.ts                          Remote MCP Server (Coarse Tools)
[✅ PASS] scripts/mcp-server.mjs                     Stdio MCP Server (HTTP proxy)

--- 3. Offline Maintenance Whitelist Verification ---
[ℹ️ INFO] prisma/seed.ts                             VERIFIED (Offline/Maintenance only)
[ℹ️ INFO] scripts/backup-db.sh                       VERIFIED (Offline/Maintenance only)
[ℹ️ INFO] scripts/restore-db.sh                      VERIFIED (Offline/Maintenance only)
[ℹ️ INFO] scripts/purge-test-data.ts                 VERIFIED (Offline/Maintenance only)
[ℹ️ INFO] scripts/switch-db.sh                       VERIFIED (Offline/Maintenance only)
[ℹ️ INFO] scripts/prune-ai-archive.sh                VERIFIED (Offline/Maintenance only)

===============================================================================
✅ AUDIT PASSED: All 14 business routes and MCP entry points have active BFF guards.
   Under GROWDESK_CONFIG.enabled=true, zero direct SQLite writes can leak.
===============================================================================
```
退出码：`0`。白名单严格生效，全部生产入口均受双模守卫保护。

### 2.4 测试套件全量独立复核 —— **ACCEPTED**

复核执行了三仓库的全量静态检查与测试套件，证据如下：

1. **`baby_panel_for_cecilia` 静态类型检查**：
   ```bash
   npx tsc --noEmit
   # 退出码 0，零类型报错
   ```
2. **`baby_panel_for_cecilia` 单元测试与 AI 测试**：
   ```bash
   npm test
   # ℹ tests 182, ℹ pass 182, ℹ fail 0 (test:unit)
   # ℹ tests 3, ℹ pass 3, ℹ fail 0 (test:ai)
   # 退出码 0，全量 185 项测试 100% 通过
   ```
3. **`growdesk-server` 契约自洽性校验**：
   ```bash
   npm run backend:contracts:check
   # Contract check passed: contracts/openapi.json is perfectly in sync (86 paths, 123 operations).
   # 退出码 0
   ```
4. **`growdesk-server` 单元与门禁测试**：
   ```bash
   npm run backend:test:unit
   # ℹ tests 84, ℹ pass 84, ℹ fail 0
   # 退出码 0
   ```
5. **`growdesk-server` 真实 PostgreSQL 18 / Redis 集成测试**：
   ```bash
   python3 scripts/test-integration.py
   # ℹ tests 183, ℹ pass 183, ℹ fail 0
   # Owned PostgreSQL/Redis integration checks passed; test process exited successfully.
   # 退出码 0
   ```

### 2.5 任务报告与进度表复核 —— **ACCEPTED**

- **`evidence/tasks/SH-08/REPORT.md`**：
  - 格式符合 `09_WEB_IOS_SHARED_BACKEND.md` 第 19 节规范；
  - 记录了正确的起始基线（`baby_panel: a0f66ff`, `growdesk-server: c9f2ef2`）与交付提交 SHA（`965e88a`, `afae355`）；
  - 详尽记录了文件清单、测试证据、安全与隔离合规情况。
- **`evidence/long-run/PROGRESS.md`**：
  - 第 1 节准确记录了各仓库最新提交与工作区状态；
  - 第 3 节已登记 `SH-08` 完成项与对应报告路径；
  - 第 6 节准确指向下一任务 `SH-09: 后端同步协议与本地状态机` 及操作目录 `/Users/wangzhuo/Documents/GitHub/growdesk-server`。

---

## 3. 独立复查结论与下一任务放行

### 3.1 总体审计结论
**`ACCEPTED` (验收通过)**

SH-08 任务在旧 Web 端完整实现了所有剩余 14 个照护与健康业务路由的双模 BFF 网关改造，建立了高内聚的 8 大领域 DTO 双向适配层，将远程与 Stdio MCP 服务端完全收口至 GrowDesk REST API，并建立通过了架构写入口防泄漏门禁 `check:writers`。测试全绿，三仓库物理与状态隔离严密，生产库零触碰。

### 3.2 允许领取的下一任务
- **任务编号**：**`SH-09: 后端同步协议与本地状态机 (Local-First Sync Protocol)`**
- **目标仓库**：`/Users/wangzhuo/Documents/GitHub/growdesk-server`
- **主要内容**：
  1. 依据 `02_BACKEND_CONTRACTS.md` 与 `07_LOCAL_FIRST_OPTIONAL_SYNC.md` 实现增量变更拉取 (`GET /api/v1/sync/changes`) 与离线变更批量推送 (`POST /api/v1/sync/commands`)；
  2. 实现单调递增的 `SyncCursor` 签名游标机制与客户端 `localSequence` 幂等收据；
  3. 基于 `FamilySyncState` 行级锁实现同步指令串行化与 `baseVersion` 乐观并发控制；
  4. 严格隔离历史未提交文件，编写完整的单元与集成测试。
