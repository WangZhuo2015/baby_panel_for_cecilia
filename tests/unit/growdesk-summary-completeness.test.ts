import test from "node:test";
import assert from "node:assert/strict";
import { fetchDailyComprehensiveMetrics } from "../../lib/ai-daily-summary";

test("daily summary refuses to turn an upstream outage into zero care records", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { code: "TEST_OUTAGE", message: "test unavailable" } }, { status: 503 });
  try {
    await assert.rejects(fetchDailyComprehensiveMetrics({ userId: "test_user", babyId: "test_baby", accessToken: "test_token" }, "2026-09-19"));
  } finally { globalThis.fetch = original; }
});

test("daily summary includes supplements, same-day growth and medical reports beyond the first page", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/babies/test_baby")) return Response.json({ data: { id: "test_baby", familyId: "test_family" } });
    if (url.pathname.endsWith("/families/test_family")) return Response.json({ data: { id: "test_family", timeZone: "Asia/Shanghai" } });
    let data: unknown[] = [];
    let nextCursor: string | null = null;
    if (url.pathname.endsWith("/records/supplement")) data = [{ id: "test_supplement", babyId: "test_baby", familyId: "test_family", supplementName: "test_vitamin", occurredAt: "2026-09-19T01:00:00Z", amount: "2 滴", notes: null, version: "1" }];
    if (url.pathname.endsWith("/growth-measurements")) data = [{ id: "test_growth", version: "1", measurementDate: "2026-09-19", weightKg: "7.25", heightCm: "65.5", headCircumferenceCm: null }];
    if (url.pathname.endsWith("/medical/reports")) {
      if (!url.searchParams.has("cursor")) { data = [{ id: "test_old", reportDate: "2026-09-18" }]; nextCursor = "test_page2"; }
      else data = [{ id: "test_report", reportDate: "2026-09-19" }];
    }
    return Response.json({ data, page: { nextCursor } });
  };
  try {
    const result = await fetchDailyComprehensiveMetrics({ userId: "test_user", babyId: "test_baby", accessToken: "test_token" }, "2026-09-19");
    assert.equal(result.supplementsCount, 1);
    assert.equal(result.supplements[0]?.name, "test_vitamin");
    assert.equal(result.supplements[0]?.dose, 2);
    assert.equal(result.medicalReportsCount, 1);
    assert.equal(result.growthMeasurement?.weightKg, 7.25);
  } finally { globalThis.fetch = original; }
});
