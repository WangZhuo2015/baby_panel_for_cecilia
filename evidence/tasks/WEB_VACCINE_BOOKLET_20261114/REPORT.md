# Web vaccine booklet records

Status: **IMPLEMENTED_NOT_REVIEWED**

Baseline: `WangZhuo2015/baby_panel_for_cecilia` main, `ecf29fb3ce0c1dabdb20c545fdc264acd44d0189`.

## Problem

The vaccine screen used a reference-programme completion checkbox as a write to vaccination history. Historical records could not be corrected in place, and the legacy form/adapter filled missing plan dates and dose numbers with invented values. The stored record also could not represent the manufacturer, product, tracing code, injection site, clinic, and lot shown in a paper vaccination book.

## Record-book interface

- `/health/vaccines` now opens the actual record book. The reference timetable is a separate view, and a catalogue loading failure does not prevent reading or entering records.
- The record book separates completed injections from appointments, supports search and expandable booklet details, and provides create, correct, convert an appointment using an explicit actual date, and confirmed delete actions.
- The native modal form preserves the original wording and unknown doses. It requires a real date for the selected status and never initializes a historical injection to today. Manufacturer, product, lot, tracing code, clinic, site, and notes can be copied from the booklet. Catalogue linkage and an original appointment date remain optional.
- Reference completion opens the underlying record, including legacy name-matched records via their returned record ID. Adding from the timetable only prefills the name and dose, leaving the actual date for the user to provide. Missing imported records are described as needing record verification, not as proof of missed vaccination.
- Reads and editors are scoped to the active baby. Aborted loads, older responses, and an A-to-B-to-A baby switch cannot overwrite a newer view or close another baby's form. Save buttons reject duplicate clicks, while the stable client key protects a retried create request.
- Version conflicts preserve the form values and ask the user to reload and compare. The delete action uses the record version and requires explicit confirmation in the form.

## API and persistence changes

- `GET /api/vaccines/records?babyId=…` returns the scoped records and their string versions. The reference catalogue remains at `GET /api/vaccines`.
- `POST /api/vaccines` accepts a completed record with an explicit actual date, or a plan with an explicit scheduled date. A historical completed record may have no scheduled date. Unknown doses remain null; the original label can be retained separately.
- `PATCH /api/vaccines` requires `id`, `babyId`, and `baseVersion`, and preserves the original record ID. A stale version returns 409; a missing version returns 428. In bridge mode, the BFF forwards a partial PATCH to the canonical endpoint, never writing display fallbacks back into absent source fields.
- `DELETE /api/vaccines` accepts a version guard. A stale deletion does not remove a corrected record.
- The DTO round trips `manufacturer`, `productName`, `traceabilityCode`, `injectionSite`, `clinic`, `batchNumber`, and `notes`. Tracing codes remain strings, including leading zeros. Catalogue codes and normalized IDs are kept distinct. Free-text original names do not require a catalogue match.
- Selection writes only change the choice of programme. Completion is derived from surviving completed records. Incompatible old completion-checkbox requests return `VACCINE_RECORD_REQUIRED`, without changing historical records or dates.
- Legacy SQLite has additive migrations for the booklet fields and durable `VaccineWriteReceipt` rows. Retries with the same client key and payload return the same record; conflicting payloads return 409. Receipts remain after record deletion so a delayed retry cannot recreate a deleted vaccination. Tenant deletion cascades receipt cleanup.
- Legacy record snapshot restoration preserves the new booklet fields. Reminder projection no longer assumes an unknown dose is dose 1 or uses it to hide a known-dose appointment.

## Validation completed

All clinical data used here was generated under isolated `test_` accounts, families, and babies in `dev_test.db`. No personal vaccination-book image or copied individual medical record is included in the repository.

### Real HTTP and SQLite integration

```sh
TEST_API_FILES='tests/api/medical-vaccines.test.ts tests/api/vaccine-booklet.test.ts' bash scripts/test-api.sh 3089
```

**Passed, exit 0:** two API test files against a real local Next.js service and the migrated SQLite database. See `api-tests.txt`.

The booklet test covers historical create/read/update, null plan and unknown dose preservation, all booklet fields and leading-zero tracing codes, concurrent initial POST deduplication, same-key replay, mismatched-key payload rejection, deletion followed by delayed retry, version conflicts, explicit plan-to-completed transition, invalid dates, selection changes preserving the original facts, cross-tenant read/write rejection, and guarded deletion. The second file retains the existing medical-report/vaccine regression, with completion now based on a deliberately recorded actual date.

The test runner keeps its default complete API suite. `TEST_API_FILES` is an optional, validated subset for this change. The runner now uses the equivalent `node --import tsx` entry point (the environment blocks the tsx CLI's Unix IPC pipe), binds the temporary server to `127.0.0.1`, bounds its health probe, and rejects non-test database paths and port 3088 before migration/seed commands. An initial run without an explicit hostname hit this environment's `uv_interface_addresses` restriction and was stopped; the subsequent explicit-loopback runs passed.

### Unit and compatibility regression

```sh
node --import tsx --env-file=.env.test --test \
  tests/unit/vaccine-booklet.test.ts \
  tests/unit/growdesk-vaccine-legacy-projection.test.ts \
  tests/unit/growdesk-vaccine-pending-compat.test.ts \
  tests/unit/growdesk-medical-books-parity.test.ts \
  tests/unit/growdesk-bff-all.test.ts
```

**Passed: 91 tests, 0 failed.** See `unit-tests.txt`. HTTP interception in existing BFF unit tests validates wire mapping only; it does not replace the real SQLite transaction/concurrency checks above.

After cross-client contract review, the original dose label limit was aligned with the server's 100-character contract. The five focused booklet tests passed again, including acceptance at 100 characters and rejection at 101; see `dose-boundary-tests.txt`.

Also passed:

- Prisma client generation after both schema changes.
- `npm run typecheck` after the API and UI working-tree changes were present.
- `git diff --check` and `bash -n scripts/test-api.sh`.
- A negative runner check for port 3088 exited 1 before any migration or seed command.
- An in-memory SQLite migration check with one completed historical record and one planned record: every pre-existing field and ID remained equal, new unknown fields remained null, and `PRAGMA foreign_key_check` returned no violations.

### Interface verification

- Static cross-review covered active-baby scoping, stale asynchronous responses, original dose text, catalogue unlinking after a name correction, explicit actual dates, retry handling, and reference-to-record navigation.
- Targeted lint and TypeScript checks passed for the new component and changed vaccine page.
- `NODE_ENV=production npm run build`, with only `.env.test` loaded, passed. The build includes both `/health/vaccines` and `/api/vaccines/records`; `build.txt` contains its output. It reports eight filesystem-tracing warnings in unchanged backup and LLM configuration modules.
- No browser screenshot, mobile viewport, keyboard interaction, or deployed cross-service verification is claimed. The available browser could not reach the isolated local service.

## Limits and deployment dependency

- These HTTP integration results exercise the legacy SQLite mode. The canonical Go/TypeScript backend change has its own tests and migration; this report does not claim a deployed cross-service end-to-end run.
- Deploy the compatible server PATCH/field contract before enabling the updated Web bridge. Apply the Web's two SQLite migrations for deployments that still use legacy mode.
- Browser and device interaction checks remain a review gate for this draft implementation.
- Cloud photo attachments, OCR recognition, and batch-import confirmation are not implemented by this change. No production migration or deployment was performed here.
