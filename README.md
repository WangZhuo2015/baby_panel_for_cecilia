# 宝宝成长工作台 (baby-panel-for-cecilia)

一个面向中国家庭的宝宝成长记录与育儿参考 Web 应用,移动端优先,支持 PWA 推送通知。

## 功能

- **日常记录**:喂奶、睡眠、尿布、辅食记录,今日汇总与时间轴
- **成长曲线**:身高/体重/头围/BMI 记录与 WHO 百分位图表
- **育儿参考**:国家免疫规划疫苗与自费疫苗方案、发育里程碑与预警征象、辅食添加指南与食材库、绘本推荐库
- **天气**:苏州实时天气、UV/空气质量、宝宝外出建议
- **AI 建议**:接入本地 Hermes API(OpenAI 兼容)生成个性化育儿建议,失败时回退到静态建议
- **推送通知**:疫苗提醒、每日记录提醒、AI 建议推送(Web Push)

## 技术栈

- Next.js 16 (App Router) + React 19 + TypeScript
- Prisma 7 + SQLite(libsql 适配器)
- Zustand 状态管理、react-hook-form、recharts、Tailwind CSS v4
- web-push 推送通知 + Service Worker

## 快速开始

```bash
npm install

# 1. 配置环境变量
cp .env.example .env
# 编辑 .env,至少设置 DATABASE_URL

# 2. 初始化数据库(应用已有基线迁移)
npx prisma migrate dev

# 3. 导入种子数据(宝宝信息、疫苗、里程碑、食材、绘本、活动等)
npm run db:seed

# 4. 开发
npm run dev

# 5. 生产构建
npm run build
npm start
```

> 首次使用 Web Push 前需要生成 VAPID 密钥并填入 `.env`:
> `npx tsx scripts/generate-vapid-keys.ts`

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建(`output: standalone`) |
| `npm start` | 启动生产服务器(默认 3000 端口) |
| `npm run lint` | oxlint 代码检查 |
| `npm run db:seed` | 清空并导入种子数据 |
| `npm run db:studio` | Prisma Studio 可视化数据库 |

## 目录结构

```
app/              # 页面与 API 路由 (App Router)
  (main)/         # 主界面页面(首页/绘本/发育/辅食/成长/疫苗/天气)
  records/        # 记录页(喂奶/睡眠/尿布)
  notifications/  # 通知中心 + 推送开关
  api/            # 后端 API 路由
components/       # UI 组件
stores/           # Zustand store
lib/              # 共享逻辑(prisma/日期/年龄/AI tips)
prisma/           # Schema、迁移、种子脚本
data/             # 种子数据源(01_sources ~ 06_activities)
public/sw.js      # Service Worker(推送)
```

## 部署说明

- 本机部署示例:`npm run build` 后 `npm start -p 3000`,nginx 反代到公网
- 推送鉴权:未配置 `PUSH_SEND_TOKEN` 时 `/api/push/send` 返回 503,防止任意人群发
- 数据来源与核对日期在应用内通过"数据版本"标识展示,以 `prisma/migrations` 中的基线迁移为准
- 环境变量参考 `.env.example`

## 免责声明

应用内疫苗/发育/辅食等参考信息及 AI 建议仅供参考,不作为医疗诊断依据。如有疑问请咨询专业医生。
