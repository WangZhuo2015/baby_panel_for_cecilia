import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJsonParse } from '@/lib/json'
import { requireAuth, requireBaby } from '@/lib/api-helpers'
import { GROWDESK_CONFIG } from "@/lib/config"
import { resolveBffSession } from "@/lib/growdesk/session"
import { verifyBffCsrf } from "@/lib/growdesk/csrf"
import { growdeskFetch } from "@/lib/growdesk/client"
import {
  toGrowDeskVaccineRecordPayload,
  fromGrowDeskVaccineRecord,
  fromGrowDeskVaccineCatalog,
  projectLegacyVaccineKnowledge,
  type GrowDeskVaccineRecord,
} from "@/lib/growdesk/vaccine-compat"
import { loadWebBaby } from "@/lib/growdesk/bridge-identity"
import { BridgeError, bridgeErrorResponse, requireData, pathId, wireVersion } from "@/lib/growdesk/bridge-protocol"
import crypto from "node:crypto"
import { idempotencyKey, readJsonObject } from "@/lib/growdesk/record-route-helpers"
import { matchVaccineProduct, parseVaccineRecordInput, projectVaccineLedgerRecord, VaccineRecordValidationError, type VaccineLedgerRecord, type VaccineRecordInput } from "@/lib/vaccine-records"
import type { Prisma } from "@/generated/prisma/client"

const ledgerHeaders = { "x-growdesk-representation": "ledger" };
const privateHeaders = { "cache-control": "no-store" };

function vaccineErrorResponse(error: unknown): Response {
  if (error instanceof VaccineRecordValidationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400, headers: privateHeaders });
  }
  if (error instanceof BridgeError || GROWDESK_CONFIG.enabled) return bridgeErrorResponse(error);
  console.error("Vaccine record request failed:", error);
  return NextResponse.json({ error: "疫苗记录保存失败，请重试" }, { status: 500, headers: privateHeaders });
}

function optionalBabyId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim() || value.length > 128) throw new BridgeError(400, "INVALID_BABY_ID", "宝宝 ID 格式无效");
  return value.trim();
}

async function cloudBabyId(value: unknown, token: string): Promise<string> {
  const supplied = optionalBabyId(value);
  if (supplied) { pathId(supplied); return supplied; }
  const baby = await loadWebBaby(growdeskFetch, token);
  if (!baby?.id) throw new BridgeError(400, "BABY_REQUIRED", "请先选择宝宝");
  pathId(baby.id);
  return baby.id;
}

async function cloudRecords(babyId: string, token: string): Promise<GrowDeskVaccineRecord[]> {
  const records = requireData(await growdeskFetch<GrowDeskVaccineRecord[]>(`/api/v1/babies/${pathId(babyId)}/vaccines/records`, {
    accessToken: token, headers: ledgerHeaders,
  }));
  if (!Array.isArray(records)) throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "疫苗记录列表格式无效");
  for (const row of records) {
    if (!row || row.babyId !== babyId || typeof row.id !== "string" || typeof row.vaccineCode !== "string") {
      throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "疫苗记录不属于当前宝宝");
    }
  }
  return records;
}

function checkedCloudRecord(record: GrowDeskVaccineRecord, babyId: string, id?: string): VaccineLedgerRecord {
  if (!record || record.babyId !== babyId || typeof record.id !== "string" || (id && record.id !== id)) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "保存结果不属于当前疫苗记录");
  }
  return fromGrowDeskVaccineRecord(record);
}

async function localProduct(input: VaccineRecordInput, tx: Prisma.TransactionClient, inferProduct = false): Promise<VaccineRecordInput> {
  const catalog = await tx.vaccine.findMany({ select: { id: true, vaccineId: true, name: true, shortName: true } });
  const product = input.vaccineId
    ? catalog.find(row => row.vaccineId === input.vaccineId || row.id === input.vaccineId)
    : inferProduct ? matchVaccineProduct(input.name, catalog) : null;
  if (input.vaccineId && !product) throw new BridgeError(400, "UNKNOWN_VACCINE_PRODUCT", "未找到所选疫苗产品；可清除产品选择后按本子原文保存");
  return { ...input, vaccineId: product?.vaccineId ?? null };
}

function mergedPatch(record: VaccineLedgerRecord, body: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...record, ...body };
  if (body.recordStatus !== undefined && body.isCompleted === undefined) merged.isCompleted = body.recordStatus === "completed";
  if (body.completedDate !== undefined && body.administeredDate === undefined) merged.administeredDate = body.completedDate;
  if (body.administeredDate !== undefined && body.completedDate === undefined) merged.completedDate = merged.recordStatus === "completed" ? body.administeredDate : null;
  if (body.recordStatus === "planned") {
    if (body.administeredDate === undefined) merged.administeredDate = null;
    if (body.completedDate === undefined) merged.completedDate = null;
  }
  if (body.recordStatus === "needs_review" && body.completedDate === undefined) merged.completedDate = null;
  return merged;
}

async function getLedger(request: Request): Promise<Response> {
  const requestedBabyId = optionalBabyId(new URL(request.url).searchParams.get("babyId"));
  if (GROWDESK_CONFIG.enabled) {
    const session = await resolveBffSession(request);
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const babyId = await cloudBabyId(requestedBabyId, session.accessToken);
    const records = await cloudRecords(babyId, session.accessToken);
    return NextResponse.json({ records: records.map(fromGrowDeskVaccineRecord) }, { headers: privateHeaders });
  }
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const scope = await requireBaby(auth.user, requestedBabyId);
  if (scope.errorResponse) return scope.errorResponse;
  const [records, catalog] = await Promise.all([
    prisma.vaccineRecord.findMany({ where: { babyId: scope.baby.id }, orderBy: [{ completedDate: "desc" }, { scheduledDate: "asc" }, { id: "desc" }] }),
    prisma.vaccine.findMany({ select: { id: true, vaccineId: true, name: true, shortName: true } }),
  ]);
  return NextResponse.json({ records: records.map(row => projectVaccineLedgerRecord({ ...row,
    vaccineId: row.vaccineId || (!row.recordStatus ? matchVaccineProduct(row.name, catalog)?.vaccineId : null) || null,
  })) }, { headers: privateHeaders });
}


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const regionCode = searchParams.get('regionCode') || 'CN-JS' // default to Jiangsu

  try {
    if (searchParams.get("view") === "records") return await getLedger(request);
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const catalog = await growdeskFetch<any>(`/api/v1/vaccines/catalog?regionCode=${encodeURIComponent(regionCode)}`, {
        accessToken: bffSession.accessToken,
      });
      const fullKb = fromGrowDeskVaccineCatalog(requireData(catalog), regionCode);
      // The normalized API owns the vaccine graph. The versioned Web bundle
      // supplies the legacy rule/release projection until those reference
      // slices have dedicated canonical tables, preserving the old response.
      return NextResponse.json(projectLegacyVaccineKnowledge(fullKb, regionCode));
    }

    // Fetch all vaccines
    const vaccines = await prisma.vaccine.findMany({
      include: { doses: { orderBy: { doseNumber: 'asc' } } }
    })

    // Parse JSON fields
    const parsed = vaccines.map(v => ({
      ...v,
      diseases: safeJsonParse(v.diseases),
      catchUpRules: safeJsonParse(v.catchUpRules),
      substitutionRules: safeJsonParse(v.substitutionRules),
      contraindications: safeJsonParse(v.contraindications),
      precautions: safeJsonParse(v.precautions),
      specialPopulations: safeJsonParse(v.specialPopulations),
      regionalOverrides: safeJsonParse(v.regionalOverrides),
      regimenOptions: safeJsonParse(v.regimenOptions),
      sourceRefsJson: safeJsonParse(v.sourceRefsJson),
      doses: v.doses.map(d => ({
        ...d,
        sourceRefsJson: safeJsonParse(d.sourceRefsJson)
      }))
    }))

    // Apply regional overrides
    const withOverrides = parsed.map(v => {
      if (v.regionalOverrides && v.regionalOverrides.length > 0) {
        const override = v.regionalOverrides.find((o: any) => o.regionCode === regionCode)
        if (override) {
          return {
            ...v,
            programType: override.programType,
            feeType: override.feeType,
            regionalOverride: override
          }
        }
      }
      return v
    })

    // Group by program type
    const national = withOverrides.filter(v => v.programType === 'national_immunization_program')
    const nonProgram = withOverrides.filter(v => v.programType === 'non_program')
    const provincial = withOverrides.filter(v => v.programType === 'provincial_immunization_program')

    // Get strategy groups
    const strategyGroups = await prisma.vaccineStrategyGroup.findMany()
    const parsedGroups = strategyGroups.map(g => ({
      ...g,
      optionsJson: safeJsonParse(g.optionsJson),
      sourceRefsJson: safeJsonParse(g.sourceRefsJson)
    }))

    // Get schedule entries
    const scheduleEntries = await prisma.vaccineScheduleEntry.findMany({
      orderBy: [{ ageMonths: 'asc' }, { doseNumber: 'asc' }]
    })
    const parsedSchedule = scheduleEntries.map(s => ({
      ...s,
      sourceRefsJson: safeJsonParse(s.sourceRefsJson)
    }))

    // Get engine rules
    const engineRules = await prisma.scheduleEngineRule.findMany()
    const parsedRules = engineRules.map(r => ({
      ...r,
      vaccineIdsJson: safeJsonParse(r.vaccineIdsJson),
      sourceRefsJson: safeJsonParse(r.sourceRefsJson)
    }))

    // Get data release info
    const dataRelease = await prisma.dataRelease.findFirst({
      include: { sources: true }
    })

    return NextResponse.json({
      national,
      nonProgram,
      provincial,
      strategyGroups: parsedGroups,
      schedule: parsedSchedule,
      engineRules: parsedRules,
      dataRelease
    })
  } catch (error) {
    return vaccineErrorResponse(error)
  }
}


export async function POST(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrf = verifyBffCsrf(request);
      if (csrf) return csrf;
      const session = await resolveBffSession(request);
      if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
      const body = await readJsonObject(request);
      const babyId = await cloudBabyId(body.babyId, session.accessToken);
      const payload = toGrowDeskVaccineRecordPayload(body);
      const record = requireData(await growdeskFetch<GrowDeskVaccineRecord>(`/api/v1/babies/${pathId(babyId)}/vaccines/records`, {
        method: "POST", accessToken: session.accessToken, headers: ledgerHeaders,
        idempotencyKey: idempotencyKey(body, request), body: payload,
      }));
      return NextResponse.json({ record: checkedCloudRecord(record, babyId) }, { status: 201, headers: privateHeaders });
    }
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await readJsonObject(request);
    const scope = await requireBaby(auth.user, optionalBabyId(body.babyId));
    if (scope.errorResponse) return scope.errorResponse;
    const input = parseVaccineRecordInput(body);
    const key = idempotencyKey(body, request);
    const requestHash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const replay = async () => {
      const record = await prisma.vaccineRecord.findUnique({ where: { babyId_clientId: { babyId: scope.baby.id, clientId: key } } });
      if (!record) return null;
      if (record.clientHash !== requestHash) throw new BridgeError(409, "IDEMPOTENCY_KEY_REUSED", "本次保存标识已用于另一条内容，请重新打开录入表单");
      return record;
    };
    let record = await replay();
    if (!record) {
      try {
        record = await prisma.$transaction(async tx => {
          const resolved = await localProduct(input, tx, !Object.hasOwn(body, "vaccineId"));
          return tx.vaccineRecord.create({ data: { ...resolved, babyId: scope.baby.id, clientId: key, clientHash: requestHash } });
        });
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        record = await replay();
        if (!record) throw error;
      }
    }
    return NextResponse.json({ record: projectVaccineLedgerRecord(record) }, { status: 201, headers: privateHeaders });
  } catch (error) { return vaccineErrorResponse(error); }
}

/** Web PUT is an atomic, versioned edit; the canonical API uses PATCH. */
export async function PUT(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrf = verifyBffCsrf(request);
      if (csrf) return csrf;
      const session = await resolveBffSession(request);
      if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
      const body = await readJsonObject(request);
      const id = pathId(body.id);
      const baseVersion = wireVersion(body.baseVersion);
      const babyId = await cloudBabyId(body.babyId, session.accessToken);
      const records = await cloudRecords(babyId, session.accessToken);
      const current = records.find(row => row.id === body.id);
      if (!current) throw new BridgeError(404, "VACCINE_RECORD_NOT_FOUND", "未找到这条接种记录");
      if (String(current.version) !== baseVersion) throw new BridgeError(409, "CONCURRENCY_CONFLICT", "记录已被更新，请刷新后核对再保存");
      const payload = toGrowDeskVaccineRecordPayload(mergedPatch(fromGrowDeskVaccineRecord(current), body));
      const record = requireData(await growdeskFetch<GrowDeskVaccineRecord>(`/api/v1/babies/${pathId(babyId)}/vaccines/records/${id}`, {
        method: "PATCH", accessToken: session.accessToken, headers: ledgerHeaders, body: { ...payload, baseVersion },
      }));
      return NextResponse.json({ record: checkedCloudRecord(record, babyId, String(body.id)) }, { headers: privateHeaders });
    }
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await readJsonObject(request);
    const id = pathId(body.id);
    const baseVersion = wireVersion(body.baseVersion);
    const numericVersion = Number(baseVersion);
    if (!Number.isSafeInteger(numericVersion)) throw new BridgeError(400, "INVALID_VERSION", "记录版本超出范围");
    const scope = await requireBaby(auth.user, optionalBabyId(body.babyId));
    if (scope.errorResponse) return scope.errorResponse;
    const record = await prisma.$transaction(async tx => {
      const current = await tx.vaccineRecord.findFirst({ where: { id, babyId: scope.baby.id } });
      if (!current) throw new BridgeError(404, "VACCINE_RECORD_NOT_FOUND", "未找到这条接种记录");
      if (current.version !== numericVersion) throw new BridgeError(409, "CONCURRENCY_CONFLICT", "记录已被更新，请刷新后核对再保存");
      const input = await localProduct(parseVaccineRecordInput(mergedPatch(projectVaccineLedgerRecord(current), body)), tx);
      const changed = await tx.vaccineRecord.updateMany({
        where: { id, babyId: scope.baby.id, version: numericVersion }, data: { ...input, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new BridgeError(409, "CONCURRENCY_CONFLICT", "记录已被更新，请刷新后核对再保存");
      return tx.vaccineRecord.findUniqueOrThrow({ where: { id } });
    });
    return NextResponse.json({ record: projectVaccineLedgerRecord(record) }, { headers: privateHeaders });
  } catch (error) { return vaccineErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const body = query.get("id") ? {} : await readJsonObject(request);
    const rawId = query.get("id") || body.id;
    const id = pathId(rawId);
    const requestedBabyId = optionalBabyId(query.get("babyId") || body.babyId);
    const suppliedVersion = query.get("baseVersion") || body.baseVersion;
    const baseVersion = suppliedVersion === undefined || suppliedVersion === null ? null : wireVersion(suppliedVersion);
    if (GROWDESK_CONFIG.enabled) {
      const csrf = verifyBffCsrf(request);
      if (csrf) return csrf;
      const session = await resolveBffSession(request);
      if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
      const babyId = await cloudBabyId(requestedBabyId, session.accessToken);
      const suffix = baseVersion ? `?baseVersion=${encodeURIComponent(baseVersion)}` : "";
      requireData(await growdeskFetch(`/api/v1/babies/${pathId(babyId)}/vaccines/records/${id}${suffix}`, {
        method: "DELETE", accessToken: session.accessToken, headers: ledgerHeaders,
      }));
      return NextResponse.json({ success: true, id }, { headers: privateHeaders });
    }
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const scope = await requireBaby(auth.user, requestedBabyId);
    if (scope.errorResponse) return scope.errorResponse;
    const version = baseVersion === null ? undefined : Number(baseVersion);
    if (version !== undefined && !Number.isSafeInteger(version)) throw new BridgeError(400, "INVALID_VERSION", "记录版本超出范围");
    await prisma.$transaction(async tx => {
      const current = await tx.vaccineRecord.findFirst({ where: { id, babyId: scope.baby.id } });
      if (!current) throw new BridgeError(404, "VACCINE_RECORD_NOT_FOUND", "未找到这条接种记录");
      if (version !== undefined && current.version !== version) throw new BridgeError(409, "CONCURRENCY_CONFLICT", "记录已被更新，请刷新后再删除");
      const removed = await tx.vaccineRecord.deleteMany({ where: { id, babyId: scope.baby.id, ...(version !== undefined ? { version } : {}) } });
      if (removed.count !== 1) throw new BridgeError(409, "CONCURRENCY_CONFLICT", "记录已变更，请刷新后重试");
    });
    return NextResponse.json({ success: true, id }, { headers: privateHeaders });
  } catch (error) { return vaccineErrorResponse(error); }
}
