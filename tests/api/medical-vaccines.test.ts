import assert from "node:assert/strict";
import test, { after } from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { getLocalDateStr } from "../../lib/date";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";
import { getTestServerUrl } from "../helpers/test-server-url";

const BASE_URL = getTestServerUrl();
after(async () => { await prisma.$disconnect(); });

test("API: Medical Reports and Vaccines Domain", async (t) => {
  // 隔离租户：禁止 findFirst 抓取真实用户/宝宝（AGENTS.md）
  const tenant = await createTestTenant(prisma, "medvac");
  const baby = { id: tenant.babyId };
  t.after(() => destroyTestTenant(prisma, tenant.username));

  const headers = tenant.headers;
  const today = getLocalDateStr();
  let reportId: string | undefined;

  try {

  // 1. Vaccines Schedule & Program Query
  console.log("-> Testing Vaccines API...");
  const vacRes = await fetch(`${BASE_URL}/api/vaccines`);
  assert.equal(vacRes.status, 200, "GET /api/vaccines should succeed");
  const vacData = await vacRes.json();
  assert.ok(Array.isArray(vacData.national), "National NIP vaccines list should exist");
  assert.ok(Array.isArray(vacData.schedule), "Vaccine schedule entries should exist");

  // 2. Completion is projected from a real dated record; a selection is only a preference.
  const vaccineRecord = await fetch(`${BASE_URL}/api/vaccines`, {
    method: "POST", headers,
    body: JSON.stringify({ babyId: baby.id, name: "test_乙肝原文", vaccineId: "vac_hepb", doseNumber: 1,
      recordStatus: "completed", completedDate: "2025-07-07", clientId: `test_medvac_${baby.id}` }),
  });
  assert.equal(vaccineRecord.status, 201, await vaccineRecord.text());
  const selPutRes = await fetch(`${BASE_URL}/api/vaccines/selections`, {
    method: "PUT", headers,
    body: JSON.stringify({ babyId: baby.id, vaccineId: "vac_hepb", doseNumber: 1, selected: true }),
  });
  assert.equal(selPutRes.status, 200, "PUT /api/vaccines/selections should save preference");
  const selGetRes = await fetch(`${BASE_URL}/api/vaccines/selections?babyId=${baby.id}`, { headers });
  assert.equal(selGetRes.status, 200);
  const selections = await selGetRes.json();
  const foundHepB1 = selections.find((row: any) => row.vaccineId === "vac_hepb" && row.doseNumber === 1);
  assert.equal(foundHepB1?.completed, true, "the actual record supplies completion");

  // 3. Medical Reports List & Creation
  console.log("-> Testing Medical Reports API...");
  const medRes = await fetch(`${BASE_URL}/api/medical/reports?babyId=${baby.id}`, { headers });
  assert.equal(medRes.status, 200, "GET /api/medical/reports should succeed");
  const reportsData = await medRes.json();
  assert.ok(Array.isArray(reportsData.reports || reportsData), "Reports array should exist");

  // Create a medical report
  const createMedRes = await fetch(`${BASE_URL}/api/medical/reports`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      babyId: baby.id,
      title: "自动化测试血常规化验单",
      date: today,
      hospital: "儿童医院",
      type: "blood",
      indicators: [
        { name: "白细胞 (WBC)", value: "9.5", unit: "10^9/L", refRange: "4.0-10.0", status: "normal" },
        { name: "血红蛋白 (Hb)", value: "115", unit: "g/L", refRange: "110-140", status: "normal" },
      ],
      doctorAdvice: "指标一切正常，定期随访",
    }),
  });
  assert.ok(createMedRes.status === 200 || createMedRes.status === 201, "POST /api/medical/reports should succeed");
  const createdReport = await createMedRes.json();
  reportId = createdReport.id || createdReport.report?.id;
  assert.ok(reportId, "Medical report ID should exist");
  } finally {
    if (reportId) await prisma.medicalReport.delete({ where: { id: reportId } }).catch(() => {});
    // 恢复疫苗选择：新租户本无此行，直接删掉测试写入的行
    await prisma.vaccineSelection
      .deleteMany({ where: { babyId: baby.id, vaccineId: "vac_hepb", doseNumber: 1 } })
      .catch(() => {});
  }
});


test("API: vaccine ledger stores booklet fields, edits atomically and keeps plans/review separate", async t => {
  const tenant = await createTestTenant(prisma, "vaccine_ledger");
  const outsider = await createTestTenant(prisma, "vaccine_other");
  t.after(() => destroyTestTenant(prisma, tenant.username));
  t.after(() => destroyTestTenant(prisma, outsider.username));
  const babyId = tenant.babyId;
  const send = async (method: string, body?: Record<string, unknown>, query = "", headers = tenant.headers) => {
    const response = await fetch(`${BASE_URL}/api/vaccines${query}`, {
      method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const selections = async () => {
    const response = await fetch(`${BASE_URL}/api/vaccines/selections?babyId=${babyId}`, { headers: tenant.headers });
    assert.equal(response.status, 200);
    return await response.json() as Array<{ vaccineId: string; doseNumber: number; completed: boolean }>;
  };
  const original = {
    babyId, clientId: `test_record_${babyId}`, name: "test_五价轮状本子原文", vaccineId: "vac_rotavirus5", doseNumber: 2,
    recordStatus: "completed", completedDate: "2025-07-10", scheduledDate: null,
    manufacturer: "test_生产企业", clinic: "test_接种单位", batchNumber: "TEST-LOT-007", traceCode: "000000000001234",
    administrationRoute: "口服", injectionSite: "不适用", sourceText: "test_来源抄录", notes: "test_初始备注",
  };
  const created = await send("POST", original);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.record.id;
  assert.equal(created.data.record.version, "1");
  const replay = await send("POST", original);
  assert.equal(replay.status, 201, JSON.stringify(replay.data));
  assert.equal(replay.data.record.id, id);
  const conflict = await send("POST", { ...original, notes: "test_另一个请求" });
  assert.equal(conflict.status, 409);
  const listed = await send("GET", undefined, `?view=records&babyId=${babyId}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.data.records.length, 1, "retry must not create a second administration");
  const saved = listed.data.records[0];
  for (const field of ["name", "manufacturer", "clinic", "batchNumber", "traceCode", "administrationRoute", "injectionSite", "sourceText", "notes", "completedDate"] as const) {
    assert.equal(saved[field], original[field], `${field} survives a real database read`);
  }
  assert.equal(saved.administeredDate, "2025-07-10");
  assert.equal(saved.scheduledDate, null);
  assert.equal(saved.doseNumber, 2);
  assert.equal(saved.recordStatus, "completed");

  const edited = await send("PUT", { id, babyId, baseVersion: "1", notes: "test_更正备注" });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.record.version, "2");
  assert.equal(edited.data.record.traceCode, original.traceCode);
  assert.equal(edited.data.record.manufacturer, original.manufacturer);
  assert.equal(edited.data.record.administeredDate, "2025-07-10");
  assert.equal(edited.data.record.notes, "test_更正备注");
  const stale = await send("PUT", { id, babyId, baseVersion: "1", notes: "test_过期编辑" });
  assert.equal(stale.status, 409);
  const staleDelete = await send("DELETE", undefined, `?id=${id}&babyId=${babyId}&baseVersion=1`);
  assert.equal(staleDelete.status, 409);

  const deniedRead = await send("GET", undefined, `?view=records&babyId=${babyId}`, outsider.headers);
  assert.ok([403, 404].includes(deniedRead.status));
  const deniedWrite = await send("PUT", { id, babyId, baseVersion: "2", notes: "test_跨租户" }, "", outsider.headers);
  assert.ok([403, 404].includes(deniedWrite.status));
  const wrongBabyDelete = await send("DELETE", undefined, `?id=${id}&babyId=${outsider.babyId}&baseVersion=2`, outsider.headers);
  assert.equal(wrongBabyDelete.status, 404);

  const planned = await send("POST", { babyId, clientId: `test_plan_${babyId}`, name: "test_五联预约", vaccineId: "vac_dtap_ipv_hib_pentaxim", doseNumber: 1,
    recordStatus: "planned", scheduledDate: "2025-07-12" });
  assert.equal(planned.status, 201, JSON.stringify(planned.data));
  assert.equal(planned.data.record.administeredDate, null);
  assert.equal(planned.data.record.completedDate, null);
  const noActual = await send("PUT", { id: planned.data.record.id, babyId, baseVersion: "1", recordStatus: "completed" });
  assert.equal(noActual.status, 400, "an appointment date must not be promoted to an actual date");
  const completed = await send("PUT", { id: planned.data.record.id, babyId, baseVersion: "1", recordStatus: "completed", completedDate: "2025-07-13" });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  assert.equal(completed.data.record.administeredDate, "2025-07-13");
  assert.equal(completed.data.record.scheduledDate, "2025-07-12");

  const review = await send("POST", { babyId, name: "test_五联记录待核对", vaccineId: "vac_dtap_ipv_hib_pentaxim", doseNumber: 2,
    recordStatus: "needs_review", sourceText: "test_仅有月日，无法确认年份及用途" });
  assert.equal(review.status, 201, JSON.stringify(review.data));
  assert.equal(review.data.record.administeredDate, null);
  assert.equal(review.data.record.scheduledDate, null);
  const unassigned = await send("POST", { babyId, name: "PENTAXIM", vaccineId: null, recordStatus: "needs_review", sourceText: "test_用户明确暂不关联产品" });
  assert.equal(unassigned.status, 201);
  assert.equal(unassigned.data.record.vaccineId, null);
  const unassignedRead = (await send("GET", undefined, `?view=records&babyId=${babyId}`)).data.records.find((row: any) => row.id === unassigned.data.record.id);
  assert.equal(unassignedRead.vaccineId, null, "explicitly unassigned product survives the database read");
  let progress = await selections();
  assert.equal(progress.find(row => row.vaccineId === "vac_dtap_ipv_hib_pentaxim" && row.doseNumber === 1)?.completed, true);
  assert.notEqual(progress.find(row => row.vaccineId === "vac_dtap_ipv_hib_pentaxim" && row.doseNumber === 2)?.completed, true);
  const unknownDose = await send("POST", { babyId, name: "test_剂次缺失", vaccineId: "vac_hepb", recordStatus: "completed", completedDate: "2025-07-09" });
  assert.equal(unknownDose.status, 201);
  assert.equal(unknownDose.data.record.doseNumber, null);
  progress = await selections();
  assert.notEqual(progress.find(row => row.vaccineId === "vac_hepb" && row.doseNumber === 1)?.completed, true);
  const future = await send("POST", { babyId, name: "test_未来日期", recordStatus: "completed", completedDate: "9999-12-31" });
  assert.equal(future.status, 400);

  const falseCompletion = await fetch(`${BASE_URL}/api/vaccines/selections`, {
    method: "PUT", headers: tenant.headers,
    body: JSON.stringify({ babyId, vaccineId: "vac_rotavirus5", doseNumber: 2, completed: false }),
  });
  assert.equal(falseCompletion.status, 400);
  assert.ok((await send("GET", undefined, `?view=records&babyId=${babyId}`)).data.records.some((row: any) => row.id === id));

  const another = await send("POST", { ...original, clientId: `test_other_record_${babyId}`, completedDate: "2025-07-14" });
  assert.equal(another.status, 201);
  const deleted = await send("DELETE", undefined, `?id=${id}&babyId=${babyId}&baseVersion=2`);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  const remaining = (await send("GET", undefined, `?view=records&babyId=${babyId}`)).data.records;
  assert.ok(!remaining.some((row: any) => row.id === id));
  assert.ok(remaining.some((row: any) => row.id === another.data.record.id), "deleting one record must not erase other records of the same product/dose");
  progress = await selections();
  assert.equal(progress.find(row => row.vaccineId === "vac_rotavirus5" && row.doseNumber === 2)?.completed, true);
});
