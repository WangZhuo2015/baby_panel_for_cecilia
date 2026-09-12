# GrowDesk Web / iOS 共用后端长程推进进度表 (PROGRESS)

> 本文件按 `docs/plan/GEMINI_LONG_RUN_HANDOFF.md` 维护，每个小任务完成、异常恢复和上下文交接时持续更新。

---

## 当前状态概览

- **当前批次 / 小任务**：`SH-02B` 已完成 -> 进入 `L2 (SH-03: 账号、会话与宝宝授权)`
- **最后更新时间**：2026-09-12 (US/Pacific)
- **总体状态**：`IN_PROGRESS` (SH-00 R0、SH-01、SH-02A、SH-02B 验证完成，自主推进中)

---

## 1. 三仓库基线、最新提交与未提交文件

| 仓库 | 分支 (Branch) | 起始基线 HEAD | 当前最新提交 HEAD | 工作区状态与未提交文件核对 |
|---|---|---|---|---|
| `baby_panel_for_cecilia` | `main` | `4901731` | `3603dc6` | Clean |
| `growdesk-server` | `codex/backend-storage-foundation` | `d9604d5` | `ae97fcc` | **Dirty (严格隔离保留原样)**：<br>- `M deploy/Migration.Dockerfile`<br>- `?? evidence/tasks/LEGACY_IMPORT/host-after.json`<br>- `?? evidence/tasks/LEGACY_IMPORT/remote-migration.txt`<br>- `?? evidence/tasks/LEGACY_IMPORT/target-verification.json`<br>- `?? scripts/legacy-import/ios_backup.py`<br>- `?? scripts/legacy-import/test_ios_backup.py` |
| `growdesk-ios` | `codex/local-storage-policy` | `96aa000` | `96aa000` | **Dirty (严格隔离保留原样)**：<br>- `M BabyPanel.xcodeproj/project.pbxproj`<br>- `?? docs/design-mockups/` |

---

## 2. 契约、迁移与客户端快照版本

- **服务端契约权威**：`growdesk-server/packages/contracts/src`（模块化 TypeBox 契约，覆盖全部 84 路径、119 操作端点）
- **OpenAPI 规范快照**：`growdesk-server/contracts/openapi.json`（OpenAPI 3.0.3，119 operationId 全局唯一，无 diff 校验通过，Swift 6 测试通过）
- **iOS 客户端消费快照**：尚未复制引入（待进入原生端任务后同步并记录 `Contracts/source.json`）
- **PostgreSQL Migration 版本**：`202609120001_identity` + `202609120002_foundation`（通过真实 PG18 顺序升级与复合外键/约束测试）
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

---

## 4. 正在执行的命令 / 进程归属与清理状态

- 无常驻后台悬挂进程。所有自检脚本均以单次 CLI 方式运行并正常退出（退出码 0）。

---

## 5. 失败与修复、外部阻塞

- **SH-02B 实施期间发现与解决的技术细节**：
  1. PostgreSQL `CHAR(64)` 对不足 64 字节哈希补齐空格，代码中增加 `.trim()` 并规范测试 payload 为 64 字符十六进制串；
  2. Prisma 命名复合键时使用声明的名称（如 `uq_babies_family_id_id`），查询时需使用精确键名；
  3. `tests/integration/unit-of-work.test.ts` 中针对 baby-level viewer 拒绝写测试，需将测试账号在家庭内设为 member、宝宝设为 viewer，精确触发 `BABY_WRITE_DENIED` 403 异常。
- **外部阻塞**：当前无阻塞。

---

## 6. 下一条准确操作

- **目标任务**：**`SH-03: 账号、会话与宝宝授权 (Auth, Session & BabyMember Authorization)`**
- **工作目录 (workdir)**：`/Users/wangzhuo/Documents/GitHub/growdesk-server`
- **操作内容**：
  1. **SH-03A 登录与设备会话**：实现 Fastify 认证插件、Bearer JWT (`aud: .../mcp`) 校验、密码 bcrypt 校验与透明升级、设备会话绑定；
  2. **SH-03B 刷新令牌轮换与撤销**：实现原子单次使用 Refresh Token 轮换、重放检测及级联撤销；
  3. **SH-03C 家庭与宝宝逐级授权**：实现 BabyMember 邀请接受、主动退出与“最后活跃管理员保护”防死锁校验；
  4. **SH-03D 密码修改与恢复码**：实现 10 组 128-bit 恢复码批量安全生成与灾难恢复；
  5. 编写针对真实 PG18 与 Redis 的集成测试套件。

---

## 7. 生产 / 外部操作

- **生产操作**：`未执行`（严格禁止直连 230 生产数据库、禁止改动 nginx 8443 / systemd 3088、禁止切断旧写权威）。
- **数据操作**：`未执行`（未导入新真实数据，测试只使用 `test_*` 租户）。
- **外部账单/推送**：`未执行`（无真实外部 AI 计费或 Web Push 推送）。
