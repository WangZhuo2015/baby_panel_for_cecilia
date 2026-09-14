# GrowDesk WIP: published core repair

Status: IMPLEMENTED_NOT_REVIEWED. No production deployment, configuration change or data migration.

## Published scope

Base: `3aac3042712a34a4fcf72210a2cdc09d40f45a83` on `codex/wip-growdesk-web-integration-20260914`.
Feature branch: `codex/growdesk-feature-parity-20260914`.

This PR contains only independently validated record/date boundary fixes and their regression tests: family-local day bounds (including DST gaps), complete legacy history pagination, explicit scan-cap and cursor errors, strict input/upstream record validation, null-write rejection, and baby gestational-day precision. Two old Tokyo-date assertions were corrected to the actual local-day boundary; their coverage was not removed.

A separate, larger local workspace also contains identity serialization, scoped durable drafts, extended-view request isolation, registration/family/daily-summary wiring and growth adapters. Its bulk remote write was blocked by the tool safety check. Those dependent changes are NOT in this PR; they remain a reviewable offline patch. Unreferenced intermediate Git trees are NOT deployed or committed branch content. No incomplete dependency set was placed on the feature branch.

## Actual validation

The exact published source subset was reconstructed separately from the WIP baseline and tested independently:

- `growdesk-records-preview.test.ts` + `growdesk-record-boundaries.test.ts`: 31/31 passed, no skips.
- Strict targeted typecheck of these modules and tests: passed.
- Local environment: Node 22.16.0, TypeScript 5.8.3, a transpile-only source loader for runtime tests. No ambient framework stubs were used to claim a full build.
- The larger offline workspace passed 185 selected Web tests; that figure is NOT the test count of this PR and includes the 31 core tests.
- Server weather repair: WangZhuo2015/growdesk-server#2, 8/8 selected tests.

Web full typecheck and server full build were attempted but did not pass in the dependency-limited environment. Real PG/Redis/S3 and browser E2E were not run. IndexedDB event-contract mocks do not constitute browser storage validation. Existing MCP writer static check still fails and is tracked in #5.

With repository dependencies installed, reproduce this PR's selected tests with:

```sh
node --import tsx --test tests/unit/growdesk-records-preview.test.ts tests/unit/growdesk-record-boundaries.test.ts
```

The added read-only CI workflow attempts locked dependency installation, client generation, these selected tests, and the existing full typecheck/lint/build. Its presence is not a claim that remote CI has passed. No deploy step, production secret, migration or service restart is included.

## Remaining work

Master tracking: #1. Safety/identity/offline recovery: #2. Nutrition parity: #3. AI jobs/chat/search/voice: #4. MCP/OAuth and non-HTTP writers: #5. Attachments/OCR and health/reference features: #6. Notifications/push/scheduler: #7. Isolated integration and migration rehearsal: #8.

Do not remove legacy capabilities or broadly relax migration fences to close these tasks. Each domain requires field-level parity, authorization tests, actual isolated service evidence and independent review. The full offline patch must be reviewed and validated before any publication or merge; the current PR does not complete the full migration.
