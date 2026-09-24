import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GROWDESK_CONFIG } from "../../lib/config";
import { fromGrowDeskGrowthRecord, transformWhoPercentilesForLegacy, type GrowDeskGrowthRecord } from "../../lib/growdesk/growth-compat";
import { GET as chart } from "../../app/api/growth/chart/route";
import { GET as measurements } from "../../app/api/growth/route";

const BABY = "test_baby_growth_chart";
const record: GrowDeskGrowthRecord = { id: "test_growth", babyId: BABY, familyId: "test_family", measurementDate: "2026-07-31", weightKg: "7.10", heightCm: null, headCircumferenceCm: null, attachmentId: null, notes: null, version: "1", createdAt: "2026-07-31T00:00:00Z", updatedAt: "2026-07-31T00:00:00Z" };
const request = (path: string) => new Request(`https://test.invalid${path}`, { headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"b".repeat(64)}` } });

// Simulated HTTP boundary only: no database, server, or external API access.
function setup(t: any, babyStatus = 200) {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => { if (previous === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = previous; });
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    if (path === `/api/v1/babies/${BABY}` && babyStatus !== 200) return Response.json({ error: { code: "UNAVAILABLE", message: "test baby unavailable" } }, { status: babyStatus });
    if (path === `/api/v1/babies/${BABY}`) return Response.json({ data: { id: BABY, familyId: "test_family", name: "test_baby", birthDate: "2026-01-31", gender: "boy", version: "1" } });
    if (path === `/api/v1/babies/${BABY}/growth-chart`) return Response.json({ data: { measurements: [record], whoPercentiles: {} } });
    if (path === `/api/v1/babies/${BABY}/growth-measurements`) return Response.json({ data: [record] });
    throw new Error(`Unexpected test request: ${path}`);
  });
  return calls;
}

test("growth compat supplies calendar month ages including month-end and year boundaries", () => {
  for (const [birthDate, date, expected] of [["2026-01-31", "2026-07-31", 6], ["2026-01-31", "2026-02-28", 1], ["2025-12-31", "2026-01-30", 0], ["2024-02-29", "2025-02-28", 12]] as const) {
    const result = fromGrowDeskGrowthRecord({ ...record, measurementDate: date }, birthDate);
    assert.equal(result.ageInMonths, expected, `${birthDate} -> ${date} must not plot at month zero`);
    assert.ok(result.ageLabel);
  }
});

test("growth compat preserves current-date legacy history through the controlled whitelist", () => {
  const imported: GrowDeskGrowthRecord = {
    ...record,
    measurementDate: "2026-09-18",
    legacyDate: "2026-09-18",
    legacyAgeInMonths: 99,
    legacyAgeLabel: "旧档案月龄",
    legacyPercentile: 75,
    legacyClientId: "test_growth_legacy_client",
    legacyRecordedById: "test_growth_recorder",
    legacySource: "ui_manual",
    legacySourceAgent: "test_growth_agent",
  };

  const result = fromGrowDeskGrowthRecord(imported, "2026-01-31");
  assert.equal(result.ageInMonths, 99, "same legacy date must retain the archived age");
  assert.equal(result.ageLabel, "旧档案月龄");
  assert.equal(result.percentile, 75);
  assert.equal(result.clientId, "test_growth_legacy_client");
  assert.equal(result.recordedById, "test_growth_recorder");
  assert.equal(result.source, "ui_manual");
  assert.equal(result.sourceAgent, "test_growth_agent");
  assert.equal("legacyMetadata" in result, false, "raw importer metadata must stay private");
});

test("growth compat recalculates changed dates and drops stale legacy percentile", () => {
  const imported: GrowDeskGrowthRecord = {
    ...record,
    measurementDate: "2026-10-18",
    legacyDate: "2026-09-18",
    legacyAgeInMonths: 99,
    legacyAgeLabel: "旧档案月龄",
    legacyPercentile: 75,
    legacyClientId: "test_growth_legacy_client",
    legacyRecordedById: "test_growth_recorder",
    legacySource: "ui_manual",
    legacySourceAgent: "test_growth_agent",
  };

  const result = fromGrowDeskGrowthRecord(imported, "2026-01-31");
  assert.equal(result.ageInMonths, 8, "changed measurement date must use the current birth-date calculation");
  assert.notEqual(result.ageLabel, "旧档案月龄");
  assert.equal("percentile" in result, false, "a percentile for the old date must not be displayed");
  assert.equal(result.clientId, "test_growth_legacy_client");
  assert.equal(result.source, "ui_manual");
});

test("growth compat supplies explicit legacy defaults for non-imported records", () => {
  const result = fromGrowDeskGrowthRecord(record, "2026-01-31");
  assert.equal(result.ageInMonths, 6);
  assert.equal(result.percentile, null);
  assert.equal(result.clientId, null);
  assert.equal(result.recordedById, null);
  assert.equal(result.source, "ui_manual");
  assert.equal(result.sourceAgent, null);
});

test("chart route requires an explicit selected baby before any chart read", async t => {
  const calls = setup(t);
  const response = await chart(request("/api/growth/chart"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "请提供 babyId");
  assert.equal(calls.some(path => path.endsWith("/growth-chart")), false);
});

test("chart route includes ages and standards for the explicitly selected baby", async t => {
  setup(t);
  const response = await chart(request(`/api/growth/chart?babyId=${BABY}`));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.gender, "male");
  assert.equal(data.measurements[0].ageInMonths, 6);
  assert.ok(data.monthLabels.includes(6));
  assert.ok(data.whoPercentiles.weight.P50.length > 0);
});

test("measurement list used by the growth store includes age from the requested baby's birth date", async t => {
  setup(t);
  const response = await measurements(request(`/api/growth?babyId=${BABY}`));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data[0].ageInMonths, 6);
  assert.equal(data[0].babyId, BABY);
});

test("growth page scopes chart requests to auth selection and reloads when selection changes", () => {
  const source = readFileSync(new URL("../../app/(main)/growth/page.tsx", import.meta.url), "utf8");
  assert.match(source, /useBabyStore\(\(s\) => s\.selectedBabyId\)/);
  assert.doesNotMatch(source, /fetch\("\/api\/growth\/chart"\)/, "all initial, refresh and delete chart requests must include babyId");
  assert.match(source, /URLSearchParams\(\{ babyId: selectedBabyId \}\)/);
  assert.match(source, /if \(!res\.ok\)/, "HTTP errors must not be parsed as successful chart data");
  assert.match(source, /\[selectedBabyId\]/, "the shared chart loader must depend on baby selection");
});


test("canonical monthAge produces an ordered shared month axis and aligned percentile values", () => {
  const point = (monthAge: number) => ({ monthAge, p3: "1", p15: "2", p50: String(monthAge + 3), p85: "4", p97: "5" });
  const result = transformWhoPercentilesForLegacy({ weightForAge: [point(2), point(0)], heightForAge: [point(0), point(2)], headCircumferenceForAge: [point(2), point(0)] });
  assert.deepEqual(result.months, [0, 2]);
  assert.deepEqual(result.weight.P50, [3, 5]);
  assert.deepEqual(result.height.P50, [3, 5]);
  assert.throws(() => transformWhoPercentilesForLegacy({ weightForAge: [point(0)], heightForAge: [point(1)] }), /月龄不一致/);
  assert.throws(() => transformWhoPercentilesForLegacy({ weightForAge: [{ ...point(0), monthAge: -1 }] }), /有效月龄/);
});

test("chart propagates baby read failure instead of inventing gender and birth date", async t => {
  setup(t, 503);
  const response = await chart(request(`/api/growth/chart?babyId=${BABY}`));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).whoPercentiles, undefined);
});
