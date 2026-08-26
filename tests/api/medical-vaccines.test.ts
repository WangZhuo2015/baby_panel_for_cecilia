import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { signAuthToken } from "../../lib/auth";
import { getLocalDateStr } from "../../lib/date";

const BASE_URL = "http://127.0.0.1:3088";

test("API: Medical Reports and Vaccines Domain", async () => {
  const user = await prisma.user.findFirst();
  const baby = await prisma.baby.findFirst();
  assert.ok(user && baby, "User and Baby must exist");

  const token = await signAuthToken({ userId: user.id, username: user.username });
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const today = getLocalDateStr();

  // 1. Vaccines Schedule & Program Query
  console.log("-> Testing Vaccines API...");
  const vacRes = await fetch(`${BASE_URL}/api/vaccines`);
  assert.equal(vacRes.status, 200, "GET /api/vaccines should succeed");
  const vacData = await vacRes.json();
  assert.ok(Array.isArray(vacData.national), "National NIP vaccines list should exist");
  assert.ok(Array.isArray(vacData.schedule), "Vaccine schedule entries should exist");

  // 2. Vaccine Selections & Completion Tracking
  console.log("-> Testing Vaccine Selections API...");
  const selPutRes = await fetch(`${BASE_URL}/api/vaccines/selections`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      babyId: baby.id,
      vaccineId: "vac_hepb",
      doseNumber: 1,
      completed: true,
      selected: true,
    }),
  });
  assert.equal(selPutRes.status, 200, "PUT /api/vaccines/selections should succeed");

  const selGetRes = await fetch(`${BASE_URL}/api/vaccines/selections?babyId=${baby.id}`, { headers });
  assert.equal(selGetRes.status, 200, "GET /api/vaccines/selections should succeed");
  const selections = await selGetRes.json();
  const foundHepB1 = selections.find((s: any) => s.vaccineId === "vac_hepb" && s.doseNumber === 1);
  assert.ok(foundHepB1 && foundHepB1.completed === true, "HepB dose 1 should be marked completed");

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
  const reportId = createdReport.id || createdReport.report?.id;
  assert.ok(reportId, "Medical report ID should exist");

  // Clean up
  await prisma.medicalReport.delete({ where: { id: reportId } }).catch(() => {});
});
