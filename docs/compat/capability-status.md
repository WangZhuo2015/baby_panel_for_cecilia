# 双端共用后端能力状态与就绪矩阵 (R0 修正稿)

> 任务对应：`SH-00 (R0 语义修复)` / 现状事实审计  
> 规范权威：以 `docs/plan/implementation/09_WEB_IOS_SHARED_BACKEND.md` 为核心分工标准。  
> 状态：代码事实基线（Audit Fact），杜绝将脚本占位或文档规划冒充为已实现。

---

## 1. 状态分类与可追溯证据标准

- **已有实现 (IMPLEMENTED)**：代码已编写、存在物理文件并具备实际逻辑。
- **仅骨架 (SKELETON)**：代码仅包含空类/函数声明、生命周期空转或类型桩，无业务执行逻辑。
- **占位脚本 (PLACEHOLDER_SCRIPT)**：`package.json` 中的命令显式指向 `scripts/not-ready.mjs`，执行时**退出码为 2**。
- **缺失 (MISSING)**：尚未创建任何实现文件或端点。
- **已验证 (VERIFIED)**：在当前会话中由命令实际执行并验证通过，附带具体命令与退出码。
- **历史记录 (HISTORICAL)**：引用先前任务的测试日志或部署证据，必须标明来源文件、对应 Commit 与记录日期，不能伪称为本次实时测试。
- **未验证 / 未运行 (NOT_RUN / UNVERIFIED)**：有代码或脚本，但缺少真实环境、隔离环境或本次未执行测试。

---

## 2. 三仓库能力就绪全景总表

### 2.1 现有 Web 仓库 (`baby_panel_for_cecilia`)

| 模块 / 能力领域 | 实现状态 | 验证状态 | 代码事实与可追溯证据 | 改造缺口 (Shared Backend Gaps) |
|---|---|---|---|---|
| **照护业务 (喂养/睡眠/尿布/辅食/补剂)** | `IMPLEMENTED` | `HISTORICAL` | 13 个 Route Handler 活跃运行。引用历史证据：2026-09-04 审查报告及 `tests/api/records.test.ts`、`tests/api/food.test.ts`。本次会话未重跑业务全量测试。 | 目前直连 SQLite `prod.db`；缺少 BFF 转发层；多处隐式兜底第一宝宝。 |
| **发育与健康 (生长测量/疫苗/病历报告)** | `IMPLEMENTED` | `HISTORICAL` | 路由完整，支持 WHO 曲线计算、疫苗选案、病历多图；引用历史测试 `tests/api/medical-vaccines.test.ts`。本次会话未重跑。 | 医疗附件直接写入 `public/uploads` 本地目录，未接入 S3 对象存储；无乐观锁版本。 |
| **AI 协同 (聊天/语音记账/日报/OCR)** | `IMPLEMENTED` | `HISTORICAL` | `/api/ai/chat`、`/api/agent/voice` 正常，支持 fast-path 与工具调用；引用历史测试 `tests/api/agent-voice.test.ts`。本次会话未重跑。 | AI 任务在 Next.js 进程内存中跑，无持久化 TaskOutbox；进程重启易丢任务。 |
| **远程 MCP 协议 (HTTP/SSE)** | `IMPLEMENTED` | `HISTORICAL` | `app/mcp/route.ts` 暴露 5 大工具 (`get_baby_overview`, `record_baby_events`, `record_health_measurement`, `query_parenting_knowledge`, `web_search`)；引用历史测试 `tests/api/mcp-oauth.test.ts`。本次未重跑。 | 直连旧 Prisma 读写 SQLite；尚未委托给统一 GrowDesk 业务 API。 |
| **OAuth 2.1 授权服务器** | `IMPLEMENTED` | `HISTORICAL` | 支持 RFC 7591 / 7636 / 6749，PKCE S256 单次兑换；引用历史测试 `tests/api/mcp-oauth.test.ts`。本次未重跑。 | 授权数据与令牌存储在旧 SQLite `OAuth*` 表中，未迁移到 PostgreSQL。 |
| **Web Push 推送与通知** | `IMPLEMENTED` | `HISTORICAL` | Web Push 订阅、测试与触发完整；引用历史测试 `tests/unit/functional-p1-remaining.test.ts`。本次未重跑。 | 缺乏逐宝宝、逐时段的细粒度通知偏好模型。 |
| **静态知识库与配置** | `IMPLEMENTED` | `HISTORICAL` | 食材库、绘本库、里程碑、天气 API 完整。 | 天气缓存使用内存缓存，多实例无法共享。 |
| **Next.js 同源 BFF 兼容层** | `MISSING` | `NOT_RUN` | 尚无 `lib/growdesk/{client,session,compat}/` 目录。 | 核心缺口：需创建受控 HTTP 客户端、BFF 会话管理、CSRF 防护与字段映射器。 |

---

### 2.2 服务端仓库 (`growdesk-server`)

| 模块 / 能力领域 | 实现状态 | 验证状态 | 代码事实与可追溯证据 | 改造缺口 (Shared Backend Gaps) |
|---|---|---|---|---|
| **工作区与构建体系** | `IMPLEMENTED` | `HISTORICAL` | npm workspace，Node 24 + TS 5.9；引用证据 `evidence/tasks/CLOUD_BOOTSTRAP/typecheck.txt`（2026-09-12）。 | 需集成 OpenAPI 生成流水线。 |
| **基础 HTTP 探针与就绪检查** | `IMPLEMENTED` | `HISTORICAL` | Fastify 5 `/health/live` 与 `/health/ready`（真实 PG18 + Redis8 探针）；引用部署证据 `evidence/tasks/CLOUD_BOOTSTRAP/REPORT.md`，运行于 `ampere.zwang.fun:8443`。 | 业务 API 尚未注册（当前业务请求一律 404）。 |
| **多对多授权策略 (08 规范)** | `IMPLEMENTED` | `HISTORICAL` | 位于 `packages/domain/src/index.ts`（非独立 baby-access.ts 文件）；引用单元测试 `packages/domain/tests/baby-access.test.ts`（13/13 通过，2026-09-11）。 | 尚未结合 PostgreSQL 真实事务和 Repository 落地。 |
| **云同步门禁策略 (07 规范)** | `IMPLEMENTED` | `HISTORICAL` | 位于 `packages/domain/src/cloud-sync-policy.ts`；引用单元测试 `packages/domain/tests/cloud-sync-policy.test.ts`（11/11 通过，2026-09-11）。 | 尚未接入持久化 `DeviceSyncBinding` 表与 Change Feed 游标。 |
| **Worker 进程 (`apps/worker`)** | `SKELETON` | `HISTORICAL` | 仅具备 idle 生命周期、配置加载与 SIGTERM 响应；引用测试 `apps/worker/tests/lifecycle.test.ts`。 | 缺少实际 BullMQ 5 业务队列消费者（AI、OCR、通知）。 |
| **Scheduler 进程 (`apps/scheduler`)** | `SKELETON` | `HISTORICAL` | 仅具备 idle 生命周期与 SIGTERM 响应；引用测试 `apps/scheduler/tests/lifecycle.test.ts`。 | 缺少定时任务（日报生成、归档清理、对账检查）。 |
| **契约导出命令 (`backend:contracts:*`)** | `PLACEHOLDER_SCRIPT` | `VERIFIED` | 物理文件 `scripts/not-ready.mjs:5` 明确设置 `process.exitCode = 2`。**本次实测执行 `node scripts/not-ready.mjs backend:contracts:generate BE-01`，退出码准确为 2**。 | **占位桩**：需在 BE-01 真正集成 TypeBox 导出与 OpenAPI 3.0.3。 |
| **数据库命令 (`backend:db:*`)** | `PLACEHOLDER_SCRIPT` | `VERIFIED` | 物理文件 `scripts/not-ready.mjs:5` 设置 `process.exitCode = 2`。**本次实测执行，退出码准确为 2**。 | **占位桩**：需在 BE-02 真正落地 PostgreSQL 迁移与 Prisma 7 客户端。 |
| **契约库 (`packages/contracts`)** | `SKELETON` | `HISTORICAL` | 物理文件 `packages/contracts/src/index.ts` 仅声明 `HealthLiveResponseSchema` 与 `HealthReadyResponseSchema`。 | 缺失全部业务契约（Auth, Baby, Records, Sync, Task, MCP）。 |
| **历史数据私有归档 (`LEGACY_IMPORT`)** | `IMPLEMENTED` | `HISTORICAL` | 提交 `e00cedc` 在目标 PG 导入 5 用户、1 家庭、1 宝宝及 1311 行历史档案。引用证据 `evidence/tasks/LEGACY_IMPORT/target-verification.json`。 | **非业务表**：档案存在于 `legacy_import` schema，API 无权读取；`businessHistoryReady: false`。导入脚本具非空库拒绝保护，不能直接用于增量同步。 |
| **正式业务 API / 端点** | `MISSING` | `NOT_RUN` | 尚未编写业务 route / service。 | 需在 SH-03、SH-04、SH-05 等任务分领域交付。 |
| **私有 S3 对象存储接入** | `MISSING` | `NOT_RUN` | 尚未编写 S3 适配器与上传/下载凭据生成。 | 需在 SH-06 任务交付。 |

---

### 2.3 原生端仓库 (`growdesk-ios`)

| 模块 / 能力领域 | 实现状态 | 验证状态 | 代码事实与可追溯证据 | 改造缺口 (Shared Backend Gaps) |
|---|---|---|---|---|
| **本地持久库 (Local Vault)** | `IMPLEMENTED` | `HISTORICAL` | 基于 GRDB 的本地资料库，支持本地记录新增、查询、附件存储与备份导出。引用提交 `96aa000`。 | 纯本地运行，与云端服务解耦。 |
| **云端 API 客户端** | `MISSING` | `NOT_RUN` | 尚未生成基于 OpenAPI 快照的 Swift 客户端代码。 | 需在 IOS01 / SH-10 任务从已验收 OpenAPI 生成。 |
| **原生账号与会话管理** | `MISSING` | `NOT_RUN` | 尚未实现登录、Keychain 令牌保存与原子刷新。 | 需在 SH-10 落地。 |
| **双向云同步引擎** | `MISSING` | `NOT_RUN` | 尚未实现 Change Feed 拉取、变更排队、冲突处理与版本升级。 | 需在 SH-09 与 SH-10 协同落地。 |

---

## 3. 脚本占位与伪装防护实测证明

为杜绝将占位桩误报为可用能力，本次会话进行了独立实测，捕获真实输出与退出码：

```bash
$ node scripts/not-ready.mjs backend:contracts:generate BE-01
backend:contracts:generate is not implemented in this baseline; it is owned by BE-01.
$ echo $?
2

$ node scripts/not-ready.mjs backend:db:migrate BE-02
backend:db:migrate is not implemented in this baseline; it is owned by BE-02.
$ echo $?
2
```

- **实测结论**：`growdesk-server` 中的契约生成与数据库迁移命令**退出码为 2**，属于明确的未实现占位桩。必须先完成 `BOOT-02` 剩余项与 `BE-01/BE-02`。
