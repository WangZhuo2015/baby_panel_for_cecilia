# Round10b31 golden parity gap audit

> 后续夹具诊断：本报告对应的旧 SQLite `createdAt/updatedAt` 使用了数值毫秒，但该版本 PrismaLibSql 的日期范围查询使用带 `+00:00` 的 ISO 字符串。这会漏掉旧通知的最近 24 小时记录。夹具已改为驱动实际存储格式（logicalVersion 3），需以重跑报告复核通知差异；不能把这里的 20 条新增家庭动态认定为产品缺陷。

审计对象是本轮实际 HTTP compare 报告：

`golden/2026-09-19T18-33-48-973Z/golden-report.json`

报告固定了 `sourceGitSha=0b3e87c202b7420cb2ad2e1ee5d24cab3ceea156`、
`fixtureSha=69c463aa4125131e256d3095ef813759b37c734c27fb17fabec59d90c56e56d7`、
`manifestSha256=8b4182eab04658d6d1c94481021308f269b75d5fff9e07212394c774e0c96b06`。
31 个接口均返回 HTTP 200；严格比较结果为 **8 PASS / 23 FAIL**。本文件只解释结果，未修改 collector、golden 或 strict 判定。

## 判读方法

报告本身逐字段比较 `null`、额外字段、稳定 ID 和数组位置，数组顺序仍然是严格判定条件。本次诊断另外按业务自然键重新对照，避免把一个排序变化误报成整组数据丢失：记录类用 `id`，食物用 `foodId`，疫苗产品用 `vaccineId`、剂次用 `vaccineId + doseNumber`，发育数据用 `milestoneId` / `activityId` / `warningSignId`，绘本用 `bookId`。timeline 仍按事件 `id` 对照，并单独检查成员集合与顺序。重新对照只用于分类，没有过滤报告中的字段差异。

## 必须优先处理的缺陷

1. **身份/家庭兼容投影缺失。** `auth.me` 中旧响应的 `family.inviteCode` 消失，`membership:{role:"admin",relation:"parent"}` 变成 `null`；`family.members` 中旧成员的 `username`、`relation` 也消失。家庭和宝宝 ID 相同，新增的 `families`、`babies`、时间戳属于扩展字段，但成员显示、角色/关系和邀请流程不能依赖这些扩展字段推断。
2. **timeline 成员和顺序不再与旧 UI 相同。** 旧数组 209 项，新数组 210 项；按事件 ID 对照，209 项旧事件都在新数组中，但新增加了 growth 事件 `a0000000-0000-4000-8000-000000000402`。同为 `09:00` 的 diaper 和 supplement 顺序互换，且 bottle-breast 的 detail 从 `30ml · ...` 变为 `母乳30ml · ...`。3979 个 strict 差异不能全部视为丢数据，其中多数来自索引错位和新字段；集合增加、tie-break 顺序和文案改变是真实行为差异。
3. **喂奶记录丢失旧接口的嵌套产品投影。** `records.feeding` 的 50 个自然记录 ID 和顺序均相同，`feeding.history` 的 100 个自然记录 ID 和顺序也相同，数值字段一致；但旧响应中 25/50 个配方记录（history 为 50/100）带有非空 `formulaProduct` 对象，新响应只保留 `formulaProductId`。`version`、`baseVersion`、`updatedAt` 是新字段，`clientId:null` 的省略是兼容差异；产品对象缺失是实际旧 UI 可见信息缺口。
4. **food plan 丢失旧计划身份。** 两端只有一条相同日期/名称/内容的计划，新响应没有旧 `id=a0000000-0000-4000-8000-000000000504` 和 `createdAt`，增加了 `updatedAt`、`supplementState`、`vaccineSelections`。需先保证 BFF 的编辑/删除仍能使用旧计划 ID，否则历史计划的操作会出现行为断点。
5. **疫苗 schedule 需要事实和策略复核。** 33 个疫苗产品（national 13、provincial 1、nonProgram 19）按 `vaccineId` 成套存在，产品说明字段大体保留；但 schedule 两端都是 51 行，按 `vaccineId+doseNumber` 新端多出 `vac_dtap_hib#4` 和 `vac_dtap_ipv_hib_pentaxim#4`，并将部分旧的年龄/priority/action 改成了新的值。例如 `vac_dtap_hib#1` 旧值为 `ageMonths=18`、`action=18–24月龄加强`，新值为 `ageMonths=3`、`action=可开始`。这不是稳定 ID 差异，可能是旧 seed 与 canonical 政策的语义差异；在确认事实来源前不要静默覆盖剂次或年龄。

## 逐接口分类

| 接口 | 自然键/顺序对照 | 分类 | 结论 |
|---|---|---|---|
| `auth.me` | user/family/baby ID 相同 | **真实兼容缺口** + 新增字段 | `inviteCode`、旧 membership 角色/关系缺失；新增加 `families`、`babies`、时间戳、`gestationalDays`。 |
| `baby` | 同一 baby ID | **仅新增兼容字段** | 核心资料完全相同；新增加 `gestationalDays`。 |
| `family.members` | 同一 family、同一 user | **真实兼容缺口** + 稳定 ID 迁移 | `username`、`relation`、`inviteCode` 缺失；成员 `id` 从旧 membership UUID 变成 `familyId:userId` 复合 ID；family 元数据是新增字段。 |
| `records.feeding` | 50 个 `id`，顺序相同 | **真实内容丢失** + 新增字段 | 标量记录一致；旧非空 `formulaProduct` 对象消失。新 `version/baseVersion/updatedAt` 为新增字段。 |
| `records.sleep` | 1 个 `id`，顺序相同 | **仅新增兼容字段** | 睡眠时间、类型、夜醒次数和备注一致；新增加 `sleepType/startedAt/endedAt/version` 等，旧 `clientId:null` 被省略。 |
| `records.diaper` | 1 个 `id`，顺序相同 | **仅新增兼容字段** | 尿布类型、颜色、稠度和备注一致；新增加 `diaperType/version` 等，旧 `clientId:null` 被省略。 |
| `records.timeline` | 209 个共同 `id`，新多 1 个 | **用户行为缺陷/未确定** | 新增 growth 事件、同时间事件排序变化、bottle-breast 文案变化；大量差异是索引错位和新字段，不能按 differenceCount 直接判为丢数据。 |
| `records.daily-summary` | 对象逐字段 | **已相同** | 旧新 body 完全一致。 |
| `feeding.history` | 100 个 `id`，顺序相同 | **真实内容丢失** + 新增字段 | 与 `records.feeding` 相同：配方记录的旧 `formulaProduct` 投影缺失。 |
| `food.logs` | 同一 food log `id` | **兼容投影差异** | 食物、时间、份量、接受度、异常信息一致；新增加 `mealType/reaction/foodNames/version`，旧 source/provenance 字段有省略。 |
| `food.items` | 45 个 `foodId`，集合和顺序相同 | **稳定 ID 迁移** + 新增字段 | 旧食物知识字段均可按 `foodId` 对上；旧 UUID `id` 变为自然 `foodId`，新增加 `allergenRisk/recommendedAgeMonths`，未发现内容丢失。 |
| `food.plans` | 以 `babyId+date+name` 对照 | **真实兼容缺口** + 新增字段 | 计划内容相同，但旧 `id/createdAt` 缺失；新增加补剂状态和疫苗选择。 |
| `knowledge.food-guidelines` | 单条文本/数组内容相同 | **稳定 ID 迁移** | 仅 `id` 从旧 UUID 变为 `feeding-guideline-0`；指导内容和来源数组相同。 |
| `growth` | 同一 measurement `id` | **兼容投影差异** | 体重、身高、头围、日期和年龄相同；新也提供 metric 别名，但旧 source/provenance 字段有省略。 |
| `growth.chart` | 同一 measurement `id` | **未确定** | 测量值和 percentile 数值可对上；新 `whoPercentiles.months` 缺失，但增加 `rawWhoPercentiles` 的 `monthAge` 行。需核对旧 UI 是否直接读取 `months`。 |
| `medical.reports` | 同一 report `id` | **兼容投影差异** | 检查、医院、医生备注、items 等内容一致；source/recordedBy provenance 有省略，新增加版本字段。 |
| `nutrition.products` | 产品集合逐字段 | **已相同** | strict PASS。 |
| `nutrition.products.formula` | 产品集合逐字段 | **已相同** | strict PASS。 |
| `nutrition.products.supplement` | 产品集合逐字段 | **已相同** | strict PASS。 |
| `nutrition.records` | 同一 supplement record/product ID | **兼容字段缺失** | 剂量、时间、备注和产品营养数据相同；旧非空 `recordedById` 消失，`clientId:null` 被省略，新增加产品时间戳。 |
| `nutrition.schedules` | schedule 集合逐字段 | **已相同** | strict PASS。 |
| `nutrition.analysis.day` | 对象逐字段 | **已相同** | strict PASS。 |
| `nutrition.analysis.week` | 对象逐字段 | **已相同** | strict PASS。 |
| `vaccines` | 产品按 `vaccineId`；schedule 按 `vaccineId+doseNumber` | **未确定的真实策略差异** + 稳定 ID/结构迁移 | 产品集合和主要政策文本保留；产品/剂次 ID 变为自然键，`catchUp`、engine rule、strategy JSON 的结构和字段名改变。schedule 年龄、action、priority 和剂次数量有真实差异，需以 canonical 政策与旧 UI 语义复核。 |
| `vaccines.selections` | 已完成项按 `vaccineId+doseNumber` | **用户行为/生成策略差异** + 稳定 ID | 旧只有 1 条持久化选择，新生成 76 条默认 schedule 项；共同的 HepB 第 1 剂仍 `completed:true`，新用 `recordId`，旧用 `id/babyId/updatedAt`。额外默认项不是已完成数据丢失，但会改变选择器行为。 |
| `development.milestones` | 119 个 `milestoneId`，集合和顺序相同 | **稳定 ID 迁移** + 新增结构 | milestone 内容逐自然键保留；旧 UUID `id` 变成自然 ID，新增加 `ageRange/criterion/monthAge` 等；主要 strict 差异来自 dataRelease 投影。 |
| `development.activities` | 25 个 `activityId`，集合和顺序相同 | **稳定 ID 迁移** + 新增兼容字段 | 活动步骤、材料、安全信息逐自然键保留；旧 UUID `id` 变成自然 ID，新增加 `content/monthAge`。 |
| `development.warning-signs` | 32 个 `warningSignId`，集合和顺序相同 | **稳定 ID 迁移** + 新增兼容字段 | 预警描述、建议、来源逐自然键保留；新增加 `signText/actionAdvice/monthAge`，旧 UUID `id` 变成自然 ID。 |
| `knowledge.books` | 5 个 `bookId`，集合和顺序相同 | **稳定 ID 迁移** + 新增结构 | 书名、作者、译者、出版社、ISBN、互动建议等内容逐自然键保留；旧 UUID `id` 变成自然 ID，新增加 `rating/version` 等结构。 |
| `notifications.list` | 旧 1 条，新 30 条；只有 data-release 语义相同 | **用户行为缺陷/未确定** | 新增加 9 条疫苗提醒、20 条家庭喂奶记录类通知及新的 data-release ID；旧列表只有一条 data-release。需决定兼容层是否保留旧列表语义，不能把 29 条新增通知当作字段差异。 |
| `app.config` | 对象逐字段 | **已相同** | strict PASS。 |

## 未确定项与边界

- `vaccines` 的 schedule 差异不能仅凭 strict 结果判定 canonical 错误：报告同时显示 canonical 新增了 dose 4、修正了部分起始月龄和 action，必须对照版本化政策数据及旧 UI 的显示/选择逻辑。
- `growth.chart` 的 percentile 数值没有证据表明丢失；当前是外层索引从 `months` 改为 raw rows 的结构迁移，是否造成用户可见故障取决于页面读取方式。
- timeline 的 `differenceCount=3979` 主要由一个新增事件、tie-break 顺序和新增字段放大；它不能替代按事件 ID 的内容审计。
- `food.items`、发育知识和绘本的 strict FAIL 主要是旧数据库 UUID 与新自然 ID/兼容字段结构不同；自然键集合、顺序和业务内容均已对上，不能列为内容缺失。

本轮只读复核，没有修改产品文件、没有重采集 golden，也没有降低 strict 判定。
