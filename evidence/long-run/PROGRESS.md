# GrowDesk Web / iOS 共用后端长程推进进度表 (PROGRESS)

> 本文件按 `docs/plan/GEMINI_LONG_RUN_HANDOFF.md` 维护，每个小任务完成、异常恢复和上下文交接时持续更新。

---

## 当前状态概览

- **当前批次 / 小任务**：`R0` 完成 -> 进入 `L1 (SH-01: 契约与 Web 兼容矩阵)`
- **最后更新时间**：2026-09-12 (US/Pacific)
- **总体状态**：`IN_PROGRESS` (R0 修复通过，自动推进中)

---

## 1. 三仓库基线、最新提交与未提交文件

| 仓库 | 分支 (Branch) | 起始基线 HEAD | 当前最新提交 HEAD | 工作区状态与未提交文件核对 |
|---|---|---|---|---|
| `baby_panel_for_cecilia` | `main` | `4901731` | *待 R0 提交* | R0 语义修复文件已就绪，准备提交 `docs(compat): correct SH-00 semantic inventory and evidence` |
| `growdesk-server` | `codex/backend-storage-foundation` | `d9604d5` | `d9604d5` | **Dirty (保留原样)**：<br>- `M deploy/Migration.Dockerfile`<br>- `?? evidence/tasks/LEGACY_IMPORT/host-after.json`<br>- `?? evidence/tasks/LEGACY_IMPORT/remote-migration.txt`<br>- `?? evidence/tasks/LEGACY_IMPORT/target-verification.json`<br>- `?? scripts/legacy-import/ios_backup.py`<br>- `?? scripts/legacy-import/test_ios_backup.py` |
| `growdesk-ios` | `codex/local-storage-policy` | `96aa000` | `96aa000` | **Dirty (保留原样)**：<br>- `M BabyPanel.xcodeproj/project.pbxproj`<br>- `?? docs/design-mockups/` |

---

## 2. 契约、迁移与客户端快照版本

- **服务端契约权威**：`growdesk-server/packages/contracts/src`（目前仅包含基础健康探针，SH-01 将注册全部 128 端点）
- **OpenAPI 规范快照**：尚未生成（待 SH-01 生成 `contracts/openapi.json`）
- **iOS 客户端消费快照**：尚未引入（待 IOS01 / SH-10 固定快照与 `source.json`）
- **PostgreSQL Migration 版本**：`202609120001_identity`（目标 PG 仅应用初始身份与私有归档 schema，待 SH-02 推进正式业务表）
- **SQLite 数据源状态**：`file:./prod.db`，维持只读参考与生产写权威，未动

---

## 3. 已验证任务及报告链接

1. **`SH-00 (R0 语义修复)`**：
   - 执行报告：[`evidence/tasks/SH-00/REPORT.md`](../tasks/SH-00/REPORT.md)
   - 状态：`IMPLEMENTED_VERIFIED_REVIEW_PENDING` (依据 `REVIEW_CODEX.md` 修复所有语义错误并通过 `check-sh00-inventory.py` 与 `validate-sh00-semantics.py`)
   - 历史复核：[`evidence/tasks/SH-00/REVIEW_CODEX.md`](../tasks/SH-00/REVIEW_CODEX.md) (CHANGES_REQUESTED，已据此逐条完成 R0 修复)

---

## 4. 正在执行的命令 / 进程归属与清理状态

- 无常驻后台悬挂进程。所有自检脚本均以单次 CLI 方式运行并正常退出（退出码 0）。

---

## 5. 失败与修复、外部阻塞

- **历史失败与修正**：原 SH-00 交付物存在喂养/睡眠字段虚构、MCP 鉴权标注错误、非路由写者包含不存在的表与工具、占位退出码与源码路径不准确等实质错误。已在 R0 中基于实际源码与 Prisma schema 全量重构并交付两套可复现校验脚本。
- **外部阻塞**：当前无阻塞。基础环境与只读参考就绪，可直接执行 L1 (SH-01)。

---

## 6. 下一条准确操作

- **目标任务**：**`SH-01：契约和 Web 兼容矩阵`**
- **工作目录 (workdir)**：`/Users/wangzhuo/Documents/GitHub/growdesk-server`
- **操作内容**：
  1. 读取 `growdesk-server/AGENTS.md` 与既有未提交文件差异；
  2. 在 `packages/contracts/src` 基于已修正的 `web-call-inventory.csv` 与 `02_BACKEND_CONTRACTS.md` 建立真正的 TypeBox 请求/响应 schema；
  3. 替换 `scripts/not-ready.mjs` 中的 `backend:contracts:generate` 与 `backend:contracts:check`；
  4. 导出 `contracts/openapi.json` 并通过无 diff 静态校验；
  5. 交付 `evidence/tasks/SH-01/REPORT.md` 并单独提交。

---

## 7. 生产 / 外部操作

- **生产操作**：`未执行`（严格禁止直连 230 生产数据库、禁止改动 nginx 8443 / systemd 3088、禁止切断旧写权威）。
- **数据操作**：`未执行`（未导入新真实数据，测试只使用 `test_*` 租户）。
- **外部账单/推送**：`未执行`（无真实外部 AI 计费或 Web Push 推送）。
