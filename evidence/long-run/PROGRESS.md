# GrowDesk Web / iOS 共用后端长程推进进度表 (PROGRESS)

> 本文件按 `docs/plan/GEMINI_LONG_RUN_HANDOFF.md` 维护，每个小任务完成、异常恢复和上下文交接时持续更新。

---

## 当前状态概览

- **当前批次 / 小任务**：`SH-05` 已完成 -> 进入 `L3 (SH-06: S3 附件与预签名直传链路)`
- **最后更新时间**：2026-09-12 (US/Pacific)
- **总体状态**：`IN_PROGRESS` (SH-00 R0、SH-01、SH-02A、SH-02B、SH-03A、SH-03B、SH-03C、SH-03D、SH-04F、SH-04D、SH-04S、SH-04FO、SH-04SU、SH-04G、SH-04TL、SH-05 验证完成，自主推进中)

---

## 1. 三仓库基线、最新提交与未提交文件

| 仓库 | 分支 (Branch) | 起始基线 HEAD | 当前最新提交 HEAD | 工作区状态与未提交文件核对 |
|---|---|---|---|---|
| `baby_panel_for_cecilia` | `main` | `4901731` | `dd2f125` | Clean |
| `growdesk-server` | `codex/backend-storage-foundation` | `d9604d5` | `a62f36c` | **Dirty (严格隔离保留原样)**：<br>- `M deploy/Migration.Dockerfile`<br>- `?? evidence/tasks/LEGACY_IMPORT/host-after.json`<br>- `?? evidence/tasks/LEGACY_IMPORT/remote-migration.txt`<br>- `?? evidence/tasks/LEGACY_IMPORT/target-verification.json`<br>- `?? scripts/legacy-import/ios_backup.py`<br>- `?? scripts/legacy-import/test_ios_backup.py` |
| `growdesk-ios` | `codex/local-storage-policy` | `96aa000` | `96aa000` | **Dirty (严格隔离保留原样)**：<br>- `M BabyPanel.xcodeproj/project.pbxproj`<br>- `?? docs/design-mockups/` |

---

## 2. 契约、迁移与客户端快照版本

- **服务端契约权威**：`growdesk-server/packages/contracts/src`（模块化 TypeBox 契约，覆盖全部 86 路径、122 操作端点）
- **OpenAPI 规范快照**：`growdesk-server/contracts/openapi.json`（OpenAPI 3.0.3，122 operationId 全局唯一，无 diff 校验通过，Swift 6 测试通过）
- **iOS 客户端消费快照**：尚未复制引入（待进入原生端任务后同步并记录 `Contracts/source.json`）
- **PostgreSQL Migration 版本**：`202609120001_identity` + `202609120002_foundation` + `202609120003_care_feeding` + `202609120004_care_diaper` + `202609120005_care_sleep` + `202609120006_care_food` + `202609120007_care_supplement` + `202609120008_care_growth`（通过真实 PG18 顺序升级与复合外键/约束测试）
- **SQLite 数据源状态**：`file:./prod.db`，维持只读参考与旧 Web 生产写权威，严格未触碰

---

## 3. 已验证任务及报告链接

1. **`SH-00 (R0 语义修复)`**：
   - 执行报告：[`evidence/tasks/SH-00/REPORT.md`](../tasks/SH-00/REPORT.md)
   - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING` (依据 `REVIEW_CODEX.md` 修复所有语义错误并通过 `check-sh00-inventory.py` 与 `validate-sh00-semantics.py`)
   - 历史复核：[`evidence/tasks/SH-00/REVIEW_CODEX.md`](../tasks/SH-00/REVIEW_CODEX.md) (CHANGES_REQUESTED，已据此逐条完成 R0 修复)
2. **`SH-01 (契约和 Web 兼容矩阵)`**：
   - 执行报告：`../growdesk-server/evidence/tasks/SH-01/REPORT.md`
   - 交付提交：`growdesk-server: 2226345`
   - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（TypeBox 契约全量实现、OpenAPI 3.0.3 生成与零 diff 校验、81/81 单元测试通过、Swift 6 契约客户端编译测试通过）
3. **`SH-02A (数据模型与迁移)`**：
   - 执行报告：`../growdesk-server/evidence/tasks/SH-02A/REPORT.md`
   - 交付提交：`growdesk-server: 2cd4efb`
   - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（补齐会话、凭据、增量 Feed、任务执行、时间线、首个照护模型 FeedingRecord，Prisma Client 生成与架构无 any 检查通过，PG18 复合外键/约束/级联删除保护/索引执行计划通过）
4. **`SH-02B (UnitOfWork 与事务底座)`**：
   - 执行报告：`../growdesk-server/evidence/tasks/SH-02B/REPORT.md`
   - 交付提交：`growdesk-server: ae97fcc`
   - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现标准 8 步 UnitOfWork、FamilySyncState 行锁与递增、带锁权限校验、baseVersion 乐观锁、时间线原子投影、幂等收据与重放，17 项真实 PG18 集成测试全量通过）
5. **`SH-03A (登录与设备会话)`**：
   - 执行报告：`../growdesk-server/evidence/tasks/SH-03A/REPORT.md`
   - 交付提交：`growdesk-server: 923e1eb`
   - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现注册、登录、登出、会话列表、显式会话撤销、当前用户接口，密码 bcrypt 验证与透明升级至 cost 12，JWT 签发与动态 UserPrincipal 重验，84 项单元测试与 27 项 PG18 集成测试全量通过）
6. **`SH-03B (刷新令牌轮换与重放检测)`**：
   - 执行报告：`../growdesk-server/evidence/tasks/SH-03B/REPORT.md`
   - 交付提交：`growdesk-server: ab1c6fe`
   - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现全局锁序原子刷新 `UserSyncState -> DeviceSession -> RefreshCredential`、60 秒同 rotationId 重发容错、不同 rotationId 重用 409 熔断与会话级联吊销，32 项真实 PG18 集成测试全量通过）
7. **`SH-03C (家庭与宝宝逐级授权)`**：
   - 执行报告：`../growdesk-server/evidence/tasks/SH-03C/REPORT.md`
   - 交付提交：`growdesk-server: 2a9791d`
   - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现 12 个 Family 端点与 5 个 Baby 端点，双重最后管理员保护 `LAST_FAMILY_ADMIN_PROTECTION` 与 `LAST_BABY_ADMIN_PROTECTION`，严格跨租户隔离与无 BabyMember 默认 Fail Closed，84 项单元测试与 45 项 PG18 集成测试全量通过）
8. **`SH-03D (密码修改与恢复码)`**：
   - 执行报告：`../growdesk-server/evidence/tasks/SH-03D/REPORT.md`
   - 交付提交：`growdesk-server: ba462a9`
   - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现密码修改、单次恢复码生成与重置、使用恢复码重置密码并全量吊销历史会话；严格全局锁序 UserSyncState -> RecoveryCode；84 项单元测试与 59 项 PG18 集成测试全量通过）
9. **`SH-04F (喂养记录链路与配方奶产品库)`**：
   - 执行报告：`../growdesk-server/evidence/tasks/SH-04F/REPORT.md`
   - 交付提交：`growdesk-server: 1d4d22e`
   - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现配方奶产品多租户产品库 4 个端点、喂养记录 CRUD 5 个端点；严格 BabyMember 权限与跨家庭配方奶校验；UoW 事务原子投影 TimelineEntry、Idempotency 重放与冲突熔断、baseVersion 乐观锁、Keyset 游标分页；84 项单元测试与 72 项 PG18 集成测试全量通过）
10. **`SH-04D (尿布记录链路)`**：
    - 执行报告：`../growdesk-server/evidence/tasks/SH-04D/REPORT.md`
    - 交付提交：`growdesk-server: ffbbb2e`
    - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现尿布记录 CRUD 5 个端点；严格 BabyMember 逐宝宝权限与家庭边界校验；UoW 事务原子投影 TimelineEntry、Idempotency 重放与冲突熔断、baseVersion 乐观锁、Keyset 游标分页；84 项单元测试与 83 项 PG18 集成测试全量通过）
11. **`SH-04S (睡眠记录链路)`**：
    - 执行报告：`../growdesk-server/evidence/tasks/SH-04S/REPORT.md`
    - 交付提交：`growdesk-server: 4d74f31`
    - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现睡眠记录 CRUD 5 个端点；数据库级部分唯一索引严格保证单个宝宝同时仅存在一条进行中睡眠；支持跨午夜有效区间与 `endedAt < startedAt` 拦截；UoW 事务原子投影 TimelineEntry、并发 PATCH baseVersion 乐观锁互斥、Keyset 游标分页；84 项单元测试与 96 项 PG18 集成测试全量通过）
12. **`SH-04FO (辅食记录链路与食材库)`**：
    - 执行报告：`../growdesk-server/evidence/tasks/SH-04FO/REPORT.md`
    - 交付提交：`growdesk-server: cd87d32`
    - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现辅食记录 CRUD 5 个端点、食材库与自定义食材 2 个端点、临床辅食指南 1 个端点、宝宝辅食计划 2 个端点；多租户与 BabyMember 严格隔离；UoW 事务原子投影 TimelineEntry、Idempotency 重放、baseVersion 乐观锁；84 项单元测试与 109 项 PG18 集成测试全量通过）
13. **`SH-04SU (补剂记录链路)`**：
    - 执行报告：`../growdesk-server/evidence/tasks/SH-04SU/REPORT.md`
    - 交付提交：`growdesk-server: aa885bc`
    - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现补剂记录 CRUD 5 个端点；多租户与 BabyMember 严格逐宝宝隔离；UoW 事务原子投影 TimelineEntry、Idempotency 重放与 409 防冲突、baseVersion 乐观锁、Keyset 游标分页；84 项单元测试与 118 项 PG18 集成测试全量通过）
14. **`SH-04G (成长记录链路与 WHO 百分位引擎)`**：
    - 执行报告：`../growdesk-server/evidence/tasks/SH-04G/REPORT.md`
    - 交付提交：`growdesk-server: 0eb87ca`
    - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现成长测量数据 CRUD 5 个端点与 WHO 生长曲线图表端点；收录 WHO 0-36 月龄男女童体重/身长/头围标准数据集与百分位插值计算引擎；UoW 事务原子投影 TimelineEntry、Idempotency 重放、baseVersion 乐观锁、Keyset 游标分页；84 项单元测试与 128 项 PG18 集成测试全量通过）
15. **`SH-04TL (统一时间线检索与聚合查询)`**：
    - 执行报告：`../growdesk-server/evidence/tasks/SH-04TL/REPORT.md`
    - 交付提交：`growdesk-server: 707f5fd`
    - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现统一时间线聚合仓储 ScopedTimelineRepository、Keyset 复合游标编解码、GET /api/v1/babies/:babyId/timeline 端点；UoW 跨 6 大护理领域原子投影、软删除联动、逐宝宝 BabyMember 权限隔离；84 项单元测试与 134 项 PG18 集成测试全量通过）
16. **`SH-05 (Web BFF 和第一条联调链路)`**：
    - 执行报告：`../growdesk-server/evidence/tasks/SH-05/REPORT.md`
    - 交付提交：`growdesk-server: a62f36c`, `baby_panel_for_cecilia: 8cfafc1`
    - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING`（实现 GrowDesk BffSession 模型、migration 0009、FOR UPDATE 单飞刷新与凭据续期、安全 Cookie `__Host-growdesk_web` 下发与清洗、CSRF 严格校验、Feeding 路由双模切换与零降级、140 项真实 PG18 测试与 135 项 Web 单元测试全量通过）

---

## 4. 正在执行的命令 / 进程归属与清理状态

- 无常驻后台悬挂进程。所有自检脚本均以单次 CLI 方式运行并正常退出（退出码 0）。

---

## 5. 失败与修复、外部阻塞

- **SH-05 实施期间发现与解决的技术细节**：
  1. 会话状态与行级排他锁：在 GrowDesk 端使用 `SELECT ... FOR UPDATE` 加锁 `bff_sessions`，杜绝多标签页或跨 BFF worker 实例并发发起 refresh 产生令牌竞争冲突；
  2. 凭证防泄漏：浏览器端仅持有 256 位随机凭证，数据库端仅存 SHA-256 哈希摘要，绝不在 Cookie 或前端存储原始 Access/Refresh Token；
  3. DTO 转换一致性：`amountMl` 严格使用 Decimal 字符串格式化与还原，`baseVersion` 保持为数字并发版本号，杜绝 NaN 或精度损失；
  4. CSRF 与环境兼容：在非 GET 请求时严格校验 Origin/Referer，针对单测环境支持按需开启测试拦截。
- **外部阻塞**：当前无阻塞。

---

## 6. 下一条准确操作

- **目标任务**：**`SH-06 / SH-04A: S3 附件与预签名直传链路 (Attachments Pipeline)`**
- **工作目录 (workdir)**：`/Users/wangzhuo/Documents/GitHub/growdesk-server`
- **操作内容**：
  1. **S3 附件模型与契约 (`Attachment` 模型与路由)**：
     - 数据模型：`attachments` 表（`id`, `family_id`, `baby_id`, `uploader_id`, `s3_key`, `content_type`, `file_size_bytes`, `sha256`, `status`, `deleted_at`, `created_at`）；
     - 路由端点：`POST /api/v1/babies/:babyId/attachments/presigned-upload` 与 `GET /api/v1/babies/:babyId/attachments/:attachmentId/presigned-download`；
  2. **直传与元数据校验**：
     - 预签名 PUT URL 限制内容类型、文件大小与过期时间（15 分钟）；
     - 确认上传回调端点 `POST /api/v1/babies/:babyId/attachments/:attachmentId/confirm`；
  3. **权限与隔离**：
     - 严格关联 BabyMember 鉴权，杜绝跨租户直传或凭证泄露；
  4. **集成测试**：
     - 编写 `tests/integration/attachments.test.ts`，验证 S3 客户端 Mock/MinIO 交互与业务流。

---

## 7. 生产 / 外部操作

- **生产操作**：`未执行`（严格禁止直连 230 生产数据库、禁止改动 nginx 8443 / systemd 3088、禁止切断旧写权威）。
- **数据操作**：`未执行`（未导入新真实数据，测试只使用 `test_*` 租户）。
- **外部账单/推送**：`未执行`（无真实外部 AI 计费或 Web Push 推送）。
