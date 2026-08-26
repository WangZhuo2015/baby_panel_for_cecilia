import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { addDays, addMonths, diffCalendarDays } from "./date";

async function testVaccineScheduleGeneration() {
  console.log("=== Testing Vaccine Schedule Generation ===");
  const schedule = await prisma.vaccineScheduleEntry.findMany({
    orderBy: [{ ageMonths: "asc" }, { doseNumber: "asc" }]
  });
  const vaccines = await prisma.vaccine.findMany({
    include: { doses: true }
  });
  const vaccineById = new Map();
  for (const v of vaccines) vaccineById.set(v.vaccineId, v);

  // Test Case 1: Cecilia (Born 2026-02-01)
  const birthDate = "2026-02-01";
  const items = [];

  for (const entry of schedule) {
    const vaccine = vaccineById.get(entry.vaccineId);
    if (!vaccine || vaccine.routineHealthyChildOption === false) continue;

    let date;
    let ageLabel;
    if (entry.ageDays != null) {
      date = addDays(birthDate, entry.ageDays);
      ageLabel = entry.ageLabel || `${entry.ageDays}天`;
    } else if (entry.ageMonths != null) {
      date = addMonths(birthDate, entry.ageMonths);
      ageLabel = entry.ageLabel || `${entry.ageMonths}月龄`;
    } else {
      continue;
    }

    const dose = vaccine.doses?.find((d: any) => d.doseNumber === entry.doseNumber);
    items.push({
      vaccineId: entry.vaccineId,
      doseNumber: entry.doseNumber,
      vaccineName: vaccine.name,
      doseLabel: dose?.doseLabel ?? `第${entry.doseNumber}剂`,
      ageLabel,
      date,
      diffDays: diffCalendarDays("2026-08-26", date),
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date));

  // Assertions for Cecilia:
  // 1. Birth vaccines: 2026-02-01
  const atBirth = items.filter(i => i.date === "2026-02-01");
  assert.ok(atBirth.some(i => i.vaccineId === "vac_hepb" && i.doseNumber === 1));
  assert.ok(atBirth.some(i => i.vaccineId === "vac_bcg" && i.doseNumber === 1));

  // 2. 1-month vaccines: 2026-03-01
  const m1 = items.filter(i => i.date === "2026-03-01");
  assert.ok(m1.some(i => i.vaccineId === "vac_hepb" && i.doseNumber === 2));

  // 3. 42-day vaccines: 2026-03-15
  const d42 = items.filter(i => i.date === "2026-03-15");
  assert.ok(d42.some(i => i.vaccineId.startsWith("vac_rotavirus")));

  // 4. 2-month vaccines: 2026-04-01
  const m2 = items.filter(i => i.date === "2026-04-01");
  assert.ok(m2.some(i => i.vaccineId === "vac_ipv" && i.doseNumber === 1));

  // 5. 6-month vaccines: 2026-08-01
  const m6 = items.filter(i => i.date === "2026-08-01");
  assert.ok(m6.some(i => i.vaccineId === "vac_hepb" && i.doseNumber === 3));
  assert.ok(m6.some(i => i.vaccineId === "vac_dtap" && i.doseNumber === 3));
  assert.ok(m6.some(i => i.vaccineId === "vac_mpsv_a" && i.doseNumber === 1));

  // 6. 8-month vaccines: 2026-10-01
  const m8 = items.filter(i => i.date === "2026-10-01");
  assert.ok(m8.some(i => i.vaccineId === "vac_mmr" && i.doseNumber === 1));
  assert.ok(m8.some(i => i.vaccineId === "vac_je_l" && i.doseNumber === 1));

  // 7. 12-month (1 year): 2027-02-01
  const m12 = items.filter(i => i.date === "2027-02-01");
  assert.ok(m12.some(i => i.vaccineId === "vac_varicella" && i.doseNumber === 1));

  console.log(`Verified ${items.length} schedule entries for birthDate 2026-02-01`);

  // Test Case 2: Month-End baby born on 2026-01-31
  const endBirth = "2026-01-31";
  assert.equal(addMonths(endBirth, 1), "2026-02-28");
  assert.equal(addMonths(endBirth, 2), "2026-03-31");
  assert.equal(addMonths(endBirth, 6), "2026-07-31");
  assert.equal(addMonths(endBirth, 12), "2027-01-31");

  console.log("🎉 ALL VACCINE SCHEDULE VERIFICATION TESTS PASSED!");
}

testVaccineScheduleGeneration();
