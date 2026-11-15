import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST, PUT, DELETE } from "../../app/api/vaccines/route";
import { PUT as selectVaccine } from "../../app/api/vaccines/selections/route";
import { GROWDESK_CONFIG } from "../../lib/config";

const babyId = "test_baby_ledger";
const record = {
  id: "test_record_ledger", babyId, familyId: "test_family_ledger", vaccineCode: "vac_rotavirus5", vaccineId: "vac_rotavirus5",
  legacyName: "test_疫苗本原文", legacyDose: "第2剂", doseNumber: 2, recordStatus: "completed",
  administeredDate: "2024-06-12", completedDate: "2024-06-12", scheduledDate: null, isCompleted: true,
  manufacturer: "test_厂商", clinic: "test_门诊", batchNumber: "TEST-BATCH", traceCode: "0000000199988",
  administrationRoute: "口服", injectionSite: null, sourceText: "test_来源原文", notes: "test_备注",
  version: "3", createdAt: "2024-06-12T00:00:00Z", updatedAt: "2024-06-12T00:00:00Z",
};

function request(method: string, body?: Record<string, unknown>, query = "") {
  return new Request(`https://test.invalid/api/vaccines${query}`, {
    method, headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}`, origin: "https://test.invalid", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function setup(t: any, handler: (url: string, init: RequestInit) => Response) {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => { if (previous === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = previous; });
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit = {}) => {
    if (String(url).endsWith("/api/v1/auth/bff/session")) return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    return handler(String(url), init);
  });
}

test("ledger reads request nullable record representation and retain all booklet metadata", async t => {
  setup(t, (url, init) => {
    assert.match(url, /test_baby_ledger\/vaccines\/records$/);
    assert.equal(new Headers(init.headers).get("x-growdesk-representation"), "ledger");
    return Response.json({ data: [record, { ...record, id: "test_review", recordStatus: "needs_review", isCompleted: false, administeredDate: null, completedDate: null, doseNumber: null, legacyDose: "剂次待核对" }] });
  });
  const response = await GET(request("GET", undefined, `?view=records&babyId=${babyId}`));
  assert.equal(response.status, 200);
  const records = (await response.json()).records;
  assert.equal(records[0].traceCode, "0000000199988");
  assert.equal(records[0].sourceText, "test_来源原文");
  assert.equal(records[1].recordStatus, "needs_review");
  assert.equal(records[1].administeredDate, null);
  assert.equal(records[1].doseNumber, null);
});

test("record list rejects an upstream cross-baby response", async t => {
  setup(t, () => Response.json({ data: [{ ...record, babyId: "test_other_baby" }] }));
  const response = await GET(request("GET", undefined, `?view=records&babyId=${babyId}`));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "UPSTREAM_SCOPE_MISMATCH");
});

test("new planned/review records send null actual dates and preserve stable idempotency keys", async t => {
  let calls = 0;
  setup(t, (_url, init) => {
    calls++;
    const body = JSON.parse(String(init.body));
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("idempotency-key"), "test_stable_client_id");
    assert.equal(new Headers(init.headers).get("x-growdesk-representation"), "ledger");
    assert.equal(body.administeredDate, null);
    assert.equal(body.completedDate, null);
    assert.equal(body.doseNumber, null);
    return Response.json({ data: { ...record, ...body, version: "1" } }, { status: 201 });
  });
  const body = { babyId, clientId: "test_stable_client_id", name: "test_待核对", recordStatus: "needs_review", sourceText: "test_日期用途不明" };
  const first = await POST(request("POST", body));
  const second = await POST(request("POST", body));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(calls, 2, "the same key is forwarded so the canonical service can replay it atomically");
});

test("versioned edit preserves unspecified booklet fields and maps Web PUT to canonical PATCH", async t => {
  let patched: Record<string, unknown> | undefined;
  setup(t, (url, init) => {
    assert.equal(new Headers(init.headers).get("x-growdesk-representation"), "ledger");
    if (init.method === "GET") return Response.json({ data: [record] });
    assert.equal(init.method, "PATCH");
    assert.match(url, /records\/test_record_ledger$/);
    patched = JSON.parse(String(init.body));
    return Response.json({ data: { ...record, ...patched, version: "4" } });
  });
  const response = await PUT(request("PUT", { id: record.id, babyId, baseVersion: "3", notes: "test_更正备注" }));
  assert.equal(response.status, 200);
  assert.equal(patched?.baseVersion, "3");
  assert.equal(patched?.administeredDate, "2024-06-12");
  assert.equal(patched?.manufacturer, "test_厂商");
  assert.equal(patched?.traceCode, "0000000199988");
  assert.equal(patched?.vaccineId, "vac_rotavirus5", "an explicitly chosen product remains linked through PATCH");
  assert.equal(patched?.notes, "test_更正备注");
  assert.equal((await response.json()).record.version, "4");
});

test("stale edits and direct completion flags cannot mutate a record", async t => {
  let writes = 0;
  setup(t, (_url, init) => {
    if (init.method !== "GET") writes++;
    return Response.json({ data: [record] });
  });
  const stale = await PUT(request("PUT", { id: record.id, babyId, baseVersion: "2", notes: "test_stale" }));
  assert.equal(stale.status, 409);
  const flag = await selectVaccine(request("PUT", { babyId, vaccineId: "vac_rotavirus5", doseNumber: 2, completed: false }));
  assert.equal(flag.status, 400);
  assert.equal((await flag.json()).code, "READ_ONLY_VACCINE_COMPLETION");
  assert.equal(writes, 0);
});

test("delete forwards the observed version and targets exactly one record", async t => {
  setup(t, (url, init) => {
    assert.equal(init.method, "DELETE");
    assert.match(url, /test_baby_ledger\/vaccines\/records\/test_record_ledger\?baseVersion=3$/);
    assert.equal(new Headers(init.headers).get("x-growdesk-representation"), "ledger");
    return Response.json({ data: { id: record.id, deleted: true } });
  });
  const response = await DELETE(request("DELETE", undefined, `?id=${record.id}&babyId=${babyId}&baseVersion=3`));
  assert.equal(response.status, 200);
});
