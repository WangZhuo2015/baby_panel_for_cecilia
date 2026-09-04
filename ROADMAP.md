# 宝宝成长工作台 (Baby Panel) — 产品与技术演进路线图 (ROADMAP)

> **版本基线**: v1.2.1  
> **更新时间**: 2026-09-04  
> **维护规范**: 严格遵循 [AGENTS.md](AGENTS.md) 测试数据隔离与生产环境防火墙规范。

---

## 一、 产品定位与核心设计原则

- **家庭多看护人协同**: 移动端优先，支持宝爸、宝妈、月嫂、祖辈多角色加入同一家庭共享记录与实时提醒。
- **儿科专业度与确定性计算**: 拒绝非确定性大模型直接进行儿科数值算术；所有营养摄入、WHO 生长标准百分位、临床母乳摄入估算均在强类型 TypeScript 确定性引擎中计算。
- **多端响应式育儿工作台 (iPad-First)**: 手机手持卡片流与 iPad/宽屏桌面抽屉协同工作区无缝自适应。
- **无感与极速语音中枢**: 专为 HomePod 与 Siri 快捷指令优化，毫秒级快速路径 (<100ms) 极速应答高频问答与记录。
- **多模型灵活接入与隐私合规**: 支持解耦的多 Provider 模型 Profile 动态切换；外部 Agent 通过高内聚远程 MCP (OAuth 2.1) 连接，支持破坏性操作快照与自然语言一键撤销。

---

## 二、 架构演进与已交付里程碑 (Delivered)

### 1. 核心架构 ADR 体系 (0001 ~ 0006)
- [x] **ADR 0001 (Web Chat 架构)**: 采用 OpenRouter 原生 Completions Adapter + 进程内 Pi Agent 循环，杜绝无状态 Web 端接入外部重型 Agent 网关。
- [x] **ADR 0002 (确定性营养引擎与产品库)**: 建立奶粉与复合补剂产品档案，依据中国 DRIs (WS/T 578) 实现宏量与微量营养素达标率与过量防范。
- [x] **ADR 0003 (iPad / 桌面响应式双模工作台)**: 突破 430px 单一宽度限制，为平板横屏及宽屏构建侧边导航栏、抽屉式快速录入与双栏 AI 会话面板。
- [x] **ADR 0004 (高内聚粗粒度远程 MCP)**: 为 Gemini Spark 等 Connected Apps 整合 5 个粗粒度高内聚工具，将多步交互的授权弹窗从 5~10 次骤降至 1 次/轮。
- [x] **ADR 0005 (数据快照与自然语言撤销)**: 引入 `RecordSnapshot` 表，对所有破坏性删除/重写进行事件化无损捕获，支持自然语言“撤销刚才的删除”。
- [x] **ADR 0006 (母乳生理摄入量推算与辅食营养素整合)**:
  - 引入基于临床泌乳医学的有效吮吸时长分段推算模型（0-10m / 10-20m / >20m），消除母乳喂养在每日总奶量中的漏记缺失。
  - 引入 30+ 种婴幼儿标准辅食食材库（高铁米粉、纯肉泥、蛋黄泥、果蔬），将辅食铁、锌、钙等微量元素纳入每日 DRIs 达标计算。

### 2. 语音代理与快捷指令中枢 (Voice Agent MVP)
- [x] **Fast-Path 极速查询引擎 (<100ms)**: 涵盖今日奶量、睡眠、大小便、辅食汇总，纯文本 Siri TTS 自然朗读。
- [x] **自然语言语音录入与超时回退**: 15s 客户端超时熔断保护，超时自动转入后台异步 Agent 执行并通过推送送达结果。
- [x] **多 Profile LLM 配置与 CLI 切换器**:
  - 提供 `llm-profiles.json` 统一配置多厂商（OpenRouter、OpenCode、兼容 OpenAI 接口）。
  - 提供 `npm run llm:switch` CLI 交互式热切换与健康检查。

### 3. 安全防护与数据隔离基线
- [x] **生产环境与测试库物理隔离**: 强制 `DATABASE_URL=file:./dev_test.db` 与 `PORT=3089`，Prisma 运行时设置生产库硬熔断防护。
- [x] **PAT 个人访问令牌哈希化**: 存量明文废弃，SHA-256 哈希存库，仅返回 hint，杜绝数据库泄露风险。
- [x] **静态资源防越权与 CORS 加固**: `/uploads` 移除反射 CORS 头，仅允许安全同源加载。
- [x] **高频接口补齐限流**: `/mcp`、`ai/sessions`、`push/send`、`user/tokens` 全面增加 IP 与用户维度限流。

### 4. 自动化测试与质量防护网 (本次交付)
- [x] **GitHub Actions 门禁工作流 (`.github/workflows/ci.yml`)**:
  - 全量覆盖：依赖安装、Prisma 生成、TypeScript 类型检查 (`typecheck`)、代码规范检查 (`oxlint`)、数据库迁移基线漂移校验、自动化测试、Docker 构建测试。
  - 配置 `permissions: contents: read` 与并发取消机制。
- [x] **语音集成测试环境解耦 (Mock LLM)**:
  - 在 `tests/api/agent-voice.test.ts` 中使用内建 Faux Provider 替代实时外部大模型调用，实现毫秒级确定性测试，杜绝因外部网络或模型波动导致的测试红灯。
- [x] **认证全链路 API 集成测试 (`tests/api/auth.test.ts`)**:
  - 覆盖 `register`（输入校验、密码长度、唯一性冲突）、`login`（错误密码拦截、Cookie/Token 签发）、`me`（会话识别与活跃宝宝）、`logout`。
  - 严格遵守 `AGENTS.md` 测试租户创建与 `t.after` 级联销毁。
- [x] **API 测试套件全绿**: `npm run test:api:server` 11 个套件全部通过（0 失败、0 孤儿数据残留）。

### 5. 渲染架构与性能现代化交付 (Phase 2 已交付)
- [x] **`next/image` 全量替换与优化**:
  - 创建自适应 `BabyAvatar` 组件（防布局抖动 CLS、错误占位符、data/blob URL 自动 unoptimized）。
  - 全局 12 处宝宝头像与医疗化验单、生长拍照、AI 聊天缩略图全面迁移至 `next/image`。
  - `next.config.ts` 配置 `remotePatterns` 支持多源图片加载。
- [x] **重型依赖按需动态拆包**:
  - `NutritionTrendChart` (recharts) 转换为 `next/dynamic`（禁用 SSR，骨架占位）。
  - `QuickAiModal` (react-markdown / remark-gfm / agent core) 采用动态按需加载，未唤起时不载入主布局 bundle。
- [x] **鉴权与活跃租户上下文记忆化**:
  - 在 `lib/auth.ts` 中基于 `WeakMap<Request, Promise<AuthSessionUser>>` 实现单次请求内鉴权记忆化。
  - 在 `lib/api-helpers.ts` 中支持直接传入已鉴权的 `AuthUser` 对象，从内存 memberships 解析家庭与宝宝，单次 API 消除 2~3 次冗余 Prisma 查库。
- [x] **叶子级秒表计时器解耦**:
  - 提取 `NursingDualTimer.tsx` 独立微组件，将 1 秒跳秒的 `setInterval` 限制在叶子节点内，消除 `FeedingForm` 整体每秒 60 次的无谓重渲染。

### 6. 数据可靠性与端到端测试交付 (Phase 3 已交付)
- [x] **ADR 0007 (数据契约与模式演进架构)**:
  - 明确 SQLite 与生产数据库（`prod.db`）物理保护原则，制定零停机向原生 DateTime 与 Prisma Enum 的演化路径。
  - 评估与规划 TanStack Query (React Query) 替代手动 Zustand 切片请求的设计。
- [x] **Playwright 端到端 (E2E) 冒烟测试套件 (`tests/e2e/smoke.spec.ts`)**:
  - 覆盖主流程三大核心场景：
    1. 家长注册/登录 -> 添加宝宝资料 -> 主工作台即时生效。
    2. 今日工作台尿布打卡 -> 时间轴即时流水呈现。
    3. 每日总结看板 -> 2D Canvas 成长日报海报弹窗渲染。
  - 打造一键自动化运行脚本 `scripts/test-e2e.sh` 与 `npm run test:e2e`，集成自动数据库迁移、静态数据播种与测试租户自动清理。

### 7. 独立 Agent 深度审查与闭环加固 (已完成 ✅)
- [x] **CI 全流程安全门禁复原**:
  - 补充新数据库临时部署验证 (`file:/tmp/ci-fresh.db`)，提前拦截不可部署的迁移脚本。
  - 补充关键依赖漏洞审计 (`npm audit --audit-level=critical`)。
  - 补充版本一致性防漂移检查（`package.json`、`lib/version.ts` 与 `sw.js` 强制同步）。
  - 补充 Next.js 生产环境构建校验 (`npm run build`)。
- [x] **图片优化代理收敛与 SSRF 防护**:
  - 收敛 `next.config.ts` 中的 `remotePatterns`，杜绝通配符带来的公网代理中继风险。
  - 在 `BabyAvatar.tsx` 中对外部与 Blob URL 强制使用 `unoptimized`，并在 `src` 变更时自动重置错误态。
- [x] **全量路由接入会话内存级解析**:
  - 11 个业务路由（喂养、睡眠、尿布、时间线、生长、辅食、补剂、营养分析、语音解析）全面传入 `auth.user`，实现零 Prisma 查库。
- [x] **测试环境与 Mock 安全熔断**:
  - `auth.test.ts` 默认端口修正为 3089；`lib/agent/run.ts` 增加生产环境禁止 Mock 流函数的硬校验；E2E 测试前缀严格对齐规范。

### 8. PWA 与前端体验长尾项收敛 (已完成 ✅)
- [x] **母乳亲喂秒表防漂移与持久化保护 (P2-22 & F-09)**:
  - 采用真实时间戳差值计算（Timestamp Delta），彻底消除手机锁屏或切换后台时浏览器降频导致的计时漂移。
  - 基于 `localStorage` 实现秒表草稿持久化与 12 小时内自动断点恢复，并在 `visibilitychange` 时即时校准，表单提交后自动清除。
- [x] **PWA Standalone 深链返回安全兜底 (P2-24)**:
  - 解决通过推送通知或桌面快捷方式直接打开二级页面时，`history.back()` 因空栈导致返回无响应的“孤岛困境”，自动平滑回退至主工作台 `/`。
- [x] **PWA 安装横幅事件动态感知 (P2-19)**:
  - 监听 `appinstalled` 与 `(display-mode: standalone)` 变更事件，在用户完成安装瞬间即时自动隐藏安装横幅。
- [x] **离线页面自动恢复回站 (P2-21)**:
  - `offline.html` 监听 `online` 事件，网络恢复瞬间无需手动刷新即可自动重定向回站。
- [x] **iPad 与桌面多端横竖屏自适应 (P2-27)**:
  - `manifest.json` 解除 `orientation: portrait` 强锁，设为 `any`，全面契合 iPad 横屏工作台体验。
- [x] **删除操作 HTTP 幂等化处理 (P2-23)**:
  - 核心记录 DELETE 路由遇不存在记录返回 `alreadyDeleted: true` 语义成功，消除多标签页或双击时前端误弹“删除失败”的问题。

---

## 三、 待完成与进行中缺口 (Current Gaps)

```
[基础设施与部署]
├── ⏳ 存量看护人 PAT 重新生成指引（加固废弃后的重新下发）
├── ⏳ Docker 生产镜像启动入口自动应用迁移（ENTRYPOINT 脚本执行 migrate deploy）
└── ⏳ 补充未覆盖路由集成测试（medical/upload, medical/ocr, push/*）

[前端与状态架构]
├── ⏳ 逐步引入 TanStack Query 替代部分手写 Zustand 数据拉取切片
└── ⏳ 页面级 Server Component (RSC) 服务端流式渲染拆分

[儿科产品与业务深度]
├── ⏳ 食物过敏引入时间轴与高致敏排查日历
├── ⏳ 多次体检单化验指标跨期趋势联动折线图
└── ⏳ 语音助手多轮澄清问答与多宝宝快速切换
```

---

## 四、 分阶段推进规划 (Phased Roadmap)

#### Phase 1: 质量与部署闭环 (已交付 ✅)
**目标**: 固化代码质量门禁，消除公网部署与协作开发时的回归风险。
1. **GitHub Actions 门禁上线**: 确保推送到 `main` 分支及 PR 时全流程自动跑通。
2. **认证全链路测试与 Mock 解耦**: 消除外部依赖，保障毫秒级确定性验证。
3. **安全基线全覆盖**: CI 门禁、依赖漏洞审计与版本防漂移校验。

### Phase 2: 渲染架构与性能现代化 (已交付 ✅)
- [x] `next/image` 全量替换与优化
- [x] 重型依赖动态拆包 (recharts, react-markdown)
- [x] Request 级鉴权与租户上下文记忆化
- [x] 叶子级秒表优化 (NursingDualTimer)

### Phase 3: 数据建模与长效可靠性 (已交付 ✅)
- [x] ADR 0007 数据契约与架构评估
- [x] 核心主流程 Playwright E2E 冒烟测试
- [x] 渐进式状态管理演进规划 (TanStack Query)

### Phase 4: 儿科业务深度与智能化进阶 (下一阶段重点)
**目标**: 从“日常记录工具”升级为“专业儿科与家庭育儿智能中枢”。
1. **过敏原筛查与引入排查体系**:
   - 针对 8 大类高致敏食物（牛奶、鸡蛋、花生、坚果、小麦、大豆、鱼、甲壳类），建立排查打卡与过敏反应（皮疹、腹泻、拒食）预警追踪。
2. **多期体检指标趋势联动图**:
   - 汇聚多次儿保体检与化验单（血常规、微量元素、骨密度），生成随月龄变化的医学指标趋势折线图，辅助儿科复诊。
3. **疫苗接种个性化门诊日历**:
   - 允许自定义接种门诊开放日（如某社区医院仅每周二、四上午接种疫苗），智能修正接种提醒日期。
4. **多宝宝家庭无缝切换**:
   - 在顶栏与语音指令中支持“姐姐”与“弟弟”自然切换，多份档案互不串号。

---

## 五、 质量与发布检查清单 (Release Checklist)

每次版本发布前需通过以下硬性指标：
- [x] `npm run typecheck` 0 错误
- [x] `npm run lint` 0 错误
- [x] `npx prisma validate` 语法正常
- [x] `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` 零模式漂移
- [x] `npm test` 单元与 AI 测试 100% 通过 (120/120)
- [x] `npm run test:api:server` API 集成测试 100% 通过且测试库零数据残留 (11/11)
- [x] `npm run test:e2e` Playwright E2E 冒烟测试 100% 通过 (3/3)
- [x] 严格遵守测试账号前缀 `test_` / `e2e_`，严禁写入生产库 (prod.db 零接触)
