> 2026-09-12 Codex复核：本文件的原始完成/验收结论已被 [REVIEW_CODEX.md](REVIEW_CODEX.md) 替代，当前为 CHANGES_REQUESTED。以下内容保留作历史，不作为后续实现放行依据。

# SH-00 任务执行报告：Web 与 iOS 共用后端基线和调用清单

> 任务：SH-00 (Web 与 iOS 共用后端的基线和调用清单盘点)  
> 状态：`IMPLEMENTED_NOT_REVIEWED`  
> 日期：2026-09-12  
> 执行规范：`docs/plan/implementation/09_WEB_IOS_SHARED_BACKEND.md` 第 5 节与第 19 节标准。

---

## 1. 仓库基线与工作区状态核对

| 仓库名称 | 分支 (Branch) | 起始基线 HEAD | 交付提交 HEAD | Working Tree 状态与未提交文件核验 |
|---|---|---|---|---|
| **`baby_panel_for_cecilia`**<br>(当前任务工作区) | `main` | `49017313513e57cbb9720b873ccbe81942e8d491` | `942a59f2a243df8f5b0e531f244c9f5db02416d0` (本轮提交) | 起始状态 Clean (`ahead 1` of origin)。本轮**仅新增 5 个 SH-00 明确交付物**，未触碰任何业务代码与配置。 |
| **`growdesk-server`**<br>(只读参考仓库) | `codex/backend-storage-foundation` | `d9604d5a773630e81c0bedcc70b7bcf013c64535` | *(只读未动)* | **Dirty**。包含 6 个已有未提交文件：<br>- `M deploy/Migration.Dockerfile`<br>- `?? evidence/tasks/LEGACY_IMPORT/host-after.json`<br>- `?? evidence/tasks/LEGACY_IMPORT/remote-migration.txt`<br>- `?? evidence/tasks/LEGACY_IMPORT/target-verification.json`<br>- `?? scripts/legacy-import/ios_backup.py`<br>- `?? scripts/legacy-import/test_ios_backup.py`<br>**严格保留，未混入，未提交**。 |
| **`growdesk-ios`**<br>(只读参考仓库) | `codex/local-storage-policy` | `96aa0007bc44874419471a0dd5c7e07c8b317aa1` | *(只读未动)* | **Dirty**。包含已有未提交文件：<br>- `M BabyPanel.xcodeproj/project.pbxproj`<br>- `?? docs/design-mockups/`<br>**严格保留，未混入，未提交**。 |

### 1.1 部署与迁移事实核对（不混为一谈）
1. **真实写权威**：当前生产环境仍由 `baby_panel_for_cecilia` 独占，运行于 3088 端口（由 systemd `baby-panel.service` 管理），直连 SQLite 数据库（`file:./prod.db`，物理权限 600）。
2. **GrowDesk 云端基础栈**：在 `ubuntu@161.33.201.230` 上通过 Docker 容器部署了 Node 24 API（绑定宿主回环 3180）、PG 18.6、Redis 8.10.1，并通过 sing-box nginx (HTTPS 8443) 暴露 `/health/live` 与 `/health/ready`（当前均通过公网 TLS 探针检测）。但**当前业务 API 未开放（全部 404），新服务完全不具备业务写能力**。
3. **LEGACY_IMPORT 状态澄清**：目标 PG 在提交 `e00cedc` 下应用了初始迁移 `202609120001_identity`，导入了 5 个用户、1 个家庭、1 个宝宝和 1311 行历史私有档案。但这仅为 `legacy_import` schema 下的私有数据，**API 无权读取档案，业务历史数据未转换 (`businessHistoryReady: false`)，登录接口未就绪 (`newLoginReady: false`)**。不能把身份导入误判为业务上线。
4. **导入脚本保护**：`scripts/legacy-import/import_sql.py` 具有严格的“目标非空库拒绝执行保护”，不能直接用于后续切换阶段的增量合并。

---

## 2. 实现范围与明确未实现项

### 2.1 本轮实现范围
1. **全量路由与端点盘点 (`docs/compat/web-call-inventory.csv`)**：
   - 彻底扫描 `app/` 目录下全部 73 个 `route.ts` 源码；
   - 提取全部 128 个 HTTP 端点（补齐了此前仅通过 `export function` 统计漏掉的 10 个端点，包括 `/api/mcp` 与 OAuth 路由的 `export { ... } from` 重新导出声明）；
   - 明确标注每个端点的调用来源（前端 Page / Component / Hook / Script / 外部）、鉴权类型、数据库读取/写入表、外部副作用（LLM、Web Push、文件写、SSE、天气 API 等）、02 契约对应的目标 operationId、双端就绪状态及测试入口。
2. **兼容层字段与协议映射初稿 (`docs/compat/web-api-mapping.md`)**：
   - 制定 Next.js 同源 BFF 与 GrowDesk Fastify API 的边界规则；
   - 规定返回 Envelope 转换（旧原生对象/旧封装 ↔ 新 `{data: ...}` 与 `{error: {code, message, details, requestId}}`）；
   - 确立统一的事件时间（RFC3339 含时区）与日历日期（`YYYY-MM-DD`）标准，彻底杜绝 8 小时跨日时区偏移与 UTC 午夜截断；
   - 确立身高、体重、头围、摄入量等度量值的十进制小数字符串传输规范（Decimal String），杜绝浮点精度丢失；
   - 确立 `Idempotency-Key` 创建幂等与 `baseVersion` / `version` 乐观锁并发控制；
   - 确立多宝宝隔离规则，全面废除 `findFirst()` 兜底，按 `BabyMember` 权限校验；
   - 给出完整的 HTTP 状态码映射表与喂养领域 Golden Fixture 样例。
3. **非路由写入口与生产可达性审计 (`docs/compat/production-writers.md`)**：
   - 清查 40 项非路由写入口，涵盖 AI Agent 工具闭包 (`lib/agent/tools/**`, `voice-fast-path.ts`)、远程 MCP 服务端 (`lib/mcp/server.ts`)、Stdio MCP 客户端脚本 (`scripts/mcp-server.mjs`)、OAuth 2.1 状态机 (`lib/oauth/service.ts`)、后台归档/推送逻辑以及维护 Shell 脚本；
   - 逐项明确生产可达性状态（`ACTIVE_IN_PRODUCTION`, `CALLABLE_VIA_HTTP`, `OFFLINE_MAINTENANCE`, `UNKNOWN_DEPLOYMENT_REACHABLE`）；
   - 制定切生产时（SH-13 前置）必须执行的停写栅栏（Write-Freeze Fence）具体清退规程。
4. **双端能力就绪矩阵 (`docs/compat/capability-status.md`)**：
   - 对三仓库分领域、分层次梳理已有实现、仅骨架、缺失、已验证与未验证状态；
   - **脚本占位明确警示**：核实并记录 `growdesk-server` 中的 `backend:contracts:*` 与 `backend:db:*` 脚本均指向 `scripts/not-ready.mjs`，退出码为 1。

### 2.2 明确未实现项（严格遵守职责边界）
- 未在 Web 仓库修改任何业务代码，未新建 BFF 客户端。
- 未在服务端开发任何业务 API 或执行新的数据库迁移。
- 未在 iOS 仓库生成客户端或修改同步引擎。
- 未访问生产数据库，未读取生产部署 secrets，未更改 230 主机上的服务配置。

---

## 3. 契约与 Migration 版本现状

- **契约权威**：以 `docs/plan/implementation/02_BACKEND_CONTRACTS.md` 为统一业务协议依据。当前 `growdesk-server` 的 `packages/contracts/src` 仅包含健康检查类型，正式业务 OpenAPI 3.0.3 规范待 SH-01 实现。
- **PostgreSQL Migration 状态**：目标数据库当前仅有一条初始迁移 `202609120001_identity`（建 User, Family, Baby, BabyMember, FamilyMember 及 legacy_import 私有表）。正式照护模型迁移由 SH-02 负责。
- **SQLite Migration 状态**：旧 Web 的 6 个迁移历史仅作为数据结构参考，禁止跨 provider 重放。

---

## 4. 交付物与改动文件清单

本轮全部改动位于 `/Users/wangzhuo/Documents/GitHub/baby_panel_for_cecilia`，共 5 个文件：

1. `evidence/tasks/SH-00/REPORT.md` (本执行报告)
2. `docs/compat/web-call-inventory.csv` (全量 128 个端点调用清单)
3. `docs/compat/web-api-mapping.md` (兼容字段/状态码/日期/小数/版本映射规格初稿)
4. `docs/compat/production-writers.md` (40 项非路由写入口全景清单与可达性审计)
5. `docs/compat/capability-status.md` (三仓库能力就绪与占位脚本核查矩阵)

---

## 5. 执行命令、退出码与隔离验证证据

| 执行命令 | 退出码 | 验证结果与说明 |
|---|---|---|
| `git status` / `git rev-parse HEAD` | 0 | 确认三仓库分支、HEAD 与 dirty 文件状态。 |
| `python3 scratch/analyze_routes.py` | 0 | 成功解析 73 个 route 文件，确认 128 个端点。 |
| `python3 scratch/generate_csv.py` | 0 | 成功生成 128 行 `web-call-inventory.csv`。 |
| `python3 -c "import csv; ... assert len(rows) == 128"` | 0 | 验证 CSV 每一行数据完整性，无丢失。 |
| `node scripts/not-ready.mjs backend:contracts:generate BE-01` | 1 | 证实服务端契约脚本确为占位桩，退出码非零。 |

**隔离与安全合规证明**：
- 严格遵循 `AGENTS.md` 隔离规范：全程未触碰 `prod.db`，未启动 3088 生产服务；
- 未读取 `.env` 中的任何外部 API Key、数据库密码或部署证书；
- 未在宿主或远程执行任何破坏性写入或部署动作。

---

## 6. 已知缺口与 SH-01 可执行范围

### 6.1 核心缺口
1. **契约生成层**：`growdesk-server` 尚无包含 128 个端点的 TypeBox 定义，`backend:contracts:*` 为占位。
2. **BFF 兼容层**：`baby_panel_for_cecilia` 尚未建立 `lib/growdesk` 客户端与受控 Session Cookie 管理机制。
3. **数据模型层**：`growdesk-server` 尚无照护业务表（Feeding, Sleep, Diaper, Food, Nutrition, Growth, Medical, Vaccine）的 PostgreSQL 模型与迁移。
4. **对象存储层**：附件目前直接落盘到 Web 容器的 `public/uploads` 目录，未对齐 S3 协议。

### 6.2 SH-01 可执行范围建议
- **负责仓库**：`growdesk-server`
- **任务目标**：
  1. 依据本轮 `web-call-inventory.csv` 与 `02_BACKEND_CONTRACTS.md`，在 `packages/contracts/src` 注册所有端点的 TypeBox 请求与响应 schema；
  2. 替换 `scripts/not-ready.mjs`，实现真正的 `backend:contracts:generate` 与 `backend:contracts:check`；
  3. 导出规范的 `contracts/openapi.json` (OpenAPI 3.0.3)，确保 operationId 全局唯一且无 diff；
  4. 补齐脱敏 Golden Fixtures，完成 Swift 客户端解析兼容性冒烟；
  5. 细化并冻结 `docs/compat/web-api-mapping.md` 中的正式字段映射。

---

## 7. 独立 Review 状态

- **当前状态**：`IMPLEMENTED_NOT_REVIEWED`
- **Review 要求**：
  - 由独立 Review Agent 根据 `09_WEB_IOS_SHARED_BACKEND.md` 任务卡及 `02/03/07/08` 约束进行独立核查；
  - 检查 128 个端点覆盖是否完备、非路由写入口是否有遗漏、占位脚本标记是否准确；
  - Review 通过并标记 `ACCEPTED` 后，方可正式领取 SH-01 任务。
