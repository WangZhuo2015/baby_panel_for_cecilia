# Web migration differential acceptance

Status: IMPLEMENTED_NOT_REVIEWED. A successful build or unit suite does not imply HTTP parity, UI acceptance, or production deployment.

## Baselines

- Legacy golden source: server production commit `0b3e87c202b7420cb2ad2e1ee5d24cab3ceea156`.
- Isolated legacy checkout: `/Users/wangzhuo/Documents/GitHub/baby-panel-legacy-golden-20260919`.
- Candidate Web branch: `codex/web-parity-20260919`.
- Candidate backend branch: `codex/web-parity-20260919` in the sibling `growdesk-server` repository.
- Server production commits were fetched over SSH and merged into the candidate. No production database is a test fixture.

## Reproduction

Build both Next standalone artifacts with synthetic environment values. The candidate uses `GROWDESK_ENABLED=true`; the legacy checkout uses `false`. Do not copy production environment files. The managed runner supplies its own temporary database URLs and API origins when it starts each artifact.

From `growdesk-server`:

```sh
python3 scripts/test-integration.py \
  --web-root /Users/wangzhuo/Documents/GitHub/baby_panel_for_cecilia \
  --legacy-web-root /Users/wangzhuo/Documents/GitHub/baby-panel-legacy-golden-20260919 \
  --web-ui
```

The runner builds backend workspace dependencies first, owns dedicated PostgreSQL 18 and Redis 8 processes, verifies database/role/instance identity, runs the existing integration suites, starts real Fastify and Next TCP listeners, and destroys its resources on failure or success. UI requires locally installed Playwright Chromium. The optional flags can be run separately to identify the failing acceptance layer; no failed layer is treated as passing.

The legacy fixture uses a newly created `dev_test.db` under the owned temporary run directory. It never opens legacy `prod.db`, `dev.db`, or port 3088. Fixture accounts, families, and babies use test prefixes. UI screenshots and JSON reports are written into `ui/`; golden responses and the exact comparison report are written into `golden/`. Credentials and manifests stay in private temporary files and are not evidence artifacts.

## Strict golden contract

`scripts/review/golden-parity.mjs` has separate `collect` and `compare` modes. Collection reads real legacy HTTP responses. Comparison verifies the frozen legacy baseline and compares the new responses without deleting fields, sorting arrays, coercing numbers, or treating matching HTTP failures as success. IDs, nulls, field presence, types, and order all matter.

The source commit, fixture hash, endpoint catalog, and logical context bind a golden to its inputs. Runtime ports and newly issued login cookies can change between isolated runs; they do not change the logical fixture. A changed source or fixture requires an explicit new baseline, never silent replacement of an accepted artifact.

A report with differences is evidence of a migration gap. It must not be relabeled PASS merely because the UI can render some data. Version metadata, pagination defaults, and other deliberate protocol additions remain visible differences requiring an explicit compatibility decision.

## Deployment gate

Do not promote a candidate while strict comparison or required browser flows are failing. Production deployment and post-deployment read-only health checks are separate evidence from this isolated suite. External paid AI, real push delivery, and object-storage uploads require their own isolated acceptance fixtures; this suite does not claim those capabilities are covered.

## Verified checkpoint: round 12 (2026-09-19 UTC)

- Candidate standalone: build `GNId9ARuUvlQkMZrSCyR2`, source `7bdf6a2856f6caebdf156eecf95ab51e0bde7517` with recorded uncommitted changes; artifact SHA-256 `35df18cdb5e3ef5c157379bd34d00e4d86f6f1c5302c95202a5dc158fd6c27b0`.
- Web unit suite: 561 passed, zero failed (`/tmp/growdesk-web-full-unit-round12b.log`).
- Backend owned main suite: 197 passed plus separate infrastructure/care/AI suites; every production SQL migration applied to a fresh owned database with `ON_ERROR_STOP` before business assertions.
- Sol low browser acceptance: 15/15 PASS, zero browser console/network errors. See `ui/20260919185412203-ui-parity-report.json`. This includes direct-entry custom food creation, food record persistence/deletion, three consecutive medical title cycles, family sharing/revocation/regrant and selection persistence.
- Golden: all 31 endpoints returned HTTP 200; 8 exact PASS, 23 strict FAIL. The report is intentionally still failed. New concurrency metadata, reference identity changes, notification semantics and recipe-history coverage remain visible, and fixes are in progress.
- Two independent fresh legacy databases produced exactly equal complete endpoint objects. See `GOLDEN_REPEATABILITY.json`. DateTime fixtures use the Prisma LibSQL adapter's ISO text with `+00:00`; prior numeric-timestamp fixtures were invalid for SQL DateTime range predicates and are not the current baseline.
- No production database or port 3088 was used. No production deployment has occurred in this task checkpoint.

The checkpoint above identifies a tested artifact, not whatever future code happens to be in the branch. Subsequent fixes require a new build and matching acceptance evidence.


## Checkpoint: round 13 (2026-09-19 UTC; acceptance still failing)

- Candidate standalone: build `LpdfHzfCLpIlcZRQTSmIA`, source `da213b2f29057e286dd6bae65df10c9bf14c2c52` with recorded uncommitted changes; artifact SHA-256 `739e233104290029039f84821c1e83ecb4c83432c34867a4acdccff97c5ba939`.
- Web unit suite: 590 passed, zero failed before the later scope and outbox fixes. This is not a test count for the current working tree.
- Owned backend main suite: 200 passed; infrastructure, identity import, care (13), and AI contract (10) suites also passed. New real HTTP recipe-history and pending-vaccine assertions completed before the strict golden assertion failed the run.
- Strict golden: 31 successful HTTP responses, 9 exact PASS / 22 FAIL. Recipe history now exactly matches; notifications have the same 16-item count and six remaining field differences. Added fields, reference IDs, and missing metadata remain differences, not waived failures.
- Browser acceptance was extended from 15 to 16 flows to include an actual offline feeding save and reconnect. Round 13 did **not** pass: the saved draft lacked authenticated user ownership and appeared as an orphan, so automatic upload was not proven. A sleep timeline refresh assertion also failed despite the new sleep appearing in the sleep card. See `ui/20260919193210304-ui-parity-report.json`.
- Subsequent outbox, scope, notification-detail, and actor fixes need a fresh artifact and fresh HTTP/UI/golden runs. Focused test results do not change the round 13 result.
- A separate cloud importer audit found that `identity-v1` materializes identity only and archives the business rows without promoting them to runtime tables. Business import and field/count reconciliation remain production cutover blockers; the synthetic paired golden fixture does not prove that ETL.
- No production deployment or production data mutation has occurred.
