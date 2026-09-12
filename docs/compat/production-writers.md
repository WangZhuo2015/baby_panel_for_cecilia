> 当前是待修正的SH-00初稿，不可直接生成业务代码或宣称已验收。已确认错误及修复门槛见 [Codex复核](../../evidence/tasks/SH-00/REVIEW_CODEX.md)，长程任务R0必须先修正。

# 生产写入口全景清单与可达性审计 (Production Writers Inventory)

> 任务对应：`SH-00` / 迁移安全基线  
> 规范权威：以 `docs/plan/implementation/02_BACKEND_CONTRACTS.md`、`03_DATABASE_MIGRATION.md`、`09_WEB_IOS_SHARED_BACKEND.md` 为准。  
> 状态：代码审计事实与安全规格（Audit Baseline & Reachability Matrix）。

---

## 1. 现状事实与写权威界限

1. **当前旧 Web (`baby_panel_for_cecilia`) 仍是唯一的真实照护业务写权威**：
   - 生产环境通过 systemd 管理的 `baby-panel.service`（端口 3088）直接读写物理权限为 600 的 SQLite 数据库（`file:./prod.db`）。
   - `growdesk-server` 在 2026-09-12 已部署基础容器栈（端口 8443 / 3180），但业务 API 未就绪（仅注册 `/health/live` 与 `/health/ready`，业务路由全为 404），因此新后端目前**完全不具备业务写能力**。
2. **写入口不仅存在于前端页面与标准 HTTP 路由**：
   - Web 路由 (`app/api/**`) 只是显式入口之一；
   - 内部还存在 **AI Agent 工具闭包**、**远程 MCP 服务端**、**Stdio MCP 独立进程**、**OAuth 2.1 凭据引擎**、**后台总结/归档逻辑**以及**运维 Shell 脚本**。
3. **切换硬红线**：
   - 在正式切换到 GrowDesk 共享后端（SH-13）之前，必须排空并封锁所有旧写入通道；**严禁仅隐藏前端按钮**，遗漏 MCP 或后台脚本继续向旧 SQLite 写入导致数据脑裂。

---

## 2. 非路由与间接写入口详细审计

### 2.1 AI Agent 工具闭包 (`lib/agent/tools/**`)
- **写入机制**：通过统一工具分发器 `lib/agent/tools.ts:executeTool()` 调用各领域写方法，直接调用 Prisma SQLite Client 或底层 `lib/records/service.ts`。
- **具体写入口文件**：
  1. `lib/agent/tools/feeding.ts`：
     - 写入表：`FeedingRecord`、`RecordSnapshot`
     - 触发：AI 聊天助手意图识别为“记录喂奶/辅食”时自动或确认后执行。
  2. `lib/agent/tools/food.ts`：
     - 写入表：`FoodLogRecord`、`FamilyFoodStatus`
     - 触发：AI 助手记录宝宝辅食、添加食材尝试状态。
  3. `lib/agent/tools/nutrition.ts`：
     - 写入表：`SupplementRecord`、`RecordSnapshot`
     - 触发：AI 助手记录维生素D/补剂服用。
  4. `lib/agent/tools/diaper.ts`：
     - 写入表：`DiaperRecord`、`RecordSnapshot`
     - 触发：AI 助手快速记录换尿布。
  5. `lib/agent/tools/sleep.ts`：
     - 写入表：`SleepRecord`、`RecordSnapshot`
     - 触发：AI 助手记录入睡/醒来。
  6. `lib/agent/tools/growth.ts`：
     - 写入表：`GrowthMeasurement`
     - 触发：AI 记录身高体重。
  7. `lib/agent/tools/medical.ts`：
     - 写入表：`MedicalReport`
     - 触发：AI 记录就医或疫苗反馈。
  8. `lib/agent/voice-fast-path.ts`：
     - 写入表：`AgentVoiceLog`，并直接调用上述领域工具写入业务记录。
- **生产可达性**：`ACTIVE_IN_PRODUCTION`（用户在 Web 页面使用 AI 助手聊天框、语音助手发指令时直接触发）。

### 2.2 远程 MCP 服务端 (`lib/mcp/server.ts`)
- **写入机制**：使用 `@modelcontextprotocol/sdk` 实现的远程 MCP Server，通过 SSE + POST 挂载于 `app/mcp/route.ts` 与 `app/api/mcp/route.ts`。
- **写入工具**：
  1. `record_event`：写入 `FeedingRecord`、`SleepRecord`、`DiaperRecord`、`RecordSnapshot`。
  2. `manage_nutrition`：写入 `SupplementRecord`、`FormulaProduct`、`SupplementProduct`。
  3. `update_profile`：写入 `Baby`（修改宝宝姓名、生日、性别等）。
  4. `manage_growth`：写入/删除 `GrowthMeasurement`。
  5. `manage_medical`：写入/更新 `MedicalReport`。
  6. **审计日志写入**：每次 MCP 工具调用不论读写，均通过 `logOAuthAudit` 写入 `OAuthAuditLog` 表。
- **生产可达性**：`ACTIVE_IN_PRODUCTION`（外部 AI 助手如 Gemini Spark 或 Claude 通过已授权 OAuth Bearer Token 随时可远程调用）。

### 2.3 Stdio MCP 客户端脚本 (`scripts/mcp-server.mjs`)
- **写入机制**：
  - 采用标准输入输出（Stdio）与本地客户端（如 Claude Desktop 或 Cursor）通讯；
  - 内部**不直连 Prisma/SQLite**，而是通过 `fetch(BASE_URL + pathname)` 调用 Web 路由（`/api/...`）；
  - 支持环境变量 `BABY_PANEL_TOKEN`、`BABY_PANEL_USER_ID`，以及 `MCP_ALLOW_STATIC_USER=1`。
- **生产可达性**：`UNKNOWN_DEPLOYMENT_REACHABLE`（代码位于仓库中，若维护者或家庭成员在本地配置了 Claude Desktop 并连接 3088 生产服务，则随时可能发起写入）。

### 2.4 OAuth 2.1 授权状态机 (`lib/oauth/service.ts`)
- **写入机制**：提供 RFC 6749 / RFC 7636 / RFC 7591 标准支持，维护全套 OAuth 实体。
- **写入表**：
  1. `OAuthClient`：动态客户端注册（`registerClient`）
  2. `OAuthAuthorizationCode`：生成授权码（`createAuthorizationCode`）
  3. `OAuthToken`：发放 Access Token 与 Refresh Token（`createTokenPair`）
  4. `OAuthConsent`：记录用户家庭/宝宝授权范围（`saveConsent`）
  5. `OAuthAuditLog`：审计事件入库（`logOAuthAudit`）
- **生产可达性**：`ACTIVE_IN_PRODUCTION`（接入 Gemini Spark 自定义应用时常态运行）。

### 2.5 后台周期逻辑与衍生写入
1. **AI 日报生成 (`lib/ai-daily-summary.ts`)**：
   - 写入表：`AiDailySummary`、`AiJob`
   - 生产可达性：`CALLABLE_VIA_HTTP`（当前由前端 `/daily-summary` 页面请求或 POST `/api/ai/daily-summary` 触发）。
2. **AI 育儿贴士 (`lib/ai-tips.ts`)**：
   - 写入表：`AiTip`
   - 生产可达性：`CALLABLE_VIA_HTTP`（页面访问 `/api/ai/tips` 时若缓存过期则重新调用 LLM 并写库）。
3. **附件与对话归档 (`lib/archive.ts`)**：
   - 写入表：`AiArchive`，并写入磁盘目录 `data/archive/YYYYMM/`
   - 生产可达性：`ACTIVE_IN_PRODUCTION`（AI 交互与多模态分析时持续沉淀原始 payload）。
4. **Web 推送订阅 (`lib/push-helper.ts`)**：
   - 写入表：`PushSubscription`
   - 生产可达性：`ACTIVE_IN_PRODUCTION`（浏览器开启通知时写入）。
5. **个人访问令牌 PAT (`lib/tokens.ts`)**：
   - 写入表：`PersonalAccessToken`
   - 生产可达性：`CALLABLE_VIA_HTTP`（用户在设置中心生成或吊销 API Key）。

### 2.6 维护与运维脚本 (`scripts/**`)
1. **`scripts/prune-ai-archive.sh`**：
   - **行为**：使用 Python `sqlite3` 直连 `prod.db`，执行 `DELETE FROM AiArchive WHERE id IN (...)`，并删除孤儿磁盘文件。
   - **生产可达性**：`OFFLINE_MAINTENANCE`（脚本注记为“手动运行，不设调度”，但切换前必须确认无自动化 cron 挂载）。
2. **`scripts/switch-db.sh`**：
   - **行为**：直接覆写 `.env` 中的 `DATABASE_URL`，并执行 `sudo systemctl restart baby-panel`。
   - **生产可达性**：`OFFLINE_MAINTENANCE`（管理员手动切换工具）。
3. **`scripts/backup-db.sh`** 与 **`scripts/restore-db.sh`**：
   - **行为**：`backup-db.sh` 通过 SQLite online backup API 读出快照；`restore-db.sh` 覆写当前数据库。
   - **生产可达性**：`OFFLINE_MAINTENANCE`（部署宿主可能挂载了定期备份 crontab）。
4. **`scripts/purge-test-data.ts`**：
   - **行为**：Prisma 级联删除 `test_*` / `e2e_*` 用户及孤儿家庭。
   - **生产可达性**：`OFFLINE_MAINTENANCE`（仅在测试和开发后手动清理）。

---

## 3. 全量写入口与可达性矩阵总表

| 编号 | 写入来源 / 模块 | 物理文件入口 | 操作目标表 (Prisma Models) | 鉴权机制 | 生产可达性状态 | 切换前封锁处置 (SH-13) |
|---|---|---|---|---|---|---|
| **W-01** | Web API: 喂养记录 | `app/api/records/feeding/route.ts` | `FeedingRecord`, `RecordSnapshot` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-02** | Web API: 尿布记录 | `app/api/records/diaper/route.ts` | `DiaperRecord`, `RecordSnapshot` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-03** | Web API: 睡眠记录 | `app/api/records/sleep/route.ts` | `SleepRecord`, `RecordSnapshot` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-04** | Web API: 辅食打卡 | `app/api/food/logs/route.ts` | `FoodLogRecord` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-05** | Web API: 食材管理 | `app/api/food/items/route.ts` | `FoodItem`, `FamilyFoodStatus` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-06** | Web API: 辅食计划 | `app/api/food/plans/route.ts` | `FoodPlan` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-07** | Web API: 补剂产品 | `app/api/nutrition/products/route.ts`| `FormulaProduct`, `SupplementProduct`| Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-08** | Web API: 补剂记录 | `app/api/nutrition/records/route.ts` | `SupplementRecord` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-09** | Web API: 补剂计划 | `app/api/nutrition/schedules/route.ts`| `SupplementSchedule` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-10** | Web API: 生长测量 | `app/api/growth/route.ts` | `GrowthMeasurement` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-11** | Web API: 医疗报告 | `app/api/medical/reports/route.ts` | `MedicalReport` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-12** | Web API: 报告编辑 | `app/api/medical/reports/[id]/...` | `MedicalReport` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-13** | Web API: 医疗附件上传 | `app/api/medical/upload/route.ts` | 磁盘文件 (`public/uploads`) | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 停写，迁移至 S3 协议 |
| **W-14** | Web API: 宝宝头像 | `app/api/baby/avatar/route.ts` | `Baby`, 磁盘文件 | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 停写，迁移至 S3 协议 |
| **W-15** | Web API: 宝宝资料 | `app/api/baby/route.ts` | `Baby` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-16** | Web API: 绘本状态 | `app/api/books/[id]/route.ts` | `FamilyBookStatus` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-17** | Web API: 疫苗记录 | `app/api/vaccines/route.ts` | `VaccineRecord` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-18** | Web API: 疫苗选案 | `app/api/vaccines/selections/route.ts`| `VaccineSelection` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，BFF 转发新 API |
| **W-19** | Web API: AI 会话 | `app/api/ai/sessions/route.ts` | `AiChatSession` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 停写，由新 Task 接管 |
| **W-20** | Web API: AI 消息 | `app/api/ai/chat/route.ts` | `AiChatMessage`, `AiChatSession` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 停写，由新 Task 接管 |
| **W-21** | Web API: 异步任务 | `app/api/ai/jobs/route.ts` | `AiJob` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 停写，由新 Task 接管 |
| **W-22** | Web API: 语音记账 | `app/api/agent/voice/route.ts` | `AgentVoiceLog` + 业务记录 | PAT 或 Cookie Session | `ACTIVE_IN_PRODUCTION` | 切只读，转新 Voice Run |
| **W-23** | Web API: 语音日志确认 | `app/api/agent/voice/logs/[id]/...` | `AgentVoiceLog` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 切只读，转新 API |
| **W-24** | Web API: 推送订阅 | `app/api/push/subscribe/route.ts` | `PushSubscription` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 停写，切换新通知偏好 |
| **W-25** | Web API: PAT 令牌 | `app/api/user/tokens/route.ts` | `PersonalAccessToken` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 停写，切换新 PAT 协议 |
| **W-26** | Web API: 账号注册 | `app/api/auth/register/route.ts` | `User`, `Family`, `FamilyMember` | Turnstile + 公开 | `ACTIVE_IN_PRODUCTION` | 封锁注册，切换新认证 |
| **W-27** | Web API: 家庭加入 | `app/api/family/join/route.ts` | `FamilyMember` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 封锁加入，切换新邀请码 |
| **W-28** | AI 工具: 喂养写入 | `lib/agent/tools/feeding.ts` | `FeedingRecord`, `RecordSnapshot` | 内部 Agent Principal 上下文 | `ACTIVE_IN_PRODUCTION` | 废除直写，改调新 API |
| **W-29** | AI 工具: 辅食写入 | `lib/agent/tools/food.ts` | `FoodLogRecord`, `FamilyFoodStatus` | 内部 Agent Principal 上下文 | `ACTIVE_IN_PRODUCTION` | 废除直写，改调新 API |
| **W-30** | AI 工具: 营养写入 | `lib/agent/tools/nutrition.ts` | `SupplementRecord`, `RecordSnapshot` | 内部 Agent Principal 上下文 | `ACTIVE_IN_PRODUCTION` | 废除直写，改调新 API |
| **W-31** | AI 工具: 语音快速路 | `lib/agent/voice-fast-path.ts` | `AgentVoiceLog` + 业务记录 | Principal 上下文 | `ACTIVE_IN_PRODUCTION` | 废除直写，改调新 API |
| **W-32** | 远程 MCP: 5 大工具 | `lib/mcp/server.ts` | 全部业务核心表 + `OAuthAuditLog` | OAuth Bearer Token (Scoped) | `ACTIVE_IN_PRODUCTION` | 冻结写工具，改调新 API |
| **W-33** | Stdio MCP 客户端 | `scripts/mcp-server.mjs` | 通过 HTTP 间接写上述业务表 | Stdio 静态 Token / Session | `UNKNOWN_DEPLOYMENT_REACHABLE` | 确认宿主/客户端无存活实例 |
| **W-34** | OAuth: 客户端注册 | `app/api/oauth/register/route.ts` | `OAuthClient` | 公开动态注册 | `ACTIVE_IN_PRODUCTION` | 封锁注册端点 |
| **W-35** | OAuth: 授权码发放 | `app/api/oauth/authorize/route.ts` | `OAuthAuthorizationCode`, `Consent` | Cookie Session (`getAuthUser`) | `ACTIVE_IN_PRODUCTION` | 封锁授权，强制重登 |
| **W-36** | OAuth: Token 兑换 | `app/api/oauth/token/route.ts` | `OAuthToken` | PKCE S256 + Client Auth | `ACTIVE_IN_PRODUCTION` | 封锁兑换，废除旧 Token |
| **W-37** | 归档: 对话与多模态 | `lib/archive.ts` | `AiArchive`, 磁盘文件 | 内部上下文 | `ACTIVE_IN_PRODUCTION` | 冻结写入，启动 ETL 对账 |
| **W-38** | 维护: 归档数据清理 | `scripts/prune-ai-archive.sh` | SQLite CLI 直删 `AiArchive` | 宿主本地 root/用户权限 | `OFFLINE_MAINTENANCE` | 检查并禁用相关 crontab |
| **W-39** | 维护: 数据库切换 | `scripts/switch-db.sh` | 修改 `.env` + 重启 systemd | 宿主 sudo 权限 | `OFFLINE_MAINTENANCE` | 禁止在切换期间调用 |
| **W-40** | 维护: 测试数据清理 | `scripts/purge-test-data.ts` | Prisma 直删 `User`, `Family` | 本地执行 | `OFFLINE_MAINTENANCE` | 仅开发/测试期运行 |

---

## 4. 切换停写栅栏：修正后的要求

1. 按真实调用链列出所有写者，包括有副作用的GET、OAuth审计、HTTP/stdio MCP、AI确认、worker、scheduler、归档及维护脚本；静态可达与线上启用分别核对。
2. 在已授权的正式切换窗口阻止新业务写和新任务；在途任务完成、可恢复地暂停或标记结果待对账，不无条件强杀。记录每个writer停写状态和freeze marker。
3. 证明marker后源无新写，再用SQLite backup API拍最终一致快照并核对附件。WAL checkpoint不是冻结机制，也不是导入只读快照的前提。
4. 比对源/目标ID集合、规范化内容hash、删除集合、全部归属/软引用、权限基线和附件hash；不能仅比行数/最大时间戳。
5. 目标有基线后真实写入时先出冲突计划，禁止覆盖。新PG接受真实写后不能直接切回旧SQLite；按09执行同PG应用回滚或已演练的反向迁移。

这些是未来切换门槛，本轮不执行生产操作。
