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
     -- 删 User 只级联中间表与直连子表；Family/Baby 无指向 User 的外键，需再清孤儿家庭（自动级联其 Baby 与全部记录）：
     DELETE FROM "Family" WHERE "id" NOT IN (SELECT "familyId" FROM "FamilyMember");
     ```
   - 或跑脚本：`npx tsx scripts/purge-test-data.ts`（等价，另含空家庭与测试 OAuth 客户端清理）。
   - 局限：`AiArchive` / `OAuthAuditLog` 无用户关联，清不掉（审计需要；测试库 `dev_test.db` 定期重建即可）。
   - API 集成测试必须跑隔离脚本，禁止直连生产库：`npm run test:api:server` 或 `bash scripts/test-api.sh 3089`（独立 `dev_test.db` + 3089 临时服务，跑完自清理）。

## 🛡️ Database & Environment Isolation (生产库与测试环境硬隔离规范)

**Rule: Strict physical and configuration separation between Production (`prod.db`) and Testing (`dev_test.db`).**

1. **Environment & Database Mapping (环境文件与数据库映射)**:
   - **生产环境 (Production)**:
     - 配置文件：`.env`
     - 生产数据库：`file:./prod.db`（物理权限 `600`，存储真实家庭与宝宝“好好”的全部核心数据）
     - 生产端口：`3088` (由 systemd `baby-panel.service` 管理)
   - **自动化测试环境 (Test Suite)**:
     - 配置文件：`.env.test`（Git 托管公共模板 `.env.test.example`）
     - 测试数据库：`file:./dev_test.db`（严禁任何测试触碰 `prod.db` 或 `dev.db`）
     - 测试端口：`3089`（避免与 3088 生产服务冲突）
     - 安全 Mock：测试环境统一配置虚拟密钥，杜绝测试执行产生外部 API 计费或推送骚扰。

2. **Defense-in-Depth Connection Firewall (连接层硬熔断保护)**:
   - **Prisma 运行时硬阻断 (`lib/prisma.ts`)**：检测到处于测试进程（`IS_TEST`）且连接字符串指向 `prod.db` 或 `dev.db` 时，直接抛出 `[FATAL DATABASE SAFETY GUARD]` 并终止进程。
   - **配置优先级强覆盖 (`lib/config.ts`)**：在测试执行时，自动以 `override: true` 优先加载 `.env.test`，确保测试环境变量（`DATABASE_URL=file:./dev_test.db`、`PORT=3089`）始终拥有最高优先级，彻底消除因意外加载 `.env` 造成的变量污染。

3. **Standard Test Execution (测试执行标准规范)**:
   - 单元测试与 AI 工具测试：
     ```bash
     npm test             # 串行执行单元测试与 AI 测试（自动加载 .env.test，连接 dev_test.db）
     npm run test:unit    # tsx --env-file=.env.test --test tests/unit/**/*.test.ts ...
     npm run test:ai      # tsx --env-file=.env.test --test tests/ai/**/*.test.ts ...
     ```
   - API 集成测试：
     ```bash
     npm run test:api:server   # 等价于 bash scripts/test-api.sh 3089（拉起 3089 临时服务 + 跑完自清理）
     ```
   - **禁令**：严禁在测试代码中使用 `prisma.baby.findFirst()` 或 `prisma.user.findFirst()` 抓取第一条真实数据，所有测试必须通过 `createTestTenant()` 创建隔离租户并在 `t.after` 注册销毁。

## 🔒 Tenancy & Identity Principles (防串号与权限规范)

1. **Untrusted LLM Parameters**:
   - `userId`, `babyId`, `familyId` passed as tool arguments by an external AI / LLM are **untrusted**.
   - Tools and Route Handlers **MUST ALWAYS** resolve the active `UserPrincipal` from the validated session / OAuth Bearer Token context.

2. **Audience & PKCE Strictness**:
   - OAuth 2.1 access tokens are strictly bound to `aud: <baseUrl>/mcp`.
   - PKCE must strictly enforce `S256` with single-use atomic code exchange.

