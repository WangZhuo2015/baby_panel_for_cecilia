import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const comparator = path.resolve("scripts/compare-3088-3089.py");
const preflight = path.resolve("scripts/import-prod-to-growdesk.py");

function compare(left: string, right: string, extra: string[] = []) {
  const directory = mkdtempSync(path.join(tmpdir(), "growdesk-test-parity-"));
  try {
    const legacy = path.join(directory, "test_legacy.json");
    const growdesk = path.join(directory, "test_growdesk.json");
    writeFileSync(legacy, left, { mode: 0o600 });
    writeFileSync(growdesk, right, { mode: 0o600 });
    return spawnSync("python3", [comparator, "--legacy-json", legacy, "--growdesk-json", growdesk, ...extra], {
      encoding: "utf8", timeout: 10_000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function snapshot(body: unknown, status = 200) {
  return JSON.stringify({ "/api/test": { status, body } });
}

test("parity checks every record, including changes after the old 20-record sample", () => {
  const left = Array.from({ length: 100 }, (_, i) => ({ id: `test_record_${i}`, amountMl: i }));
  const right = left.map(row => ({ ...row }));
  right[99]!.amountMl = 999;
  const result = compare(snapshot(left), snapshot(right), ["--max-details", "0"]);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.passed, false);
  assert.equal(report.endpoints[0].differenceCount, 1);
  assert.deepEqual(report.endpoints[0].differences, []);
});

test("nested arrays compare values rather than just their lengths", () => {
  const result = compare(snapshot({ records: [{ id: "test_one", notes: "original" }] }),
    snapshot({ records: [{ id: "test_one", notes: "changed" }] }));
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /original|changed/);
});

test("matching HTTP errors never pass as successful parity", () => {
  for (const status of [401, 403, 500]) {
    const value = snapshot({ error: "test error" }, status);
    const result = compare(value, value);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /non_success_http_status/);
  }
});

test("duplicate record IDs cannot hide a missing record", () => {
  const value = snapshot([{ id: "test_duplicate" }, { id: "test_duplicate" }]);
  const result = compare(value, value);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /duplicate_id/);
});

test("complete entity arrays match independently of ordering", () => {
  const values = [{ id: "test_a", amount: 1 }, { id: "test_b", amount: 2 }];
  const result = compare(snapshot(values), snapshot([...values].reverse()));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).scope, "exported_payloads_only");
});

test("large integers and decimal quantities are compared without float truncation", () => {
  const a = '{"/api/test":{"status":200,"body":{"value":9007199254740993.001}}}';
  const b = '{"/api/test":{"status":200,"body":{"value":9007199254740993.002}}}';
  assert.equal(compare(a, b).status, 1);
  assert.equal(compare(a, a).status, 0);
});

test("missing, null, boolean and numeric values remain distinct", () => {
  assert.equal(compare(snapshot({ value: null }), snapshot({})).status, 1);
  assert.equal(compare(snapshot({ value: true }), snapshot({ value: 1 })).status, 1);
});

test("invalid JSON, duplicate keys and nonfinite values are rejected", () => {
  for (const invalid of ["not-json", "{}", '{"x":1,"x":2}', '{"x":NaN}']) {
    const result = compare(invalid, invalid);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /No live server was contacted|no live server was contacted/);
  }
});

test("field exclusions must be explicit and appear in the report", () => {
  const left = snapshot({ id: "test_record", version: "1" });
  const right = snapshot({ id: "test_record", version: "2" });
  assert.equal(compare(left, right).status, 1);
  const result = compare(left, right, ["--ignore-field", "version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).ignoredFields, ["version"]);
});

function withSnapshot(run: (database: string) => void, extraFamilies = false, orphan = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "growdesk-test-preflight-"));
  const database = path.join(directory, "test_snapshot.db");
  const fixture = `
import sqlite3, sys
connection = sqlite3.connect(sys.argv[1])
connection.executescript('''
CREATE TABLE User (id TEXT PRIMARY KEY);
CREATE TABLE Family (id TEXT PRIMARY KEY);
CREATE TABLE Baby (id TEXT PRIMARY KEY, familyId TEXT);
CREATE TABLE FamilyMember (userId TEXT, familyId TEXT);
INSERT INTO User VALUES ('test_user');
INSERT INTO Family VALUES ('test_family');
INSERT INTO Baby VALUES ('test_baby', 'test_family');
INSERT INTO FamilyMember VALUES ('test_user', 'test_family');
''')
for name in ('FeedingRecord', 'SleepRecord', 'DiaperRecord', 'FoodLogRecord', 'GrowthMeasurement', 'SupplementRecord', 'MedicalReport', 'VaccineRecord'):
    connection.execute('CREATE TABLE ' + name + ' (babyId TEXT)')
if sys.argv[2] == '1': connection.execute("INSERT INTO Family VALUES ('test_second_family')")
if sys.argv[3] == '1': connection.execute("INSERT INTO FeedingRecord VALUES ('test_missing_baby')")
connection.commit()
connection.close()
`;
  try {
    const setup = spawnSync("python3", ["-c", fixture, database, extraFamilies ? "1" : "0", orphan ? "1" : "0"], {
      encoding: "utf8", timeout: 10_000,
    });
    assert.equal(setup.status, 0, setup.stderr);
    run(database);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function inspect(database: string, extra: string[] = []) {
  return spawnSync("python3", [preflight, "--snapshot", database, "--check-only", ...extra], {
    encoding: "utf8", timeout: 10_000,
  });
}

test("a successful source preflight is read-only and never reports cutover readiness", () => {
  withSnapshot(database => {
    const before = createHash("sha256").update(readFileSync(database)).digest("hex");
    const result = inspect(database);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.passed, true);
    assert.equal(report.executionAllowed, false);
    assert.equal(report.readyForCutover, false);
    assert.equal(report.scope, "source_reference_preflight_only");
    assert.equal(createHash("sha256").update(readFileSync(database)).digest("hex"), before);
  });
});

test("multi-family and orphaned sources cannot silently become a successful import", () => {
  withSnapshot(database => {
    const result = inspect(database);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /MULTI_FAMILY_REQUIRES_SCOPED_ETL/);
  }, true);
  withSnapshot(database => {
    const result = inspect(database);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /RECORD_WITHOUT_BABY/);
  }, false, true);
});

test("migration execution is unavailable and a live prod.db path is refused", () => {
  withSnapshot(database => {
    assert.equal(inspect(database, ["--execute"]).status, 2);
    const productionName = path.join(path.dirname(database), "prod.db");
    writeFileSync(productionName, readFileSync(database), { mode: 0o600 });
    const result = inspect(productionName);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /No target was contacted or modified/);
  });
});
