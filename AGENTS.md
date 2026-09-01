<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Baby Panel Agent Guidelines & Security Principles

## 🚨 Test Data & Test Account Isolation (测试数据与测试账号严格规范)

**Rule: All test, integration, and mock data MUST be created under explicit test accounts.**

1. **Test Account Naming Convention**:
   - Every user account created during test execution, development verification, API debugging, or E2E scripts **MUST** have a `username` starting with `test_` or `e2e_` (e.g. `test_${Date.now()}_user`).
   - Associated test families and babies **MUST** clearly carry test prefixes (e.g. `test_family_*`, `test_baby_*`).

2. **Strict Prohibition on Real User Data Pollution**:
   - **NEVER** write mock, stress-test, benchmark, or dummy records (feeding, sleep, diaper, food, growth, vaccines, medical reports) into real caregiver accounts or real baby profiles (e.g. `Cecilia` or any production family).
   - All automated test suites (`tests/**/*.test.ts`) must dynamically create isolated test users (`prefix = "test_"`) and their own test families/babies, ensuring complete tenant isolation.

3. **Batch Cleanup Guarantee (方便一键清理)**:
   - Because all test entities are bound to `test_*` users and cascade-deleted with `Family` / `Baby`, the database administrator can wipe all test residue at any time with a clean query:
     ```sql
     -- Safe purge of all test data without affecting real accounts
     DELETE FROM "User" WHERE username LIKE 'test_%' OR username LIKE 'e2e_%';
     ```

## 🔒 Tenancy & Identity Principles (防串号与权限规范)

1. **Untrusted LLM Parameters**:
   - `userId`, `babyId`, `familyId` passed as tool arguments by an external AI / LLM are **untrusted**.
   - Tools and Route Handlers **MUST ALWAYS** resolve the active `UserPrincipal` from the validated session / OAuth Bearer Token context.

2. **Audience & PKCE Strictness**:
   - OAuth 2.1 access tokens are strictly bound to `aud: <baseUrl>/mcp`.
   - PKCE must strictly enforce `S256` with single-use atomic code exchange.

