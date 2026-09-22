# Web migration hardening — 2026-09-22

Status: **IMPLEMENTED_NOT_REVIEWED / partial delivery**. The entire migration task is not complete and this PR does not authorize a production cutover.

## Revisions and scope

- Candidate base: `69c13f9c68ee763e28aa2d4d24c36b28b3277c93`.
- Code checkpoint: `339f31c029e0277c99875f09ebb3c72c66e7f710`.
- Branch: `codex/migration-readiness-20260922`; PR #21 targets `codex/web-parity-20260919`, not main.
- Companion backend: [growdesk-server#8](https://github.com/WangZhuo2015/growdesk-server/pull/8), final reviewed implementation checkpoint `2bfff7980b73f856408125e3c22f466660b79903` (code plus report; not independently approved).
- This report is a documentation-only commit after the code checkpoint.
- No page components or layout were rewritten. No merge, deployment, production data/account operation or paid AI call was performed.

## Implemented

### Accurate legacy DTO types

Legacy projections return types reflecting omitted concurrency metadata rather than claiming the result still has every property of the source. Copies preserve the original extended response. Nested unvalidated values remain unknown instead of being asserted to retain their old shape. Explicit extended-representation requests remain available to callers that require versions.

Four new regressions cover runtime omissions, source immutability, nested timeline fields, growth/chart projection and explicit representation selection; type-level negative assertions are checked by the project typecheck.

### Object-authorized old image URLs

In GrowDesk mode, `/uploads/*` no longer reads local files after merely detecting a valid session. The bridge calls the backend's authenticated legacy attachment resolver, validates its returned ID and issues a relative redirect to the existing protected `/api/attachments/:id` route. That content endpoint authorizes again. Unknown mappings, revoked access, ambiguous mappings and upstream failures do not fall back to old JWT or local filesystem reads.

The backend resolver and completed attachment-reference mappings are prerequisites. An unmapped legacy image returns an explicit failure rather than appearing to work through an unsafe local fallback. Preserving a URL does not itself migrate the file or prove that all historical mappings exist.

Four new bridge tests verify same-origin target construction, rejection before network access for unsafe paths or missing credentials, propagation of authorization/outage responses, and rejection of invalid IDs. The companion backend additionally ran real PostgreSQL object-permission regressions; these are not a substitute for a complete browser/object-storage acceptance run.

### Per-attempt AI retry clock

The existing job watchdog now measures `startedAt || createdAt`. Retrying sets a fresh `startedAt` without rewriting historical `createdAt`. An old job without startedAt retains its creation-time fallback. The existing watchdog fixture ages both timestamps so it still tests a genuinely expired attempt.

Two new tests demonstrate that an expired original job gets a fresh retry window, is not immediately timed out by GET or list, expires after the new attempt window, and preserves the old-job fallback. **This fixes timing only; the Map/JSON job store has not been migrated to backend authority.**

### Candidate CI and container provenance

The original full CI now covers this candidate branch and PRs targeting the candidate, without removing its test, audit, migration, build or Docker gates. Docker builds receive the actual `BUILD_REVISION`, which the standalone provenance generator requires outside a Git checkout. Packaging success remains a separate verification result from source tests.

## Actual validation

[Run 35692303656](https://github.com/WangZhuo2015/baby_panel_for_cecilia/actions/runs/35692303656), job `106631685166`, **passed**: dependency installation, Prisma generation, full project typecheck, lint, the 10 new focused regressions and Next.js production build. It then published the exact source edits as `339f31c` and removed its one-use publishing workflow. Only the temporary workflow was removed after source verification; the permanent CI change had already been committed through the authorized repository connection.

The run's separate container job `106632095837` was **still running at this report's checkpoint**. No Docker success is claimed. Earlier packaging attempts and publishing permission failures remain visible in Actions history and do not count as passing checks.

The full existing Web test suite has unresolved session, medical and nutrition-related failures observed in the candidate CI. Focused success does not override that result, establish full npm test success, or prove full feature parity. The new retry-clock change is not used as a reason to skip the original tests.

Local execution became unavailable during the task; the validation above is actual GitHub Actions execution, not a claimed local full build. All temporary source-export and source-publishing workflows have been removed from the branch.

## Not completed

- Full backend persistence for Web AI jobs and voice logs; actual voice and daily-summary Worker processors.
- Durable MCP/OAuth/PAT state, real authorization context, scope narrowing and safe enablement of the remaining routes.
- Timeline batch-by-ID retrieval and complete supplement timeline source convergence.
- Resolution of every existing Web test failure.
- Current clean Web/Server pair strict golden, browser, visual and private-object-storage acceptance, plus mandatory joint CI lanes.
- Candidate/main divergence integration, final stopped-writer snapshot, incremental promotion, historical attachment migration, restore rehearsal and production cutover.

Both PRs remain drafts. The absence of unsafe fallback is not equivalent to completing the missing backend capabilities, and no pending item is closed by this report.
