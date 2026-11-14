# VACCINE_BOOKLET_LEDGER

Status: **IMPLEMENTED_NOT_REVIEWED**. No production migration or deployment was performed.

## Scope and baseline

- Request: make vaccination recording usable against a real paper booklet.
- Web baseline: `ecf29fb3ce0c1dabdb20c545fdc264acd44d0189`.
- Companion backend: `WangZhuo2015/growdesk-server`, baseline `d89d9ef380482e39df3171a6f782de63101cebbb`.
- Companion backend PR: https://github.com/WangZhuo2015/growdesk-server/pull/21 ; paired integration is pinned to `f7f96f37a50d0dc62dd83135a25dd7157c3088c0`.
- Native iOS was inspected for compatibility. This change does not implement a new native iOS editing screen or update its pinned API snapshot.
- No supplied booklet image, child identifier, actual vaccination row, or clinical traceability identifier is included in this repository. Tests use synthetic tenants and records.

## Problem and resulting behavior

The old page emphasized an age-based checklist. Its completion switch could create an administration using today's date, and unchecking could remove the historical record. It could not adequately represent handwritten uncertainty, distinct appointment dates, product identity or the booklet's manufacturer/batch/clinic fields.

The primary screen is now a record ledger with independent **completed**, **planned** and **needs_review** states. Users can add historical doses, record appointments, keep uncertain source text, edit individual records, search the ledger, and continue entering another row. A single combined vaccine remains a single recorded administration.

- Confirmed administrations require an explicit valid nonfuture actual date. Appointment dates are never promoted into actual dates automatically.
- Missing dates and dose ordinals remain unknown. A new ledger row with an explicitly unknown ordinal is not reinterpreted from its unverified source text.
- Product links use full catalogue names, explicit brands or the user's selected product. Generic names such as Hib and five-in-one do not silently choose a brand. An explicitly unassigned product remains unassigned through storage, cloud transport and progress projection.
- The record retains manufacturer, clinic, batch number, trace code, administration route, injection site, original text and notes.
- Completion is derived from dated confirmed records. Selection preferences cannot create, rewrite or delete an administration.
- Writes check baby ownership, use a stable client id for creation retries, and compare record versions for edit/delete. Stale reads cannot overwrite a newer successful UI write.
- Notification generation, AI/MCP single and batch writers, and snapshot restoration share the same date/status/uncertainty rules. Failed cloud writes are reported as failures.
- The reference catalogue remains secondary and keeps its existing applicability metadata filters. It does not calculate catch-up instructions from the booklet.

## Data and API changes

`prisma/migrations/20261114120000_vaccine_record_ledger/migration.sql` preserves historical raw names, dose text and dates. It only links a historical product on one exact full-name match and only backfills an ordinal from a strict written ordinal. New nullable dates, detailed fields, record versions and creation idempotency fields support the ledger.

Web API:

- `GET /api/vaccines?view=records&babyId=...`
- `POST /api/vaccines` with a stable `clientId`
- `PUT /api/vaccines` with `id`, `babyId`, `baseVersion`
- `DELETE /api/vaccines?id=...&babyId=...&baseVersion=...`

In cloud mode, record requests opt into `x-growdesk-representation: ledger`; Web PUT maps to canonical PATCH. Deploy the companion backend migration/API before switching this Web build to it. The backend's legacy response representation protects the currently pinned iOS non-null date decoder; uncertain rows are not fabricated into dated legacy records.

## Verification

- Production `next build`: passed, including TypeScript and page generation.
- `tsc --noEmit`: passed.
- Focused ledger/compatibility/BFF regression suite: 98 passed, 0 failed.
- Full existing Web unit suite: 880 passed, 0 failed (using `node --env-file=.env.test --import tsx --test --test-concurrency=1`). Two obsolete source-string assertions were replaced with behavioral assertions for precise product identity and catalogue applicability; no tests were skipped.
- Notification, uncertainty and snapshot synthetic side-effect tests: 5 passed, 0 failed.
- Real HTTP suite `bash scripts/test-api.sh 3089 tests/api/medical-vaccines.test.ts`: 2 scenarios passed against isolated `dev_test.db`, including actual persistence, metadata edits, idempotency conflicts, stale edit/delete versions, cross-baby rejection, plan-to-completion validation, explicit product uncertainty and selective deletion. Test tenants were removed.
- `python3 scripts/review/check-vaccine-ledger-migration.py`: passed against an owned in-memory SQLite database with four synthetic historical rows. Dates, original text, exact identity, unknown values and foreign keys were checked.
- Prisma migration/schema diff was empty; `git diff --check` passed.

The API runner supports selecting relevant test files and binds its temporary server to loopback. The test process explicitly disconnects Prisma. The environment's tsx CLI IPC restriction was handled by using `node --import tsx`, without changing application behavior or skipping assertions.

## Review findings addressed

Independent source review identified generic-name brand inference, explicit unassigned identity being re-linked, stale list requests overwriting successful saves/deletes, and future-dated historical rows suppressing reminders. These were corrected and the product/notification/migration regressions were added. The legacy MCP health-record alias was also checked and corrected.

## Remaining acceptance gates

- Browser interaction and visual QA could not be performed in this environment. Check mobile Safari dialog behavior, date entry, keyboard scrolling, error retry, continuous entry, delayed reads and switching babies during requests.
- Cloud Go/PostgreSQL behavior must pass the companion backend's CI and paired Web integration gate. The local workspace has no usable Go compiler or owned PostgreSQL runtime.
- Repository implementation and local tests do not establish clinical schedule accuracy, production migration success, independent acceptance, or deployment.
