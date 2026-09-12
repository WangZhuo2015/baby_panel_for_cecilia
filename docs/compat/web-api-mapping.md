# Web API 兼容层字段与协议映射规格 (R0 修正稿)

> 任务对应：`SH-00 (R0 语义修复)` / `SH-01 契约准备`  
> 规范权威：以实际旧源码 `app/api/**`、`lib/records/service.ts`、`prisma/schema.prisma` 与服务端规范 `docs/plan/implementation/02_BACKEND_CONTRACTS.md`、`03_DATABASE_MIGRATION.md`、`07_LOCAL_FIRST_OPTIONAL_SYNC.md`、`08_ACCOUNT_BABY_RELATIONSHIPS.md` 为准。  
> 状态：规范草案（Draft Specification），不代表当前 Web 已经完成切换。

---

## 1. 架构总览与兼容层定位

```mermaid
flowchart LR
    subgraph Client [前端客户端]
        Browser[Web 浏览器 / Zustand Stores]
        iOSApp[iOS 原生端 (Local GRDB + Optional Sync)]
    end

    subgraph WebHost [现有 Web 容器 (Next.js 15)]
        Pages[UI 页面 / SWR / Stores]
        BFF[Next.js 同源 Route Handlers<br/>(/api/** 兼容层)]
    end

    subgraph CoreBackend [GrowDesk 独立后端服务]
        FastifyAPI[Fastify 5 业务 API<br/>(/api/v1/**)]
        UnitOfWork[UnitOfWork / 事务框架]
        PG[(PostgreSQL 18)]
        Redis[(Redis 8 / BullMQ)]
        S3[(私有 S3 对象存储)]
    end

    Browser -- 1. __Host-growdesk_web Cookie<br/>CSRF Header --> BFF
    BFF -- 2. 受信 BFF Bearer 会话<br/>X-Request-ID / 幂等键 --> FastifyAPI
    iOSApp -- Bearer Access Token<br/>Idempotency-Key --> FastifyAPI
    FastifyAPI --> UnitOfWork
    UnitOfWork --> PG
    UnitOfWork --> Redis
    UnitOfWork --> S3
```

- **单一写权威**：只有新 GrowDesk 服务端持有 PostgreSQL 18 的业务写权限；Next.js BFF 仅作为同源 HTTP 客户端代理与格式转换层，**严禁直连 PG**，也**不长期双写 SQLite**。
- **透明兼容**：现有 Web 界面（Zustand 状态层 `stores/slices/*.ts` 与 React UI 组件）继续发起同源 `/api/...` 请求，BFF 负责参数校验、凭据挂载、旧字段与 DTO 双向映射。
- **严格失败语义**：兼容层不将上游 4xx/5xx 改为 200 假成功，不静默吞掉或覆盖关键字段。
- **目标 operationId 标识**：在 SH-01 正式冻结 OpenAPI 3.0.3 之前，所有目标端点操作标识均标记为 `PROPOSED:<operationId>`。

---

## 2. 通用跨领域映射规范

### 2.1 鉴权与会话传递
- **旧模式**：
  - Web：浏览器使用单一 `auth_token` Cookie（存储 JWT），直接调用 `lib/auth.ts:getAuthUser()` 解密并在各 API 中作为身份依据；部分路由存在 `findFirst()` 匿名越权漏洞。
  - MCP：`app/mcp/route.ts` 明确使用 `verifyMcpAccessToken` 验证 **OAuth 2.1 Bearer Token**，而不是 Cookie。
- **新模式**：
  - Web 浏览器采用 256-bit 随机不透明会话 Cookie（命名为 `__Host-growdesk_web`，`HttpOnly; Secure; SameSite=Lax; Path=/`）。
  - Next.js BFF 持有托管凭据映射，代向 GrowDesk `/api/v1` 交换短期 Bearer Access Token。
  - 写入操作强制校验请求的 `Origin` 白名单与 CSRF Token。
  - 彻底剥离旧 Web 路由中的 `prisma.baby.findFirst()` 隐式回退，所有需要宝宝上下文的请求必须显式携带 `babyId`，由 GrowDesk 服务端核对 `BabyMember` 权限。
  - MCP 客户端（如 Gemini Spark / Claude）继续使用 OAuth 2.1 Bearer Token 访问 GrowDesk 统一 MCP 端点。

### 2.2 响应 Envelope 结构转换
- **旧 Web 响应事实**：
  - 记录新增 (POST)：HTTP 201，直接返回完整实体对象 `{ id, babyId, timestamp, amountMl, ... }`。
  - 记录删除 (DELETE)：HTTP 200，返回 `{ success: true, id: string, alreadyDeleted?: boolean }`。
  - 记录查询 (GET)：HTTP 200，直接返回数组 `[ ... ]`。
  - 错误响应：HTTP 400/403/404/500，返回 `{ error: "错误文案" }`。
- **新 GrowDesk API (02 规范)**：
  - 单实体成功：`{ "data": { ... } }`
  - 列表成功：`{ "data": [ ... ], "page": { "nextCursor": "string|null" } }`
  - 错误响应：
    ```json
    {
      "error": {
        "code": "VALIDATION_FAILED",
        "message": "用户友好提示信息",
        "details": [ ... ],
        "requestId": "req_uuid"
      }
    }
    ```
- **BFF 转换职责**：
  - BFF 向前端输出时，根据旧前端组件所期待的格式解包 `{ data: ... }`；若旧前端期望 `{ success: true, ... }`，则在 BFF 补齐包装。
  - 发生错误时，提取 `error.message` 与 `error.code`，映射为旧前端能渲染的错误结构，保持 HTTP 状态码一致。

### 2.3 日期、时间与时区规范
- **旧 Web 事实**：
  - 事件时刻字段：如 `timestamp`、`startTime`、`endTime` 接收客户端 ISO 字符串（例如 `2026-09-12T14:30:00+08:00`）。
  - 日历日期字段：如 `date` 接收 `YYYY-MM-DD` 字符串。
- **新 GrowDesk 规格**：
  - **事件时刻**：强制使用 RFC3339 含时区格式，服务端统一归一化为 UTC ISO 毫秒时间戳存储。
    - **正确时区换算示例**：北京时间 `2026-09-12T14:30:00+08:00` 对应 UTC 时间为 `2026-09-12T06:30:00.000Z`（严禁误算为 `14:30Z`）。
  - **日历日期**：严格采用 `YYYY-MM-DD` 格式（如 `2026-09-12`），不得因时区偏移截断为前一日 UTC 午夜。
  - **家庭时区**：从 `Family.timeZone` 显式获取（默认 `Asia/Shanghai`）。

### 2.4 小数值与度量单位 (Decimal Precision)
- **旧 Web 事实**：
  - `amountMl`、`weightKg`、`heightCm`、`headCircumferenceCm` 在 SQLite 中为 Float，前端直接传 number 或 string number。
- **新 GrowDesk 规格**：
  - 身高 (`heightCm`)、体重 (`weightKg`)、头围 (`headCircumferenceCm`)、摄入量 (`amountMl`) 均以**十进制字符串 (Decimal String)** 传输。
  - schema 显式固定单位（如 `weightKg: "12.350"`，`heightCm: "85.2"`）。
  - BFF 负责在旧前端 number 类型与服务端 string 之间进行无损安全转换。

### 2.5 幂等性、版本控制与并发锁
- **旧 Web 事实**：
  - 旧 Web 前端通过 `clientId`（UUID）在 IndexedDB outbox 中去重，但服务端未强校验 `Idempotency-Key`。
  - 无乐观锁机制，PUT 更新直接覆盖。
- **新 GrowDesk 规格**：
  - **POST 创建**：HTTP Header 必须携带 `Idempotency-Key: <UUID>`（BFF 将客户端的 `clientId` 映射为 `Idempotency-Key`）；同一 Key 重复提交返回同结果，异内容返回 `409 CONFLICT`。
  - **PATCH / PUT 更新与 DELETE 删除**：请求携带 `baseVersion`（目标实体的当前版本号）；若服务端已被他人修改，返回 `409 VERSION_MISMATCH`。
  - 实体内部维护自增整数 `version`。

### 2.6 多宝宝与权限隔离 (08 规范)
- **旧 Web 痛点**：`lib/auth.ts` 中存在 `getAuthSession` 找不到关联宝宝时回退 `prisma.baby.findFirst()`，导致多宝宝家庭或未授权用户串号。
- **新 GrowDesk 规格**：
  - 客户端通过选择器明确当前操作的 `babyId`。
  - 服务端在 UnitOfWork 事务中重验当前用户在该宝宝上的 `BabyMember.status = 'active'`。
  - 彻底杜绝全表扫描兜底。

---

## 3. 核心业务领域逐字段真实映射表

### 3.1 喂养记录 (Feeding Records: SH-04F)
- **旧路由入口**：`app/api/records/feeding/route.ts`（GET, POST, PUT, DELETE）
- **旧代码事实**：
  - POST 读取：`type`, `timestamp`, `amountMl`, `leftMinutes`, `rightMinutes`, `spitUp`, `notes` (max 1000), `clientId`, `formulaProductId`, `source`, `sourceAgent`。
  - 状态码：POST 成功为 201；DELETE 成功为 200 (`{ success: true, id, alreadyDeleted?: true }`)。
  - 服务层校验：`records.validateFeedingStrict(body)`，`notes` 长度限制 1000 字符。
- **目标 GrowDesk API**：`GET/POST /api/v1/babies/:babyId/records/feeding`，`PATCH/DELETE /api/v1/babies/:babyId/records/feeding/:id`

| 旧字段名 | 旧类型 | 目标字段名 | 目标类型 | 映射规则与约束 |
|---|---|---|---|---|
| `id` | `string` (cuid) | `id` | `string` (UUID/cuid) | 保留旧 ID，新记录生成 UUIDv4 |
| `babyId` | `string` | URL 路径 `:babyId` | `string` | 路径参数，BFF 校验合法性 |
| `type` | `"breast" \| "bottle" \| "formula"` | `feedingType` | `enum` | 保持旧枚举：`breast`, `bottle`, `formula` |
| `timestamp` | `string` (ISO) | `occurredAt` | `string` (RFC3339) | 归一化为 UTC ISO 字符串，如 `2026-09-12T06:30:00.000Z` |
| `amountMl` | `number \| string \| null` | `amountMl` | `string \| null` (Decimal) | 奶量毫升，转换为十进制字符串，如 `"150.0"` |
| `leftMinutes` | `number \| string \| null` | `leftMinutes` | `integer \| null` | 母乳亲喂左侧分钟数 |
| `rightMinutes` | `number \| string \| null` | `rightMinutes` | `integer \| null` | 母乳亲喂右侧分钟数 |
| `spitUp` | `boolean \| "true" \| 1` | `spitUp` | `boolean` | 真实布尔值（严禁编造为 MILD 等未定义临床枚举） |
| `formulaProductId` | `string \| null` | `formulaProductId` | `string \| null` | 关联的配方奶产品 ID |
| `notes` | `string \| null` | `notes` | `string \| null` | 最大 1000 字符（严格遵守旧业务上限） |
| `clientId` | `string` (UUID) | Header `Idempotency-Key` | `string` (UUID) | 映射为服务端创建幂等键 |
| `source` | `string` | `source` | `string` | 来源标示（ui_manual / ai_chat / voice / mcp） |
| `sourceAgent` | `string` | `sourceAgent` | `string` | 协同 Agent 标示 |
| *(新字段)* | - | `version` | `string` (Int64) | 乐观锁版本号 |

---

### 3.2 睡眠记录 (Sleep Records: SH-04S)
- **旧路由入口**：`app/api/records/sleep/route.ts`（GET, POST, DELETE）
- **旧代码事实**：
  - POST 明确要求：`if (!body.startTime || !body.endTime)` 报 400；`startTime` 和 `endTime` 均为**必填且非空字符串**。
  - 字段：`startTime`, `endTime`, `type` ("nap" | "night"), `nightWakingCount` (integer, min 0), `notes` (max 1000), `clientId`, `date`, `source`, `sourceAgent`。
  - 无 `quality` 或 `awakeningCount` 字段。
- **目标 GrowDesk API**：`GET/POST /api/v1/babies/:babyId/records/sleep`，`PATCH/DELETE /api/v1/babies/:babyId/records/sleep/:id`

| 旧字段名 | 旧类型 | 目标字段名 | 目标类型 | 映射规则与约束 |
|---|---|---|---|---|
| `id` | `string` | `id` | `string` | 原样保留/新成UUID |
| `babyId` | `string` | URL 路径 `:babyId` | `string` | 路径参数 |
| `startTime` | `string` (ISO, 必填) | `startedAt` | `string` (RFC3339) | 入睡时刻（UTC） |
| `endTime` | `string` (ISO, 旧必填) | `endedAt` | `string \| null` | **新能力单列**：目标 02 允许进行中活跃睡眠（`endedAt=null`）；旧 Web 前端发起必须兼容非空规则 |
| `type` | `"nap" \| "night"` | `sleepType` | `enum` | 保持 `"nap"`（小睡）与 `"night"`（夜觉） |
| `nightWakingCount` | `integer` (min 0) | `nightWakingCount` | `integer` | 夜醒次数，默认 0 |
| `notes` | `string \| null` | `notes` | `string \| null` | 最大 1000 字符 |
| `clientId` | `string` | Header `Idempotency-Key` | `string` | 幂等键 |
| *(新字段)* | - | `version` | `string` | 乐观锁版本号 |

---

### 3.3 尿布记录 (Diaper Records: SH-04D)
- **旧路由入口**：`app/api/records/diaper/route.ts`（GET, POST, DELETE）
- **旧代码事实**：
  - 字段：`type` ("pee" | "poop" | "both"), `timestamp`, `poopColor`, `poopConsistency`, `notes` (max 1000), `clientId`, `source`, `sourceAgent`。
- **目标 GrowDesk API**：`GET/POST /api/v1/babies/:babyId/records/diaper`，`PATCH/DELETE /api/v1/babies/:babyId/records/diaper/:id`

| 旧字段名 | 旧类型 | 目标字段名 | 目标类型 | 映射规则与约束 |
|---|---|---|---|---|
| `id` | `string` | `id` | `string` | 原样映射 |
| `babyId` | `string` | URL 路径 `:babyId` | `string` | 路径参数 |
| `type` | `"pee" \| "poop" \| "both"` | `diaperType` | `enum` | 保持 `"pee"`, `"poop"`, `"both"` |
| `timestamp` | `string` (ISO) | `occurredAt` | `string` (RFC3339) | 事件时间戳（UTC） |
| `poopColor` | `string \| null` | `poopColor` | `string \| null` | 便便颜色 |
| `poopConsistency` | `string \| null` | `poopConsistency` | `string \| null` | 便便性状（如 loose, paste, formed） |
| `notes` | `string \| null` | `notes` | `string \| null` | 最大 1000 字符 |
| *(新字段)* | - | `version` | `string` | 乐观锁版本号 |

---

### 3.4 辅食打卡记录 (Food Logs: SH-04FO)
- **旧路由入口**：`app/api/food/logs/route.ts`（GET, POST, PUT, DELETE）
- **旧代码事实**：
  - 字段：`date` (YYYY-MM-DD), `time` (HH:mm), `mealType` ("breakfast"|"lunch"|"dinner"|"snack"), `foodItemIds` (array of string), `amount` (string), `reaction` ("like"|"normal"|"dislike"), `notes`, `clientId`。
- **目标 GrowDesk API**：`GET/POST /api/v1/babies/:babyId/records/food`，`PATCH/DELETE /api/v1/babies/:babyId/records/food/:id`

| 旧字段名 | 旧类型 | 目标字段名 | 目标类型 | 映射规则与约束 |
|---|---|---|---|---|
| `id` | `string` | `id` | `string` | 原样映射 |
| `babyId` | `string` | URL 路径 `:babyId` | `string` | 路径参数 |
| `date` | `string` (YYYY-MM-DD) | `recordDate` | `string` (YYYY-MM-DD) | 日历日期 |
| `time` | `string` (HH:mm) | `occurredAt` | `string` (RFC3339) | 结合 date 组合为完整带时区时间戳 |
| `mealType` | `enum` | `mealType` | `enum` | 餐次枚举 |
| `foodItemIds` | `string[]` | `foodItemIds` | `string[]` | 食材 ID 数组 |
| `amount` | `string \| null` | `portionDescription` | `string \| null` | 分量描述（如“半碗”） |
| `reaction` | `"like" \| "normal" \| "dislike"` | `reaction` | `enum \| null` | 婴儿接受度反馈 |
| `notes` | `string \| null` | `notes` | `string \| null` | 备注说明 |

---

### 3.5 成长测量与图表 (Growth Measurements & Chart: SH-04G)
- **旧路由入口**：
  - `app/api/growth/route.ts`（GET, POST, DELETE）
  - `app/api/growth/chart/route.ts`（GET）
- **旧代码事实**：
  - POST 字段：`date` (YYYY-MM-DD), `weightKg` (number), `heightCm` (number), `headCircumferenceCm` (number), `imageUrl`, `notes`, `clientId`。
  - 旧接口缺少针对记录单条更新的 PATCH 动作（仅在 stores 中通过删除+新增模拟，或未暴露）。
- **目标 GrowDesk API (02 Canonical 规范)**：
  - `GET /api/v1/babies/:babyId/growth-measurements`
  - `POST /api/v1/babies/:babyId/growth-measurements`
  - `PATCH /api/v1/babies/:babyId/growth-measurements/:id` (02 规范新增正规更新动作)
  - `DELETE /api/v1/babies/:babyId/growth-measurements/:id`
  - `GET /api/v1/babies/:babyId/growth-chart` (历史测量点 + WHO 百分位曲线叠加计算)

| 旧字段名 | 旧类型 | 目标字段名 | 目标类型 | 映射规则与约束 |
|---|---|---|---|---|
| `id` | `string` | `id` | `string` | 原样映射 |
| `babyId` | `string` | URL 路径 `:babyId` | `string` | 路径参数 |
| `date` | `string` (YYYY-MM-DD) | `measurementDate` | `string` (YYYY-MM-DD) | 日历日期 |
| `weightKg` | `number \| null` | `weightKg` | `string \| null` (Decimal) | 体重公斤数，转十进制字符串（如 `"8.45"`） |
| `heightCm` | `number \| null` | `heightCm` | `string \| null` (Decimal) | 身高厘米数，转十进制字符串（如 `"71.2"`） |
| `headCircumferenceCm`| `number \| null` | `headCircumferenceCm` | `string \| null` (Decimal) | 头围厘米数，转十进制字符串（如 `"44.5"`） |
| `imageUrl` | `string \| null` | `attachmentId` | `string \| null` | 迁移为 S3 附件 ID 引用 |
| `notes` | `string \| null` | `notes` | `string \| null` | 备注说明 |

---

## 4. 脱敏 Golden Fixture 样例 (真实旧输入与正确 UTC 转换)

### 4.1 喂养新增请求 (POST /api/records/feeding)

**真实旧客户端发送请求 Body**：
```json
{
  "babyId": "test_baby_uuid_001",
  "type": "bottle",
  "timestamp": "2026-09-12T14:30:00+08:00",
  "amountMl": 150,
  "leftMinutes": null,
  "rightMinutes": null,
  "spitUp": false,
  "formulaProductId": "test_formula_product_001",
  "notes": "下午瓶喂配方奶，喝得很顺畅",
  "clientId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "source": "ui_manual",
  "sourceAgent": "Web"
}
```

**BFF 转换后发给 GrowDesk (`POST /api/v1/babies/test_baby_uuid_001/records/feeding`)**：
```json
// Headers:
// Authorization: Bearer <BFF_MANAGED_ACCESS_TOKEN>
// Idempotency-Key: f47ac10b-58cc-4372-a567-0e02b2c3d479
// Content-Type: application/json
{
  "feedingType": "bottle",
  "occurredAt": "2026-09-12T06:30:00.000Z",
  "amountMl": "150.0",
  "leftMinutes": null,
  "rightMinutes": null,
  "spitUp": false,
  "formulaProductId": "test_formula_product_001",
  "notes": "下午瓶喂配方奶，喝得很顺畅",
  "source": "ui_manual",
  "sourceAgent": "Web"
}
```

**GrowDesk 服务端返回 (HTTP 201 Created)**：
```json
{
  "data": {
    "id": "feed_rec_uuid_001",
    "babyId": "test_baby_uuid_001",
    "familyId": "test_family_uuid_001",
    "feedingType": "bottle",
    "occurredAt": "2026-09-12T06:30:00.000Z",
    "amountMl": "150.0",
    "leftMinutes": null,
    "rightMinutes": null,
    "spitUp": false,
    "formulaProductId": "test_formula_product_001",
    "notes": "下午瓶喂配方奶，喝得很顺畅",
    "version": "1",
    "createdAt": "2026-09-12T06:30:01.000Z",
    "updatedAt": "2026-09-12T06:30:01.000Z"
  }
}
```

**BFF 转换后返回给前端 (HTTP 201 Created，完全符合旧接口契约)**：
```json
{
  "id": "feed_rec_uuid_001",
  "babyId": "test_baby_uuid_001",
  "type": "bottle",
  "timestamp": "2026-09-12T14:30:00.000+08:00",
  "amountMl": 150,
  "leftMinutes": null,
  "rightMinutes": null,
  "spitUp": false,
  "formulaProductId": "test_formula_product_001",
  "notes": "下午瓶喂配方奶，喝得很顺畅",
  "clientId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "source": "ui_manual",
  "sourceAgent": "Web",
  "version": "1"
}
```
