# ADR 0007: Schema Evolution, Type Contracts, and Data Reliability Architecture

- Status: accepted
- Date: 2026-09-04

## Context

Baby Panel has grown from a single-caregiver logging utility into a multi-caregiver pediatric intelligence workstation managing medical records, WHO growth standards, DRIs nutrition engines, and remote AI agents. As data volume and external integration touchpoints (HomePod voice shortcuts, Gemini Spark MCP) increase, long-term schema reliability and contract consistency must be addressed:

1. **Prisma Schema Data Modeling Realities (SQLite vs PostgreSQL/LibSQL)**:
   - Several core timestamps (`FeedingRecord.timestamp`, `DiaperRecord.timestamp`, `SleepRecord.startTime`/`endTime`) are currently stored as `String` in SQLite rather than native `DateTime`.
   - Enumerated attributes (`role`, `relation`, `gender`, `feedingType`, `diaperType`) are modeled as `String` with default values rather than native Prisma `enum`.
   - SQLite does not support native `enum` or native `DateTime` types at the storage engine level (storing them as `TEXT` check constraints or ISO-8601 strings).
   - Any uncoordinated database schema migration on `prod.db` could cause data loss or table locks in production.

2. **Frontend State & Request Synchronization (Zustand vs TanStack Query)**:
   - The frontend currently utilizes custom Zustand slices with manual imperative `fetch()` methods.
   - While Zustand provides simple local UI state, background revalidation, window refocus polling, and concurrent request deduplication require handwritten event listeners and `SmartPollingHost` logic.

3. **End-to-End Reliability Assurance**:
   - Unit and API tests execute in Node.js runtime with mocked or direct HTTP invocations, but do not verify browser hydration, dynamic client rendering, CSS layout stability, or user interaction lifecycles.

---

## Decisions

### 1. Schema Evolution & Safe Dual-Compatibility Protocol

1. **Zero-Downtime Contract Compatibility Layer**:
   - Production SQLite (`prod.db`) must remain physically protected and unbroken. Direct destructive SQL migrations (`DROP TABLE`, `ALTER COLUMN TYPE`) are strictly prohibited.
   - All API endpoints and domain engines must enforce ISO-8601 UTC validation at the boundary (`lib/date.ts:isValidDateStr`) before writing strings.
   - Domain types in `types/index.ts` remain strictly typed TypeScript string unions (`FeedingType`, `SleepType`, `DiaperType`, `BabyGender`, `FamilyRole`).

2. **Native DateTime & Enum Migration Roadmap (Targeting LibSQL/PostgreSQL)**:
   - When migrating from standalone local SQLite to distributed LibSQL/Turso or PostgreSQL:
     - **Phase A**: Add check constraints and synthetic getters in Prisma (`@db.Text` with ISO-8601 regex check).
     - **Phase B**: Introduce shadow columns or dual-write adapters during table transformation.
     - **Phase C**: Promote columns to native `DateTime` and Prisma `enum` using safe batch migration scripts (`prisma migrate dev --create-only`).

### 2. Frontend Data Fetching Evolution (TanStack Query Assessment)

1. **Separation of Concerns**:
   - **Local UI State**: Retain Zustand for ephemeral modal states, quick AI drawer visibility, and active stopwatches (`useBabyStore.baby`, `useBabyStore.user`).
   - **Server Cache & Revalidation**: Plan gradual introduction of `@tanstack/react-query` for high-frequency cacheable queries:
     - Daily timeline (`/api/records/timeline`)
     - Nutrition analysis (`/api/nutrition/analysis`)
     - WHO growth standards (`/api/growth`)
     - Vaccine schedules (`/api/health/vaccines`)
   - **Benefits**: Automatic stale-while-revalidate, request deduplication across simultaneous components (e.g. desktop sidebar + mobile header), and background polling without manual `setInterval`.

### 3. Playwright E2E Smoke Suite & Isolation Framework

1. **Strict Test Tenant Physical Isolation (`tests/e2e/smoke.spec.ts`)**:
   - All E2E test runs execute against port `3089` and `DATABASE_URL=file:./dev_test.db`.
   - Automated runner `scripts/test-e2e.sh` guarantees:
     - Pre-test migration baseline check and reference data seeding.
     - Pre-test and post-test purge of `test_*` and `e2e_*` users via `scripts/purge-test-data.ts`.
     - Zero test remnants in database upon suite termination.

2. **Core Smoke Scenarios Covered**:
   - **Journey 1**: User Registration -> Baby Profile Onboarding -> Direct landing on Main Dashboard `/`.
   - **Journey 2**: Core Diaper/Feeding recording -> Instantaneous timeline reflection.
   - **Journey 3**: Daily summary dashboard navigation -> Poster modal opening and 2D canvas export verification.

---

## Consequences

- **Positive**:
  - Full end-to-end user journeys are continuously validated using real headless Chromium browsers.
  - Zero database corruption risk to real production family data.
  - Transparent migration roadmap for eventual cloud database migration.
- **Negative / Trade-offs**:
  - Running full Playwright E2E tests takes ~35 seconds due to browser boot and Next.js page compilation; retained as a dedicated gate (`npm run test:e2e`) rather than running on every tiny unit test save.
