import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as dates from "../../lib/date";
import * as age from "../../lib/age";
import * as engine from "../../lib/nutrition/engine";
import * as presets from "../../lib/nutrition/presets";
import * as protocol from "../../lib/growdesk/bridge-protocol";
import * as pages from "../../lib/growdesk/paged-list";
import * as feeding from "../../lib/growdesk/feeding-compat";
import * as food from "../../lib/growdesk/food-compat";
import * as nutritionScope from "../../lib/growdesk/nutrition-scope";
import * as nutritionValidation from "../../lib/growdesk/nutrition-validation";
import * as nutrition from "../../lib/growdesk/nutrition-compat";

function route(fetchApi: protocol.BridgeFetch) {
  const filename = path.resolve(import.meta.dirname, "../../app/api/nutrition/analysis/route.ts");
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: Response },
    "@/lib/config": { GROWDESK_CONFIG: { enabled: true } },
    "@/lib/api-helpers": {}, "@/lib/prisma": {},
    "@/lib/date": dates, "@/lib/age": age, "@/lib/nutrition/engine": engine,
    "@/lib/nutrition/presets": presets,
    "@/lib/growdesk/bridge-protocol": protocol, "@/lib/growdesk/paged-list": pages,
    "@/lib/growdesk/feeding-compat": feeding, "@/lib/growdesk/food-compat": food,
    "@/lib/growdesk/nutrition-compat": nutrition,
    "@/lib/growdesk/nutrition-validation": nutritionValidation,
    "@/lib/growdesk/nutrition-scope": { ...nutritionScope, requireNutritionBaby: async () => ({ id: "test_baby", familyId: "test_family", birthDate: "2026-01-01" }) },
    "@/lib/growdesk/client": { growdeskFetch: fetchApi },
    "@/lib/growdesk/session": { resolveBffSession: async () => ({ accessToken: "test_token", user: { id: "test_user" } }) },
    "@/lib/growdesk/bridge-identity": { loadWebBaby: async () => ({ id: "test_baby", familyId: "test_family", birthDate: "2026-01-01" }) },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(fs.readFileSync(filename, "utf8"), { loader: "ts", format: "cjs" }).code,
    { module, exports: module.exports, require: (id: string) => { assert.ok(id in modules, id); return modules[id]; }, URL, console });
  return module.exports;
}
const request = () => new Request("https://test.invalid/api/nutrition/analysis?babyId=test_baby&date=2026-09-19");

test("nutrition refuses an upstream failure instead of returning an empty healthy analysis", async () => {
  const api = route(async () => ({ ok: false, status: 503, error: { code: "TEST_OUTAGE", message: "test unavailable" } }));
  assert.equal((await api.GET(request())).status, 503);
});

test("nutrition includes every page and converts bottle milk through the legacy adapter", async () => {
  const record = { id: "test_feeding", babyId: "test_baby", familyId: "test_family", feedingType: "bottle", occurredAt: "2026-09-19T01:00:00.000Z", amountMl: "120", leftMinutes: null, rightMinutes: null, spitUp: false, formulaProductId: null, notes: null, source: "ui_manual", sourceAgent: null, version: "1", createdAt: "2026-09-19T01:00:00.000Z", updatedAt: "2026-09-19T01:00:00.000Z" } as feeding.GrowDeskFeedingRecord;
  const later = { ...record, id: "test_later", occurredAt: "2026-09-19T02:00:00.000Z", amountMl: "140" };
  const seen: string[] = [];
  const api = route((async (endpoint: string) => {
    const url = new URL(endpoint, "https://test.invalid"); seen.push(endpoint);
    if (url.pathname.endsWith("/food-plan")) return { ok: true, status: 200, data: { babyId: "test_baby", planData: {} } };
    if (url.pathname.endsWith("/records/feeding")) {
      return url.searchParams.has("cursor")
        ? { ok: true, status: 200, data: [record], page: { nextCursor: null } }
        : { ok: true, status: 200, data: [later], page: { nextCursor: "test_page2" } };
    }
    return { ok: true, status: 200, data: [], page: { nextCursor: null } };
  }) as protocol.BridgeFetch);
  const response = await api.GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  const expected = engine.calculateDailyNutrition({ date: "2026-09-19", babyAgeMonths: body.babyAgeMonths, feedings: [feeding.fromGrowDeskFeedingRecord(record), feeding.fromGrowDeskFeedingRecord(later)], supplements: [], foodLogs: [], formulaProductsMap: {}, supplementProductsMap: {} });
  assert.deepEqual(body.analysis, JSON.parse(JSON.stringify(expected)));
  assert.ok(seen.some(url => url.includes("cursor=test_page2")));
});
