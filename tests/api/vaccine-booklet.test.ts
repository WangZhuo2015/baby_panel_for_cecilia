import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../lib/prisma";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";

const baseUrl = process.env.BABY_PANEL_URL || "http://127.0.0.1:3089";

test("API: vaccine booklet creates, corrects, completes plans, and protects historical facts", async t => {
  const tenant = await createTestTenant(prisma, "vaccine_booklet");
  t.after(() => destroyTestTenant(prisma, tenant.username));
  const other = await createTestTenant(prisma, "vaccine_booklet_other");
  t.after(() => destroyTestTenant(prisma, other.username));
  const write = (method: string, body: Record<string, unknown>) => fetch(`${baseUrl}/api/vaccines`, { method, headers: tenant.headers, body: JSON.stringify({ babyId: tenant.babyId, ...body }) });
  const list = async () => {
    const response = await fetch(`${baseUrl}/api/vaccines/records?babyId=${tenant.babyId}`, { headers: tenant.headers });
    assert.equal(response.status, 200);
    return (await response.json()).records as Array<Record<string, any>>;
  };
  const historical = {
    clientId: "test_vaccine_retry",
    name: "test_疫苗本原名", completedDate: "2024-02-29", isCompleted: true,
    clinic: "test_接种单位", batchNumber: "test_batch_001", manufacturer: "test_生产企业", productName: "test_产品",
    traceabilityCode: "00000012345678901234567890", injectionSite: "test_部位", notes: "test_原始备注",
  };
  const createdResponse = await write("POST", historical);
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const created = (await createdResponse.json()).record;
  assert.equal(created.scheduledDate, null);
  assert.equal(created.doseNumber, null);
  assert.equal(created.dose, null);
  assert.equal(created.version, "1");
  for (const [key, value] of Object.entries(historical)) if (key !== "clientId") assert.equal(created[key], value);
  const replayResponse = await write("POST", historical);
  assert.equal(replayResponse.status, 201);
  assert.equal((await replayResponse.json()).record.id, created.id);
  const concurrent = await Promise.all([write("POST", historical), write("POST", historical)]);
  for (const replay of concurrent) { assert.equal(replay.status, 201); assert.equal((await replay.json()).record.id, created.id); }
  assert.equal((await list()).length, 1);
  const parallelBody = { ...historical, clientId: "test_vaccine_parallel_create", name: "test_并发同一接种" };
  const initialParallel = await Promise.all([write("POST", parallelBody), write("POST", parallelBody)]);
  for (const response of initialParallel) assert.equal(response.status, 201, await response.clone().text());
  const parallelRecords = await Promise.all(initialParallel.map(response => response.json()));
  assert.equal(parallelRecords[0].record.id, parallelRecords[1].record.id);
  assert.equal((await list()).filter(item => item.name === parallelBody.name).length, 1);
  assert.equal((await write("POST", { ...historical, clinic: "test_conflicting_reuse" })).status, 409);
  const visible = (await list()).find(item => item.id === created.id)!;
  assert.equal(visible.traceabilityCode, historical.traceabilityCode);

  const editedResponse = await write("PATCH", { id: created.id, baseVersion: created.version, clinic: "test_更正单位", batchNumber: null });
  assert.equal(editedResponse.status, 200, await editedResponse.clone().text());
  const edited = (await editedResponse.json()).record;
  assert.equal(edited.id, created.id);
  assert.equal(edited.version, "2");
  assert.equal(edited.completedDate, historical.completedDate);
  assert.equal(edited.scheduledDate, null);
  assert.equal(edited.clinic, "test_更正单位");
  assert.equal(edited.batchNumber, null);
  assert.equal(edited.traceabilityCode, historical.traceabilityCode);
  assert.equal((await write("PATCH", { id: created.id, baseVersion: "1", completedDate: "2026-08-01" })).status, 409);
  assert.equal((await write("PATCH", { id: created.id, notes: "test_missing_version" })).status, 428);
  assert.equal((await list()).find(item => item.id === created.id)!.completedDate, "2024-02-29");

  assert.equal((await write("POST", { name: "test_missing_date" })).status, 400);
  assert.equal((await write("POST", { name: "test_plan_is_not_fact", scheduledDate: "2026-08-01", isCompleted: true })).status, 400);
  assert.equal((await write("POST", { name: "test_invalid_date", completedDate: "2026-02-30" })).status, 400);
  assert.equal((await write("POST", { name: "test_numeric_trace", completedDate: "2026-08-01", traceabilityCode: 123 })).status, 400);
  const planResponse = await write("POST", { name: "test_预约", scheduledDate: "2026-08-01", isCompleted: false, dose: "加强（待核对）" });
  assert.equal(planResponse.status, 201);
  const plan = (await planResponse.json()).record;
  assert.equal(plan.completedDate, null);
  assert.equal(plan.doseNumber, null);
  assert.equal((await write("PATCH", { id: plan.id, baseVersion: plan.version, isCompleted: true })).status, 400);
  const completeResponse = await write("PATCH", { id: plan.id, baseVersion: plan.version, isCompleted: true, completedDate: "2026-08-03" });
  assert.equal(completeResponse.status, 200);
  const complete = (await completeResponse.json()).record;
  assert.equal(complete.id, plan.id);
  assert.equal(complete.completedDate, "2026-08-03");
  assert.equal(complete.scheduledDate, "2026-08-01");

  const shortNameResponse = await write("POST", { ...historical, clientId: "test_vaccine_short_name", name: "Hib", doseNumber: 1 });
  assert.equal(shortNameResponse.status, 201, await shortNameResponse.clone().text());
  const shortName = (await shortNameResponse.json()).record;
  assert.equal(shortName.name, "Hib");
  assert.equal(shortName.vaccineId, null, "a short name must not select a combination vaccine by substring");
  assert.equal((await list()).find(item => item.id === shortName.id)!.vaccineId, null);

  const knownResponse = await write("POST", { ...historical, clientId: "test_vaccine_known", vaccineId: "vac_hepb", doseNumber: 1, name: "test_目录关联原名" });
  assert.equal(knownResponse.status, 201);
  const known = (await knownResponse.json()).record;
  assert.equal(known.vaccineId, "vac_hepb", "an explicit catalog association takes precedence over the written name");
  assert.equal(known.name, "test_目录关联原名");
  assert.equal((await list()).find(item => item.id === known.id)!.vaccineId, "vac_hepb");
  const select = (fields: Record<string, unknown>) => fetch(`${baseUrl}/api/vaccines/selections`, { method: "PUT", headers: tenant.headers, body: JSON.stringify({ babyId: tenant.babyId, vaccineId: "vac_hepb", doseNumber: 1, ...fields }) });
  assert.equal((await select({ selected: false })).status, 200);
  assert.equal((await select({ completed: false })).status, 400);
  const afterSelection = (await list()).find(item => item.id === known.id)!;
  assert.equal(afterSelection.completedDate, known.completedDate);
  assert.equal(afterSelection.batchNumber, known.batchNumber);
  assert.equal(afterSelection.version, known.version);
  const choicesResponse = await fetch(`${baseUrl}/api/vaccines/selections?babyId=${tenant.babyId}`, { headers: tenant.headers });
  assert.equal(choicesResponse.status, 200);
  const choice = (await choicesResponse.json()).find((item: any) => item.vaccineId === "vac_hepb" && item.doseNumber === 1);
  assert.equal(choice.completed, true);
  assert.equal(choice.selected, false);

  const crossScope = await fetch(`${baseUrl}/api/vaccines/records?babyId=${tenant.babyId}`, { headers: other.headers });
  assert.ok([403, 404].includes(crossScope.status));
  const crossWrite = await fetch(`${baseUrl}/api/vaccines`, { method: "PATCH", headers: other.headers, body: JSON.stringify({ babyId: other.babyId, id: created.id, baseVersion: "2", clinic: "test_unauthorized" }) });
  assert.ok([403, 404].includes(crossWrite.status));
  assert.equal((await fetch(`${baseUrl}/api/vaccines?id=${created.id}&babyId=${tenant.babyId}&baseVersion=1`, { method: "DELETE", headers: tenant.headers })).status, 409);
  assert.equal((await fetch(`${baseUrl}/api/vaccines?id=${created.id}&babyId=${tenant.babyId}&baseVersion=2`, { method: "DELETE", headers: tenant.headers })).status, 200);
  assert.equal((await list()).some(item => item.id === created.id), false);
  assert.equal((await write("POST", historical)).status, 409, "a delayed retry must not recreate a deleted record");
  assert.equal((await list()).some(item => item.id === created.id), false);
});
