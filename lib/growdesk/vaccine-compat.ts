if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

export interface LegacyVaccineRecord {
  id: string;
  babyId: string;
  name: string;
  vaccineId?: string;
  dose: string;
  scheduledDate: string;
  completedDate: string | null;
  isCompleted: boolean;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface GrowDeskVaccineRecord {
  id: string;
  babyId: string;
  familyId: string;
  vaccineCode: string;
  administeredDate: string;
  clinic: string | null;
  batchNumber: string | null;
  notes: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrowDeskVaccineScheduleItem {
  id: string;
  vaccineCode: string;
  name: string;
  recommendedAgeMonths: number;
  doseNumber: number;
  mandatory: boolean;
}

export function toGrowDeskVaccineRecordPayload(body: Record<string, unknown>) {
  const code = String(body.vaccineId || body.vaccineCode || body.name || "").trim();
  const administeredDate = String(
    body.completedDate || body.scheduledDate || body.administeredDate || new Date().toISOString().slice(0, 10),
  ).trim();

  const clinic = body.clinic ? String(body.clinic).trim() : null;
  const batchNumber = body.batchNumber ? String(body.batchNumber).trim() : null;

  let notes = body.notes ? String(body.notes).trim() : null;
  if (body.dose && !notes?.includes("剂次")) {
    notes = notes ? `${notes} (剂次: ${body.dose})` : `剂次: ${body.dose}`;
  }

  return {
    vaccineCode: code,
    administeredDate,
    clinic,
    batchNumber,
    notes,
  };
}

export function fromGrowDeskVaccineRecord(rec: GrowDeskVaccineRecord): LegacyVaccineRecord {
  let dose = "第1剂";
  if (rec.notes) {
    const m = rec.notes.match(/第\s*(\d+)\s*剂/);
    if (m) {
      dose = `第${m[1]}剂`;
    }
  }

  return {
    id: rec.id,
    babyId: rec.babyId,
    name: rec.vaccineCode,
    vaccineId: rec.vaccineCode,
    dose,
    scheduledDate: rec.administeredDate,
    completedDate: rec.administeredDate,
    isCompleted: true,
    notes: rec.notes,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
