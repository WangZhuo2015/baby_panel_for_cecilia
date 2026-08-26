---
name: baby-panel
description: "Baby Panel 智能育儿与儿科数据中枢技能。支持查询宝宝档案、记录喂养/睡眠/排便/生长数据、解析医学化验单与体检报告、以及查询 0-3 岁疫苗接种计划。"
version: 1.0.0
author: baby-panel
license: MIT
metadata:
  hermes:
    tags: [Parenting, Pediatric, Baby, Health, MCP, Medical]
---

# Baby Panel 智能育儿技能指南

本技能为 **Baby Panel 智能育儿看板系统** 提供全面的 Agent 数据交互与临床决策支持。

## 🌟 核心能力

1. **宝宝档案管理**：获取精准月龄天数、性别、纠正月龄（早产评估）；
2. **日常作息记账**：
   - 🍼 **喂养**：母乳亲喂、配方奶、瓶喂母乳、混合喂养奶量与时长；
   - 😴 **睡眠**：昼夜睡眠起止时间、清醒间隔、入睡方式与情绪；
   - 🍑 **排便**：大小便频次、大便性状（软糊、水样、奶瓣）与颜色；
3. **生长发育监测**：记录体重 (kg)、身长 (cm)、头围 (cm)，评估 WHO 0-3 岁生长曲线百分位（P3-P97）；
4. **医学化验与体检**：血常规（WBC/CRP/HGB）、微量元素、儿保体检、过敏原等指标结构化建档与解读；
5. **疫苗接种规划**：国家一类免疫规划与二类自费疫苗（13价肺炎、轮状病毒、手足口EV71、水痘等）接种日程与禁忌查询。

---

## 🛠️ MCP 工具调用清单 (Baby Panel Tools)

通过 `baby-panel-mcp` 服务提供以下标准 MCP Tools：

| 工具名称 | 功能描述 | 关键参数 |
| :--- | :--- | :--- |
| `get_baby_profile` | 获取当前宝宝基本档案与精准月龄 | 无 |
| `get_daily_summary` | 获取指定日期（默认今日）累计奶量、睡眠时长、换尿布汇总 | `date?: string` (YYYY-MM-DD) |
| `get_recent_records` | 查询具体活动时间轴明细（每次吃奶/睡眠/排便/辅食详情） | `date?`, `type?` (all/feeding/sleep/diaper/food), `limit?` |
| `record_feeding` | 记录一次吃奶喂养事件 | `type` (breast/formula/bottle_breast/mixed), `amountMl?`, `durationMinutes?`, `notes?` |
| `record_food` | 记录一次辅食餐点 | `foods` (string[]), `date?`, `time?`, `portion?`, `acceptance?`, `babyState?`, `hasAbnormal?`, `abnormalNotes?` |
| `record_food_plan` | 制定并保存一日辅食食谱日程计划 | `name`, `ingredients`, `steps`, `nutrition`, `date?`, `tags?` |
| `query_food_item` | 查询食材库适龄推荐、防噎处理与过敏原指引 | `name` (食材名称) |
| `record_sleep` | 记录一次睡眠事件 | `startTime` (HH:mm), `endTime` (HH:mm), `type` (day/night), `notes?` |
| `record_diaper` | 记录一次排便/换尿布 | `type` (pee/poop/both), `poopColor?`, `poopConsistency?`, `notes?` |
| `record_growth` | 记录生长测量数据 | `weightKg?`, `heightCm?`, `headCircumferenceCm?`, `date?`, `notes?` |
| `get_vaccine_schedule` | 查询疫苗接种时间表与临近接种项 | `regionCode?`, `maxMonthsAhead?` |
| `record_vaccine` | 记录宝宝已接种疫苗剂次 | `name`, `dose`, `completedDate?` |
| `get_development_milestones` | 查询国家卫健委儿童发育里程碑指标 | `month?`, `category?` |
| `get_warning_signs` | 查询儿童发育预警红线与就医指征 | `month?`, `category?` |
| `get_recommended_books` | 适龄精选绘本推荐与亲子共读要点 | `tag?`, `month?` |
| `get_activity_recommendations` | 适龄早教与亲子互动游戏建议 | `month?`, `category?` |
| `web_search` | 互联网实时搜索最新儿科指南、药品说明与育儿科普 | `query` (关键词), `limit?` |
| `save_medical_report` | 保存医学化验单/体检档案 | `title`, `category`, `date`, `hospital?`, `items`, `growthData?`, `aiSummary?` |

---

## 💬 自然语言与 Action Card 交互协议

在 Web 聊天交互中，Agent 会输出自然语言儿科分析，并附带特制标准结构：
```json:action
{
  "type": "medical_report" | "feeding" | "food" | "food_plan" | "sleep" | "diaper" | "growth" | "vaccine",
  "data": { ... }
}
```
前端会自动解析并在聊天流中渲染交互式确认卡片（支持原地微调与一键存入）。

---

## 📋 临床与育儿常识标准参考

- **每日奶量参考**：
  - 0-6 个月婴儿：每日总奶量约 600-900ml，按需喂养；
  - 6-12 个月婴儿：辅食逐步建立，每日保证 600-800ml 奶量；
- **生长百分位参考**：
  - P50 为同月龄中位数；
  - P3-P97 处于正常生理波动区间；
  - 短期内跨越两条主百分位线需提醒家长关注喂养与儿保评估；
- **疫苗接种禁忌原则**：
  - 急性发热（体温 ≥ 37.5℃）或处于急性感染期应暂缓接种；
  - 蛋类轻微过敏非流感疫苗绝对禁忌（遵新版药典指南）。
