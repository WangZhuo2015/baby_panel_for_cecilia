import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const script = path.resolve("scripts/review/golden-parity.mjs");
const sourceGitSha = "0b3e87c000000000000000000000000000000000";
const fixtureSha = "f".repeat(64);

type FixtureMode = "same" | "changed" | "error";

interface Fixture {
  server: Server;
  origin: string;
  mode: FixtureMode;
  requests: number;
}

const fixtures: Fixture[] = [];

async function startFixture(initialMode: FixtureMode): Promise<Fixture> {
  const fixture: Fixture = { server: createServer(), origin: "", mode: initialMode, requests: 0 };
  fixture.server.on("request", (request, response) => {
    fixture.requests += 1;
    const url = new URL(request.url || "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");
    if (request.method !== "GET" || url.pathname !== "/api/records/feeding") {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "test_not_found" }));
      return;
    }
    if (fixture.mode === "error") {
      response.writeHead(500);
      response.end(JSON.stringify({ error: "test_sensitive_server_error" }));
      return;
    }
    const rows: Array<Record<string, unknown>> = [
      { id: "test_record_a", version: "7", nullable: null, secret: "test_sensitive_value" },
      { id: "test_record_b", version: "8", nullable: "present", secret: "test_sensitive_value_2" },
    ];
    if (fixture.mode === "changed") {
      rows.reverse();
      rows[0]!.version = "999";
      delete rows[1]!.nullable;
    }
    response.writeHead(200);
    response.end(JSON.stringify({ data: rows, extra: null }));
  });
  fixture.server.listen(0, "127.0.0.1");
  await once(fixture.server, "listening");
  const address = fixture.server.address();
  assert.ok(address && typeof address === "object");
  fixture.origin = `http://127.0.0.1:${address.port}`;
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()!;
    if (fixture.server.listening) {
      fixture.server.closeAllConnections();
      await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    }
  }
});

function manifest(legacyOrigin: string, newOrigin: string) {
  return {
    schemaVersion: 1,
    sourceGitSha,
    fixtureSha,
    legacyOrigin,
    newOrigin,
    tenant: {
      username: "test_user_golden",
      familyName: "test_family_golden",
      babyName: "test_baby_golden",
    },
    context: {
      userId: "a0000000-0000-4000-8000-000000000001",
      familyId: "b0000000-0000-4000-8000-000000000001",
      babyId: "c0000000-0000-4000-8000-000000000001",
      date: "2026-09-19",
    },
    headers: {
      legacy: { cookie: "test_legacy_cookie" },
      new: { cookie: "test_new_cookie" },
    },
    endpoints: [
      {
        id: "records.feeding",
        category: "records",
        path: "/api/records/feeding",
        query: { babyId: "{{babyId}}", date: "{{date}}", limit: "200" },
      },
    ],
  };
}

function tempFiles() {
  const directory = mkdtempSync(path.join(tmpdir(), "growdesk-golden-parity-test-"));
  return {
    directory,
    manifest: path.join(directory, "test_manifest.json"),
    golden: path.join(directory, "test_legacy.golden.json"),
    report: path.join(directory, "test_report.json"),
  };
}

function writeManifest(file: string, value: unknown, mode = 0o600) {
  writeFileSync(file, JSON.stringify(value), { mode });
  chmodSync(file, mode);
}

async function run(args: string[]) {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  return await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ status: null, stdout, stderr: `${stderr}\nTIMEOUT` });
    }, 15_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function collectArgs(files: ReturnType<typeof tempFiles>) {
  return [
    "--mode", "collect",
    "--manifest", files.manifest,
    "--golden", files.golden,
    "--output", files.report,
  ];
}

function compareArgs(files: ReturnType<typeof tempFiles>) {
  return [
    "--mode", "compare",
    "--manifest", files.manifest,
    "--golden", files.golden,
    "--output", files.report,
  ];
}

test("collects golden data from legacy HTTP and strictly compares every field and array position", async () => {
  const legacy = await startFixture("same");
  const newer = await startFixture("same");
  const files = tempFiles();
  try {
    writeManifest(files.manifest, manifest(legacy.origin, newer.origin));

    const collected = await run(collectArgs(files));
    assert.equal(collected.status, 0, collected.stderr);
    const golden = JSON.parse(readFileSync(files.golden, "utf8"));
    assert.equal(golden.provenance.source, "legacy-next-http");
    assert.equal(golden.endpoints[0].response.body.data[0].secret, "test_sensitive_value");
    assert.equal(statSync(files.golden).mode & 0o777, 0o600);
    assert.equal(statSync(files.report).mode & 0o777, 0o600);

    const matching = await run(compareArgs(files));
    assert.equal(matching.status, 0, matching.stderr);
    assert.equal(JSON.parse(matching.stdout).passed, true);

    newer.mode = "changed";
    const changed = await run(compareArgs(files));
    assert.equal(changed.status, 1, changed.stderr);
    assert.match(changed.stdout, /BODY_MISMATCH/);
    assert.doesNotMatch(changed.stdout, /test_sensitive_value|test_sensitive_server_error/);
    const report = JSON.parse(readFileSync(files.report, "utf8"));
    assert.equal(report.responses[0].legacy.body.data[0].secret, "test_sensitive_value");
    assert.ok(report.results[0].differenceCount >= 3, "order, version, and null/extra fields must all be compared");
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test("matching 500 responses never count as a golden parity pass", async () => {
  const legacy = await startFixture("same");
  const newer = await startFixture("same");
  const files = tempFiles();
  try {
    writeManifest(files.manifest, manifest(legacy.origin, newer.origin));
    assert.equal((await run(collectArgs(files))).status, 0);
    legacy.mode = "error";
    newer.mode = "error";
    const result = await run(compareArgs(files));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /NON_SUCCESS_HTTP_STATUS/);
    assert.doesNotMatch(result.stdout, /test_sensitive_server_error/);
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test("rejects non-private manifests, production ports, and non-test tenants before any HTTP request", async () => {
  const legacy = await startFixture("same");
  const newer = await startFixture("same");
  const files = tempFiles();
  try {
    const valid = manifest(legacy.origin, newer.origin);
    writeManifest(files.manifest, valid, 0o644);
    const modeRejected = await run(collectArgs(files));
    assert.equal(modeRejected.status, 2);
    assert.match(modeRejected.stderr, /MANIFEST_MUST_BE_MODE_600/);
    assert.equal(legacy.requests, 0);
    assert.equal(newer.requests, 0);

    writeManifest(files.manifest, { ...valid, legacyOrigin: "http://127.0.0.1:3088" });
    const portRejected = await run(collectArgs(files));
    assert.equal(portRejected.status, 2);
    assert.match(portRejected.stderr, /LEGACY_ORIGIN_PRODUCTION_PORT_FORBIDDEN/);
    assert.equal(legacy.requests, 0);

    writeManifest(files.manifest, {
      ...valid,
      tenant: { ...valid.tenant, username: "real_user" },
    });
    const tenantRejected = await run(collectArgs(files));
    assert.equal(tenantRejected.status, 2);
    assert.match(tenantRejected.stderr, /TENANT_USERNAME_MUST_BE_TEST_NAME/);
    assert.equal(legacy.requests, 0);
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test("refuses a golden file whose provenance or manifest fingerprint was changed", async () => {
  const legacy = await startFixture("same");
  const newer = await startFixture("same");
  const files = tempFiles();
  try {
    const valid = manifest(legacy.origin, newer.origin);
    writeManifest(files.manifest, valid);
    assert.equal((await run(collectArgs(files))).status, 0);
    const golden = JSON.parse(readFileSync(files.golden, "utf8"));
    golden.provenance.source = "new-http";
    writeManifest(files.golden, golden);
    const rejected = await run(compareArgs(files));
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /GOLDEN_SOURCE_NOT_LEGACY_HTTP/);
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test("default endpoint catalog covers the requested parity domains and dynamic baby/date queries", async () => {
  const module = await import("../../scripts/review/golden-parity.mjs");
  const categories = new Set(module.DEFAULT_ENDPOINTS.map((endpoint: { category: string }) => endpoint.category));
  for (const category of ["records", "timeline", "nutrition", "growth", "medical", "vaccine", "family", "food", "knowledge"]) {
    assert.ok(categories.has(category), `missing default parity category: ${category}`);
  }
  assert.ok(module.DEFAULT_ENDPOINTS.some((endpoint: { query: Record<string, unknown> }) => endpoint.query.babyId === "{{babyId}}"));
  assert.ok(module.DEFAULT_ENDPOINTS.some((endpoint: { query: Record<string, unknown> }) => endpoint.query.date === "{{date}}"));
  assert.ok(module.DEFAULT_ENDPOINTS.every((endpoint: { path: string }) => endpoint.path.startsWith("/api/")));
});

test("a frozen golden survives fresh isolated ports and cookies but rejects changed fixture identity", async () => {
  const legacy = await startFixture("same");
  const newer = await startFixture("same");
  const files = tempFiles();
  try {
    writeManifest(files.manifest, manifest(legacy.origin, newer.origin));
    assert.equal((await run(collectArgs(files))).status, 0);
    const freshLegacy = await startFixture("same");
    const freshNew = await startFixture("same");
    const next = manifest(freshLegacy.origin, freshNew.origin);
    next.headers.legacy.cookie = "test_fresh_legacy_cookie";
    next.headers.new.cookie = "test_fresh_new_cookie";
    writeManifest(files.manifest, next);
    const result = await run(compareArgs(files));
    assert.equal(result.status, 0, result.stderr);
    next.fixtureSha = "e".repeat(64);
    writeManifest(files.manifest, next);
    const changed = await run(compareArgs(files));
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /GOLDEN_FIXTURE_SHA_MISMATCH/);
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});
