# Baby Panel domain glossary

Terms used in product and architecture talk. Prefer these names over file-level labels.

## People and tenancy

**User** — a logged-in caregiver (username + password). The web session JWT identifies this person. Writes that need an author use `recordedById = User.id`.

**Family** — the household that owns babies and shared status (food tried, books). Users join a Family via invite code (`FamilyMember`).

**Baby** — a child record owned by a Family. All feeding / sleep / diaper / growth / medical rows hang off `Baby.id`.

**串号** — mixing one family's baby data into another session. The forbidden failure mode for any agent or MCP path. Identity is bound by the server from the login session + currently selected Baby, never from model-chosen `babyId` / `userId`.

**Principal (current)** — the pair `(User, Baby)` established before the model runs. Tools execute as that Principal. Family-vs-User as a single principal is not decided yet; web chat uses User for `recordedById` and Baby for the record target.

## Web chat agent

**Web Chat Agent** — the in-app assistant (`/api/ai/chat`). It is a Pi agent loop over an OpenAI-compatible completions model. It is not a channel into another agent.

**Baby Panel Tools** — in-process Prisma tools (`createBabyPanelTools`). They close over the Principal. The model cannot pick a different baby.

**OpenRouter Completions Adapter** — the only LLM backend the web app uses (`stealth/ox-alpha` by default). Native `tools` / `tool_choice`. HTTP headers must be ASCII (`X-Title` cannot contain Chinese).

**Action Card** — a `json:action` block the UI can confirm. Fallback for non-tool clients, not the web chat write path.

## Optional CLI / MCP

**MCP Server** (`scripts/mcp-server.mjs`) — stdio tools for external agents. Process-scoped, so it is not used as the web chat backend.

**MCP Session Token** — short-lived JWT (`typ=mcp`, `userId` + `babyId`, 15m). Required on MCP calls unless `MCP_ALLOW_STATIC_USER=1` (single-user CLI debug only).

**Hermes** — an external stateful agent (gateway, nested tool loop, process-scoped MCP). Not a web-app LLM backend. See [docs/adr/0001-no-hermes-for-web-chat.md](docs/adr/0001-no-hermes-for-web-chat.md).

## Formula, Supplements & Nutrition Intake

**Formula Product (奶粉档案)** — A specific formula milk product profile owned by or shared with a Family, capturing brand, stage, standard scoop weight, reconstitution ratio (冲调比例), and a full nutrition fact table (per 100g or per 100kJ/100ml).

**Standard Reconstitution (标准冲调浓度)** — The default concentration ratio configured for a Formula Product (e.g. 1 scoop = 4.3g into 30ml water ≈ 13.5% concentration). The system prompts the caregiver on first setup to confirm standard vs custom concentration.

**Supplement Product (补剂档案)** — A dietary supplement profile (e.g. Vitamin AD, D3, Liquid Calcium with D3/K2, Iron drops, DHA, Probiotics, Multivitamins) defining brand, dosage form (drops/capsule/liquid ml/sachet), and a flexible multi-nutrient specification (capturing compound nutrients such as Calcium + Vit D3 within a single supplement).

**Supplement Schedule (补剂计划)** — A baby's configured administration regimen (daily, alternate days like AD/D3 rotation, or specific days of week) with target dosage units.

**Conflict Guard & Overdose Alert (冲突与防过量守护)** — A proactive atomic nutrient-level check in the Supplement Record flow and Nutrition Engine that sums cumulative intakes across all products (e.g. Formula + D3 drops + Liquid Calcium containing D3) and alerts against China DRIs (WS/T 578) Upper Intake Levels (UL) and redundant administration.


**Supplement Record (补剂打卡记录)** — A first-class timeline event logging when a specific supplement was administered to a Baby, how many units/doses were given, and by whom.

**Nutrient Intake Engine (营养素摄入计算引擎)** — Deterministic aggregation engine that computes total daily and historical nutrient intakes across formula milk, supplements, and solid food, comparing against China DRIs (WS/T 578) with AI/RNI achievement rates and UL (Upper Intake Level) overdose safety alerts.


