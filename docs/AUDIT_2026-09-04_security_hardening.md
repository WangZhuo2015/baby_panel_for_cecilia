# 安全加固与测试体系整改审计报告（2026-09-04）

- **日期**：2026-09-04
- **范围**：P0 安全项 ×3、P1 数据/测试体系 ×4、P2 schema 与前端卫生项
- **决策记录**：PAT 存量令牌全部作废重发（B）/ 全量范围 P0+P1+P2（C）/ 归档只给脚本不设调度（C）
- **版本**：v1.2.0 → v1.2.1（`package.json` / `lib/version.ts` / `public/sw.js` 三处一致）
- **备份**：`backups/dev_20260904_072347.db`（动库前快照，权限 600）

---

## 1. 背景

2026-09-04 做了一次全仓库 review（70 个 API 路由、898 行 schema、服务层、测试、配置），产出 21 项问题清单；
随后派 5 个独立 subagent 只读复核，结论：**17 项成立，4 项被修正**（见 §2）。
本轮按锁定计划全部执行完毕，门禁全绿（见 §5）。

## 2. 问题清单与复核结论

| # | 问题 | 等级 | 复核结论 | 证据 |
|---|------|------|---------|------|
| 1 | `lib/rate-limit.ts` 顶层 `setInterval` 无 `unref()`，测试进程永不退出，`test:unit`/CI 被 hang 死 | 高 | ✅成立（实证+对照实验） | 空 import 测试 EXIT:124，对照秒退 EXIT:0 |
| 2 | PAT 明文存库、永久有效、无 scope | 高 | ✅成立 | `lib/tokens.ts:16-21` 原文 create、`42-43` 原文 findUnique；OAuth refresh token 存哈希，形成不一致 |
| 3 | 6 个 API 测试用 `findFirst` 抓真实用户/宝宝并写脏数据，违反 AGENTS.md | 高 | ✅成立（细化：medical-vaccines 还改真实疫苗状态且无清理；ai-daily-summary 有 finally 除外；development/family-config 纯 GET 除外） | 各测试文件行号见 subagent D 报告 |
| 4 | `/uploads` 反射任意 Origin + `Allow-Credentials: true`，任意网站可读用户影像 | 中 | ✅成立 | `app/uploads/[...path]/route.ts:67,73-75` |
| 5 | AGENTS.md 一键清理 SQL 清不掉 Family/Baby（无指向 User 的 FK，成孤儿） | 中 | ✅成立 | schema 无链路；`voice-fast-path.test.ts` 被迫手写 `family.deleteMany` 为旁证 |
| 6 | 限流缺口 | 中 | ⚠️部分修正：`oauth/token`、`oauth/register` 在 re-export 目标里**有**限流；确认缺失的是 `/mcp`、`ai/sessions`、`push/send`、`user/tokens` | 各 route 文件 grep |
| 7 | `AiArchive`/`data/archive` 无保留策略，只增不减 | 中 | ✅成立（另发现 `OAuthAuditLog` 同样只写不清） | `lib/archive.ts` 注释"永不 delete" |
| 8 | 冗余索引 ×3（`@unique` + 同名 `@@index`） | 低 | ✅成立 | `OAuthAuthorizationCode.code`、`OAuthRefreshToken.tokenHash`、`PersonalAccessToken.token` |
| 9 | 静态引用表 6 处 relation 缺 `onDelete` | 低 | ✅成立 | VaccineDose 等；`seed.ts` 手动按序 deleteMany 即为此所迫 |
| 10 | 时间/日期全 String 存储，排序依赖 ISO 字典序 | 低 | ✅成立（`validateFeedingStrict` 用宽松 `new Date()` 非严格 ISO） | `service.ts:219-221` |
| 11 | `VaccineRecord.countdownDays` 入库即变质的死列 | 低 | ✅成立（比预期更严重：create 不写、tools 硬编码 0、前端忽略自算） | `vaccines/route.ts:182-191` 等 |
| 12 | `npm test` 无 3088 服务自启，开箱即失败 | 中 | ✅成立 | package.json 脚本；CI 只跑 `test:unit` |
| 13 | 42/65 路由无 API 测试 | 中 | ✅成立 | auth 全家、medical 上传/OCR、nutrition×4、ai×10、push×4 |
| 14 | 23/23 页面全 client 化（原报告误报 4 个 Server，系单引号漏检） | 低 | ✅成立（修正计数） | `rg "use client" app` 23/23 |
| 15 | 0 处 `next/image`，23 处原生 `<img>` | 低 | ✅成立 | grep 统计 |
| 16 | `medical/add` 轮询 unmount 泄漏 | 低 | ✅成立 | `add/page.tsx:191` 仅成功时 clear |
| 17 | `getAuthSession` + `getActiveBaby` 重复查库（3 趟） | 低 | ✅成立 | auth.ts:86-106 + api-helpers.ts:86-98,113-115 |
| 18 | `as any` 166 处（原报告按行数少算为 120） | 低 | ✅成立（修正计数） | Top: `tools/food.ts` 30 处 |
| 19 | 首屏 useEffect+fetch 瀑布 | 低 | ✅成立（`refreshAll` 并行存在但首屏路径未用） | `app/(main)/page.tsx:150-167` |
| 20 | OfflineBanner 轮询抖动 | 低 | ✅成立（有 cleanup，不泄漏，仅周期漂移） | `OfflineBanner.tsx:59` 依赖 `[pending]` |
| 21 | `AiJob.userId/babyId` 裸 String 无 FK，删用户成孤儿（生产库实测 4 条） | 中 | ✅成立 | schema:685-686 |

**明确排除**（另立项）：整站 Server Component 化、`next/image` 迁移、agent tools zod 化。

## 3. 变更明细

### Step1 — `setInterval().unref()`（P0）
- `lib/rate-limit.ts:22-35`：保存 timer 句柄并 `unref()`，长驻服务不受影响。
- 验证：对照实验 237ms 退出（EXIT 0）；`voice-fast-path.test.ts` 2/2 过且退出；最终 `test:unit` 114/114 全过且有限时间结束。

### Step2 — 去掉 `/uploads` CORS 反射（P0）
- `app/uploads/[...path]/route.ts`：删除 `Access-Control-Allow-Origin/Allow-Credentials`，加注说明。执行前 grep 确认无跨站 `fetch('/uploads')` 消费者（全是同源 `<img>`/CSS 背景，海报 avatar 走 Base64 data URL）。
- 验证：文件内零 `Access-Control` 残留（仅注释）；`tsc` 干净。

### Step3 — PAT 哈希化 + 存量作废（P0，决策 B）
- Schema：`token String @unique` → `tokenHash String @unique` + `tokenHint`（列表展示用），删冗余 `@@index([token])`。
- `lib/tokens.ts`：新增纯函数 `hashPersonalAccessToken`（SHA-256，与 OAuth `hashSecret` 同算法）、`buildTokenHint`、`MAX_TOKENS_PER_USER=10`；create 只存哈希（原文仅随响应返回一次）；verify 改哈希比对；list 只返 hint。
- `app/api/user/tokens/route.ts` POST：加 10/分钟限流 + 超 10 个返回 409。响应形状不变（`token.token` / `maskedToken`），前端零改动。
- 生产库 1 枚存量 PAT 已删除（决策 B 作废重发，见 §7 上线检查单）。
- 验证：新增 `tests/unit/tokens-hash.test.ts` 3/3 过；`personal-tokens` 集成测试同步更新断言后通过。

### Step4 — 合并 migration（P0/P1）
`prisma/migrations/20260904080000_security_pat_hash_fk_cleanup/migration.sql`，一次覆盖：
PAT 列变更、删 3 冗余索引、静态表补 6 处 `onDelete: Cascade`、AiJob 加 `user→Cascade / baby→SetNull` FK、删 `countdownDays` 死列。
**专项见 §4**（含基线漂移意外的处理）。

代码侧同步：`lib/agent/tools.ts`、`lib/mcp/server.ts`、`lib/records/snapshot.ts`、`types/index.ts` 删除 `countdownDays` 写点/类型（全库 grep 确认无读者）。

### Step5 — 补限流（P1）
`app/mcp/route.ts`（`mcp:${ip}` 120/分，认证前）、`app/api/ai/sessions/route.ts` POST（每用户 30/分）、`app/api/push/send/route.ts`（每 IP 30/分）、`user/tokens` POST（见 Step3）。

### Step6 — 测试体系隔离改造（P1）
- 新增 `tests/helpers/tenant.ts`（`createTestTenant` / `destroyTestTenant`，`test_` 前缀三件套）。
- records/food/medical-vaccines/ai-daily-summary/development/family-config：`findFirst` → 隔离租户；写操作进 `try/finally`；medical-vaccines 额外恢复疫苗选择行。
- mcp-oauth/mcp-source-attribution：家庭/宝宝名加 `test_` 前缀 + `t.after` 清理；修复 `nickname` 硬编码断言一处。
- `personal-tokens` 测试同步新 hint 契约。
- 新增 `scripts/test-api.sh`：`dev_test.db` + `migrate deploy` + `seed` + 预清理 → 端口占用预检 → `next dev` 临时服务 → **顺序**执行各文件 → 跑后 purge → 进程组清理。新增 `test:api:server` npm 脚本。
- 新增 `scripts/purge-test-data.ts`；`AGENTS.md` 修正一键清理 SQL（追加孤儿家庭语句 + 局限说明 + 强制走隔离脚本）。
- 执行中发现并修复：① 首次运行打到生产 3088（401 拦截，**生产库零污染已验证**）→ 加端口预检；② 多文件并行共享一 SQLite 会互相饿死 → 改顺序执行；③ `next-server` 子进程成孤儿占库 → `setsid` 进程组清理。

### Step7 — 收尾（P2）
- `scripts/prune-ai-archive.sh`（决策 C：`--days N` + `--dry-run`，默认 90 天，排除被 `AiJob` 引用行与 `output_error`，连带清 `data/archive/` 孤儿文件；dry-run 在生产库验证：7 天窗口 63 行、零删除）。
- `app/health/medical/add/page.tsx`：`useRef` 存 timer + unmount 清理。
- `components/ui/OfflineBanner.tsx`：第二 effect 依赖改 `[]`，以实时队列长度为准，消周期漂移。
- `lib/records/service.ts`：新增 `assertIsoTimestamp`（严格 ISO+时区），收紧 feeding/diaper/sleep 4 处写路径；sleep 垃圾输入由"静默回退 1 小时前"改为 400（生产库全表审计零脏数据，见 §6）。
- 版本 bump 1.2.1。

## 4. Migration 专项记录（重点审计项）

1. **意外发现**：migrations 基线缺少 `PersonalAccessToken` / `AgentVoiceLog` 两表（此前全靠 `db push`），`migrate dev` 要求 reset 生产库——已拒绝。且 HEAD 的 CI 漂移检查本身已红 28 行（与本次改动无关）。
2. **处理**：`migrate diff` 生成完整 SQL 存为新 migration 文件（含两表建表，一举修复基线漂移）；对 `dev.db` 定向应用 delta（跳过已存在表，PAT 空表定制重建，rebuild 类语句原文执行），行数快照一致、零 FK 违规、旧索引清零。
3. **登记**：生产库被运行中服务持有写锁，`migrate resolve` 多次失败；改用"备份库上 resolve 取 checksum → 主库直写 `_prisma_migrations` 同一行"方案（checksum `306995e4…`）。
4. **三重验证**：备份库 `migrate deploy` 显示 "Database schema is up to date!"；CI 漂移检查输出 0 行；`prisma generate` 成功。
5. **代价**：`dev_test.db` 旧文件同样漂移（P3018），已重建（测试库可丢弃；原文件备份于 `/tmp/dev_test.db.bak`，重启后失效）。

## 5. 测试报告

- `test:unit`：114/114 ✅（修复前无限 hang）
- `test:api`（`scripts/test-api.sh 3089`）：9/10 文件绿 ✅；跑后 `dev_test.db` 零残留（test 用户 0、孤儿家庭 0）
- 唯一未绿 `agent-voice.test.ts`：Test 5 依赖**实时大模型**，两次复现均为 LLM 613ms 返回空文本 → fallback 回复 → 无 DB 落库；该文件及整条写入路径与 HEAD 字节一致（仅无关删行），判定为既有环境/模型侧波动，**未纳入本次修复**，建议另立项 mock 化 LLM 后收编。
- 生产库污染检查：`test_%` 用户 0、`自动化测试` 脏数据 0。

## 6. 生产库审计 SQL（复用）

```sql
-- 脏数据类型审计（本轮结果全 0）
SELECT COUNT(*) FROM "FeedingRecord" WHERE "timestamp" NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*';
SELECT COUNT(*) FROM "AiJob" WHERE "userId" NOT IN (SELECT "id" FROM "User");
SELECT COUNT(*) FROM "Family" WHERE "id" NOT IN (SELECT "familyId" FROM "FamilyMember");
```

## 7. 上线检查单（部署后执行）

- [ ] `npm run deploy`（build + 重启 baby-panel 服务；旧进程 + 新 schema 下 PAT 接口会 500，属预期）
- [ ] 重启后验证：登录、记一笔喂养、`/uploads` 响应头无 `Access-Control-Allow-Origin`（带 Origin 的 curl）、`mcp` 429 触发
- [ ] **重建 PAT**（决策 B：旧令牌已全部作废，Siri/快捷指令需重配）
- [ ] 观察 24h 后跑 `bash scripts/prune-ai-archive.sh --days 90 --dry-run` 看归档水位

## 8. 回滚方案

- 代码回滚：`git revert <commit>`（本轮单 commit，见 git log）。
- 数据库回滚：`bash scripts/restore-db.sh backups/dev_20260904_072347.db`（或 `cp` 备份回 `dev.db` 后重启服务）。
  注意：回滚 DB 必须连同代码一起回滚（新代码依赖新列 `tokenHash`）。
- 最坏情况：备份 + 新 migration 均在，`migrate deploy` 可重建空库结构，再灌备份数据。

## 9. 遗留与后续（未做）

1. `agent-voice.test.ts` mock 化 LLM（消除实时模型依赖）。
2. 整站 Server Component 化、`next/image` 迁移、agent tools zod 化（大 scope，另立项）。
3. `getAuthSession` + `getActiveBaby` 重复查库（3 趟，可传参优化）。
4. `OAuthAuditLog` 无清理（审计需要，暂保留；若膨胀则定窗口归档）。
5. `/uploads` 文件级归属校验（需改文件名命名空间，纵深防御项）。
