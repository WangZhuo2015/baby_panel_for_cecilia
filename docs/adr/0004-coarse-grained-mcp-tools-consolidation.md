# ADR 0004: Coarse-Grained MCP Tools Consolidation for Connected Apps

- Status: accepted
- Date: 2026-09-01

## Context

When integrating Baby Panel as a Custom Connected App in Gemini Spark (and similar OAuth 2.1-enabled AI environments), every individual MCP tool call triggers an explicit user confirmation modal. 

In our initial design, we exposed 21 fine-grained, 1:1 REST-like MCP tools (e.g. `get_baby_profile`, `get_daily_summary`, `get_recent_records`, `get_vaccine_schedule`, `get_nutrition_analysis`, `record_feeding`, `record_sleep`, `record_diaper`, etc.). Consequently:
- Answering a single broad question (e.g. "How is the baby doing today, what vaccines are due, and are milestones on track?") caused Gemini to invoke 4 to 6 sequential tools, popping 4 to 6 separate authorization dialogs.
- Logging a multi-activity update (e.g. "Fed 150ml formula, changed diaper, and recorded 1 hour nap") triggered 3 sequential tool approvals.

This resulted in severe prompt fatigue and degraded conversational fluidity.

## Decision

We consolidate the 21 fine-grained MCP tools into **5 high-cohesion, coarse-grained tools**:

1. **`get_baby_overview`** (Composite Read):
   - Returns baby profile & exact age, today's aggregated schedule (milk volume, sleep duration, diaper counts, foods tried), recent timeline events (last 15 entries), nutrition & supplement DRI achievement status, upcoming vaccines (next 30 days), and current month developmental milestones & warning signs.
2. **`record_baby_events`** (Composite Write):
   - Supports single or multi-event atomic batch recording in a single turn for `feeding`, `sleep`, `diaper`, `food`, and `supplement`.
3. **`record_health_measurement`** (Clinical & Physical Growth Write):
   - Unified health entry covering physical measurements (height, weight, head circumference + WHO percentiles), completed vaccine doses, medical report archives, and record deletion.
4. **`query_parenting_knowledge`** (Structured Knowledge Search):
   - Unified query interface across local domain libraries: complementary food ingredients (age suitability, choking hazard), picture books, family early-education activities, and formula/supplement product profiles.
5. **`web_search`** (External Research):
   - Real-time pediatric guideline and web search with rate limiting.

## Consequences

- **Pros**:
  - Drops Gemini Spark user authorization prompts from 5~10 per turn down to **1 per turn**.
  - Provides complete context to the LLM in a single roundtrip, preventing hallucination caused by partial tool execution.
  - Enables atomic multi-event logging (e.g. feeding + diaper logged together without race conditions).
- **Trade-offs**:
  - Response payload for `get_baby_overview` is slightly larger (~2-3 KB), which is well within modern LLM context windows (Gemini / Claude / GPT).
  - Clients requesting specific sub-sections can use the optional `sections` or `date` filter parameter.
