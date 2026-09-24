# Nutrition and notification boundary review

Status: IMPLEMENTED_NOT_REVIEWED. This is an incremental self-review, not independent acceptance, whole-site completion, deployment approval or a benchmark result.

## Source boundaries

- Web PR #22: `codex/go-web-adapter-20260923` -> `codex/web-parity-20260919`, not main.
- This continuation started at `253e1538c39aa21c0b529d463f1af55ad430f79f`.
- Earlier interrupted nutrition work was already committed between `b4cec411` and that starting point. It was inspected and retained, not represented as newly written in this continuation.
- Real-stack verification pins `WangZhuo2015/growdesk-server@3e0578ba5e7ba6dc4b00e04d931385bbc5fafddb` through `scripts/review/go-api-baseline.json`.
- No default backend switch, preview-guard removal, production data operation, real AI/push call, benchmark or merge was performed.

## Nutrition fixes retained and reviewed

The product catalog, nutrition page and supplement check-in use an explicitly captured user/family/baby scope. Reads, writes and multipart requests carry that selection; the BFF validates it against the authenticated session and actual family/baby APIs. An expected-user header detects an old tab after a cookie/account change; it is not an authentication source. Missing selection can be inferred only where unambiguous, not by choosing the first family.

Canonical supplement product IDs are authoritative. Conflicting notes tags, duplicate IDs and ambiguous same-name matches are rejected. A missing explicitly referenced product does not silently bind the historical record to a different current product with the same name. This resolves reference selection; it does not certify every old nutritional unit/default-dose fallback or all historical data.

This continuation additionally rejects conflicting or repeated foreign `babyId`/`familyId` multipart fields before fetch, copies rather than mutates the caller's form and disallows redirects. The client snapshots request identity, checks it before and after asynchronous work and advances its request epoch on every synchronous store transition, including React-batched A -> B -> A changes.

## Notification fixes

### Wire and authority

The existing array response and legacy item projection remain unchanged by default. Explicit `x-growdesk-representation: extended` requests receive validated `serverNotificationId` and nullable `readAt` for canonical persisted notifications only. Missing/invalid upstream state is an error, not invented unread state. Derived vaccine/daily reminders remain browser-local and have no fabricated backend ID.

The BFF validates expected user and requested family/baby consistency. Read writes retain CSRF-before-session checks and require a positive upstream acknowledgement. Authorization, conflict and service failures remain failures.

### Page and badge behavior

The notification page and both home/profile badges share `useNotificationInbox`. Persisted read state comes from the server even when old browser storage contains a conflicting local read ID. The page acknowledges visible entries; badges only read. Acknowledgement requests have per-request deadlines and at most four concurrent writes; denial stops additional queued writes. Captured identities and request epochs prevent late responses from changing the new user's view.

The clear action first acknowledges persisted items and then dismisses only confirmed items on this browser. A failed acknowledgement does not hide the item or store a fake local success. Text explicitly says `本机`; backend deletion remains unsupported. A fresh browser retains server readAt but not a different browser's dismissal. The page includes existing AI/data-release entries in its existing reminder section. Fetch failures have an explicit error/retry state instead of a false empty-success message.

A real Chromium run exposed a hard-reload defect: `/notifications` is outside the main layout and did not bootstrap the empty identity store. `e781e6d8` adds real session bootstrap through the existing deduplicated `fetchUser`, retains loading until it completes, and does not restore identity from private cached records. The failing browser scenario was preserved.

## Checks and evidence

Local execution was unavailable (container ClientError), so no local npm/Go/PostgreSQL/browser execution is claimed. Actual execution evidence is from GitHub Actions.

New focused files cover notification state/DTOs and BFF identity checks, acknowledgements with concurrency/failure/cancellation, and multipart/identity epochs. The previous smart-polling source test expected the event name inside the home page; it now checks both badge-to-hook wiring and hook event subscription/cleanup. The event assertion was moved to its implementation, not removed.

`Native Go Web parity` now runs `check-native-boundaries.py`, which composes and executes all six original HTTP/database scenarios before the new Chromium test. The existing immutable-source, isolated database/role, generated test credentials and cleanup checks are retained. Chromium is installed only in the disposable CI runner.

The browser test uses actual login forms, browser-managed Secure/HttpOnly cookies, actual Next and Go services and owned PostgreSQL. Only a designated notification acknowledgement is intercepted with a deliberate 503. External browser origins are blocked; service workers are disabled, so this is NOT offline/IndexedDB/service-worker acceptance. Scenarios include automatic reads, failure and retry, local dismissal versus cross-browser persisted read state, stale expected-user requests and account isolation. The Python harness also verifies committed database read_at values.

At `0cfc3ab0`, the original HTTP/database scenarios and real browser login/cookie check passed, but the notification rendering check failed on the missing bootstrap. Normal CI also caught the old smart-polling source assertion. These are retained failed runs, not reported as acceptance. Subsequent exact-HEAD results are recorded in PR #22 after completion; earlier green runs are not evidence for later commits.

## Cleanup and reproduction

Temporary source-export and branch-writing patch workflows, the applied patch and its receipt have been removed. Required normal and native/browser checks remain; assertions were not skipped and production guards were not weakened.

```sh
npm ci
npx prisma generate
npm run typecheck
npm run lint
npm test
npm run build
node scripts/review/check-growdesk-runtime.mjs
# Use the pinned clean server source, build its Go executable outside its tree,
# then execute only against newly owned disposable services:
python3 scripts/review/check-native-boundaries.py \
  --server-root /absolute/path/to/pinned/growdesk-server \
  --binary /absolute/path/to/test-binary/growdesk-api \
  --report /absolute/path/to/test-evidence/report.json
```

Read both repositories' AGENTS first. Do not point this harness at production, read production secrets, weaken source/connection checks or attach test data to real accounts.

## Remaining work

These changes do not complete missing published AI/Worker/Scheduler, voice/OCR or OAuth/MCP/PAT execution and their full frontend adaptation. The corresponding explicit unavailable paths are not counted as implemented. Full offline/IndexedDB, visual, private S3 byte-flow, push delivery and independent whole-site review remain separate. Server notification deletion is not added; local dismissal is intentionally distinct. The nutrition history still requires further checks of value/unit inference beyond product-reference identity.
