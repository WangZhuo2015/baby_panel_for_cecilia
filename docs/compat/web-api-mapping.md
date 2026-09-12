> 当前是待修正的SH-00初稿，不可直接生成业务代码或宣称已验收。已确认错误及修复门槛见 [Codex复核](../../evidence/tasks/SH-00/REVIEW_CODEX.md)，长程任务R0必须先修正。

# Web API 兼容层字段与协议映射规格 (初稿)

> 任务对应：`SH-00` / `SH-01` 准备  
> 规范权威：以 `docs/plan/implementation/02_BACKEND_CONTRACTS.md`、`03_DATABASE_MIGRATION.md`、`07_LOCAL_FIRST_OPTIONAL_SYNC.md`、`08_ACCOUNT_BABY_RELATIONSHIPS.md` 为准。  
> 状态：规划草案（Draft Specification），不代表当前 Web 已经完成切换。

---

## 1. 架构总览与兼容层定位

```mermaid
flowchart LR
    subgraph Client [前端客户端]
        Browser[Web 浏览器]
        iOSApp[iOS 原生端]
    end

    subgraph WebHost [现有 Web 容器 (Next.js 15)]
        Pages[页面 / Server Components]
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
- **透明兼容**：现有 Web 界面（React UI 组件）继续发起同源 `/api/...` 请求，BFF 负责参数校验、凭据挂载、旧字段与 DTO 双向映射。
- **严格失败语义**：兼容层不将上游 4xx/5xx 改为 200 假成功，不静默吞掉或覆盖关键字段。

---

## 2. 通用跨领域映射规范

### 2.1 鉴权与会话传递
- **旧模式**：浏览器使用单一 `auth_token` Cookie（存储 JWT），直接调用 `lib/auth.ts:getAuthUser()` 解密并在各 API 中作为身份依据；部分路由存在 `findFirst()` 匿名越权漏洞。
- **新模式**：
  - 浏览器采用 256-bit 随机不透明会话 Cookie（命名为 `__Host-growdesk_web`，`HttpOnly; Secure; SameSite=Lax; Path=/`）。
  - Next.js BFF 持有托管凭据映射，代向 GrowDesk `/api/v1` 交换短期 Bearer Access Token。
  - 写入操作强制校验请求的 `Origin` 白名单与 CSRF Token。
  - 彻底剥离旧 Web 路由中的 `prisma.baby.findFirst()` 隐式回退，所有需要宝宝上下文的请求必须显式携带 `babyId`，由 GrowDesk 服务端核对 `BabyMember` 权限。

### 2.2 响应 Envelope 结构转换
- **旧 Web 响应**：
  - 简单成功：直接返回实体对象 `{ id, amount, ... }` 或数组 `[ ... ]`。
  - 部分封装：`{ success: true, record: { ... } }` 或 `{ success: true, message: "ok" }`。
  - 错误：`{ error: "错误文案" }`（HTTP 400/401/500）或 `{ message: "..." }`。
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
- **旧 Web 痛点**：
  - 客户端直接提交无时区本地时间字符串（如 `2026-09-12 14:30`）或本地 `new Date().toISOString()`；
  - 部分路由直接存入 SQLite 作为 UTC 字符串，查询时未做时区换算导致跨日 8 小时偏移。
- **新 GrowDesk 规格**：
  - **事件时刻 (occurredAt / startTime / endTime)**：强制使用 RFC3339 含时区格式（如 `2026-09-12T14:30:00.000+08:00`），服务端统一归一化为 UTC 时间戳存储。
  - **日历日期 (date / birthDate / scheduledDate)**：严格采用 `YYYY-MM-DD` 格式（如 `2026-09-12`），不得因时区偏移截断为前一日 UTC 午夜。
  - **家庭时区**：从 `Family.timeZone` 显式获取（默认 `Asia/Shanghai`）。

### 2.4 小数值与度量单位 (Decimal Precision)
- **旧 Web 痛点**：
  - 身高、体重、奶量在 JS 中作为浮点数（Float）处理，Prisma SQLite 存储为 Float，在计算汇总或四舍五入时存在 `0.1 + 0.2 = 0.30000000000000004` 精度损失。
- **新 GrowDesk 规格**：
  - 身高 (`heightCm`)、体重 (`weightKg`)、头围 (`headCircumferenceCm`)、摄入量 (`amountMl`)、百分位 (`percentile`) 均以**十进制字符串 (Decimal String)** 传输。
  - schema 显式固定单位（如 `weightKg: "12.350"`，`heightCm: "85.2"`）。
  - BFF 负责在旧前端 number 类型与服务端 string 之间进行无损安全转换。

### 2.5 幂等性、版本控制与并发锁
- **旧 Web 痛点**：
  - 页面反复提交表单无去重，无乐观锁机制；多成员并发修改同一记录时“后写覆盖先写”。
- **新 GrowDesk 规格**：
  - **POST 创建**：HTTP Header 必须携带 `Idempotency-Key: <UUID>`（或由 BFF 根据用户会话 + 业务客户端 ID 生成）；同一 Key 重复提交返回同结果，异内容返回 `409 CONFLICT`。
  - **PATCH / PUT 更新与 DELETE 删除**：请求 Header 或 Body 携带 `baseVersion`（目标实体的当前版本号）；若服务端已被他人修改，返回 `409 VERSION_MISMATCH`。
  - 实体内部维护自增整数 `version`。

### 2.6 多宝宝与权限隔离 (08 规范)
- **旧 Web 痛点**：`lib/auth.ts` 中存在 `getAuthSession` 找不到关联宝宝时回退 `prisma.baby.findFirst()`，导致多宝宝家庭或未授权用户串号。
- **新 GrowDesk 规格**：
  - 客户端通过选择器明确当前操作的 `babyId`。
  - 服务端在 UnitOfWork 事务中重验当前用户在该宝宝上的 `BabyMember.status = 'active'`。
  - 彻底杜绝全表扫描兜底。

---

## 3. HTTP 状态码映射标准

| HTTP 状态码 | GrowDesk 错误码 (`error.code`) | 旧 Web 错误呈现 | BFF 兼容处理规则 |
|---|---|---|---|
| **200 OK** | 无 | 数据对象 / 数组 | 成功提取 `data`，返回给旧 Web 前端 |
| **201 Created** | 无 | 新建对象 | 提取 `data` 并补充旧格式 envelope |
| **400 Bad Request** | `VALIDATION_FAILED` / `INVALID_PAYLOAD` | `{ error: "参数错误: ..." }` | 展开 validation details，保留字段提示 |
| **401 Unauthorized** | `UNAUTHORIZED` / `SESSION_EXPIRED` | 触发登出跳转 `/login` | 清理 `__Host-growdesk_web` Cookie，重定向登录 |
| **403 Forbidden** | `FORBIDDEN` / `BABY_ACCESS_DENIED` | `{ error: "无权限访问此宝宝或操作" }` | 保持 403，明确提示权限已被撤销 |
| **404 Not Found** | `NOT_FOUND` / `RESOURCE_NOT_FOUND` | 404 页面或 `{ error: "不存在" }` | 防枚举安全：跨租户不存在均报 404 |
| **409 Conflict** | `CONFLICT` / `VERSION_MISMATCH` / `IDEMPOTENCY_KEY_MISMATCH` | `{ error: "记录已被修改，请刷新后重试" }` | 提示并发冲突，前端刷新当前版本，禁止无脑强行覆盖 |
| **410 Gone** | `CURSOR_EXPIRED` / `SNAPSHOT_EXPIRED` | 重新全量拉取 | Feed 游标失效，BFF 引导客户端重置游标 |
| **422 Unprocessable** | `DOMAIN_RULE_VIOLATION` | `{ error: "业务规则限制: ..." }` | 展示业务拒绝原因（如“结束时间早于开始时间”） |
| **429 Too Many Req** | `RATE_LIMITED` | `{ error: "请求过于频繁，请稍候" }` | 保留 `Retry-After` Header |
| **503 Service Unavail** | `SERVICE_UNAVAILABLE` / `DEPENDENCY_DOWN` | `{ error: "服务升级中，请稍后再试" }` | **严禁降级回写旧 SQLite**；提示稍后重试 |

---

## 4. 核心业务领域字段映射矩阵

### 4.1 喂养记录 (Feeding Records: SH-04F)
- **旧接口**：`GET/POST/PUT/DELETE /api/records/feeding`
- **目标接口**：`GET/POST /api/v1/babies/:babyId/records/feeding`，`PATCH/DELETE /api/v1/babies/:babyId/records/feeding/:id`

| 旧字段名 | 旧类型 | 目标字段名 | 目标类型 | 转换规则与约束 |
|---|---|---|---|---|
| `id` | `string` (cuid) | `id` | `string` (UUID/cuid) | 保留旧 ID，新记录生成 UUIDv4 |
| `babyId` | `string` | URL 路径 `:babyId` | `string` (UUID) | 移至 URL 路径，BFF 强制校验路径与 Body 一致 |
| `type` | `"breast" \| "bottle" \| "formula"` | `feedingType` | `enum` | 映射为统一枚举值：`BREAST`, `BOTTLE_BREAST`, `FORMULA` |
| `startTime` | `string \| Date` | `startedAt` | `string` (RFC3339) | 归一化为 UTC ISO 字符串（带时区） |
| `endTime` | `string \| Date \| null` | `endedAt` | `string \| null` | 校验 `endedAt >= startedAt` |
| `amount` | `number \| null` | `amountMl` | `string \| null` (Decimal) | 单位毫升；转为十进制字符串，如 `"120.0"` |
| `leftDuration` | `number \| null` | `leftDurationSeconds` | `integer \| null` | 分钟转为秒数（或固定按秒存储） |
| `rightDuration` | `number \| null` | `rightDurationSeconds` | `integer \| null` | 分钟转为秒数 |
| `formulaId` | `string \| null` | `nutritionProductId` | `string \| null` | 关联新 `NutritionProduct` 表（奶粉产品） |
| `spitUp` | `boolean \| null` | `spitUpSeverity` | `enum \| null` | `true` 映射为 `MILD`，`null/false` 为 `NONE` |
| `note` | `string \| null` | `notes` | `string \| null` | 最大 500 字符限制 |
| *(新字段)* | - | `version` | `string` (Int64) | 实体当前版本号（返回给客户端供乐观锁使用） |
| *(新字段)* | - | `source` | `enum` | 固定为 `WEB_BFF`，禁止冒充其他来源 |

### 4.2 尿布记录 (Diaper Records: SH-04D)
- **旧接口**：`GET/POST/PUT/DELETE /api/records/diaper`
- **目标接口**：`GET/POST /api/v1/babies/:babyId/records/diaper`，`PATCH/DELETE /api/v1/babies/:babyId/records/diaper/:id`

| 旧字段名 | 旧类型 | 目标字段名 | 目标类型 | 转换规则与约束 |
|---|---|---|---|---|
| `id` | `string` | `id` | `string` | 原样映射 |
| `babyId` | `string` | URL 路径 `:babyId` | `string` | 路径参数 |
| `type` | `"pee" \| "poop" \| "both"` | `diaperType` | `enum` | 保持枚举对应：`PEE`, `POOP`, `BOTH` |
| `time` | `string \| Date` | `occurredAt` | `string` (RFC3339) | 归一化为标准事件时间 |
| `color` | `string \| null` | `stoolColor` | `string \| null` | 映射便便颜色 |
| `texture` | `string \| null` | `stoolTexture` | `enum \| null` | 软便、水便、成型等标准枚举映射 |
| `note` | `string \| null` | `notes` | `string \| null` | 最大 500 字符 |
| *(新字段)* | - | `version` | `string` | 乐观锁版本 |

### 4.3 睡眠记录 (Sleep Records: SH-04S)
- **旧接口**：`GET/POST/PUT/DELETE /api/records/sleep`
- **目标接口**：`GET/POST /api/v1/babies/:babyId/records/sleep`，`PATCH/DELETE /api/v1/babies/:babyId/records/sleep/:id`

| 旧字段名 | 旧类型 | 目标字段名 | 目标类型 | 转换规则与约束 |
|---|---|---|---|---|
| `id` | `string` | `id` | `string` | 原样映射 |
| `babyId` | `string` | URL 路径 `:babyId` | `string` | 路径参数 |
| `startTime` | `string \| Date` | `startedAt` | `string` (RFC3339) | 睡眠开始时间 |
| `endTime` | `string \| Date \| null` | `endedAt` | `string \| null` | 允许未结束睡眠（进行中） |
| `quality` | `string \| null` | `sleepQuality` | `enum \| null` | 浅睡、深睡、安稳度枚举 |
| `awakeningCount` | `number \| null` | `awakeningCount` | `integer` | 默认 0 |
| `note` | `string \| null` | `notes` | `string \| null` | 备注说明 |

### 4.4 辅食记录 (Food Logs: SH-04FO)
- **旧接口**：`GET/POST/PUT/DELETE /api/food/logs`
- **目标接口**：`GET/POST /api/v1/babies/:babyId/records/food`，`PATCH/DELETE /api/v1/babies/:babyId/records/food/:id`

| 旧字段名 | 旧类型 | 目标字段名 | 目标类型 | 转换规则与约束 |
|---|---|---|---|---|
| `id` | `string` | `id` | `string` | 原样映射 |
| `babyId` | `string` | URL 路径 `:babyId` | `string` | 路径参数 |
| `date` | `string` (YYYY-MM-DD) | `recordDate` | `string` (YYYY-MM-DD) | 日历日期保持不变 |
| `time` | `string \| null` | `occurredAt` | `string` (RFC3339) | 结合 date 组合为完整带时区时间戳 |
| `foodItemIds` | `string` (JSON array) | `foodItems` | `array<FoodItemRef>` | 旧 JSON 字符串在 BFF 显式解析为结构化数组 |
| `portion` | `string \| null` | `portionGrams` | `string \| null` (Decimal) | 转换为十进制克重字符串 |
| `reaction` | `string \| null` | `adverseReaction` | `enum \| null` | 过敏/不适反馈标准枚举 |

### 4.5 成长测量记录 (Growth Measurements: SH-04G)
- **旧接口**：`GET/POST/DELETE /api/growth`
- **目标接口**：`GET/POST /api/v1/babies/:babyId/growth-measurements`，`DELETE /api/v1/babies/:babyId/growth-measurements/:id`

| 旧字段名 | 旧类型 | 目标字段名 | 目标类型 | 转换规则与约束 |
|---|---|---|---|---|
| `id` | `string` | `id` | `string` | 原样映射 |
| `babyId` | `string` | URL 路径 `:babyId` | `string` | 路径参数 |
| `date` | `string` (YYYY-MM-DD) | `measurementDate` | `string` (YYYY-MM-DD) | 严格日历日期 |
| `weight` | `number \| null` | `weightKg` | `string \| null` (Decimal) | 体重（千克），转为字符串，如 `"8.45"` |
| `height` | `number \| null` | `heightCm` | `string \| null` (Decimal) | 身高（厘米），转为字符串，如 `"71.2"` |
| `headCircumference`| `number \| null` | `headCircumferenceCm` | `string \| null` (Decimal) | 头围（厘米），如 `"44.5"` |
| `percentiles` | `string` (JSON) | *(计算字段)* | `object` | 百分位由 GrowDesk 服务端自动计算，不相信客户端上传值 |

---

## 5. 脱敏 Golden Fixture 样例初稿

### 5.1 喂养新增请求 (POST /api/records/feeding)
**旧客户端发送**：
```json
{
  "babyId": "test_baby_001",
  "type": "bottle",
  "startTime": "2026-09-12T14:30:00+08:00",
  "amount": 150,
  "spitUp": false,
  "note": "测试喂奶"
}
```

**BFF 转换后发给 GrowDesk (`POST /api/v1/babies/test_baby_001/records/feeding`)**：
```json
// Headers:
// Authorization: Bearer <BFF_MANAGED_TOKEN>
// Idempotency-Key: c9b29e64-58a1-4ee3-9e47-fa2581290bb1
// Content-Type: application/json
{
  "feedingType": "BOTTLE_BREAST",
  "startedAt": "2026-09-12T06:30:00.000Z",
  "endedAt": null,
  "amountMl": "150.0",
  "spitUpSeverity": "NONE",
  "notes": "测试喂奶",
  "source": "WEB_BFF"
}
```

**GrowDesk 返回 (201 Created)**：
```json
{
  "data": {
    "id": "feed_rec_test_uuid",
    "babyId": "test_baby_001",
    "familyId": "test_fam_001",
    "feedingType": "BOTTLE_BREAST",
    "startedAt": "2026-09-12T06:30:00.000Z",
    "endedAt": null,
    "amountMl": "150.0",
    "spitUpSeverity": "NONE",
    "notes": "测试喂奶",
    "version": "1",
    "createdAt": "2026-09-12T06:30:01.000Z",
    "updatedAt": "2026-09-12T06:30:01.000Z"
  }
}
```

**BFF 转换后返回给前端 (200 OK)**：
```json
{
  "id": "feed_rec_test_uuid",
  "babyId": "test_baby_001",
  "type": "bottle",
  "startTime": "2026-09-12T14:30:00.000Z",
  "amount": 150,
  "spitUp": false,
  "note": "测试喂奶",
  "version": "1"
}
```

---

## 6. 后续任务交接与审查要求

1. 本映射表为初稿，在 **SH-01** 任务中将与 `packages/contracts/src` 的正式 TypeBox schema 和 OpenAPI 3.0.3 导出进行自动化校验与严格比对。
2. 任何字段名、枚举或单位分歧必须先修订权威契约（02 文档），严禁在 BFF 私自抹平或猜测。
