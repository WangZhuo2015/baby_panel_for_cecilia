# ADR 0006: Breastmilk Volume Estimation and Complementary Food Nutrition Integration

- Status: accepted
- Date: 2026-09-04

## Context

Pediatric nutrition tracking for infants (0-3 years) requires accurate assessment of both milk intake and complementary feeding. Two severe architectural and data consistency gaps were identified in earlier releases:

1. **Breastmilk Omission in Total Volume Tracking**:
   - Breastfeeding sessions (`type: breast`) naturally lack the volumetric measurement graduations of bottles.
   - The logging form previously hardcoded `amountMl: null` upon submission of breast records, and all aggregation queries (`service.getDailySummary`, `ai-daily-summary`, `voice-fast-path`, home timeline) computed milk volume via `r.amountMl ?? 0`.
   - Consequently, purely breastfed or mixed-fed infants appeared to have 0 ml or severely understated milk intake in daily summaries, AI reports, and voice fast-path queries.
   - Furthermore, bottle-fed breastmilk (`type: bottle_breast`) was erroneously categorized under formula counts (`formulaCount`) in AI reports.

2. **Complementary Solid Foods Omission in DRIs Nutrition Analysis**:
   - The deterministic nutrition engine (`lib/nutrition/engine.ts`) previously aggregated formula milk and dietary supplements, but completely bypassed complementary food records (`FoodLogRecord`).
   - From 6 months onward, breastmilk and formula alone no longer meet infant physiological requirements for iron and zinc. Parents feeding iron-fortified rice cereal, pureed meat, and egg yolk saw persistent red "Severe Deficiency" warnings for iron because the analysis engine ignored all solid food intake.

## Decisions

### 1. Clinical Nursing Volume Estimation & Universal Intake Resolver

1. **Clinical Physiological Sucking Model (`estimateNursingVolumeMl`)**:
   - Based on clinical lactation medicine standards (Academy of Breastfeeding Medicine & China WS/T 578):
     - Active sucking minutes 0–10 min: ~5 ml/min (initial high-flow letdown, capped at 60 ml).
     - Active sucking minutes 10–20 min: ~4 ml/min (steady maintenance, capped at 110 ml).
     - Active sucking minutes > 20 min: ~2.5 ml/min (hindmilk and non-nutritive soothing, capped at 160 ml).
   - E.g., a standard 25-minute nursing session (10m left + 15m right) resolves to ~103 ml.

2. **Universal Effective Volume Parsing (`getFeedingEffectiveMl`)**:
   - Defined in `lib/nutrition/breastmilk.ts`:
     - `breast`: Prioritizes explicitly logged `amountMl` (e.g. from pre/post feeding scale weighing or manual override); falls back to `estimateNursingVolumeMl(left, right)`.
     - `formula` & `bottle_breast`: Directly reads recorded `amountMl`.
     - `mixed`: Computes `amountMl` (formula portion) + `estimateNursingVolumeMl(left, right)` (nursing portion).
   - All aggregate statistics across the codebase (`createFeeding`, `updateFeeding`, `getDailySummary`, `getTimeline`, `ai-daily-summary`, `voice-fast-path`) exclusively use `getFeedingEffectiveMl`.

3. **Interactive Visual Feedback in Caregiver Logging Form**:
   - `FeedingForm.tsx` provides immediate, non-intrusive volume feedback as timer runs or minutes are adjusted.
   - Caregivers can click `+` / `-` in 10ml increments or input precise test-weighed ml without friction.
   - Submissions persist a deterministic integer `amountMl` into SQLite, eliminating `null` database rows.

### 2. Deterministic Complementary Food Micronutrient Engine

1. **Standardized Infant Food Composition Benchmark (`lib/nutrition/food-nutrients.ts`)**:
   - Derived from the Chinese Dietary Guidelines for Infants and Young Children (2022) and China Food Composition Tables (Standard Edition 6).
   - Establishes canonical nutrient profiles per standard infant serving for 30+ staples:
     - High-iron rice cereals & Little Freddie lines (高铁米粉 / 小皮): 5.0 mg Fe / serving.
     - Pureed meats (beef, pork liver): 1.5–5.0 mg Fe, 1.8–2.2 mg Zn.
     - Egg yolk (蛋黄泥): 1.1 mg Fe, 55 mg Ca, 1.3 mg Protein.
     - Salmon & seafood (三文鱼泥): 80 mg DHA, 2.5 g Protein.
     - Vegetables & Fruits (spinach, pumpkin, avocado, banana, etc.): Vitamins A/C, dietary fiber.
     - Infant dietary oils (walnut, flaxseed oil): Essential fatty acids (ALA/LA).

2. **Intake Scaling & Fuzzy Ingredient Matching**:
   - Maps caregiver-reported portion selections to multipliers:
     - `all` (全部吃完): 1.0x
     - `most` (大部分吃完): 0.8x
     - `half` (吃了一半): 0.5x
     - `few` (尝了几口): 0.3x
   - Fuzzy synonym matching resolves variant naming (e.g., "米糊", "米粉", "强化铁米粉" -> standard iron-fortified cereal).

3. **Multi-Source Lineage Penetration**:
   - `calculateDailyNutrition` and `calculateMultiDayNutritionTrend` in `lib/nutrition/engine.ts` process `foodLogs` and emit `{ sourceType: "food", sourceName: ingredient, amount, unit }` lineage items into each nutrient item.
   - Food logs are queried in `/api/nutrition/analysis` and AI tools, returning `foodCount` and `foodsTried`.

4. **UI Presentation & Visual Clarity**:
   - `app/(main)/nutrition/page.tsx` banner surfaces `总奶量 X ml · 辅食 Y 顿 · 补剂 Z 次` alongside interactive ingredient tags.
   - `CompoundSourceBreakdown.tsx` assigns dedicated bowl emoji (`🥣`) to complementary food sources.

## Consequences

- **Zero Data Loss in Volume Reporting**: Nursing mothers and mixed-feeding households now observe realistic cumulative volumes matching infant physiological capacity (600–900 ml/day).
- **Accurate Iron & Micronutrient Tracking**: Pediatricians and caregivers can verify iron adequacy from solid foods during the critical 6–12 month developmental window without false alarms.
- **Strictly Deterministic**: All numerical calculations remain strictly in typed TypeScript business logic; zero hallucination risk from LLM arithmetic.
