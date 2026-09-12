# GrowDesk Web / iOS 共用后端长程推进进度表 (PROGRESS)

> 本文件按 `docs/plan/GEMINI_LONG_RUN_HANDOFF.md` 维护，每个小任务完成、异常恢复和上下文交接时持续更新。

---

## 当前状态概览

- **当前批次 / 小任务**：`SH-04F` 已完成 -> 进入 `L3 (SH-04D: 尿布记录链路)`
- **最后更新时间**：2026-09-12 (US/Pacific)
- **总体状态**：`IN_PROGRESS` (SH-00 R0、SH-01、SH-02A、SH-02B、SH-03A、SH-03B、SH-03C、SH-03D、SH-04F 验证完成，自主推进中)

---

## 1. 三仓库基线、最新提交与未提交文件

| 仓库 | 分支 (Branch) | 起始基线 HEAD | 当前最新提交 HEAD | 工作区状态与未提交文件核对 |
|---|---|---|---|---|
| `baby_panel_for_cecilia` | `main` | `4901731` | `2e2235a` | Clean |
| `growdesk-server` | `codex/backend-storage-foundation` | `d9604d5` | `1d4d22e` | **Dirty (严格隔离保留原样)**：<br>- `M deploy/Migration.Dockerfile`<br>- `?? evidence/tasks/LEGACY_IMPORT/host-after.json`<br>- `?? evidence/tasks/LEGACY_IMPORT/remote-migration.txt`<br>- `?? evidence/tasks/LEGACY_IMPORT/target-verification.json`<br>- `?? scripts/legacy-import/ios_backup.py`<br>- `?? scripts/legacy-import/test_ios_backup.py` |
| `growdesk-ios` | `codex/local-storage-policy` | `96aa000` | `96aa000` | **Dirty (严格隔离保留原样)**：<br>- `M BabyPanel.xcodeproj/project.pbxproj`<br>- `?? docs/design-mockups/` |

---

## 2. 契约、迁移与客户端快照版本

- **服务端契约权威**：`growdesk-server/packages/contracts/src`（模块化 TypeBox 契约，覆盖全部 86 路径、122 操作端点）
- **OpenAPI 规范快照**：`growdesk-server/contracts/openapi.json`（OpenAPI 3.0.3，122 operationId 全局唯一，无 diff 校验通过，Swift 6 测试通过）
- **iOS 客户端消费快照**：尚未复制引入（待进入原生端任务后同步并记录 `Contracts/source.json`）
- **PostgreSQL Migration 版本**：`202609120001_identity` + `202609120002_foundation` + `202609120003_care_feeding`（通过真实 PG18 顺序升级与复合外键/约束测试）
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

---

## 4. 正在执行的命令 / 进程归属与清理状态

- 无常驻后台悬挂进程。所有自检脚本均以单次 CLI 方式运行并正常退出（退出码 0）。

---

## 5. 失败与修复、外部阻塞

- **SH-04F 实施期间发现与解决的技术细节**：
  1. 配方奶跨家庭边界校验：宝宝归属家庭，喂养记录关联的配方奶产品必须严格属于同一 `familyId` 且未软删除，否则返回 400 `FORMULA_PRODUCT_NOT_FOUND`；
  2. 幂等重放时日期反序列化鲁棒性：`existingReceipt.responseBody` 作为 JSON 反序列化后，`occurredAt/createdAt/updatedAt` 均为 ISO 字符串，实体映射适配了 Date 或 string 类型；
  3. CHECK 约束与 Decimal 字符串序列化：扩展 CHECK 约束允许 `breast`, `bottle`, `formula`，并通过 Prisma `Decimal` 精确序列化，保证浮点数无精度丢失；
  4. Keyset 游标复合结构：`occurredAt|id` 采用 base64url 编码，支持稳定翻页与无跳页。
- **外部阻塞**：当前无阻塞。

---

## 6. 下一条准确操作

- **目标任务**：**`SH-04D: 尿布记录链路 (Diaper Record Pipeline)`**
- **工作目录 (workdir)**：`/Users/wangzhuo/Documents/GitHub/growdesk-server`
- **操作内容**：
  1. **数据模型与迁移**：核对 `diaper_records` 表及 CHECK 约束 (`diaper_type IN ('wet', 'dirty', 'both', 'dry')`)；
  2. **尿布仓储与领域服务**：实现 `ScopedDiaperRepository` 与 `DiaperService`（基于 UnitOfWork 封装 CRUD，严格校验 BabyMember 照护权限）；
  3. **时间线投影与乐观锁**：原子同步更新 `timelines` 投影，比对 `baseVersion` 乐观锁防冲突；
  4. **HTTP 路由挂载**：挂载 `GET/POST /api/v1/babies/:babyId/records/diaper` 及 `GET/PATCH/DELETE /api/v1/babies/:babyId/records/diaper/:id`，对齐 TypeBox 契约；
  5. **真实 PG18 集成测试**：编写 `tests/integration/diaper.test.ts` 覆盖尿布 CRUD、幂等重放、乐观锁冲突、跨宝宝隔离与时间线原子软删除。

---

## 7. 生产 / 外部操作

- **生产操作**：`未执行`（严格禁止直连 230 生产数据库、禁止改动 nginx 8443 / systemd 3088、禁止切断旧写权威）。
- **数据操作**：`未执行`（未导入新真实数据，测试只使用 `test_*` 租户）。
- **外部账单/推送**：`未执行`（无真实外部 AI 计费或 Web Push 推送）。
