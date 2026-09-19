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

test("pending route writes with the fetched CAS version and propagates 409", async t => {
  let written: any;
  setupRoute(t, (_url, init) => {
    if (init?.method === "PUT") {
      written = JSON.parse(String(init.body));
      return Response.json({ error: { code: "VERSION_CONFLICT", message: "test_conflict" } }, { status: 409 });
    }
    return Response.json({ data: fullPlan("7", { formula: { id: "test_formula" } }) });
  });
  const response = await postVaccine(request("POST", { babyId, clientId: "pending_route", name: "测试疫苗", dose: "第1剂", scheduledDate: "2026-09-20", isCompleted: false }));
  assert.equal(response.status, 409);
  assert.equal(written.baseVersion, "7");
  assert.deepEqual(written.planData.formula, { id: "test_formula" });
});

test("first pending vaccine creates an empty food plan with baseVersion zero", async t => {
  let written: any;
  setupRoute(t, (_url, init) => {
    if (init?.method === "PUT") {
      written = JSON.parse(String(init.body));
      return Response.json({ data: fullPlan("1", written.planData) });
    }
    return Response.json({ data: { babyId, id: null, createdAt: null, updatedAt: "2026-09-19T00:00:00.000Z", version: "0", planData: {} } });
  });
  const response = await postVaccine(request("POST", { babyId, clientId: "pending_first", name: "首次预约", scheduledDate: "2026-09-20", isCompleted: false }));
  assert.equal(response.status, 201);
  assert.equal(written.baseVersion, "0");
  assert.equal(written.planData.legacyPendingVaccines[0].id, "pending_first");
});

test("pending POST replay returns the persisted timestamps and performs only one PUT", async t => {
  let current = fullPlan("7", {});
  let puts = 0;
  setupRoute(t, (_url, init) => {
    if (init?.method === "PUT") {
      puts++;
      const body = JSON.parse(String(init.body));
      current = fullPlan("8", body.planData);
      return Response.json({ data: current });
    }
    return Response.json({ data: current });
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
  assert.equal(puts, 1);

  const conflict = await postVaccine(request("POST", { ...body, name: "不同疫苗" }));
  assert.equal(conflict.status, 409);
  assert.equal(puts, 1);
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

test("pending delete removes only its namespace and propagates plan scope errors", async t => {
  const pending = createLegacyPendingVaccine({ clientId: "pending_delete", name: "测试疫苗", scheduledDate: "2026-09-20" }, babyId);
  let saved: any;
  setupRoute(t, (_url, init) => {
    if (init?.method === "PUT") { saved = JSON.parse(String(init.body)); return Response.json({ data: fullPlan("8", saved.planData) }); }
    return Response.json({ data: fullPlan("7", { supplements: ["test_supp"], legacyPendingVaccines: [pending] }) });
  });
  const response = await deleteVaccine(request("DELETE", { babyId, id: pending.id }));
  assert.equal(response.status, 200);
  assert.deepEqual(saved.planData.supplements, ["test_supp"]);
  assert.deepEqual(saved.planData.legacyPendingVaccines, []);

  t.mock.restoreAll();
});

test("pending route rejects a cross-scope plan before writing", async t => {
  let writes = 0;
  setupRoute(t, (_url, init) => {
    if (init?.method === "PUT") writes++;
    return Response.json({ data: fullPlan("7", {}, { babyId: "baby_other" }) });
  });
  const response = await postVaccine(request("POST", { babyId, name: "测试疫苗", scheduledDate: "2026-09-20", isCompleted: false }));
  assert.equal(response.status, 502);
  assert.equal(writes, 0);
});
