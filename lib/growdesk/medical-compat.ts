if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

export interface LegacyMedicalReport {
  id: string;
  babyId: string;
  title: string;
  category: string;
  date: string;
  hospital: string | null;
  doctorNotes: string | null;
  aiSummary: string | null;
  items?: unknown[];
  itemsJson?: string;
  imageUrl: string | null;
  version?: number;
  baseVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface GrowDeskMedicalReport {
  id: string;
  babyId: string;
  familyId: string;
  reportDate: string;
  title: string;
  hospital: string | null;
  department: string | null;
  diagnosis: string | null;
  attachmentIds: string[];
  notes: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export function toGrowDeskMedicalCreatePayload(body: Record<string, unknown>) {
  const title = String(body.title || "").trim().slice(0, 100);
  const reportDate = String(body.date || body.reportDate || new Date().toISOString().slice(0, 10)).trim();

  const hospital = body.hospital ? String(body.hospital).trim().slice(0, 100) : null;
  const department = body.category ? String(body.category).trim().slice(0, 100) : (body.department ? String(body.department).trim().slice(0, 100) : null);
  const diagnosis = body.doctorNotes ? String(body.doctorNotes).trim().slice(0, 500) : (body.diagnosis ? String(body.diagnosis).trim().slice(0, 500) : null);
  const notes = body.aiSummary ? String(body.aiSummary).trim().slice(0, 2000) : (body.notes ? String(body.notes).trim().slice(0, 2000) : null);

  let attachmentIds: string[] = [];
  if (Array.isArray(body.attachmentIds)) {
    attachmentIds = body.attachmentIds.map(String);
  } else if (body.imageUrl && typeof body.imageUrl === "string") {
    attachmentIds = [body.imageUrl];
  }

  return {
    reportDate,
    title,
    hospital,
    department,
    diagnosis,
    attachmentIds,
    notes,
  };
}

export function toGrowDeskMedicalUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    baseVersion: Number(body.baseVersion ?? body.version ?? 1),
  };

  if (body.title) {
    payload.title = String(body.title).trim().slice(0, 100);
  }
  if (body.date || body.reportDate) {
    payload.reportDate = String(body.date || body.reportDate).trim();
  }
  if (body.hospital !== undefined) {
    payload.hospital = body.hospital ? String(body.hospital).trim().slice(0, 100) : null;
  }
  if (body.category !== undefined || body.department !== undefined) {
    const dep = body.category !== undefined ? body.category : body.department;
    payload.department = dep ? String(dep).trim().slice(0, 100) : null;
  }
  if (body.doctorNotes !== undefined || body.diagnosis !== undefined) {
    const diag = body.doctorNotes !== undefined ? body.doctorNotes : body.diagnosis;
    payload.diagnosis = diag ? String(diag).trim().slice(0, 500) : null;
  }
  if (body.aiSummary !== undefined || body.notes !== undefined) {
    const n = body.aiSummary !== undefined ? body.aiSummary : body.notes;
    payload.notes = n ? String(n).trim().slice(0, 2000) : null;
  }
  if (body.attachmentIds !== undefined) {
    payload.attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String) : [];
  } else if (body.imageUrl !== undefined) {
    payload.attachmentIds = body.imageUrl ? [String(body.imageUrl)] : [];
  }

  return payload;
}

export function fromGrowDeskMedicalRecord(rec: GrowDeskMedicalReport): LegacyMedicalReport {
  return {
    id: rec.id,
    babyId: rec.babyId,
    title: rec.title,
    category: rec.department || "general",
    date: rec.reportDate,
    hospital: rec.hospital,
    doctorNotes: rec.diagnosis,
    aiSummary: rec.notes,
    items: [],
    itemsJson: "[]",
    imageUrl: rec.attachmentIds && rec.attachmentIds.length > 0 ? rec.attachmentIds[0] : null,
    version: Number(rec.version ?? 1),
    baseVersion: Number(rec.version ?? 1),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
