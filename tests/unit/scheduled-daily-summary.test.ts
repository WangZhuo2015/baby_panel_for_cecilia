import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  BridgeError,
  type BridgeFetch,
  type BridgeResult,
} from "../../lib/growdesk/bridge-protocol";
import {
  fetchScheduledDailySummary,
  parseScheduledDailySummary,
  type ScheduledDailySummary,
} from "../../lib/growdesk/scheduled-daily-summary";

const babyId = "test_baby_scheduled";
const date = "2026-10-29";
const content: ScheduledDailySummary = {
  schemaVersion: 1,
  kind: "scheduled_daily_summary",
  date,
  babyId,
  generatedAt: "2026-10-30T02:15:00Z",
  llm: { source: "api", provider: "developer.amd.com.cn", model: "DeepSeek-V4.1-Flash" },
  headline: "test scheduled headline",
  highlights: ["test highlight one", "test highlight two"],
  sections: {
    feeding: "test feeding summary",
    sleep: "test sleep summary",
    diaper: "test diaper summary",
    growthAndCare: "test growth and care summary",
    tomorrowTips: "test tomorrow tips",
  },
  suggestedQuestions: ["test follow-up question"],
  disclaimer: "test scheduled summary disclaimer",
  overallScore: "test steady status",
  overallRating: 4.2,
  statusLevel: "good",
};

function ok<T>(data: T, nextCursor: string | null = null): BridgeResult<T> {
  return { ok: true, status: 200, data, page: { nextCursor } };
}

test("parser validates the stable scheduled contract and keeps metrics out", () => {
  const parsed = parseScheduledDailySummary(content, babyId, date);
  assert.deepEqual(parsed, content);
  assert.equal(parsed && "metrics" in parsed, false);
  assert.equal(parseScheduledDailySummary("legacy plain summary", babyId, date), null);
  assert.equal(parseScheduledDailySummary({ headline: "older object format" }, babyId, date), null);
  assert.throws(() => parseScheduledDailySummary({ ...content, babyId: "test_other_baby" }, babyId, date), BridgeError);
  assert.throws(() => parseScheduledDailySummary({ ...content, headline: "x".repeat(801) }, babyId, date), BridgeError);
});

test("loader uses authenticated bounded cursor pages and returns the exact baby/date", async () => {
  const calls: Array<{ path: string; accessToken?: string }> = [];
  const pages: BridgeResult<unknown>[] = [
    ok([{ babyId, targetDate: "2026-10-28", content: "older row" }], "test_cursor_next"),
    ok([{ babyId, targetDate: date, content: JSON.stringify(content) }]),
  ];
  const fetchApi: BridgeFetch = async <T>(path: string, options?: Parameters<BridgeFetch>[1]) => {
    calls.push({ path, accessToken: options?.accessToken });
    return pages.shift() as BridgeResult<T>;
  };

  const summary = await fetchScheduledDailySummary(fetchApi, "test_access_token", babyId, date);
  assert.deepEqual(summary, content);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].accessToken, "test_access_token");
  assert.equal(calls[0].path, "/api/v1/babies/test_baby_scheduled/daily-summaries?limit=100");
  assert.equal(calls[0].path.includes("date="), false);
  assert.equal(calls[1].path, "/api/v1/babies/test_baby_scheduled/daily-summaries?limit=100&cursor=test_cursor_next");
});

test("loader treats absent or legacy content as missing and preserves authorization errors", async () => {
  const noSummary: BridgeFetch = async <T>() => ok([{ babyId, targetDate: date, content: "legacy plain content" }]) as BridgeResult<T>;
  assert.equal(await fetchScheduledDailySummary(noSummary, "test_access_token", babyId, date), null);

  const forbidden: BridgeFetch = async <T>() => ({
    ok: false,
    status: 403,
    error: { code: "FORBIDDEN", message: "test access denied" },
  }) as BridgeResult<T>;
  await assert.rejects(
    fetchScheduledDailySummary(forbidden, "test_access_token", babyId, date),
    (error: unknown) => error instanceof BridgeError && error.status === 403 && error.code === "FORBIDDEN",
  );
});


test("loader accepts the actual Go list targetDate and parses its synthetic stable JSON fixture", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/scheduled-daily-summary-go.json", import.meta.url), "utf8")) as Record<string, unknown>;
  const fixtureBabyId = String(fixture.babyId);
  const fixtureDate = String(fixture.date);
  const fetchApi: BridgeFetch = async <T>() => ok([{
    babyId: fixtureBabyId,
    targetDate: fixtureDate,
    content: fixture,
  }]) as BridgeResult<T>;

  const summary = await fetchScheduledDailySummary(fetchApi, "test_access_token", fixtureBabyId, fixtureDate);
  assert.equal(summary?.babyId, fixtureBabyId);
  assert.equal(summary?.date, fixtureDate);
  assert.equal(summary?.overallRating, 4.5);
  assert.equal(summary?.llm.model, "DeepSeek-V4.1-Flash");
  assert.equal(summary && "metrics" in summary, false);
});


test("scope mismatches emit opaque status/code telemetry without identifiers or tokens", async () => {
  const priorWarn = console.warn;
  const events: unknown[] = [];
  console.warn = (...args: unknown[]) => { events.push(args); };
  const wrongBaby: BridgeFetch = async <T>() => ok([{
    babyId: "test_other_baby",
    targetDate: date,
    content: JSON.stringify(content),
  }]) as BridgeResult<T>;
  try {
    await assert.rejects(
      fetchScheduledDailySummary(wrongBaby, "test_access_token", babyId, date),
      (error: unknown) => error instanceof BridgeError && error.code === "UPSTREAM_SCOPE_MISMATCH",
    );
    const eventText = JSON.stringify(events);
    assert(eventText.includes("UPSTREAM_SCOPE_MISMATCH"));
    assert.equal(eventText.includes("test_access_token"), false);
    assert.equal(eventText.includes("test_baby_scheduled"), false);
    assert.equal(eventText.includes("test_other_baby"), false);
  } finally {
    console.warn = priorWarn;
  }
});
