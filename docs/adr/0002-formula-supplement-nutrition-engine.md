# ADR 0002: Deterministic Nutrition Intake Engine and Product Catalog Architecture

- Status: accepted
- Date: 2026-08-31

## Context

Infants and young children (0-3 years) receive nutrients from multiple overlapping sources: formula milk, breastfeeding, dietary supplements (Vitamin AD, D3, Calcium, Iron, Zinc, DHA, Probiotics, Multivitamins), and complementary solid foods.
Parents frequently face two major pediatric risks:
1. **Under-supplementation** (e.g. lack of Vitamin D in purely breastfed babies leading to rickets).
2. **Over-supplementation and toxicity accumulation** (e.g. overlapping administration of Vitamin AD capsules + D3 drops + Liquid Calcium fortified with D3 + formula milk exceeding the Upper Intake Level `UL` for Vitamin A and Vitamin D).

Existing solutions either oversimplify tracking to binary checkboxes (losing granular nutrient values) or attempt to use non-deterministic LLM prompts to calculate numbers, which introduces hallucination risks in medical-grade nutrition totals.

## Decisions

1. **Deterministic Calculation vs LLM Role**:
   - All nutrient aggregations, unit conversions, daily totals, and DRI ratio comparisons MUST be computed deterministically in TypeScript (`lib/nutrition/engine.ts`), strictly without LLM arithmetic.
   - LLMs and Vision models are used strictly for **multimodal OCR parsing of product labels** (converting photo of a formula/supplement nutrition table into structured JSON) and **natural language qualitative advisory** (explaining trends to parents).

2. **Family-Shared Product Catalog & Compound Supplement Modeling**:
   - `FormulaProduct` and `SupplementProduct` are owned by `Family`, shared among all caregivers in the household.
   - Each product tracks full nutrient breakdown normalized to canonical metric units (`kcal`, `mcg`, `mg`, `g`).
   - `SupplementProduct` explicitly supports **compound formulations** (e.g. Liquid Calcium containing 100mg Calcium + 100 IU Vitamin D3 + 5mcg Vitamin K2 per ml).
   - Standard Reconstitution Ratio (冲调比例) is captured per formula product and confirmed with the caregiver during initial setup (with standard dilution default ~13.5% / 1 scoop to 30ml water).

3. **First-Class Supplement Records & Schedules**:
   - `SupplementRecord` is stored as an independent timeline event associated with `Baby` and `User`.
   - `SupplementSchedule` enables pediatric routines (e.g. alternate-day AD/D3 rotation) and drives proactive reminders.
   - `Conflict Guard` automatically evaluates cumulative intake at the **atomic nutrient level** (e.g. summing Vit D across Formula + D3 drops + Liquid Calcium) to intercept duplicate or excessive administration.

4. **Medical Standard Baseline & Safety Limits**:
   - Benchmark against **China Dietary Reference Intakes (DRIs 2023 / WS/T 578)** dynamic by baby age in months (0-6m, 6-12m, 1-3y).
   - Track both **Adequate Intake / Recommended Nutrient Intake (`AI` / `RNI`)** for target achievement and **Tolerable Upper Intake Level (`UL`)** for overdose alarms.

## Consequences

- Full nutrient spectrum (energy, macro, fatty acids, 14+ vitamins, 10+ minerals) is available for comprehensive breakdown without adding daily manual logging friction.
- Formula intake `amountMl` cleanly maps to dry powder grams and all corresponding micronutrients.
- Compound supplements (e.g. Calcium + D3) are accurately accounted for across all micro-nutrient aggregations.
- Conflict checks provide peace of mind to parents and caregivers against accidental double-dosing.
