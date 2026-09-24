# Native timeline and canonical catalog increment

Status: implemented increment, author-reviewed; not complete Web/Go acceptance.

## Revisions and scope

- Web starting point: `1b645f8b5ba1c7b19f03fb6f96f40db31043043d`.
- Code checkpoint: `23ea0c08a52fff3f3b4bb0258b45ce9b2d0df6cb`.
- Native server pinned in `scripts/review/go-api-baseline.json`: `3e0578ba5e7ba6dc4b00e04d931385bbc5fafddb`.
- Frozen TypeScript contract reference: `f0f046f9f01ee34b1ed3f59ed993e4acb5d5bdf4`.
- Work remains in Web PR #22, targeting `codex/web-parity-20260919`, not main.
- No page layout, form structure, CSS or navigation is changed in this increment. The existing browser-facing URLs and legacy/extended response projections remain.
- No backend branch, production deployment, database migration, live AI service or real push device is changed by this increment.

## Implementation and review

### Direct native detail reads

`native-timeline-details.ts` obtains feeding, sleep, diaper, food and supplement details from Go's existing baby-scoped detail endpoints. It no longer scans unrelated history to locate each requested ID. The reference TypeScript mode keeps its existing loader.

All references are validated before network I/O. Duplicate kind/ID references share a read; incompatible duplicate versions are rejected. The shared five-worker pool applies across all record kinds, not five workers per kind. A failed read stops additional dispatch and joins already-started reads before returning the error. No partial successful timeline is returned.

Responses must match the requested record, baby, family and timeline version. Deletion or a version change produces a refreshable conflict. Authentication, authorization, throttling and server errors remain errors. Decimal strings, zero, false, null and the existing bottle-feeding alias are retained.

This is **one read per distinct detail ID**, not a new backend batch endpoint. The legacy 20,000-reference limit remains. The timeline list and overnight-sleep discovery still use their existing pagination; this change does not eliminate every history scan or establish a benchmark improvement. A native bounded batch projection remains a potential later optimization.

### Canonical supplement identity

Go-mode timeline enrichment reads the formal family supplement catalog, includes archived products and exhausts pagination. It rejects malformed, duplicate or cross-family product identities. It does not depend on food-plan supplement JSON. Historical doses and names are not replaced with the product's current default dose.

The TypeScript compatibility branch continues to use its previous food-plan representation. Canonical product rows are not synthesized from preset names by the new loader.

The product-list endpoint also forwards `includeInactive=true` to the backend as `includeArchived=true` for both formula and supplement catalogs. Pagination retains that filter; returned archived products remain inactive. Ordinary active-only queries preserve their prior behavior. The final production-code diff for this fix is two query strings. An unrelated copied legacy successor-filter change was noticed during commit-diff review and restored in `06029aa`; no legacy deletion behavior is intentionally changed.

## Tests and evidence

Three new unit files contain 16 tests:

- `growdesk-native-timeline-details.test.ts`: eight tests for direct IDs, deduplication, bounded concurrency, pre-validation, scope/version checks and failure handling.
- `growdesk-native-timeline-products.test.ts`: four tests for canonical archived catalogs, immutable response mapping, historical dose, scope and pagination errors.
- `growdesk-catalog-inactive.test.ts`: four actual route-handler tests covering Go/TypeScript and formula/supplement modes. Their HTTP upstream is mocked; they are not real database checks.

These files are included in the ordinary full `npm test` command. This authoring session could not execute local container/Python tools; executed results come from GitHub Actions. Do not reuse earlier local receipts as evidence for these changes.

### Real joint regression

`.github/workflows/go-web-parity.yml` runs a separate required-in-workflow job using a real Next standalone build, the pinned native Go executable, and exclusively owned PostgreSQL 18/Redis 8 test containers. It is not the previous synthetic-upstream smoke.

`scripts/review/check-native-go-web.py` currently exercises six grouped scenarios:

1. Browser-facing login, protected session-cookie attributes and explicit baby selection.
2. Feeding creation and idempotent replay with actual record/timeline/change/cursor/receipt assertions.
3. Legacy versus extended edit DTOs, optimistic update conflicts, foreign Origin rejection and sibling-baby isolation.
4. Five record kinds in the timeline, overnight sleep and an archived supplement without any food-plan row.
5. Revoking baby membership and denying the already-issued Web session.
6. Browser-facing deletion reaching native storage and BFF logout invalidating the session.

The harness sends real HTTP but does **not** drive a browser. Its loopback cookie handling does not prove browser Secure-cookie behavior, offline IndexedDB replay, visual parity or image-byte delivery. No S3 or Worker execution is included.

A first run at `74e2775` failed the clean-reference preflight because its binary was built inside the reference checkout. The safeguard was kept. `2ff2777` moved build output to the runner's temporary directory, checked the source remains clean, and passed real joint run `35934795418`.

Every later HEAD is re-run by both workflows. Final run links and conclusions belong in the PR description, bound to the actual final SHA. The workflow's report contains Web/Go revisions, build provenance, binary SHA-256, grouped results and HTTP-call count, but no test passwords or tokens.

A proposed expansion of the joint script into more nutrition/recipe scenarios was blocked during tool submission and is **not** in the branch. Only the committed six-scenario script is claimed. Archived product-list filtering has the four route-handler tests described above, not the unsubmitted real-HTTP expansion.

### Local reproduction on an owned test host

Use a clean checkout of each pinned repository and build the Web as documented by its existing scripts. Build the native executable outside the reference checkout so the source-clean check stays meaningful:

```sh
# In the pinned growdesk-server checkout:
export GOFLAGS=-mod=readonly
go mod download
go mod verify
CGO_ENABLED=0 go build -trimpath \
  -ldflags="-s -w -X main.revision=$(git rev-parse HEAD)" \
  -o /absolute/path/to/owned-test-artifacts/growdesk-api ./cmd/growdesk-api

# In the Web checkout after npm ci, Prisma generation and npm run build:
python3 scripts/review/check-native-go-web.py \
  --server-root /absolute/path/to/pinned-growdesk-server \
  --binary /absolute/path/to/owned-test-artifacts/growdesk-api \
  --report /absolute/path/to/owned-test-artifacts/native-web-report.json
```

Docker, Python and the documented language toolchains are prerequisites. The harness creates its own temporary database roles, users and resources. It accepts no production database override and performs no deployment. Cross-repository checkout uses read-only permissions; branch protection is not altered.

## Remaining review and integration work

This does not enable Web-local AI jobs, chat/voice execution, OCR, generated summaries or PAT/OAuth as substitutes for missing committed native execution. Existing Go-mode 501 boundaries remain explicit unfinished functionality.

Separate static review also found that the existing nutrition product modal omits its selected baby ID from product requests, while catalog write handlers infer the first accessible family. Correct multi-family catalog writes require a coordinated modal/handler change; this increment fixes archived listing, not that separate selection issue. Likewise, legacy supplement records relying only on note-encoded product IDs or ambiguous name matching need further end-to-end review.

Independent review, full browser acceptance, complete notification UI state migration, private S3 byte flows, Worker/Scheduler publication and complete Go feature parity remain open. Successful integration checks are not a production-cutover approval.
