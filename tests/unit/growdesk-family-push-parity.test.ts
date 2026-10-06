import assert from "node:assert/strict";
import test from "node:test";
import type { BridgeFetch, BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { fetchGrowDeskNotificationItems } from "../../lib/growdesk/notification-parity";

const scope = { familyId: "test_family_push", babyId: "test_baby_push", birthDate: "2026-03-19" };
const userId = "test_recipient_push";
const now = Date.parse("2026-09-19T04:00:00Z");
const eventKey = `family_record:${"a".repeat(64)}`;
const record = {
  id: "test_feeding_push", ...scope, version: "2", feedingType: "formula", amountMl: "120",
  occurredAt: "2026-09-19T02:00:00Z", createdAt: "2026-09-19T02:00:00Z", updatedAt: "2026-09-19T03:00:00Z",
  recordedByUserId: "test_actor_push", notes: null,
};

function remote(overrides: Record<string, unknown> = {}) {
  return {
    id: "test_remote_push", userId, eventKey, title: "家庭动态", body: "有新的照护记录",
    createdAt: "2026-09-19T03:00:00Z", readAt: "2026-09-19T03:30:00Z",
    data: { eventKind: "family_record", eventKey, entityType: "feeding", entityId: record.id,
      recordVersion: "2", operation: "update", familyId: scope.familyId, babyId: scope.babyId, ...overrides },
  };
}

function fixture(notifications: unknown[]): BridgeFetch {
  return async <T>(pathname: string): Promise<BridgeResult<T>> => {
    const path = new URL(pathname, "http://test.invalid").pathname;
    let data: unknown = [];
    if (path === "/api/v1/notifications") data = notifications;
    else if (path === `/api/v1/families/${scope.familyId}`) data = { id: scope.familyId, timeZone: "Asia/Shanghai" };
    else if (path.endsWith("/members")) data = [];
    else if (path.endsWith("/records/feeding")) data = [record];
    else if (path.endsWith("/food-plan")) data = {
      id: "test_plan_push", babyId: scope.babyId, planData: {}, version: "1",
      createdAt: "2026-09-19T02:00:00Z", updatedAt: "2026-09-19T02:00:00Z",
    };
    const result: BridgeResult<T> & { dataRelease?: unknown } = {
      ok: true, status: 200, data: data as T, page: { nextCursor: null },
    };
    if (path === "/api/v1/development/milestones") result.dataRelease = {
      id: "test_data_release", title: "test_reference", asOf: "2026-09-19", sources: [{ organization: "test_source" }],
    };
    return result;
  };
}

async function familyItems(notifications: unknown[]) {
  return (await fetchGrowDeskNotificationItems(fixture(notifications), "test_token", userId, scope, now, true))
    .filter(item => item.type === "family");
}

test("a current authoritative family event replaces the derived duplicate and preserves its remote identity/read state", async () => {
  const items = await familyItems([remote()]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "test_remote_push");
  assert.equal((items[0] as typeof items[0] & { readAt?: string }).readAt, "2026-09-19T03:30:00.000Z");
});

test("missing, older or mismatched metadata retains the derived family fallback", async () => {
  for (const value of [undefined, remote({ recordVersion: "1" }), remote({ entityId: "test_other_record" }),
    remote({ recordVersion: undefined }), remote({ eventKind: "test_other_event" }),
    remote({ familyId: "test_other_family" }), remote({ babyId: "test_other_baby" })]) {
    const items = await familyItems(value ? [value] : []);
    assert.ok(items.some(item => item.id === `family-feeding-${record.id}`));
  }
});

test("the current event removes only its derived duplicate, keeping earlier authoritative event identities", async () => {
  const earlier = { ...remote({ recordVersion: "1", operation: "create" }), id: "test_earlier_event" };
  const items = await familyItems([earlier, remote()]);
  assert.deepEqual(items.map(item => item.id).sort(), ["test_earlier_event", "test_remote_push"]);
});
