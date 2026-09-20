# ADR 0009: Supplement Product Management Tool and GrowDesk Compatibility Contract

- Status: accepted (Extends ADR 0002 and ADR 0008)
- Date: 2026-09-20

## Context

In Baby Panel (2.0), nutrition tracking encompasses both formula feeding and dietary supplementation (Vitamin D3, Vitamin AD, Calcium, Iron, Zinc, DHA, etc.). Prior to this decision:
1. **Intake-Only Logging**: Caregivers and external AI agents could record supplement intake via `record_supplement`, which auto-created a stub product if missing, but left nutritional profile empty (`nutrientsJson: "{}"`).
2. **Missing Standalone Product Registration**: When a caregiver purchases a new supplement product and wishes to register its brand, formulation, dosage form, single dose, and complete nutritional facts (e.g., 400 IU Vitamin D3, 100mg Calcium) **without** logging an actual ingestion event, no AI tool or direct MCP tool was available.
3. **Dual-Backend Migration State**: The project is migrating the frontend (`baby_panel_for_cecilia`) to a modern backend (`growdesk-server`), while production remains actively hosted on the local SQLite backend (`file:./prod.db`, port 3088).
   - Any new tool or mutation path MUST strictly respect `GROWDESK_CONFIG.enabled` dual-mode architecture.
   - When running in BFF mode against GrowDesk, zero direct SQLite writes are permitted (`scripts/check-production-writers.mjs`).
   - The contract between the old frontend/BFF and `growdesk-server` must be comprehensively documented so `growdesk-server` can implement native support with 100% compatibility.

## Decision

We introduce a dedicated tool **`create_supplement_product`** across the Built-in AI Agent, Remote MCP Server (OAuth 2.1), and Stdio MCP Server, backed by normalized nutrient extraction and dual-mode data persistence.

### 1. Unified Tool Specification (`create_supplement_product`)

- **Name**: `create_supplement_product`
- **Label**: 建档营养补剂产品
- **Category**: `write` (Requires `baby:write` OAuth scope in MCP)
- **Description**: 在家庭档案库中建档或更新营养补充剂产品（名称、品牌、剂型、单次规格与营养成分表），无需打卡即可建档录入。
- **Parameters**:
  - `name` (`string`, required): 补剂全称（如 "天然海藻油DHA"、"小金条液体钙"、"星鲨维生素D3滴剂"）。
  - `brand` (`string`, optional): 品牌名称（如 "健敏思"、"伊可新"、"Ddrops"，默认 "家庭自选"）。
  - `dosageForm` (`string`, optional, enum: `["drops", "capsule", "liquid_ml", "sachet", "tablet"]`): 剂型，默认 `"drops"`。
  - `unitName` (`string`, optional): 单次计量单位（如 "滴"、"粒"、"ml"、"袋"、"片"，默认 "滴"）。
  - `defaultDose` (`number`, optional): 单次推荐用量数值，默认 `1.0`。
  - `nutrients` (`Record<string, { amount: number, unit: string } | number>`, optional): 营养素成分含量表（例如 `{"vitamin_d": {"amount": 400, "unit": "IU"}, "dha": 100}`）。
  - `notes` (`string`, optional): 补充说明或医嘱注意事项。

### 2. Canonical Nutrient Normalization (`normalizeNutrients`)

To prevent divergence between user input, OCR output, and external AI terminology, all nutrient dictionaries are canonicalized via `normalizeNutrients` (`lib/growdesk/nutrition-compat.ts`):
- **Aliases**: `vitamind` -> `vitamin_d`, `vitamina` -> `vitamin_a`, `vitaminc` -> `vitamin_c`, hyphens converted to underscores.
- **Default Units**:
  - `vitamin_d`: `IU`
  - `vitamin_a`: `mcg RAE`
  - `vitamin_c`: `mg`
  - `calcium`, `iron`, `zinc`, `dha`: `mg`
  - `energy_kcal`: `kcal`
  - `protein`: `g`
- **Number Support**: Accepts plain numbers or `{ amount, unit }` objects, formatting amounts to 2 decimal places.

### 3. Dual-Mode Storage Architecture

1. **Local SQLite Mode (`!GROWDESK_CONFIG.enabled`, Current Production)**:
   - Queries `prisma.supplementProduct` by `familyId` and `name`.
   - If existing: updates `brand`, `dosageForm`, `unitName`, `defaultDose`, `nutrientsJson`, `notes`, and activates `isActive: true`.
   - If not existing: creates new record in `SupplementProduct` table with generated CUID.
   - Returns `{ success: true, action: "create_supplement_product", product: { ...record, nutrients } }`.

2. **GrowDesk BFF Mode (`GROWDESK_CONFIG.enabled`, Target Architecture)**:
   - Supplements are stored under the baby's food plan `planData.supplementState.supplementProducts` via `/api/v1/babies/:babyId/food-plan`.
   - Generates a UUID/prefixed ID (`supp_prod_*`), builds a full `SupplementProduct` entity, upserts it into the array (replacing any item with identical name).
   - Saves merged state back via `PUT /api/v1/babies/:babyId/food-plan`.
   - Zero direct SQLite database access occurs.

### 4. GrowDesk Server Native Compatibility Contract

When `growdesk-server` implements native first-class supplement catalog management, it MUST provide either:

#### Option A: Native Nutrition Catalog Endpoints (Preferred)
- `POST /api/v1/families/:familyId/nutrition/supplements`:
  ```json
  {
    "name": "天然海藻油DHA",
    "brand": "健敏思",
    "dosageForm": "capsule",
    "unitName": "粒",
    "defaultDose": 1.0,
    "nutrients": {
      "dha": { "amount": 100, "unit": "mg" }
    },
    "notes": "餐后随餐服用"
  }
  ```
  Returns `201 Created` with `{ "data": { "id": "...", "familyId": "...", ... } }`.

- `GET /api/v1/families/:familyId/nutrition/supplements`:
  Returns `{ "data": [ ... ] }`.

#### Option B: Food Plan State Protocol (BFF Fallback Parity)
- If `growdesk-server` stores supplement metadata inside the baby's `food-plan`:
  - Preserve `planData.supplementState` JSON structure:
    ```json
    {
      "supplementState": {
        "supplementProducts": [
          {
            "id": "supp_prod_...",
            "familyId": "fam_...",
            "name": "...",
            "brand": "...",
            "dosageForm": "drops",
            "unitName": "滴",
            "defaultDose": 1.0,
            "nutrients": { "vitamin_d": { "amount": 400, "unit": "IU" } },
            "notes": null,
            "isActive": true
          }
        ]
      }
    }
    ```
  - Preserve `planData.supplementState.supplementSchedules` for alternating medication schedules.

## Consequences

- **Caregivers & AI**: Can catalog supplements directly with complete nutritional composition before giving them to the baby.
- **Pediatric Safety**: Enables the conflict guard (`Conflict Guard`) to accurately assess cumulative daily micronutrient totals (Formula + Multivitamins + Dedicated Drops) immediately after product registration.
- **Production Integrity**: Fully backward-compatible with production `prod.db` SQLite schema, with zero migration risks.
- **Clean Migration Boundary**: Adheres to zero-direct-SQLite-leak rule (`npm run check:writers`), with a clean REST and MCP contract for `growdesk-server`.
