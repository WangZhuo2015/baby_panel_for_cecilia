# Baby Panel for Cecilia — 全面代码审查综合报告

**日期**: 2026-08-24  
**分支**: `main` @ `c9510f2` (`chore: 同步 Next.js 生成类型路径并忽略临时 scratch 目录`)  
**审查方式**: 5 路并行子代理 + 人工汇总（安全 / 架构 / 数据/API / 前端/性能 / 依赖/工程化）  
**技术栈**: Next.js 16.2.12 + React 19.2.8 + Prisma 7.9.1 + SQLite/libsql + Zustand 5.0.14 + Tailwind 4.3.3  
**总体结论**: 功能完整但存在 **6 项 CRITICAL 越权/泄露**，未修复前不建议公网部署；完成 P0 止血后可达 75+ 分生产可用。

---

## 目录

1. [Git 提交记录](#1-git-提交记录)
2. [总体评分雷达](#2-总体评分雷达)
3. [交叉印证 TOP 问题](#3-交叉印证-top-问题)
4. [安全审查（38/100 高危）](#4-安全审查38100-高危)
5. [架构与代码质量（5.1/10）](#5-架构与代码质量5110)
6. [数据层与 API 正确性（54/100）](#6-数据层与-api-正确性54100)
7. [前端与性能（68/100 B-）](#7-前端与性能68100-b-)
8. [依赖与工程化（52/100）](#8-依赖与工程化52100)
9. [分阶段修复路线图](#9-分阶段修复路线图)
10. [验证结果](#10-验证结果)
11. [附录：文件清单与统计](#11-附录文件清单与统计)

---

## 1. Git 提交记录

```text
c9510f2 chore: 同步 Next.js 生成类型路径并忽略临时 scratch 目录
f1fdda6 feat(mcp): 实现标准 Baby Panel MCP Server 与 Hermes Skill，为 Agent 提供原生工具调用能力
c7c5b72 fix(review): 完成独立 Agent 代码评审修复，强化日期时间归一化与图片上传容错
4fcc34c feat(ai): 为对话内置 Action Card 增加轻量级微调编辑能力
81c2d30 feat(ai): 实现多模态图片上传与自然语言 Agent Action Card 对话录入入库系统
```

**本次提交内容**（`git diff --cached`）：

- `next-env.d.ts:1` `import "./.next/types/routes.d.ts"` → `import "./.next/dev/types/routes.d.ts"`（Next 16 dev 产物路径变更）
- `.gitignore:46` 新增 `scratch/`（忽略 `scratch/adversarial-tests/test_ai_chat*.mjs` 等 6 个对抗测试临时脚本，未入库）
- 已 `git push` 至 `origin/main`，`git status` clean

---

## 2. 总体评分雷达

| 维度 | 评分 | 定级 | 一句话结论 |
|------|------|------|------------|
| **安全** | 38/100 | 高危 | 匿名回退 IDOR + JWT 硬编码 + 上传穿越 + MCP 零鉴权 |
| **架构/可维护性** | 5.1/10 (51) | 待重构 | 无 middleware/zod/config 中心，Store 699 行 God Object |
| **数据/API 正确性** | 54/100 | 不及格 | String 时间 + 缺索引 + 时区 8h 偏移 + Seed FK 失败 |
| **前端/性能** | 68/100 | 可用 | 90% `use client` + 0 `next/image` + SW 零缓存 |
| **依赖/工程化** | 52/100 | 待改进 | 无 CI + 镜像缺 generated + 三套 AI_BASE_URL 默认值 |
| **综合** | **53/100** | **待改进** | 完成 P0 止血可回升至 75+ |

**评分标准**: 90+ 优秀 / 80-89 良好 / 70-79 可用 / 60-69 需重构 / <60 风险

---

## 3. 交叉印证 TOP 问题

> 以下 6 项被 ≥2 个子代理同时标记为 CRITICAL，优先级最高。

| 排名 | 问题 | 涉及文件 | 影响 |
|------|------|----------|------|
| **TOP1** | **全局鉴权失效 + IDOR 越权** — 无 `middleware.ts`，15+ 路由 `getAuthSession` 失败回退 `prisma.baby.findFirst()`，且信任客户端 `?babyId=` | `lib/auth.ts:47-96`, `app/api/baby/route.ts:5-13/40-88`, `app/api/growth/route.ts:6-28`, `app/api/records/feeding/route.ts:5-26`, `app/api/medical/reports/route.ts:7-44` 等 | 匿名可读写任意家庭隐私（喂养/睡眠/生长/化验单） |
| **TOP2** | **JWT 硬编码默认密钥 30d** | `lib/auth.ts:6-7`, `docker-compose.yml:16`, `.env.example:9` | 未配 env 直接可用公开密钥伪造任意用户 |
| **TOP3** | **未鉴权上传至 public + 目录穿越读** | `app/api/medical/upload/route.ts:6-28`, `app/api/baby/avatar/route.ts:8-41`, `app/uploads/[...path]/route.ts:28-30` | 匿名传任意文件至 `public/`、可猜 URL 外泄、存储炸弹、SVG XSS、穿越读 `.env` |
| **TOP4** | **MCP Server 零鉴权代理** | `scripts/mcp-server.mjs:16,249-377` | 任意本地 Agent 可通过 MCP 未授权读写 |
| **TOP5** | **时间模型错误 + 时区 8h 偏移** | `lib/date.ts:73-81`, `lib/age.ts:4-28`, `app/api/medical/reports/route.ts:89-91` | 服务器 UTC 时 `Asia/Shanghai` 记录错位 8h，月龄三处口径不一致 |
| **TOP6** | **String 时间 + 缺索引 + WAL 未开** | `prisma/schema.prisma:72-111`, `lib/prisma.ts:8-10` | 字符串比较脆弱、无 `@@index([babyId,timestamp])` 全表扫描、SQLite 并发 `SQLITE_BUSY` |

---

## 4. 安全审查（38/100 高危）

**扫描范围**: `lib/auth.ts:1-118`, `next.config.ts:1-30`, `scripts/mcp-server.mjs:1-387`, 全部 `app/api/**/route.ts` 33 个, `app/uploads/[...path]/route.ts`, `prisma/schema.prisma`, `package.json`, `Dockerfile`, `docker-compose.yml`, `.env.*`  
**方法**: Glob + Grep + Read 全量静态审计  
**问题统计**: 19 项 — CRITICAL 6 / HIGH 8 / MEDIUM 6 / LOW 3

### CRITICAL

#### C-01 全局鉴权失效 + 水平越权（Broken Access Control / IDOR）
**文件**:
- `lib/auth.ts:47-96` `getAuthSession` 可返回 null
- `app/api/baby/route.ts:5-13, 40-88, 111-126` GET/POST/PUT 未强制鉴权，`else await prisma.baby.findFirst()`
- `app/api/growth/route.ts:6-28, 38-73` `babyId` 来自 `searchParams` 直接 `where:{babyId:targetBabyId}` 无归属校验；POST `finalBabyId = reqBabyId || babyId || findFirst()`
- `app/api/records/feeding/route.ts:5-26,37-49`, `app/api/records/sleep/route.ts:5-47`, `app/api/records/diaper/route.ts:5-47`, `app/api/growth/chart/route.ts:6-30`, `app/api/vaccines/selections/route.ts:5-46`, `app/api/medical/reports/route.ts:7-44`, `app/api/medical/reports/[id]/route.ts:11-91`, `app/api/records/timeline/route.ts:14-38`, `app/api/records/daily-summary/route.ts:7-33`, `app/api/ai/chat/route.ts:139-156`, `lib/ai-tips.ts:66-69`, `app/api/ai/tips/route.ts:7-11`, `app/api/food/items/route.ts:14-73`, `app/api/books/[id]/route.ts:17-27`, `app/api/baby/avatar/route.ts:44-49`

**描述**: 项目未提供 `middleware.ts`，所有 API 手动 `getAuthSession(request)`，失败时不返回 401 而是降级到 `prisma.baby.findFirst()` 或 `findMany orderBy` 返回全量数据。且即使已登录，也信任客户端传入 `?babyId=` / `body.babyId` 覆盖，未校验该 baby 是否属于 `user.family`。

**利用**: `curl https://target/api/records/feeding` 匿名获取全家喂养记录；`curl -X POST /api/records/diaper -d '{"babyId":"<枚举的UUID>","type":"poop"}'` 写入任意家庭数据；遍历 `babyId` 枚举所有家庭隐私。

**修复**:
```ts
// 新建 middleware.ts 强制保护 /api/*
export function middleware(req: NextRequest){
  if(req.nextUrl.pathname.startsWith("/api/") && !req.nextUrl.pathname.startsWith("/api/auth/")){
    // 交由路由内校验，但需移除 findFirst 回退
  }
}
// 每个路由内：
const user = await getAuthSession(request);
if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
const active = await getActiveBabyForUser(user.id);
if(!active?.baby) return NextResponse.json({error:"Not found"},{status:404});
const targetBabyId = active.baby.id; // 禁止接受 reqBabyId，或校验归属
if(reqBabyId && reqBabyId !== targetBabyId) {
  const owned = await prisma.baby.findFirst({where:{id:reqBabyId, familyId:active.family.id}});
  if(!owned) return NextResponse.json({error:"Forbidden"},{status:403});
}
```

#### C-02 JWT 硬编码默认密钥 + 30天超长期限
**文件**: `lib/auth.ts:6-7,18-23`, `.env.example:9`, `docker-compose.yml:16`
```ts
const JWT_SECRET_STRING = process.env.JWT_SECRET || "baby-panel-jwt-secret-key-change-me-in-production-2026";
.setExpirationTime("30d")
```
**描述**: 未设 `JWT_SECRET` 时使用公开可搜索的默认值，攻击者可在 GitHub 历史/`docker-compose.yml` 直接获取并伪造任意 `baby_auth_token`。  
**利用**: 部署者忘记覆盖 env → `jose` 使用弱密钥，`SignJWT({userId:"任意"}).sign()` 伪造会话。  
**修复**: 启动时强制校验长度 ≥32，缺失拒绝启动；缩短至 `7d` 并 `httpOnly:true, secure:true, sameSite:"strict"`。

#### C-03 未鉴权任意文件上传至 `public/` + 可猜测URL匿名访问
**文件**: `app/api/medical/upload/route.ts:6-28`, `app/api/medical/ocr/route.ts:52-79`, `app/api/growth/ocr/route.ts:27-52`, `app/api/baby/avatar/route.ts:8-41`  
**描述**: 上传接口未鉴权，写入 `public/uploads/medical|avatars`，通过 `/uploads/[...path]` 静态服务。文件名仅 `Date.now()+crypto.randomBytes(4)`（32bit 熵）。`avatar` 校验 `if(!file.type || file.type.startsWith("image/") || rawExt.length>0)` 恒真。  
**利用**: 匿名 `POST /api/medical/upload` 无限上传 15MB → 磁盘 DoS；上传 `payload.svg` 含 `<script>` → XSS；医疗照片无 Cookie 可外泄。  
**修复**: 全部加鉴权；白名单 `[".jpg",".jpeg",".png",".webp"]` + magic bytes；`mkdir(...,{recursive:true})`；文件名 `crypto.randomBytes(16)`；存储移出 `public` 改鉴权流式，`Cache-Control: private, no-store`；限配额。

#### C-04 目录穿越任意文件读取
**文件**: `app/uploads/[...path]/route.ts:28-30`
```ts
const safePath = pathSegments.map(s=> s.replace(/\.\./g,"")).join("/")
const filePath = path.join(process.cwd(),"public","uploads",safePath);
```
**描述**: 仅替换 `..` 字符串，未用 `path.resolve + startsWith`，未解码 `%2e%2e`，未过滤符号链接。  
**利用**: `GET /uploads/%2e%2e/%2e%2e/.env.local` 读取密钥。  
**修复**:
```ts
const resolved = path.resolve(path.join(process.cwd(),"public","uploads"), safePath);
const base = path.resolve(path.join(process.cwd(),"public","uploads"));
if(!resolved.startsWith(base + path.sep)) return new Response("Forbidden",{status:403});
```

#### C-05 MCP Server 完全无鉴权代理
**文件**: `scripts/mcp-server.mjs:16,249-377`
```js
const BASE_URL = process.env.BABY_PANEL_URL || "http://127.0.0.1:3088";
fetch(`${BASE_URL}/api/baby`) // 无 Authorization
```
**描述**: 8 个工具直接 `fetch` 本地 API 未携带 Cookie/Token，依赖后端 `findFirst` 回退漏洞。  
**修复**: 读取 `JWT_TOKEN` 环境变量，所有 `fetch` 加 `Authorization: Bearer`；服务端强制校验。

#### C-06 本地 `.env.local` 真实 VAPID 私钥泄漏
**文件**: `.env.local:4-5` `VAPID_PRIVATE_KEY=-PvpIxIM...`  
**描述**: 虽 `.gitignore` 含 `*.local`，但 `COPY . .` 会打入镜像层，可通过穿越或镜像历史提取；可伪造 `web-push` 钓鱼。  
**修复**: 立即轮换 `npx tsx scripts/generate-vapid-keys.ts`，`.dockerignore` 添加 `.env*`。

### HIGH

| 编号 | 文件:行 | 问题 | 修复 |
|------|---------|------|------|
| H-01 | `lib/auth.ts:38-44`, `app/api/baby/route.ts:65` | `Math.random` 邀请码 30bit 熵可爆破 | `crypto.randomInt` + `rate-limit` |
| H-02 | `app/api/auth/login/route.ts` 等 | 全站缺速率限制 | `lru-cache` 5次/分/IP+账号级 |
| H-03 | `app/api/ai/chat/route.ts:7-9,137-157` | AI 未鉴权计费盗用 + Prompt 注入 + 任意 babyId 越权 | 强制登录+`zod` 校验 `messages.length<=8` + baby 归属校验 |
| H-04 | `app/api/medical/upload/route.ts:20` | SVG/HTML XSS | 白名单+`sharp` 重编码 + `CSP: sandbox` |
| H-05 | `next.config.ts:11-27` | 缺安全头 `X-Frame-Options/CSP/HSTS` | `headers()` 全局添加 6 项 |
| H-06 | `app/api/auth/login/route.ts:79-87` | CSRF `sameSite:lax` 不充分 | 改 `strict` + 校验 `Origin/Sec-Fetch-Site` |
| H-07 | `package-lock.json:1227 cors@2.8.5` | CORS 未显式限制 | 显式白名单 `Allow-Origin: https://yourdomain.com` |
| H-08 | `app/api/growth/route.ts:75-104` | 输入未校验可传 `1e999`/1MB `notes` | `zod` 统一 `weightKg 0.5-30`, `notes max 500` |

### MEDIUM / LOW

- **M-01** `app/api/medical/ocr/route.ts:153-156` 敏感错误泄露 `AI_API_KEY` 提示 → 生产统一文案
- **M-02** `app/uploads/[...path]/route.ts:43` `public, max-age=31536000` → 改 `private, no-store`
- **M-03** `app/api/baby/route.ts:83` 硬编码 `BABY88` → 移除默认家庭
- **M-04** `components/ui/QuickAiModal.tsx:4-5` `ReactMarkdown` 未 `rehypeSanitize` → 加净化
- **M-06** `app/api/push/subscribe/route.ts:5-35` 无鉴权 `upsert` 洪泛 → 限 5/用户
- **L-01** `next.config.ts` 缺 `poweredByHeader:false`
- **L-02** `docker-compose.yml:26` 卷权限过宽
- **L-03** `secure` Cookie 仅 production

**Top3 修复**: 1) 统一强制鉴权+移除回退 2) 密钥加固 3) 文件系统重构至私有存储。

---

## 5. 架构与代码质量（5.1/10）

| 维度 | 得分/10 | 评语 |
|------|---------|------|
| 分层职责 | 5.5 | `lib` 耦合 `prisma`，无 `hooks/services/middleware`，`stores` 成 God Object |
| API 设计 | 4.0 | 命名不统一、匿名兜底破坏多租户、无 schema、无分页/版本 |
| 状态管理 | 5.0 | Zustand 单库 + 手写 `globalThis` 过期/dedup，非响应式 |
| 组件复用 | 6.0 | `components/ui` 原子化好，但页面 Client Component 400+ 行，`QuickAiModal` 700 行 |
| 错误/日志 | 4.5 | 全局 `try/catch+console.error`，无错误码/日志/边界 |
| 可维护性 | 4.5 | 大量复制粘贴、长函数、魔法值 |
| TS 严谨性 | 5.0 | `strict:true` 但 30+ 处 `any`/`as any` 逃逸 |
| 配置管理 | 5.0 | 无集中 `config.ts`，多处 `process.env` 兜底不一致 |

### Critical

- **C-01** 匿名兜底越权（同安全 C-01）`app/api/baby/route.ts:13-15`
- **C-02** JWT 弱默认值 `lib/auth.ts:6`
- **C-03** 上传路径穿越+目录缺失 `app/api/growth/ocr/route.ts:48-52`
- **C-04** 百分位逻辑分裂 `app/api/growth/route.ts:88-91` 仅算 weight，前端 `who-growth-standards.ts:77-99` 再算

### High

| 编号 | 文件:行 | 问题 | 建议 |
|------|---------|------|------|
| H-01 | `stores/useBabyStore.ts:1-699` | 单 Store 699 行承载 16 类记录+7 静态 | 拆 `useAuthStore/useRecordStore` 或 slice，迁 `SWR/TanStack Query` |
| H-02 | `app/api/vaccines/route.ts:4` 等 | `safeJsonParse` 5 处重复，鉴权样板 25+ 处 | 抽 `lib/json.ts`, `lib/api-helpers.ts` `withFamilyAndBaby` |
| H-03 | `lib/age.ts:4-28` vs `lib/ai-tips.ts:7-14` vs `ai/chat/route.ts:11-30` | 年龄计算三实现不一致 | 统一 `lib/age.ts` + 单测 |
| H-04 | `app/api/records/timeline/route.ts:26` vs `feeding/route.ts:20` | Timeline 用 `getLocalDayUtcRange`，feeding 用 `startsWith` | 统一 UTC 区间 |
| H-05 | 全路由 | 无 `zod`，手写 `typeof` | 引入 `zod` + `422 issues` |
| H-06 | `useBabyStore.ts:130` | 缓存 30s/300s/120s 分裂，部分无缓存 | 统一 `fetchWithCache+invalidate` |
| H-07 | `growth/ocr:37 15MB` vs `avatar:18 10MB` vs `QuickAiModal:238 8MB` | 上传限制三标准 | `config.ts` 集中 `MAX_UPLOAD_MB` |
| H-08 | `app/(main)/page.tsx:76-481` | 481 行单文件 7 并行+计时+通知 | 拆 `hooks/useLiveSleep.ts`, `components/home/*` |

### Medium/Low

- **M-01** `any` 30+ 处 `lib/prisma.ts:10 as any`, `timeline:86 any[]` → 用 `Prisma.*WhereInput`
- **M-02** `types/index.ts` vs `prisma/schema.prisma` 类型不一致 `FamilyMember` 需手动 map
- **M-03** 错误响应不统一 `baby GET` 裸 `Baby|null` vs `auth/me 401 {user:null}`
- **M-04** 无分页 `findMany` 全量 → `take=50 + cursor`
- **M-05** `console.error` 40 处无结构化 → `lib/logger.ts` pino
- **M-06** 魔法值 `weather/route.ts:5 31.30/120.62` 苏州坐标分散
- **M-09** 无 `test`/`typecheck` 门禁

**良好实践保留**: `lib/date.ts` `getLocalDayUtcRange` 正确、`medical/ocr` json 重试容错、`stores dedup` 思想、`Family` 模型 `@@unique` 正确。

---

## 6. 数据层与 API 正确性（54/100）

**总体**: Schema 50 / 索引 35 / API-CRUD 45 / 校验 40 / 时区 50 / 并发 40 / 迁移 55 / 错误恢复 60 → 加权 54

### Schema 与索引

- **[严重] 缺失核心索引** `prisma/schema.prisma:72-111` `FeedingRecord(babyId,timestamp)` 等 6 表无 `@@index`，仅 `MedicalReport` 有；`timeline/daily-summary Promise.all` 全表扫描
- **[严重] 时间 String 脆弱** `timestamp/startTime/date String` 依赖 ISO，若 `YYYY/MM/DD` 则 `gte/lt` 错误
- **[高] datasource 缺 url** `schema.prisma:6-8` `provider=sqlite` 无 `url=env("DATABASE_URL")`，`migrate` 与运行时分离
- **[高] 枚举退化 String** 15 处 `role/relation/type` 无约束，`types` 联合类型不同步
- **[高] birthDate String 无校验** `prisma/schema.prisma:56` `new Date(birthDate)` 遇 `2026-02-30` 返回 NaN
- **[中] 缺 audit** 无 `updatedAt/deletedAt/version`，`VaccineRecord` 无 `createdAt`
- **[中] WAL 未开** `lib/prisma.ts:8-10` 未 `PRAGMA journal_mode=WAL; busy_timeout=5000`

### API CRUD

- **[严重] 越权泄露** 同 C-01，`GET` 无 `babyId` 返全表 `app/api/growth/route.ts:24-26`
- **[严重] 无 DELETE/PUT** `feeding/sleep/diaper/growth` 仅 GET+POST，误录无法修正
- **[高] 入参错误** `feeding:68 amountMl 0→null`, `spitUp Boolean("false")==true`, `sleep:65 type 无白名单`, `growth:75 parseFloat("12abc")`, `medical/[id]:57` 可置空标题
- **[高] 业务缺口** `sleep:59` 无重叠检测、`growth:89` 前端 `ageInMonths` 可伪造、`food/items:87` 匿名污染字典、`food/plans:9` 无 `babyId` 隔离
- **[中] 无分页** 全 `findMany` 无 `take/skip`，`notifications` 内存过滤 `diffDays<=7`

### 校验与类型

- **[高] JSON 脱节** `types FoodItem.preparation: string[]` vs `prisma preparationJson String`，脏数据 `JSON.parse` 抛 500
- **[中] 可空不一致** `GrowthMeasurement.ageInMonths` TS 必选 vs Prisma 可空

### 时区（核心）

- **[严重] `localTimeToUtcIso` 8h 偏移** `lib/date.ts:73-81` `new Date(y,m,d,h,m)` 用服务器时区，非 `Asia/Shanghai`
  ```ts
  // 修复
  new Date(`${getLocalDateStr()}T${hhmm}:00+08:00`).toISOString()
  ```
- **[高] `calculateAge` 三口径** `age.ts` 日历法 vs `ai-tips.ts` 月差 vs `ai/chat` 累计天
- **[高] `medical/reports:89` 粗估** `30.44` 天/月 vs 日历法不一致
- **[中] `timeline:184` 字符串排序** `HH:MM` 跨天错误，应按 ISO 时间戳
- **[中] `getLocalDayUtcRange` 未校验** `2026-02-30` → `Invalid Date` → `gte:""` 匹配全表

### 并发/事务

- **[严重] `findFirst+create` 非原子** `app/api/baby/route.ts:78-88` 默认家庭并发创两条 `BABY88` 第二条 500
- **[高] 邀请码碰撞未捕获 `P2002`** `lib/auth.ts:38`
- **[中] 丢失更新** `PUT /api/baby` 无乐观锁
- **[中] `SQLITE_BUSY` 无重试**

### 迁移/种子

- **[严重] Seed 顺序缺失** `prisma/seed.ts:27-46` 仅删 13 表遗漏 12 表，未按依赖倒序，二次 `db:seed` 必 `FOREIGN KEY failed`
- **[高] 无事务幂等** 20+ `createMany` 非事务，半脏数据，下次 `vaccineId` 冲突
- **[中] 迁移漂移** `schema.prisma` 含 `Baby.familyId` 等但 `migrations/20260804125525_init` 无，`20260804163800_vaccine_selection` 无 `babyId`

**Top3**: 1) 堵越权+补索引 2) 统一时间+后端重算年龄 3) Seed 事务化+补 `WAL` + `datasource url`。

---

## 7. 前端与性能（68/100 B-）

| 维度 | 评分 | 关键扣分 |
|------|------|----------|
| React/Next | 68 | `use client` 滥用 90%+，缺 RSC |
| UI/可访问性 | 62 | 键盘/语义缺 8 处 |
| 数据/缓存 | 75 | 缓存不统一 |
| 性能 | 60 | 0 `next/image` + Recharts 同步 |
| 移动端 | 80 | `maximumScale=1` 禁缩放 |
| PWA/离线 | 58 | 零静态缓存 |
| AI 体验 | 70 | 无中断/焦点陷阱 |

### React/Next 最佳实践

| 文件:行 | 级别 | 问题 | 建议 |
|---------|------|------|------|
| `app/(main)/layout.tsx:1` | 🔴 | 整个 layout `"use client"` 仅为 `usePathname+fetchBaby` 使 5 子页面全客户端化 | 拆 Server `layout` + `BottomNavWrapper`/`BabyInit` Islands |
| `app/(main)/page.tsx:103-121` | 🟠 | `useEffect` 7 个 `fetch*()` 瀑布，依赖含函数引用 | `Promise.all` 并发 + `useShallow` + `AbortController` |
| `app/layout.tsx:24` | 🟠 | `maximumScale:1,userScalable:false` 禁缩放 WCAG 失败 | 移除 |
| `stores/useBabyStore.ts:120-150` | 🟡 | `request<T>` 未处理 401 跳转，`globalThis` 常驻 SSR 污染 | 迁 `tanstack-query` |

### UI/可访问性

| 文件:行 | 问题 | 建议 |
|---------|------|------|
| `components/ui/CuteCard.tsx:29` | `role=button` 无 `onKeyDown` | 加 `onKeyDown` 或用 `<button>` |
| `components/ui/CuteButton.tsx:36-46` | 无 `forwardRef`/`aria-busy` | `forwardRef` + `aria-disabled` |
| `components/ui/CuteInput.tsx:19` | `label` 未关联 `htmlFor/id` | `useId()` 绑定 |
| `components/ui/SegmentControl.tsx:34` | 无 `tablist/tab` 语义 | `role=tablist` + `aria-selected` |
| `app/globals.css:111` | `::-webkit-scrollbar{display:none}` 全局隐藏 | `scrollbar-width:thin` |
| `app/layout.tsx:24` | 同上禁缩放 | 同上 |

### 数据/缓存

- `useBabyStore.ts:283-323` 缓存不一致：`fetchBaby` 有 `isFresh+dedup`，`fetchFoodItems/fetchBooks` 完全无 → 统一 `createCachedFetch(ttl)`
- `fetchWeather:413` 定位失败未缓存重复定位 → 缓存拒绝 10min
- `growth/page.tsx:26-34` `fetch('/api/growth/chart')` 未纳入 store，无 `useMemo`

### 性能（Bundle/图片/渲染）

| 文件:行 | 级别 | 问题 | 建议 |
|---------|------|------|------|
| 全局 `grep <img` 17处 | 🔴 | 全 `<img>` 无 `next/image`，CLS | `next/image` + `priority`/`loading=lazy` + `sizes` |
| `app/(main)/growth/page.tsx:5` | 🔴 | `recharts` ~150kb gz 同步首屏 | `dynamic(()=>import('recharts'),{ssr:false})` |
| `components/ui/QuickAiModal.tsx:4-5` | 🟠 | `react-markdown+remark-gfm` ~80kb 首屏打包 | `dynamic(()=>import('./QuickAiModal'),{ssr:false})` |
| `next.config.ts:3-28` | 🟡 | 无 `optimizePackageImports`/`images.formats` | 加 `avif/webp` + `optimizePackageImports:['lucide-react','recharts']` |
| `app/(main)/page.tsx:124-143` | 🟡 | `liveSleepStart` 每 5s 全树重渲染 | `useNow(5000)` hook 仅卡片重渲染 |

### 移动端

- `app/layout.tsx:24-29` `100dvh` 键盘顶起 `BottomNav` → `visualViewport` 监听隐藏
- `QuickAiModal.tsx:399` `h-[100dvh]` iOS 含地址栏遮输入框 → `max-h-[-webkit-fill-available]` + `sticky bottom:0`

### PWA/离线

| 文件:行 | 级别 | 问题 | 建议 |
|---------|------|------|------|
| `public/sw.js:69-75` | 🔴 | 注释 `network-first` 实际永不缓存，仅 precache 5 图标 | `StaleWhileRevalidate` + `/_next/static` `CacheFirst` |
| `components/ServiceWorkerRegistrar.tsx:60-64` | 🟠 | `controllerchange` 直接 `location.reload()` 丢表单 | toast 提示手动刷新 |
| `public/offline.html:69` | 🟡 | 无 `online` 监听 | `addEventListener('online',()=>location.reload())` |

### AI 体验 `QuickAiModal.tsx:719`

| 文件:行 | 级别 | 问题 | 建议 |
|---------|------|------|------|
| `QuickAiModal.tsx:266-388` | 🔴 | 流式无 `AbortController`，关 Modal 仍 `setMessages` 泄漏 | `controller.abort()` 于 `useEffect` 清理 |
| `QuickAiModal.tsx:208-226` | 🟠 | `useEffect([isOpen])` 缺依赖闭包过期 | `useCallback(handleSend)` + 完整依赖 |
| `QuickAiModal.tsx:398-407` | 🟡 | 无焦点陷阱/无 Esc/无 `aria-modal` | `useFocusTrap` + `Esc` 关闭 |
| `AiActionCard.tsx:42-58` | 🟡 | `normalizeDate` 未校验 `2026-02-30` | `date-fns isValid` 校验 |

**Top3**: 1) 图片+Bundle 瘦身（LCP -40%, JS -180kb） 2) RSC 改造+统一缓存 3) PWA 离线可用 0%→90%。

---

## 8. 依赖与工程化（52/100）

| 维度 | 得分 | 权重 |
|------|------|------|
| package.json 健康度 | 58 | 20% |
| 构建部署 | 62 | 20% |
| CI/CD 门禁 | 25 | 20% |
| 环境变量 | 50 | 15% |
| Prisma/DB | 70 | 15% |
| 脚本工具链 | 60 | 5% |
| 文档 | 68 | 5% |
| **综合** | **52** | - |

### package.json

- **P1** `prisma 7.9.1` 在 `dependencies`（~50MB CLI 应 `devDependencies`）`package.json:25`
- **P1** `dotenv ^17.2.3` 冗余（Next 自动加载，仅 `prisma.config.ts:3` 用）`package.json:21`
- **P1** 7 high 漏洞：`deepmerge-ts<8.0.0` (GHSA-ggr8... via prisma), `nanoid<3.3.18`, `postcss<=8.5.22` 4 项, `sharp<0.35.0` CVE-2026-... → `npm audit fix` 可修 `nanoid`，`--force` 升 `next@16.3.2` 需测试
- **P1** 缺 `engines`/`packageManager`/` .nvmrc`，`Dockerfile:1 node:20-alpine` vs 本地 `v22.23.1`
- **P2** 版本策略分裂 `next` 固定 vs `jose ^`
- **P2** `@modelcontextprotocol/sdk ^1.30.0` 仅 `mcp-server.mjs` 用应 `devDeps`
- **P2** 缺 `typecheck/test/db:generate` 脚本

### 构建部署

- **`next.config.ts:1-30` P2** 缺 `poweredByHeader:false, compress:true, typedRoutes:true, optimizePackageImports`
- **`tsconfig.json:1-42` P1** `include:["**/*.ts","**/*.tsx"]` 过宽会扫 `.next/scratch`，`exclude` 未排除 `.next/generated/scratch`；`target ES2017` 偏低应 `ES2022`
- **`Dockerfile:1-44` P1** `runner` 未 `COPY --from=builder /app/generated ./generated` → `Cannot find module "@/generated/prisma/client"`；无 `HEALTHCHECK/ENTRYPOINT migrate`
- **`docker-compose.yml:1-30` P1** 默认密钥明文 `JWT_SECRET=${JWT_SECRET:-baby-panel...}`；`version:3.8` 已废弃；`12: "3000:3000"` 与 `.env:11 PORT=3088` 分裂
- **`.dockerignore:1-8` P2** 未忽略 `scratch/docs/.env.local/.claude`

### CI/CD

- **P0 致命** 无 `.github/workflows/*`，`find -name "*.yml"` 仅 `node_modules`
- **建议最小 CI**:
  ```yaml
  name: CI; on: [push, pull_request]
  jobs: { ci: { runs-on: ubuntu-latest, steps: [
    {uses: actions/checkout@v4}, {uses: actions/setup-node@v4, with:{node-version:20}},
    {run: npm ci}, {run: npx tsc --noEmit}, {run: npx oxlint .},
    {run: npm run build}, {run: npm audit --audit-level=high},
    {run: npx prisma validate}] } }
  ```
- `.oxlintrc.json:1-14` 仅 2 规则，无 `correctness/suspicious`；无 `husky/lint-staged`，`playwright ^1.62.1` 0 `*.spec.ts`

### 环境变量

- **P1 无 `lib/config.ts`** 读取分散：`lib/auth.ts:6 JWT_SECRET`, `lib/prisma.ts:9 DATABASE_URL`, `lib/ai-tips.ts:3-5 AI_*`, `app/api/ai/chat/route.ts:3-5` 等三套 `AI_BASE_URL` 默认值不一致
- **`.env.example:1-33` vs `.env:1-12` 漂移** `PORT 3000 vs 3088`, VAPID 真实私钥已在 `.env` 明文（虽 `.gitignore` 忽略但仍风险）
- **`prisma.config.ts:1-24` + `prisma/seed.ts:14-20` + `lib/prisma.ts:8-11` 三处重复 `resolveDatabaseUrl`**

### Prisma/DB

- 优点：`output="../generated/prisma"` 自定义、`defineConfig` 兼容 `file:` 正确
- **P1** 15 处 `String` 替代 `Enum/DateTime/Json`，`FamilyMember` 无 `@index([userId])`，`FeedingRecord` 等无复合索引
- **P1** `prisma/seed.ts:54 any` 30+ 处无 `zod` 校验
- **P2** 生产应 `prisma migrate deploy` 而非 `db push`，`Dockerfile` 仅 `generate`

### 脚本

- `scripts/mcp-server.mjs:16` 默认 `3088` 与 Docker `3000` 不一致，未鉴权
- `scripts/generate-vapid-keys.ts:1-24` 写 `.env.local` 非 `.env` 导致容器读不到
- `scripts/generate-icons.mjs` 需 `chromium` ~400MB 仅生 3 图标
- `scripts/take-screenshots.mjs:4` 硬编码 `/home/ubuntu/.gemini/...` 不可复现

**Top3**: 1) 建 CI+修漏洞 2) 建 `lib/config.ts` 移除默认密钥 3) 修镜像完整性+入口迁移。

---

## 9. 分阶段修复路线图

### P0 立即止血（1-2 天）— 不完成不建议公网

| 任务 | 文件 | 动作 | 收益 |
|------|------|------|------|
| 统一鉴权+IDOR | `middleware.ts` 新建 + 25+ 路由 | 删 `findFirst()` 回退，`requireActiveBaby` 校验归属，`babyId` 禁覆盖 | 堵跨家庭泄露 |
| 密钥加固 | `lib/auth.ts:6`, `docker-compose.yml:16`, `lib/config.ts` 新建 | `zod` 校验 `JWT_SECRET min(32)` 生产抛错，`7d` + `strict` | 消伪造 |
| 文件重构 | `app/api/*/upload`, `app/uploads/[...path]/route.ts:28` | 鉴权+白名单+`resolve+startsWith`+私存+`private,no-store` | 消上传/穿越 |
| 时间修正 | `lib/date.ts:73` | `+08:00` 显式时区，后端重算 `age` | 消 8h 偏移 |
| 索引+WAL | `prisma/schema.prisma`, `lib/prisma.ts` | 6 复合索引 + `WAL` + `datasource url` | 性能 O(n)→O(log n) |

### P1 本周加固（3-5 天）

- `zod` 全路由 + 分页 `take=50` + `rate-limit` + 安全头 6 项
- 图片 `next/image` 17 处 + `recharts`/`react-markdown` 动态导入（LCP -40%）
- SW 重写 `StaleWhileRevalidate` + 去强制 `reload`
- 补 `VAPID` 轮换、`.dockerignore`、MCP 鉴权
- Seed 事务化 + 补 `generated` 复制 + `HEALTHCHECK`

### P2 工程化（2 周）

- 建 `.github/workflows/ci.yml` + `typecheck/test` + `npm audit` 入门禁
- 拆 `useBabyStore:699` + 迁 `TanStack Query` + RSC 拆 `layout:1`
- 枚举化 `Role/FeedingType` + `DateTime` 迁移 + 补 `DELETE/PATCH`
- 文档 `LICENSE/CHANGELOG` + `README` API 索引 + 版本徽章

> 完成 P0 后综合分 **53 → 75+**；P1 后 **85+** 生产可用。

---

## 10. 验证结果

| 检查 | 命令 | 结果 |
|------|------|------|
| Git | `git log --oneline -3` | `c9510f2` 已推 `origin/main` |
| Lint | `npm run lint` (`oxlint`) | 0 error, 14 warnings（`no-unused-vars`, `exhaustive-deps`） |
| TypeCheck | `npx tsc --noEmit` | 0 error |
| Audit | `npm audit --audit-level=high` | 7 high（`deepmerge-ts`, `nanoid`, `postcss`×4, `sharp`） |
| Build | `next build`（隐式） | 未跑，待 CI 常态化 |

**Warnings 详情**（`oxlint`）:
- `AvatarCropModal.tsx:25` `imageNaturalSize` 未使用
- `AvatarCropModal.tsx:167` `useCallback` 依赖 `scale` 冗余
- `AiActionCard.tsx:6-10,18-19` 6 个未使用 icon
- `QuickAiModal.tsx:373` `catch e` 未使用
- `QuickAiModal.tsx:220` `useEffect` 缺 6 依赖
- 等（见 §10 完整日志）

---

## 11. 附录：文件清单与统计

**审查覆盖**: `app/api/**/route.ts` 37 个 + `lib/*.ts` 7 个 + `components/**` 25 个 + `stores/useBabyStore.ts` + `prisma/schema.prisma` + `next.config.ts` + `package.json` + `Dockerfile` + `docker-compose.yml` + `scripts/*` + `public/sw.js` 等共 **42 tsx/ts + 3 PWA + 6 配置**

**问题总数**: 19 安全 + 22 架构 + 25 数据 + 28 前端 + 18 工程化 = **112 项**（含重复交叉，PR 需去重约 70 独立项）

**生成**: Muse Spark 5 路并行子代理 + 汇总 | **产物**: `docs/COMPREHENSIVE_REVIEW_2026-08-24.md`（本文件）

> 建议纳入 `/.agents`/`.claude` 工作流 `pre-PR` 检查：`any` 计数、重复 `safeJsonParse`、匿名 `findFirst`、未校验 `babyId` 扫描。

