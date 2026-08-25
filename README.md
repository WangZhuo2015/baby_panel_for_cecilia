# 宝宝成长工作台 (Baby Panel)

一个面向中国现代家庭的宝宝成长记录与育儿参考 Web 应用，移动端优先，支持**多家长/家庭成员协同共享**、**公网部署**与 **PWA 推送通知**。

## 🌟 核心特性

- **多家长家庭协同**: 支持多用户（用户名 + 密码）认证与家庭邀请码机制，宝爸、宝妈、长辈看护可加入同一家庭共同记录与查看。
- **日常记录**: 喂奶、睡眠、尿布、辅食记录打卡，今日汇总统计与时间轴。
- **专业生长曲线 (WHO 标准)**: 内置完整的 WHO 0-36 个月男宝/女宝生长标准数据库（体重、身长、头围 P3~P97 分位曲线及动态百分位估算）。
- **育儿参考知识库**: 国家免疫规划疫苗与自费方案、发育里程碑与预警征象、辅食添加指南与食材库、绘本推荐库与亲子活动库。
- **智能天气**: 支持浏览器实时定位天气、UV 指数、空气质量及外出活动建议。
- **AI 育儿助手 & 体检单识别**: OpenRouter（默认 `stealth/ox-alpha`）+ Pi Agent 工具调用；严谨报错并支持手动重试，无虚假假数据兜底。
- **Web Push 推送通知**: 疫苗接种提醒、每日记录提醒。

---

## 🛠️ 技术栈

- **前端 / 服务端**: Next.js 16 (App Router + Standalone) + React 19 + TypeScript
- **数据库 & ORM**: Prisma 7 + SQLite (`@prisma/adapter-libsql`)
- **认证体系**: JWT Session (HTTP-Only Cookie) + bcryptjs 密码哈希
- **状态管理 & 样式**: Zustand 5 + Tailwind CSS v4 + Lucide Icons + Recharts
- **推送服务**: Web Push + Service Worker

---

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，按需配置 JWT_SECRET、AI_API_KEY 等

# 3. 初始化数据库与知识库
npx prisma db push
npm run db:seed

# 4. 本地启动开发环境
npm run dev
```

打开浏览器访问 `http://localhost:3000` 即可使用。

### 数据库迁移策略

项目采用 **基线迁移（baseline）** 模式，`prisma/migrations/20260824120000_baseline` 与当前 `schema.prisma` 完全一致（含全部复合索引）：

| 场景 | 命令 |
|------|------|
| 全新数据库部署 | `npm run db:deploy`（执行 migrate deploy 建表+索引），再 `npm run db:seed` |
| 既有库（曾用 db push 同步） | 首次需登记基线：`npx prisma migrate resolve --applied 20260824120000_baseline` |
| 开发期快速同步 schema | `npm run db:push`（不走迁移记录） |

> ⚠️ 注意：`migrate deploy/resolve` 在 dev 服务器运行时会因 SQLite 写锁报 `database is locked`，请先停服或对副本操作。修改 schema 后请用 `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` 检查漂移并生成增量迁移。

---

## 🐳 公网与 Docker 部署

### 方式 A: Docker Compose 一键启动 (推荐)

```bash
# 1. 启动容器 (自动挂载持久化数据卷)
docker compose up -d --build

# 2. 初次启动导入基础知识库 (可选)
docker compose exec baby-panel npm run db:seed
```

### 方式 B: 本机 Node.js Standalone 模式

```bash
npm run build
npm start
# 配合 Nginx / Caddy 反向代理到公网域名并开启 HTTPS
```

---

## ⚙️ 环境变量说明

参考 [`.env.example`](file:///.env.example)：

| 变量名 | 说明 | 示例 / 默认值 |
| :--- | :--- | :--- |
| `DATABASE_URL` | SQLite 数据库路径 | `file:./dev.db` 或 `file:/app/data/app.db` |
| `JWT_SECRET` | 用户会话加密密钥 | 生产环境务必设置强随机字符串 |
| `OPENROUTER_API_KEY` | OpenRouter API Key（聊天必填） | `sk-or-v1-...` |
| `OPENROUTER_MODEL` | OpenRouter 模型 | `stealth/ox-alpha` |
| `AI_BASE_URL` | 可选 OpenAI 兼容回落（勿指向 Hermes） | `https://api.deepseek.com/v1` |
| `AI_API_KEY` | 回落接口 Key | `sk-...` |
| `AI_MODEL` | 回落文本模型 | `deepseek-chat` / `gpt-4o-mini` |
| `AI_VISION_MODEL` | 可选视觉模型覆盖 | `gpt-4o-mini` / `qwen-vl-max` |
| `VAPID_PUBLIC_KEY` | Web Push 公钥 | 运行 `scripts/generate-vapid-keys.ts` 生成 |
| `VAPID_PRIVATE_KEY` | Web Push 私钥 | 运行 `scripts/generate-vapid-keys.ts` 生成 |
| `PUSH_SEND_TOKEN` | 推送发送鉴权 Token | 自定义字符串 |

---

## 📋 免责声明

应用内疫苗、发育指标、辅食指南及 AI 建议仅供日常参考与记录辅助，不作为医疗诊断依据。如有疑问请及时咨询专业儿科医生。
