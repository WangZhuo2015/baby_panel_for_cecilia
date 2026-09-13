# 任务执行报告：SH-08 Web 剩余业务路由适配与 MCP 端点收口 (Web Business Routes & MCP Convergence)

> 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`  
> 执行人：Gemini Agent  
> 实施日期：2026-09-13  
> 目标仓库：
>   - `/Users/wangzhuo/Documents/GitHub/baby_panel_for_cecilia` (分支 `main`)
>   - `/Users/wangzhuo/Documents/GitHub/growdesk-server` (分支 `codex/backend-storage-foundation`)
> 基线提交：
>   - `baby_panel_for_cecilia`: `a0f66ff` (SH-07)
>   - `growdesk-server`: `c9f2ef2` (SH-07)  
> 依赖前置：`SH-00` ~ `SH-07` (已全量验证通过)

---

## 1. 目标与架构概述

依据 `docs/plan/implementation/09_WEB_IOS_SHARED_BACKEND.md` 第 13 节（SH-08 任务卡）、`02_BACKEND_CONTRACTS.md`、`06_AGENT_EXECUTION_PLAYBOOK.md` (BE-10, BE-11, BE-12) 以及 `docs/compat/web-call-inventory.csv`：
本任务在旧 Web 前端 (`baby_panel_for_cecilia`) 完成所有剩余照护与健康业务路由的双模 BFF 适配，将远程 MCP 服务端端点收口至 GrowDesk REST API，并在架构层面建立生产写入口防泄漏校验工具，确保在 BFF 模式开启时绝不发生直写 SQLite 的静默泄漏。

### 核心实施要点：

1. **领域 DTO 双向兼容映射层 (`lib/growdesk/*-compat.ts`)**：
   - 为每个照护/健康领域建立独立的轻量类型转换与规范化模块：
     - `diaper-compat.ts`：将 legacy `type: "wet" | "dirty" | "both"` 规范化为 GrowDesk `diaperType: "pee" | "poop" | "both"`，处理 `poopColor`、`poopConsistency`、`notes` 等；
     - `sleep-compat.ts`：支持 `startedAt`/`endedAt` 与旧版 `startTime`/`endTime` 双向解析，支持跨午夜、夜醒次数 `nightWakingCount` 与 `endedAt: null` 显式重置；
     - `food-compat.ts`：转换餐点类型 `mealType`、食材 ID 数组、发生时间及反应评价；
     - `supplement-compat.ts`：转换补剂名称、剂量、打卡时间与备注；
     - `growth-compat.ts`：严格格式化体重 (`weightKg`: 2位小数字符串)、身高 (`heightCm`: 1位小数)、头围 (`headCircumferenceCm`: 1位小数)，出参转为数值；
     - `medical-compat.ts`：适配医疗报告标题、科室 (`department` / `category`)、诊断记录 (`diagnosis` / `doctorNotes`)、S3 附件 (`attachmentIds` / `imageUrl`)；
     - `vaccine-compat.ts`：转换疫苗编号、接种日期、接种机构及从备注提取剂次；
     - `timeline-compat.ts`：转换并格式化 GrowDesk 统一时间线投影为前端展示条目及图标标签。
   - 所有更新载荷 (`*UpdatePayload`) 严格保留 `baseVersion` 乐观锁版本号，防止并发写覆盖。

2. **Web 业务路由双模网关适配 (`app/api/**`)**：
   - 适配以下所有业务路由，在 `GROWDESK_CONFIG.enabled` 为 true 时：
     1. `app/api/records/diaper/route.ts` (GET, POST, PUT, DELETE)
     2. `app/api/records/sleep/route.ts` (GET, POST, PUT, DELETE, PATCH)
     3. `app/api/food/logs/route.ts` (GET, POST, PUT, DELETE)
     4. `app/api/food/items/route.ts` (GET, POST)
     5. `app/api/food/plans/route.ts` (GET, POST)
     6. `app/api/nutrition/records/route.ts` (GET, POST, DELETE)
     7. `app/api/growth/route.ts` (GET, POST, DELETE)
     8. `app/api/growth/chart/route.ts` (GET)
     9. `app/api/medical/reports/route.ts` (GET, POST)
     10. `app/api/vaccines/route.ts` (GET, POST)
     11. `app/api/records/timeline/route.ts` (GET)
     12. `app/api/notifications/route.ts` (GET)
     13. `app/api/push/subscribe/route.ts` (POST)
   - 每一个写操作均严格执行 `verifyBffCsrf(req)`（防御跨站请求伪造）与 `getBffSession(req)`（提取与校验 Session 凭据），未通过则阻断；
   - 零数据降级原则：调用 GrowDesk API 失败时，返回标准错误响应，绝不静默写回本地 SQLite。

3. **远程 MCP 与 Stdio MCP 端点收口**：
   - 远程 MCP 服务端 (`lib/mcp/server.ts` & `app/mcp/route.ts`)：
     - `app/mcp/route.ts` 提取已验证的 OAuth 2.1 Bearer Token 并注入 `createMcpServer(principal, { accessToken: token })`；
     - 在 `GROWDESK_CONFIG.enabled` 开启时，`get_baby_overview`、`record_baby_events`、`record_health_measurement`、`query_parenting_knowledge` 均通过 `growdeskFetch` 代理调用 GrowDesk REST API，不再直查本地 Prisma；
     - 严格落实 `checkScope` 作用域鉴权（`baby:read` / `baby:write`）。
   - Stdio MCP (`scripts/mcp-server.mjs`)：
     - 复核确认该脚本采用标准输入输出协议，所有 12 个工具均通过 `fetch(apiUrl(...))` 发起 HTTP 调用代理至 Web 路由，内部无任何直接 Prisma 依赖或数据库写入，自然随 Web 路由的双模接入完成收口。

4. **架构守护与写入口防泄漏校验 (`scripts/check-production-writers.mjs`)**：
   - 自动化扫描 `app/api/**`、`lib/mcp/**`、`scripts/mcp-server.mjs` 等全部入口；
   - 静态分析所有生产写方法（POST, PUT, DELETE, PATCH）及 Prisma 写入语句；
   - 严格断言全部 14 个业务路由与 MCP 入口在 BFF 模式下均受条件分支保护；
   - 白名单仅放行离线维护脚本（`prisma/seed.ts`, `backup-db.sh`, `purge-test-data.ts` 等）；
   - 接入 `package.json` 脚本：`npm run check:writers`。

---

## 2. 变更文件清单

### Web 端 (`baby_panel_for_cecilia`)
| 文件路径 | 变更类型 | 说明 |
|---|---|---|
| `lib/growdesk/diaper-compat.ts` | 新增 | 尿布记录 DTO 双向适配器与类型转换 |
| `lib/growdesk/sleep-compat.ts` | 新增 | 睡眠记录 DTO 双向适配器、跨午夜与重置区间处理 |
| `lib/growdesk/food-compat.ts` | 新增 | 辅食餐点与食材 DTO 双向适配器 |
| `lib/growdesk/supplement-compat.ts` | 新增 | 营养补剂打卡 DTO 双向适配器 |
| `lib/growdesk/growth-compat.ts` | 新增 | 成长测量与百分位 DTO 适配器（严格小数精度） |
| `lib/growdesk/medical-compat.ts` | 新增 | 医疗报告与 S3 附件关联 DTO 适配器 |
| `lib/growdesk/vaccine-compat.ts` | 新增 | 疫苗接种记录与剂次 DTO 适配器 |
| `lib/growdesk/timeline-compat.ts` | 新增 | 统一时间线投影 DTO 适配器 |
| `lib/growdesk/feeding-compat.ts` | 修改 | 修复 `baseVersion` 属性定义与版本映射 |
| `app/api/records/diaper/route.ts` | 修改 | 接入双模网关代理、CSRF 与 Session 守卫 |
| `app/api/records/sleep/route.ts` | 修改 | 接入双模网关代理、PATCH 睡眠结束与 baseVersion |
| `app/api/food/logs/route.ts` | 修改 | 接入双模网关代理、餐点记录与食材映射 |
| `app/api/food/items/route.ts` | 修改 | 接入双模网关代理、食材库检索与添加 |
| `app/api/food/plans/route.ts` | 修改 | 接入双模网关代理、宝宝辅食计划 |
| `app/api/nutrition/records/route.ts` | 修改 | 接入双模网关代理、补剂打卡与删除 |
| `app/api/growth/route.ts` | 修改 | 接入双模网关代理、成长数据记录与删除 |
| `app/api/growth/chart/route.ts` | 修改 | 接入双模网关代理、生长曲线与 WHO 百分位 |
| `app/api/medical/reports/route.ts` | 修改 | 接入双模网关代理、医疗报告创建与列表 |
| `app/api/vaccines/route.ts` | 修改 | 接入双模网关代理、接种计划与记录保存 |
| `app/api/records/timeline/route.ts` | 修改 | 接入双模网关代理、聚合时间线查询 |
| `app/api/notifications/route.ts` | 修改 | 接入双模网关代理、通知中心读取 |
| `app/api/push/subscribe/route.ts` | 修改 | 接入双模网关代理、Web 推送设备注册 |
| `app/mcp/route.ts` | 修改 | 提取 OAuth Bearer Token 传入 `createMcpServer` |
| `lib/mcp/server.ts` | 修改 | 在 BFF 模式下将 4 个业务工具分发至 GrowDesk API |
| `scripts/check-production-writers.mjs` | 新增 | 生产写入口防泄漏与双模守卫自动审计工具 |
| `package.json` | 修改 | 注册 `"check:writers": "node scripts/check-production-writers.mjs"` |
| `tests/unit/growdesk-bff.test.ts` | 修改 | 修复测试 mock 中缺失的 `occurredAt` 字段 |
| `tests/unit/growdesk-bff-all.test.ts` | 新增 | 全量 DTO 映射、BFF 路由守卫与 MCP 作用域单元测试 (47 项测试) |

---

## 3. 验证命令与测试证据

### 3.1 架构防泄漏与类型安全检查
```bash
# 1. 架构守护审计：检查所有生产写入口与零直接 SQLite 泄漏
npm run check:writers

# 输出：
# ===============================================================================
#  🛡️  SH-08 Production Writers & Zero Direct SQLite Leak Guard
# ===============================================================================
# --- 1. Web Care & Health Business Routes Dual-Mode Audit ---
# [✅ PASS] app/api/records/feeding/route.ts           [GET, POST, PUT, DELETE] BFF Guard: YES
# [✅ PASS] app/api/records/diaper/route.ts            [GET, POST, PUT, DELETE] BFF Guard: YES
# [✅ PASS] app/api/records/sleep/route.ts             [GET, POST, PUT, DELETE, PATCH] BFF Guard: YES
# [✅ PASS] app/api/food/logs/route.ts                 [GET, POST, PUT, DELETE] BFF Guard: YES
# [✅ PASS] app/api/food/items/route.ts                [GET, POST           ] BFF Guard: YES
# [✅ PASS] app/api/food/plans/route.ts                [GET, POST           ] BFF Guard: YES
# [✅ PASS] app/api/nutrition/records/route.ts         [GET, POST, DELETE   ] BFF Guard: YES
# [✅ PASS] app/api/growth/route.ts                    [GET, POST, DELETE   ] BFF Guard: YES
# [✅ PASS] app/api/growth/chart/route.ts              [GET                 ] BFF Guard: YES
# [✅ PASS] app/api/medical/reports/route.ts           [GET, POST           ] BFF Guard: YES
# [✅ PASS] app/api/vaccines/route.ts                  [GET, POST           ] BFF Guard: YES
# [✅ PASS] app/api/records/timeline/route.ts          [GET                 ] BFF Guard: YES
# [✅ PASS] app/api/notifications/route.ts             [GET                 ] BFF Guard: YES
# [✅ PASS] app/api/push/subscribe/route.ts            [POST                ] BFF Guard: YES
# --- 2. MCP Entry Points Audit ---
# [✅ PASS] lib/mcp/server.ts                          Remote MCP Server (Coarse Tools)
# [✅ PASS] scripts/mcp-server.mjs                     Stdio MCP Server (HTTP proxy)
# --- 3. Offline Maintenance Whitelist Verification ---
# [ℹ️ INFO] prisma/seed.ts                             VERIFIED (Offline/Maintenance only)
# [ℹ️ INFO] scripts/backup-db.sh                       VERIFIED (Offline/Maintenance only)
# [ℹ️ INFO] scripts/restore-db.sh                      VERIFIED (Offline/Maintenance only)
# [ℹ️ INFO] scripts/purge-test-data.ts                 VERIFIED (Offline/Maintenance only)
# [ℹ️ INFO] scripts/switch-db.sh                       VERIFIED (Offline/Maintenance only)
# [ℹ️ INFO] scripts/prune-ai-archive.sh                VERIFIED (Offline/Maintenance only)
# ===============================================================================
# ✅ AUDIT PASSED: All 14 business routes and MCP entry points have active BFF guards.
#    Under GROWDESK_CONFIG.enabled=true, zero direct SQLite writes can leak.
# ===============================================================================

# 2. TypeScript 严格类型检查
npx tsc --noEmit
# 退出码 0，零类型报错
```

### 3.2 Web 单元测试套件 (`baby_panel_for_cecilia`)
```bash
npm test

# 输出：
# ℹ tests 182, ℹ pass 182, ℹ fail 0 (test:unit)
# ℹ tests 3, ℹ pass 3, ℹ fail 0 (test:ai)
# 全量 185 项测试 100% 通过（新增 47 项 BFF DTO/Route/MCP 测试全绿）
```

### 3.3 服务端契约、单元与真实 PG18 集成测试 (`growdesk-server`)
```bash
# 契约自洽性校验
npm run backend:contracts:check
# Contract check passed: contracts/openapi.json is perfectly in sync (86 paths, 123 operations).

# 单元与守卫测试
npm run backend:test:unit
# ℹ tests 84, ℹ pass 84, ℹ fail 0

# 真实 PG18 (port 54329) 全量集成测试
python3 scripts/test-integration.py
# ℹ tests 183, ℹ pass 183, ℹ fail 0
# Owned PostgreSQL/Redis integration checks passed; test process exited successfully.
```

---

## 4. 安全、隔离与物理合规

1. **测试数据隔离与生产数据库防护**：
   - Web 端测试全程在 `.env.test` 下运行，仅连接 `file:./dev_test.db`，物理权限 600 的生产库 `prod.db` 保持严格隔离，零触碰；
   - 生产端口 3088、systemd 守护进程与宿主机 230 的 nginx 8443 零变更。
2. **三仓库脏文件与状态物理隔离**：
   - `growdesk-server` 仓库中的 6 个历史遗留未提交文件（`deploy/Migration.Dockerfile`、`scripts/legacy-import/*`、`evidence/tasks/LEGACY_IMPORT/*`）被严格隔离保留，未被触碰或提交；
   - `growdesk-ios` 仓库中的未提交文件严格原样保留。

---

## 5. 结论与下一阶段前置

- **审查结论**：`SH-08` 全部功能已实现并通过全量回归验证，架构防泄漏守护工具通过。
- **允许领取的下一任务**：**`SH-09: 后端同步协议与本地状态机 (Local-First Sync Protocol)`**。
