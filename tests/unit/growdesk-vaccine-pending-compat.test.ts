import assert from "node:assert/strict";
import test from "node:test";
import { BridgeError } from "../../lib/growdesk/bridge-protocol";
import { GROWDESK_CONFIG } from "../../lib/config";
import { POST as postVaccine, DELETE as deleteVaccine } from "../../app/api/vaccines/route";
import { buildVaccineReminderNotifications, type FamilyClock, type GrowDeskNotificationScope } from "../../lib/growdesk/notification-parity";
import {
  appendLegacyPendingVaccine,
  createLegacyPendingVaccine,
  readLegacyPendingVaccines,
  readPendingPlan,
  removeLegacyPendingVaccine,
} from "../../lib/growdesk/vaccine-pending-compat";

const babyId = "baby_test_pending";
const scope: GrowDeskNotificationScope = { babyId, familyId: "family_test_pending", birthDate: "2026-01-01" };
const clock: FamilyClock = { date: "2026-09-19", timeZone: "UTC", startMs: 0, endMs: 1 };
const nowMs = Date.parse("2026-09-19T00:00:00.000Z");

function plan(planData: Record<string, unknown> = { formula: { defaultId: "formula_test" } }) {
  return readPendingPlan(fullPlan("7", planData), babyId);
}
function fullPlan(version: string, planData: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { babyId, id: "plan_test", createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z", version, planData, ...overrides };
}

test("explicit pending vaccine survives plan merge, drives a real reminder, and deletes without touching shared state", () => {
  const item = createLegacyPendingVaccine({
    clientId: "pending_test_1", vaccineId: "vac_test", name: "测试疫苗",
    dose: "第2剂", scheduledDate: "2026-09-22", isCompleted: false,
  }, babyId, new Date("2026-09-19T01:00:00.000Z"));
  const merged = appendLegacyPendingVaccine(plan(), item);
  const storedPlan = readPendingPlan(fullPlan("8", merged), babyId);
  assert.deepEqual(readLegacyPendingVaccines(storedPlan), [item]);
  assert.deepEqual(merged.formula, { defaultId: "formula_test" });

  const reminders = buildVaccineReminderNotifications([], [], fullPlan("8", merged), scope, clock, nowMs);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0]?.id, "vaccine-pending_test_1");
  assert.equal(reminders[0]?.time, "3 天后");
  const completedReminders = buildVaccineReminderNotifications([], [{
    id: "record_done", babyId, familyId: scope.familyId, vaccineCode: "vac_test",
    administeredDate: "2026-09-19", notes: "第2剂",
  }], fullPlan("8", merged), scope, clock, nowMs);
  assert.deepEqual(completedReminders, [], "a real administered dose suppresses, but does not delete, matching pending data");
  assert.equal(readLegacyPendingVaccines(storedPlan).length, 1);

  const removed = removeLegacyPendingVaccine(storedPlan, item.id);
  assert.equal(removed.found, true);
  assert.deepEqual(removed.planData.formula, { defaultId: "formula_test" });
  assert.deepEqual(removed.planData.legacyPendingVaccines, []);
});

test("completed canonical path has no synthetic pending state", () => {
  const existing = plan({ vaccineSelections: { "vac_test-1": { selected: true, completed: true } } });
  assert.deepEqual(readLegacyPendingVaccines(existing), []);
  assert.deepEqual(existing.planData.vaccineSelections, { "vac_test-1": { selected: true, completed: true } });
});

test("pending plan rejects cross-scope data and accepts the exact initial CAS version zero state", () => {
  assert.throws(() => readPendingPlan(fullPlan("1", {}, { babyId: "baby_other" }), babyId),
    (error: unknown) => error instanceof BridgeError && error.code === "UPSTREAM_SCOPE_MISMATCH");
  const empty = readPendingPlan({ babyId, id: null, createdAt: null, updatedAt: "2026-09-19T00:00:00.000Z", version: "0", planData: {} }, babyId);
  assert.equal(empty.version, "0");
});

test("pending IDs are idempotent for the same record and reject conflicting reuse with 409", () => {
  const first = createLegacyPendingVaccine({ clientId: "pending_same", name: "疫苗A", scheduledDate: "2026-09-20" }, babyId);
  const merged = appendLegacyPendingVaccine(plan(), first);
  const current = readPendingPlan(fullPlan("8", merged), babyId);
  const retry = createLegacyPendingVaccine({ clientId: "pending_same", name: "疫苗A", scheduledDate: "2026-09-20" }, babyId);
  assert.strictEqual(appendLegacyPendingVaccine(current, retry), current.planData);
  const conflict = createLegacyPendingVaccine({ clientId: "pending_same", name: "疫苗B", scheduledDate: "2026-09-20" }, babyId);
  assert.throws(() => appendLegacyPendingVaccine(current, conflict),
    (error: unknown) => error instanceof BridgeError && error.status === 409);
});

function request(method: string, body: Record<string, unknown>) {
  return new Request("https://test.invalid/api/vaccines", {
    method,
    headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}`, origin: "https://test.invalid", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupRoute(t: any, handler: (url: string, init?: RequestInit) => Response) {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => { if (previous === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = previous; });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/api/v1/auth/bff/session")) return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    return handler(String(url), init);
  });
}

function canonicalRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "test_vaccine_record",
    babyId,
    familyId: scope.familyId,
    vaccineCode: "vac_test",
    vaccineId: "test_vaccine_uuid",
    doseNumber: 1,
    legacyName: "测试疫苗",
    legacyDose: "第1剂",
    administeredDate: "2026-09-20",
    scheduledDate: "2026-09-20",
    completedDate: null,
    isCompleted: false,
    clinic: null,
    batchNumber: null,
    notes: "剂次: 第1剂",
    version: "1",
    createdAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    ...overrides,
  };
}

test("pending route sends a normalized scheduled record and propagates 409", async t => {
  let written: any;
  setupRoute(t, (url, init) => {
    assert.match(url, /\/api\/v1\/babies\/baby_test_pending\/vaccines\/records$/);
    written = JSON.parse(String(init?.body));
    return Response.json({ error: { code: "CONCURRENCY_CONFLICT", message: "test_conflict" } }, { status: 409 });
  });
  const response = await postVaccine(request("POST", { babyId, clientId: "pending_route", name: "测试疫苗", dose: "第1剂", scheduledDate: "2026-09-20", isCompleted: false }));
  assert.equal(response.status, 409);
  assert.equal(written.vaccineCode, "测试疫苗");
  assert.equal(written.scheduledDate, "2026-09-20");
  assert.equal(written.administeredDate, "2026-09-20");
  assert.equal(written.completedDate, null);
  assert.equal(written.isCompleted, false);
});

test("first pending vaccine returns a pending normalized record", async t => {
  let written: any;
  setupRoute(t, (_url, init) => {
    written = JSON.parse(String(init?.body));
    return Response.json({ data: canonicalRecord({ legacyName: "首次预约" }) }, { status: 201 });
  });
  const response = await postVaccine(request("POST", { babyId, clientId: "pending_first", name: "首次预约", scheduledDate: "2026-09-20", isCompleted: false }));
  assert.equal(response.status, 201);
  assert.equal(written.isCompleted, false);
  assert.equal(written.completedDate, null);
  const body = await response.json();
  assert.equal(body.record.isCompleted, false);
  assert.equal(body.record.completedDate, null);
  assert.equal(body.record.scheduledDate, "2026-09-20");
});

test("pending POST replay keeps the same legacy record while forwarding idempotency", async t => {
  const calls: Array<{ body: any; idempotencyKey?: string }> = [];
  setupRoute(t, (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    calls.push({ body, idempotencyKey: headers.get("idempotency-key") ?? undefined });
    if (calls.length === 3) {
      return Response.json({ error: { code: "IDEMPOTENCY_KEY_REUSED", message: "test_payload_mismatch" } }, { status: 409 });
    }
    return Response.json({ data: canonicalRecord({ legacyName: body.legacyName || "幂等疫苗" }) }, { status: 201 });
  });
  const body = { babyId, clientId: "pending_replay", vaccineId: "vac_test", name: "幂等疫苗", dose: "第1剂", scheduledDate: "2026-09-20", isCompleted: false };
  const first = await postVaccine(request("POST", body));
  assert.equal(first.status, 201);
  const firstRecord = (await first.json()).record;
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = await postVaccine(request("POST", body));
  assert.equal(second.status, 201);
  const secondRecord = (await second.json()).record;
  assert.deepEqual(secondRecord, firstRecord);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.idempotencyKey, "pending_replay");
  assert.equal(calls[1]?.idempotencyKey, "pending_replay");

  const conflict = await postVaccine(request("POST", { ...body, name: "不同疫苗" }));
  assert.equal(conflict.status, 409);
  assert.equal(calls.length, 3);
});

test("completed route writes only the canonical administered record", async t => {
  const calls: Array<{ url: string; method?: string }> = [];
  setupRoute(t, (url, init) => {
    calls.push({ url, method: init?.method });
    return Response.json({ data: { id: "record_test", babyId, familyId: scope.familyId, vaccineCode: "vac_test", administeredDate: "2026-09-19", clinic: null, batchNumber: null, notes: "剂次: 第1剂", version: "1", createdAt: new Date(nowMs).toISOString(), updatedAt: new Date(nowMs).toISOString() } }, { status: 201 });
  });
  const response = await postVaccine(request("POST", { babyId, vaccineId: "vac_test", name: "测试疫苗", completedDate: "2026-09-19", isCompleted: true }));
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /vaccines\/records$/);
});

test("pending delete removes the canonical record and does not touch food-plan state", async t => {
  let deletedUrl = "";
  setupRoute(t, (url, init) => {
    deletedUrl = url;
    assert.equal(init?.method, "DELETE");
    return Response.json({ data: { id: "pending_delete", deleted: true } });
  });
  const response = await deleteVaccine(request("DELETE", { babyId, id: "pending_delete" }));
  assert.equal(response.status, 200);
  assert.match(deletedUrl, /\/api\/v1\/babies\/baby_test_pending\/vaccines\/records\/pending_delete$/);

  t.mock.restoreAll();
});

test("pending route propagates canonical baby scope errors before a legacy write", async t => {
  let writes = 0;
  setupRoute(t, (_url, init) => {
    if (init?.method === "POST") writes++;
    return Response.json({ error: { code: "BABY_ACCESS_DENIED", message: "test_scope_denied" } }, { status: 403 });
  });
  const response = await postVaccine(request("POST", { babyId, name: "测试疫苗", scheduledDate: "2026-09-20", isCompleted: false }));
  assert.equal(response.status, 403);
  assert.equal(writes, 1);
});
