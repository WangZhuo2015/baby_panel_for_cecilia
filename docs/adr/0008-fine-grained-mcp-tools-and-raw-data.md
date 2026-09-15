# ADR 0008: Fine-Grained MCP Tools, Raw Data Purity, and Caller Identity

- Status: accepted (Refines and extends ADR 0004)
- Date: 2026-09-05

## Context

In ADR 0004, we consolidated 21 fine-grained tools into 5 coarse-grained tools (`get_baby_overview`, `record_baby_events`, `record_health_measurement`, etc.) to alleviate user confirmation fatigue in early connected app clients that prompted users on every individual tool invocation.

Since then, several operational paradigms have evolved:
1. **Persistent Client Permissions**: Modern AI clients (Claude Desktop, ChatGPT Custom GPTs / Actions, Cursor, Open WebUI, and Gemini updates) support workspace/server-level persistent authorization ("Always allow for this session / server"), making per-tool confirmation fatigue obsolete.
2. **External Model Autonomy & Raw Data Requirement**: When frontier AI models (Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro) connect to Baby Panel via MCP, our local system's pre-baked coaching advice, heuristic warnings, and opinionated summary strings added token bloat and interfered with the external LLM's own clinical, pediatric, and developmental reasoning. External AIs require **pure, unadorned raw database records**.
3. **Multimodal & Visual Completeness**: External agents require full visibility into visual and clinical records, including baby avatars, growth chart images, physical exam papers (体检), and laboratory test sheets (`imageUrl`).
4. **Caregiver Identity & Attribution**: In a multi-caregiver household (mother, father, grandparents, nanny), external agents must know the caller's identity (`relation`, `role`), understand the baby's family structure, and attribute who recorded each activity (`recordedBy`).

## Decision

We update the MCP Server architecture to adopt fine-grained tools with raw data output, while retaining backwards compatibility:

1. **Fine-Grained Low-Granularity Tool Hierarchy**:
   - **Identity & Profile**:
     - `get_current_user`: Returns caller user ID, username, display name, family relation (`mother`/`father`/`caregiver`), family role (`admin`/`member`), and active baby summary.
     - `get_baby_profile`: Returns baby metadata, exact age structure, avatar URL, family information, and all caregiver relations.
   - **Activity Reads (Pure Raw Record Arrays)**:
     - `get_feeding_records`, `get_sleep_records`, `get_diaper_records`, `get_food_records`, `get_growth_records`, `get_medical_reports`, `get_medical_report_detail`, `get_baby_photos`, `get_vaccine_records`, `get_vaccine_schedule`, `get_supplement_records`, `get_food_plans`, `get_daily_summary`, `get_development_milestones`.
   - **Activity Writes (Single-Entity Atomic Logging)**:
     - `record_feeding`, `record_sleep`, `record_diaper`, `record_food`, `record_growth`, `record_vaccine`, `record_medical_report`, `record_supplement`, `record_food_plan`.
   - **Management & Rollback**:
     - `delete_record`: Deletes an erroneous record with automatic pre-deletion snapshot capture.
     - `restore_record`: Restores a deleted record from snapshot backups.
   - **Knowledge Queries**:
     - `query_food_item`, `query_book`, `query_activity`, `web_search`.
   - **Backwards-Compatible Aliases**:
     - Retain `get_baby_overview`, `record_baby_events`, `record_health_measurement`, and `query_parenting_knowledge` for legacy clients.

2. **Raw Data Purity (只返回原始数据)**:
   - Tool outputs return pure JSON database objects/arrays without artificial advice strings, unsolicited warning labels, or subjective recommendations.
   - Read queries return clean arrays (e.g. `[ { id, timestamp, type, amountMl, notes, recordedBy, ... } ]`), allowing calling agents to conduct unhindered medical and statistical analysis.

3. **Complete Multimodal Coverage (数据要全)**:
   - Added `get_baby_photos` to aggregate photos across baby profile avatar, growth measurement photos, medical checkup reports, and food introduction photos.
   - Enhanced `record_growth` and `record_medical_report` to persist `imageUrl`, physical examination categories (`growth` for 体检, `blood`, `routine`, `allergy`), discrete lab items (`itemsJson`), and physician notes (`doctorNotes`).

4. **Caller Identity & Attribution (带上用户身份)**:
   - `verifyMcpAccessToken` resolves caller's `relation` and `role` from the active `FamilyMember` record.
   - Every write operation automatically stamps `recordedById`, `recordedBy`, `source: "mcp"`, and `sourceAgent`.
   - Read operations enrich each entry with human-readable `recordedBy: { id, username, displayName, relation, role }`.

## Consequences

- **Pros**:
  - Fine-grained granularity allows external agents to execute precise, single-action read/write operations without fetching unnecessary bulk payloads.
  - External AIs receive unbiased raw data and can apply their own specialized instructions and reasoning models.
  - Complete multimodal queries enable agents to inspect physical exam reports, lab results, and photos.
  - 100% backward compatible: Existing clients relying on ADR 0004's coarse-grained tools continue functioning without disruption.
- **Trade-offs**:
  - Clients without persistent tool permission features may prompt the user more often if invoking several individual tools in sequence (mitigated by retaining coarse-grained tools as alternatives).
