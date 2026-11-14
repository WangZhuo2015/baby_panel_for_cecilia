import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "./session";
import { verifyBffCsrf } from "./csrf";
import { growdeskFetch } from "./client";
import { loadWebBaby } from "./bridge-identity";
import { BridgeError, bridgeErrorResponse, pathId, requireData, wireVersion } from "./bridge-protocol";
import { fromGrowDeskVaccineRecord, readGrowDeskVaccineRecords, toGrowDeskVaccineRecordPayload, toGrowDeskVaccineUpdatePayload, type GrowDeskVaccineRecord } from "./vaccine-compat";
import { parseDoseNumber, vaccineRecordFields } from "./vaccine-record-fields";
import type { VaccineRecord } from "@/generated/prisma/client";

type Scope = { babyId: string; accessToken?: string };

async function scopeFor(request: Request, requestedBabyId: unknown): Promise<Scope | Response> {
  if (requestedBabyId !== undefined && requestedBabyId !== null && requestedBabyId !== "") pathId(requestedBabyId);
  if (GROWDESK_CONFIG.enabled) {
    const csrf = verifyBffCsrf(request);
    if (csrf) return csrf;
    const session = await resolveBffSession(request);
    if (!session) return Response.json({ error: "会话无效或已过期，请重新登录" }, { status: 401 });
    const babyId = typeof requestedBabyId === "string" && requestedBabyId
      ? requestedBabyId : (await loadWebBaby(growdeskFetch, session.accessToken))?.id;
    if (!babyId) throw new BridgeError(400, "BABY_REQUIRED", "请先选择宝宝");
    pathId(babyId);
    return { babyId, accessToken: session.accessToken };
  }
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const baby = await requireBaby(auth.user.id, typeof requestedBabyId === "string" ? requestedBabyId : null);
  if (baby.errorResponse) return baby.errorResponse;
  return { babyId: baby.baby.id };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BridgeError(400, "INVALID_BODY", "请提供有效的接种记录");
  return body;
}

function legacyRecord(record: VaccineRecord) {
  return { ...record, doseNumber: record.doseNumber ?? parseDoseNumber(record.dose), version: String(record.version) };
}

function legacyVersion(value: unknown): number {
  const wire = wireVersion(value);
  const version = Number(wire);
  if (!Number.isSafeInteger(version) || version > 2147483647) throw new BridgeError(400, "INVALID_VERSION", "记录版本无效");
  return version;
}

function recordsPath(babyId: string): string {
  return `/api/v1/babies/${pathId(babyId)}/vaccines/records`;
}

async function cloudRecords(scope: Scope) {
  return readGrowDeskVaccineRecords(requireData(await growdeskFetch<GrowDeskVaccineRecord[]>(recordsPath(scope.babyId), { accessToken: scope.accessToken })), scope.babyId);
}

export async function listVaccineRecords(request: Request): Promise<Response> {
  try {
    const scope = await scopeFor(request, new URL(request.url).searchParams.get("babyId"));
    if (scope instanceof Response) return scope;
    const records = GROWDESK_CONFIG.enabled
      ? (await cloudRecords(scope)).map(fromGrowDeskVaccineRecord)
      : (await prisma.vaccineRecord.findMany({ where: { babyId: scope.babyId }, orderBy: [{ completedDate: "desc" }, { scheduledDate: "asc" }, { id: "asc" }] })).map(legacyRecord);
    return Response.json({ records }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return bridgeErrorResponse(error); }
}

export async function createVaccineRecord(request: Request): Promise<Response> {
  try {
    const body = await readBody(request);
    const scope = await scopeFor(request, body.babyId);
    if (scope instanceof Response) return scope;
    const suppliedClientId = body.clientId ?? request.headers.get("idempotency-key");
    if (suppliedClientId !== undefined && suppliedClientId !== null && (typeof suppliedClientId !== "string" || !suppliedClientId.trim() || suppliedClientId.length > 200)) throw new BridgeError(400, "INVALID_IDEMPOTENCY_KEY", "保存请求标识无效");
    const clientId = typeof suppliedClientId === "string" ? suppliedClientId.trim() : null;
    if (GROWDESK_CONFIG.enabled) {
      const payload = toGrowDeskVaccineRecordPayload(body);
      const record = requireData(await growdeskFetch<GrowDeskVaccineRecord>(recordsPath(scope.babyId), {
        method: "POST", accessToken: scope.accessToken,
        idempotencyKey: clientId || randomUUID(),
        body: payload,
      }));
      return Response.json({ record: fromGrowDeskVaccineRecord(record) }, { status: 201 });
    }
    const fields = vaccineRecordFields(body);
    const hash = createHash("sha256").update(JSON.stringify(fields)).digest("hex");
    const reused = () => new BridgeError(409, "IDEMPOTENCY_KEY_REUSED", "这次保存请求已用于其他内容或记录已被删除，请重新核对后录入");
    const create = () => prisma.$transaction(async tx => {
      if (clientId) {
        const receipt = await tx.vaccineWriteReceipt.findUnique({ where: { babyId_clientId: { babyId: scope.babyId, clientId } } });
        if (receipt) {
          if (receipt.requestHash !== hash) throw reused();
          const record = await tx.vaccineRecord.findUnique({ where: { id: receipt.recordId } });
          if (!record || record.babyId !== scope.babyId) throw reused();
          return record;
        }
      }
      const record = await tx.vaccineRecord.create({ data: { babyId: scope.babyId, ...fields } });
      if (clientId) await tx.vaccineWriteReceipt.create({ data: { babyId: scope.babyId, clientId, requestHash: hash, recordId: record.id } });
      return record;
    });
    let record: VaccineRecord;
    try { record = await create(); } catch (error) {
      // A competing identical request may have won the receipt's unique key.
      // Its failed transaction rolls back its record before this read.
      if (!clientId || !(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
      const receipt = await prisma.vaccineWriteReceipt.findUnique({ where: { babyId_clientId: { babyId: scope.babyId, clientId } } });
      if (!receipt || receipt.requestHash !== hash) throw reused();
      const existing = await prisma.vaccineRecord.findUnique({ where: { id: receipt.recordId } });
      if (!existing || existing.babyId !== scope.babyId) throw reused();
      record = existing;
    }
    return Response.json({ record: legacyRecord(record) }, { status: 201 });
  } catch (error) { return bridgeErrorResponse(error); }
}

export async function updateVaccineRecord(request: Request): Promise<Response> {
  try {
    const body = await readBody(request);
    const id = pathId(body.id);
    const baseVersion = wireVersion(body.baseVersion);
    const scope = await scopeFor(request, body.babyId);
    if (scope instanceof Response) return scope;
    if (GROWDESK_CONFIG.enabled) {
      const existing = (await cloudRecords(scope)).find(record => record.id === body.id);
      if (!existing) throw new BridgeError(404, "NOT_FOUND", "接种记录不存在或已删除");
      if (existing.version !== baseVersion) throw new BridgeError(409, "VERSION_CONFLICT", "记录已被其他设备修改，请刷新后重试");
      const record = requireData(await growdeskFetch<GrowDeskVaccineRecord>(`${recordsPath(scope.babyId)}/${id}`, {
        method: "PATCH", accessToken: scope.accessToken,
        body: toGrowDeskVaccineUpdatePayload(body, existing),
      }));
      return Response.json({ record: fromGrowDeskVaccineRecord(record) });
    }
    const version = legacyVersion(baseVersion);
    const record = await prisma.$transaction(async tx => {
      const existing = await tx.vaccineRecord.findUnique({ where: { id } });
      if (!existing || existing.babyId !== scope.babyId) throw new BridgeError(404, "NOT_FOUND", "接种记录不存在或已删除");
      if (existing.version !== version) throw new BridgeError(409, "VERSION_CONFLICT", "记录已被其他设备修改，请刷新后重试");
      const fields = vaccineRecordFields(body, existing);
      const changed = await tx.vaccineRecord.updateMany({ where: { id, babyId: scope.babyId, version }, data: { ...fields, version: { increment: 1 } } });
      if (changed.count !== 1) throw new BridgeError(409, "VERSION_CONFLICT", "记录已被其他设备修改，请刷新后重试");
      return tx.vaccineRecord.findUniqueOrThrow({ where: { id } });
    });
    return Response.json({ record: legacyRecord(record) });
  } catch (error) { return bridgeErrorResponse(error); }
}

export async function deleteVaccineRecord(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    const body = await request.json().catch(() => ({}));
    const id = pathId(query.get("id") || body?.id);
    const suppliedVersion = query.get("baseVersion") || body?.baseVersion;
    const baseVersion = suppliedVersion === undefined || suppliedVersion === null ? undefined : wireVersion(suppliedVersion);
    const scope = await scopeFor(request, query.get("babyId") || body?.babyId);
    if (scope instanceof Response) return scope;
    if (GROWDESK_CONFIG.enabled) {
      const result = await growdeskFetch(`${recordsPath(scope.babyId)}/${id}`, {
        method: "DELETE", accessToken: scope.accessToken,
        ...(baseVersion ? { body: { baseVersion } } : {}),
      });
      if (!result.ok && result.status !== 404) throw new BridgeError(result.status, result.error?.code || "DELETE_FAILED", result.error?.message || "删除接种记录失败");
      return Response.json({ success: true, id, ...(result.status === 404 ? { alreadyDeleted: true } : {}) });
    }
    await prisma.$transaction(async tx => {
      const existing = await tx.vaccineRecord.findUnique({ where: { id } });
      if (!existing || existing.babyId !== scope.babyId) throw new BridgeError(404, "NOT_FOUND", "接种记录不存在或已删除");
      const version = baseVersion === undefined ? undefined : legacyVersion(baseVersion);
      if (version !== undefined && existing.version !== version) throw new BridgeError(409, "VERSION_CONFLICT", "记录已被其他设备修改，请刷新后重试");
      const deleted = await tx.vaccineRecord.deleteMany({ where: { id, babyId: scope.babyId, ...(version === undefined ? {} : { version }) } });
      if (deleted.count !== 1) throw new BridgeError(409, "VERSION_CONFLICT", "记录已被其他设备修改，请刷新后重试");
    });
    return Response.json({ success: true, id });
  } catch (error) { return bridgeErrorResponse(error); }
}
