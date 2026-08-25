# ADR 0001: Web app does not use Hermes as an LLM backend

- Status: accepted
- Date: 2026-08-25

## Context

Hermes is a stateful nested agent (gateway, memory, its own tools), not a stateless OpenAI-compatible completions server. Treating `/v1/chat/completions` as if it were GPT/OpenRouter caused:

- No native `tool_calls` for the Pi agent loop to execute.
- Process-scoped MCP identity, which is how 串号 happens if two families share one Hermes process.
- A dual stack (Hermes stream vs Pi+OpenRouter) that looked like a backend switch but was two different agent shapes.

OpenRouter `stealth/ox-alpha` was probed for the actual product jobs: Chinese parenting answers, OpenAI function tools, Pi loop (query + record), JSON tips, and vision OCR.

## Decision

- Web chat, tips, and OCR use OpenRouter + Pi + in-process Baby Panel Tools.
- Principal `(User, Baby)` is bound in the HTTP handler before the model runs. Tools ignore model-supplied `babyId` / `userId`.
- Do not wrap Hermes in Pi. Do not present Hermes as a selectable chat backend.
- Keep `scripts/mcp-server.mjs` for optional CLI / external agents. Do not disconnect a local Hermes MCP config unless asked.

## Consequences

- UI no longer switches LLM backends. Missing `OPENROUTER_API_KEY` is a hard failure for chat, not a silent Hermes fallback.
- `AI_BASE_URL` pointing at a Hermes gateway (`:8642` / `hermes-agent`) is ignored.
- Re-introducing the web app as a Hermes channel needs a new ADR (per-request identity, not completions-shaped).
