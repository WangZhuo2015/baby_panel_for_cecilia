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
