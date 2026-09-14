import { BridgeError, wireVersion } from "./bridge-protocol";
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
  version?: string;
  baseVersion?: string;
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
  items?: unknown[];
  notes: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

function attachmentId(value: unknown): string {
  if (typeof value !== "string") throw new BridgeError(400, "INVALID_ATTACHMENT", "无效的附件");
  const id = value.replace(/^\/api\/attachments\//, "");
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new BridgeError(400, "INVALID_ATTACHMENT", "请重新上传图片");
  return id;
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
    attachmentIds = body.attachmentIds.map(attachmentId);
  } else if (body.imageUrl && typeof body.imageUrl === "string") {
    attachmentIds = [attachmentId(body.imageUrl)];
  }

  return {
    reportDate,
    items: body.items ?? [],
    ...(body.growthData && typeof body.growthData === "object" ? { growthData: Object.fromEntries(Object.entries(body.growthData).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)])) } : {}),
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
    baseVersion: wireVersion(body.baseVersion ?? body.version),
  };

  if (body.items !== undefined) payload.items = body.items;
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
    payload.attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(attachmentId) : [];
  } else if (body.imageUrl !== undefined) {
    payload.attachmentIds = body.imageUrl ? [attachmentId(body.imageUrl)] : [];
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
    items: rec.items ?? [],
    itemsJson: JSON.stringify(rec.items ?? []),
    imageUrl: rec.attachmentIds && rec.attachmentIds.length > 0 ? `/api/attachments/${rec.attachmentIds[0]}` : null,
    version: wireVersion(rec.version),
    baseVersion: wireVersion(rec.version),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
