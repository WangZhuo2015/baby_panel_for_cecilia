import assert from "node:assert/strict";
import test from "node:test";
import {
  BridgeError,
} from "../../lib/growdesk/bridge-protocol";
import {
  buildDailyReminderNotifications,
  buildDataReleaseNotification,
  buildFamilyRecordNotifications,
  buildVaccineReminderNotifications,
  fetchGrowDeskNotificationItems,
  type FamilyClock,
  type GrowDeskNotificationScope,
} from "../../lib/growdesk/notification-parity";

const scope: GrowDeskNotificationScope = {
  babyId: "baby_test_notification",
  familyId: "family_test_notification",
  birthDate: "2026-03-19",
};

const nowMs = Date.parse("2026-09-19T04:00:00.000Z");
const clock: FamilyClock = {
  date: "2026-09-19",
  timeZone: "Asia/Shanghai",
  startMs: Date.parse("2026-09-18T16:00:00.000Z"),
  endMs: Date.parse("2026-09-19T16:00:00.000Z"),
};

function recordBase(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    babyId: scope.babyId,
    familyId: scope.familyId,
    createdAt: "2026-09-19T02:00:00.000Z",
    updatedAt: "2026-09-19T02:00:00.000Z",
    ...extra,
  };
}

test("GrowDesk notification parity keeps family scope and only attributes supported actors", () => {
  const members = new Map([
    ["user_test_member", "测试家人"],
  ]);
  const items = buildFamilyRecordNotifications(
    {
      feeding: [recordBase("feed_test", {
        feedingType: "formula",
        amountMl: "120",
        occurredAt: "2026-09-19T02:00:00.000Z",
        notes: null,
        recordedByUserId: "user_test_member",
      })],
      sleep: [],
      diaper: [],
      food: [recordBase("food_test", {
        recordDate: "2026-09-19",
        foodItemIds: ["food_test_item"],
        portionDescription: "少量",
        reaction: "normal",
        notes: null,
      })],
      growth: [recordBase("growth_test", {
        measurementDate: "2026-09-19",
        weightKg: 7.2,
        heightCm: null,
        headCircumferenceCm: null,
      })],
      supplement: [],
    },
    scope,
    members,
    clock,
    nowMs,
  );

  assert.equal(items.length, 3);
  const feeding = items.find(item => item.id === "family-feeding-feed_test-created");
  assert.equal(feeding?.actorId, "user_test_member");
  assert.equal(feeding?.actorLabel, "测试家人");

  const food = items.find(item => item.id === "family-food-food_test-created");
  const growth = items.find(item => item.id === "family-growth-growth_test-created");
  assert.equal(food?.actorId, undefined, "food has no canonical actor field");
  assert.equal(food?.actorLabel, undefined, "food must not fabricate an actor label");
  assert.equal(growth?.actorId, undefined, "growth has no canonical actor field");
  assert.equal(growth?.actorLabel, undefined, "growth must not fabricate an actor label");

  assert.throws(
    () => buildFamilyRecordNotifications(
      { feeding: [recordBase("wrong_scope", { familyId: "family_other" })] },
      scope,
      members,
      clock,
      nowMs,
    ),
    (error: unknown) => error instanceof BridgeError && error.code === "UPSTREAM_SCOPE_MISMATCH",
  );
});

test("GrowDesk notification parity does not attribute record updates without updatedBy", () => {
  const items = buildFamilyRecordNotifications(
    {
      feeding: [recordBase("feed_updated", {
        feedingType: "bottle",
        amountMl: "90",
        occurredAt: "2026-09-18T20:00:00.000Z",
        createdAt: "2026-09-17T20:00:00.000Z",
        updatedAt: "2026-09-19T03:00:00.000Z",
        recordedByUserId: "user_test_member",
      })],
    },
    scope,
    new Map([["user_test_member", "测试家人"]]),
    clock,
    nowMs,
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, "family-feeding-feed_updated-updated");
  assert.equal(items[0]?.actorId, undefined);
  assert.equal(items[0]?.actorLabel, undefined);
  assert.match(items[0]?.title || "", /修改了喂奶记录/);
});

test("GrowDesk daily reminders include an overnight sleep interval", () => {
  const items = buildDailyReminderNotifications(
    {
      feeding: [recordBase("feed_today", { occurredAt: "2026-09-18T17:00:00.000Z" })],
      sleep: [recordBase("sleep_overnight", {
        startedAt: "2026-09-18T15:30:00.000Z",
        endedAt: "2026-09-18T18:30:00.000Z",
      })],
      food: [],
    },
    scope,
    clock,
    nowMs,
  );

  assert.deepEqual(items.map(item => item.id), ["daily-food"]);
});

test("GrowDesk vaccine reminders derive due dates from canonical schedule and saved selections", () => {
  const items = buildVaccineReminderNotifications(
    [
      { vaccineCode: "vaccine_due", name: "测试疫苗", recommendedAgeMonths: 6, doseNumber: 1, mandatory: true },
      { vaccineCode: "vaccine_skipped", name: "已跳过疫苗", recommendedAgeMonths: 6, doseNumber: 1, mandatory: false },
      { vaccineCode: "vaccine_later", name: "稍后疫苗", recommendedAgeMonths: 7, doseNumber: 1, mandatory: true },
    ],
    [],
    {
      planData: {
        vaccineSelections: {
          "vaccine_skipped-1": { selected: false, completed: false },
        },
      },
    },
    scope,
    clock,
    nowMs,
  );

  assert.deepEqual(items.map(item => item.id), ["vaccine-vaccine_due-1"]);
  assert.equal(items[0]?.urgent, true);
  assert.match(items[0]?.detail || "", /2026-09-19/);

  const completed = buildVaccineReminderNotifications(
    [{ vaccineCode: "vaccine_due", name: "测试疫苗", recommendedAgeMonths: 6, doseNumber: 1, mandatory: true }],
    [recordBase("vaccine_record", {
      vaccineCode: "vaccine_due",
      administeredDate: "2026-09-19",
      notes: "第1剂",
    })],
    null,
    scope,
    clock,
    nowMs,
  );
  assert.deepEqual(completed, []);

  const secondDose = buildVaccineReminderNotifications(
    [
      { vaccineCode: "vaccine_series", name: "系列疫苗", recommendedAgeMonths: 6, doseNumber: 1, mandatory: true },
      { vaccineCode: "vaccine_series", name: "系列疫苗", recommendedAgeMonths: 6, doseNumber: 2, mandatory: true },
    ],
    [recordBase("vaccine_series_record", {
      vaccineCode: "vaccine_series",
      administeredDate: "2026-09-19",
      notes: "剂次: 第1剂",
    })],
    null,
    scope,
    clock,
    nowMs,
  );
  assert.deepEqual(secondDose.map(item => item.id), ["vaccine-vaccine_series-2"]);
});

test("GrowDesk data release notification preserves canonical source metadata", () => {
  const item = buildDataReleaseNotification({
    title: "儿童健康数据标准",
    asOf: "2026-09-01",
    sources: [{ organization: "测试卫生机构" }],
  }, nowMs);

  assert.equal(item?.id, "data-release-2026-09-01");
  assert.match(item?.detail || "", /测试卫生机构/);
  assert.match(item?.detail || "", /2026-09-01/);
});

test("GrowDesk notification parity propagates canonical list failures", async () => {
  const fetchApi = async () => ({
    ok: false,
    status: 503,
    error: { code: "UPSTREAM_UNAVAILABLE", message: "测试后端不可用" },
  });

  await assert.rejects(
    () => fetchGrowDeskNotificationItems(fetchApi, "token_test", "user_test_notification"),
    (error: unknown) => error instanceof BridgeError && error.status === 503 && error.code === "UPSTREAM_UNAVAILABLE",
  );
});
