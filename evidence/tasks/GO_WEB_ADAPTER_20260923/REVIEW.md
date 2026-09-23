# Go Web adapter: incremental review

Status: implemented increment; **not full Web/Go acceptance or production approval**.

- PR: #22, `codex/go-web-adapter-20260923` -> `codex/web-parity-20260919`.
- Code checkpoint: `79071a3f5885c22ce73a2e53f4dd31a250e65524`.
- Backend candidate inspected: `3e0578ba5e7ba6dc4b00e04d931385bbc5fafddb` in `WangZhuo2015/growdesk-server`.
- Existing layouts, page components and forms are unchanged by this increment. Browser-facing paths and response envelopes are retained.
- No merge, deployment, production database action, real push delivery or benchmark was performed.

## Small commits and review findings

| Commit | Change |
| --- | --- |
| `a623c12` | Repair the HTTP smoke's canonical notification fixtures; test both legacy DTO and extended edit-version response. Notification failures remain failures. |
| `810e2aa` | Preserve complete WebPush subscription JSON including P-256 and auth keys; use stable installation IDs; propagate failed unsubscribe. Expose authenticated VAPID public-key lookup. |
| `95fe694` | Resolve old upload URLs through the backend's authorized attachment mapping. Rewrite before public-file routing to prevent surviving disk files bypassing authorization. |
| `484fe36` | Instantiate legacy attachment adapters inside request handlers after an actual CI route-collection failure. |
| `0c24294` | Restore notification POST/PATCH and voice-history GET/PATCH reachability; enforce CSRF, live session handling, response ownership and explicit acknowledgement success. |
| `52c64a2` | Check out the exact PR head, pass the source revision into Docker, verify the embedded build revision, and use an exclusively owned temporary migration database. |
| `b2f00c1` | Exercise private-history actions and a real surviving public-file fixture through the actual Next HTTP server. |
| `0915e10` | Remove the temporary source-export workflow. |
| `79071a3` | Permit authenticated attachment HEAD requests and test anonymous and revoked access through real Next HTTP routing. |

### Authorization and error handling

Push writes check CSRF before session exchange. Body size is bounded at 8 KB; URLs and both keys are validated. The full subscription is forwarded only with the BFF-resolved access token. An HTTP error or `{success:false}` is not converted into success.

Old attachment paths reject traversal components, encoded separators, control characters and oversized UTF-8 paths. A mapped ID must be a UUID. Redirects are relative same-origin URLs; upstream-provided URLs and forwarded host headers are not trusted. The canonical attachment endpoint performs its own current authorization. Missing mappings and authorization errors never fall back to disk. The HTTP test creates only its own uniquely named file and deletes only that file.

Voice-log GET checks both the requested ID and current user. PATCH rejects malformed acknowledgement values and foreign origins before writes. Notification read and voice acknowledgement require a positive backend result and preserve upstream denial/outage statuses.

### Compatibility boundaries

Full WebPush persistence applies to Go mode; the pre-existing TypeScript subscription branch remains unchanged. Registration is not proof of actual worker delivery. The Web VAPID public key must match the key configured for the eventual push worker.

Notifications derived from daily/vaccine data still use browser-local dismissal/read behavior. Restoring the persisted notification endpoint does not by itself migrate every notification-page action to cross-device server state. Notification deletion is not advertised as implemented.

The old-image rewrite also runs in TypeScript GrowDesk mode; that deployment must include `/api/v1/web/attachments/resolve-legacy` and verified attachment mappings. The legacy non-GrowDesk filesystem path is not rewritten. An nginx rule serving `/uploads` directly would bypass Next.js entirely and must not be used for private migrated uploads.

## Executed verification

The three new focused test files contain **18 passing tests** at the code checkpoint:

```sh
node_modules/.bin/tsx --env-file=.env.test --test --test-concurrency=1 \
  tests/unit/growdesk-native-push.test.ts \
  tests/unit/growdesk-legacy-attachment-route.test.ts \
  tests/unit/growdesk-private-history-routes.test.ts
npm run typecheck
npm run lint
npm run build
node scripts/review/check-growdesk-runtime.mjs
```

Local focused tests, typecheck, lint and actual Next HTTP smoke passed. Local lint retained existing warnings; it was not warning-free. A local `npm test` attempt was blocked during Prisma's pretest engine download by unavailable DNS; do not report the full local suite as passed. The local build completed and the HTTP smoke was rerun separately after the combined tool invocation timed out. Docker is not installed in the local review container; its result comes from Actions.

The smoke runs a **real Next.js production build against a synthetic upstream**, including cookie exchange, legacy/extended DTOs, push subscribe/unsubscribe, notification outage/read, voice-history acknowledgement/CSRF, and private attachment GET/HEAD. It is not a real Go/PostgreSQL/MinIO or browser acceptance test.

Actual CI checkpoint `0915e10bc3c85b7c30fa6df8164262754313b45d`, run `35892127925`, completed successfully: typecheck, lint, schema/migrations, dependency audit, full `npm test`, Next build, HTTP smoke, Docker build and embedded-revision verification. Subsequent HEAD-specific results must be checked independently; this earlier green run is not evidence for future commits. PR #22 records the final checked run.

## Remaining work, not hidden by the migration fence

The inspected merged Go backend does not yet register the complete AI execution/Worker/Scheduler and OAuth/MCP flows described in earlier local-only work. This increment therefore does not enable Web-local AI jobs, chat/voice execution, OCR, generated daily summaries/tips or synthetic PAT identities as a substitute. Their existing explicit Go-mode failures are not counted as completed adaptation.

Complete Web acceptance still needs the missing backend runtime published and reviewed, UI-to-API integration for those functions, all relevant notification actions, real private S3 byte-flow and push delivery checks, and an actual browser/Go/PostgreSQL joint run. The frontend selector and the backend's isolated-preview startup protection remain unchanged.

Independent review should verify the exact final SHA; run all checks without disabling assertions or weakening guards; launch only owned test services with generated credentials; test account/baby switching, revoked access, upload references and worker restart; and record synthetic-provider limitations separately. Do not deploy or operate production as part of review.
