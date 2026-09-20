/**
 * Remote MCP Server implementation for External AI Agents (Gemini Spark, ChatGPT, Claude, Cursor, etc.)
 * Fine-grained low-granularity tools returning pure raw database records with explicit user identity,
 * plus full data coverage (photos, medical exams, growth, vaccines, supplements) and legacy composite compatibility.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { prisma } from "@/lib/prisma";
import { calculateAgeDetail } from "@/lib/age";
import {
  getLocalDateStr,
  getLocalTimeStr,
  isValidDateStr,
  getLocalDayUtcRange,
  localTimeToUtcIso,
} from "@/lib/date";
import { formatSupplementAmount, fromGrowDeskSupplementProduct, normalizeNutrients, type GrowDeskSupplementProduct } from "@/lib/growdesk/nutrition-compat";
import * as records from "@/lib/records/service";
import { performWebSearch } from "@/lib/agent/search";
import { checkRateLimit } from "@/lib/rate-limit";
import { logOAuthAudit } from "@/lib/oauth/service";
import { safeJsonParse } from "@/lib/json";
import type { UserPrincipal } from "@/lib/oauth/types";
import fs from "node:fs";
import path from "node:path";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "@/lib/growdesk/client";
import { requireData } from "@/lib/growdesk/bridge-protocol";
import { toGrowDeskFeedingCreatePayload, fromGrowDeskFeedingRecord } from "@/lib/growdesk/feeding-compat";
import { toGrowDeskSleepCreatePayload, fromGrowDeskSleepRecord } from "@/lib/growdesk/sleep-compat";
import { toGrowDeskDiaperCreatePayload, fromGrowDeskDiaperRecord } from "@/lib/growdesk/diaper-compat";
import { toGrowDeskFoodCreatePayload, fromGrowDeskFoodRecord } from "@/lib/growdesk/food-compat";
import { toGrowDeskSupplementCreatePayload, fromGrowDeskSupplementRecord } from "@/lib/growdesk/supplement-compat";
import { toGrowDeskGrowthCreatePayload, fromGrowDeskGrowthRecord } from "@/lib/growdesk/growth-compat";
import { toGrowDeskMedicalCreatePayload, fromGrowDeskMedicalRecord, type GrowDeskMedicalReport } from "@/lib/growdesk/medical-compat";
import { toGrowDeskVaccineRecordPayload, fromGrowDeskVaccineRecord, loadFullVaccineKnowledge, type GrowDeskVaccineRecord } from "@/lib/growdesk/vaccine-compat";
import { type GrowDeskFeedingRecord } from "@/lib/growdesk/feeding-compat";
import { type GrowDeskSleepRecord } from "@/lib/growdesk/sleep-compat";
import { type GrowDeskDiaperRecord } from "@/lib/growdesk/diaper-compat";
import { type GrowDeskFoodRecord } from "@/lib/growdesk/food-compat";
import { type GrowDeskSupplementRecord } from "@/lib/growdesk/supplement-compat";
import { type GrowDeskGrowthRecord } from "@/lib/growdesk/growth-compat";
import { fromGrowDeskTimelineResponse } from "@/lib/growdesk/timeline-compat";
import { fetchLegacyRecordList } from "@/lib/growdesk/record-list";
import { recordPath, requireWriteData } from "@/lib/growdesk/record-route-helpers";

export interface UserIdentitySummary {
  id: string;
  username: string;
  displayName: string;
  relation: string;
  role: string;
}

export function checkScope(principal: UserPrincipal, requiredScope: "read" | "write"): boolean {
  if (requiredScope === "read") {
    return (
      principal.scopes.has("baby:read") ||
      principal.scopes.has("baby:write") ||
      principal.scopes.has("app:read") ||
      principal.scopes.has("app:write")
    );
  }
  if (requiredScope === "write") {
    return principal.scopes.has("baby:write") || principal.scopes.has("app:write");
  }
  return false;
}

/**
 * Resolves family members into a lookup map by userId.
 */
async function getFamilyMemberLookup(familyId: string, accessToken?: string): Promise<Map<string, UserIdentitySummary>> {
  if (GROWDESK_CONFIG.enabled) {
    const map = new Map<string, UserIdentitySummary>();
    if (accessToken) {
      try {
        const res = await growdeskFetch<any[]>(`/api/v1/families/${familyId}/members`, { accessToken });
        const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
        for (const m of list) {
          map.set(m.userId, {
            id: m.userId,
            username: m.user?.username || m.username || "family_member",
            displayName: m.user?.displayName || m.displayName || "家庭成员",
            relation: m.relation || "caregiver",
            role: m.role || "member",
          });
        }
      } catch {}
    }
    return map;
  }
  const members = await prisma.familyMember.findMany({
    where: { familyId },
    include: {
      user: {
        select: { id: true, username: true, displayName: true },
      },
    },
  });
  const map = new Map<string, UserIdentitySummary>();
  for (const m of members) {
    map.set(m.userId, {
      id: m.userId,
      username: m.user.username,
      displayName: m.user.displayName,
      relation: m.relation,
      role: m.role,
    });
  }
  return map;
}

/**
 * Resolves the user identity who recorded an entry.
 */
function resolveRecorder(
  recordedById: string | null | undefined,
  lookup: Map<string, UserIdentitySummary>,
  principal: UserPrincipal
): UserIdentitySummary | null {
  if (!recordedById) return null;
  const found = lookup.get(recordedById);
  if (found) return found;
  if (recordedById === principal.userId) {
    return {
      id: principal.userId,
      username: principal.username,
      displayName: principal.displayName,
      relation: principal.relation || "caregiver",
      role: principal.role || "member",
    };
  }
  return {
    id: recordedById,
    username: "unknown",
    displayName: "家庭成员",
    relation: "caregiver",
    role: "member",
  };
}

/**
 * Queries all photos and visual artifacts related to the baby across medical reports, growth measurements, and avatars.
 */
async function getBabyPhotos(babyId: string, type?: string, limit = 50) {
  if (GROWDESK_CONFIG.enabled) {
    return [];
  }
  const photos: Array<{
    id: string;
    type: "medical_report" | "growth" | "avatar";
    category?: string;
    title: string;
    date: string | null;
    imageUrl: string;
    recordedById: string | null;
  }> = [];

  // 1. Medical report photos & checkup sheets
  if (!type || type === "all" || type === "medical_report") {
    const reports = await prisma.medicalReport.findMany({
      where: { babyId, imageUrl: { not: null, gt: "" } },
      orderBy: { date: "desc" },
      take: limit,
      select: { id: true, category: true, title: true, date: true, imageUrl: true, recordedById: true },
    });
    for (const r of reports) {
      if (r.imageUrl && r.imageUrl.trim() !== "") {
        photos.push({
          id: r.id,
          type: "medical_report",
          category: r.category,
          title: r.title,
          date: r.date,
          imageUrl: r.imageUrl,
          recordedById: r.recordedById,
        });
      }
    }
  }

  // 2. Growth measurement photos
  if (!type || type === "all" || type === "growth") {
    const growths = await prisma.growthMeasurement.findMany({
      where: { babyId, imageUrl: { not: null, gt: "" } },
      orderBy: { date: "desc" },
      take: limit,
      select: { id: true, ageLabel: true, date: true, imageUrl: true, recordedById: true },
    });
    for (const g of growths) {
      if (g.imageUrl && g.imageUrl.trim() !== "") {
        photos.push({
          id: g.id,
          type: "growth",
          title: `生长测量照片 (${g.ageLabel || g.date})`,
          date: g.date,
          imageUrl: g.imageUrl,
          recordedById: g.recordedById,
        });
      }
    }
  }

  // 3. Baby Avatar
  if (!type || type === "all" || type === "avatar") {
    const baby = await prisma.baby.findUnique({
      where: { id: babyId },
      select: { id: true, nickname: true, avatarUrl: true },
    });
    if (baby?.avatarUrl && baby.avatarUrl.trim() !== "") {
      photos.push({
        id: baby.id,
        type: "avatar",
        title: `${baby.nickname} 头像`,
        date: null,
        imageUrl: baby.avatarUrl,
        recordedById: null,
      });
    }
  }

  // Sort photos: avatar (date === null) at top, followed by date descending
  photos.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return -1;
    if (!b.date) return 1;
    return b.date.localeCompare(a.date);
  });

  return photos.slice(0, limit);
}

export async function resolveFormulaProductId(
  familyId: string,
  type: string,
  formulaProductId?: string | null,
  formulaName?: string | null,
  accessToken?: string
): Promise<string | null> {
  if (!familyId || (type !== "formula" && type !== "mixed")) {
    return null;
  }
  if (GROWDESK_CONFIG.enabled) {
    if (typeof formulaProductId === "string" && formulaProductId.trim()) {
      return formulaProductId.trim();
    }
    if (accessToken) {
      try {
        const res = await growdeskFetch<any[]>(`/api/v1/families/${familyId}/formula-products`, { accessToken });
        const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
        if (typeof formulaName === "string" && formulaName.trim()) {
          const q = formulaName.trim().toLowerCase();
          const found = list.find((p: any) => p.name?.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q));
          if (found) return found.id;
        }
        const def = list.find((p: any) => p.isDefault) || list[0];
        return def ? def.id : null;
      } catch {}
    }
    return formulaProductId ? String(formulaProductId).trim() : null;
  }
  if (typeof formulaProductId === "string" && formulaProductId.trim()) {
    const verified = await prisma.formulaProduct.findFirst({
      where: { id: formulaProductId.trim(), familyId },
      select: { id: true },
    });
    if (verified) {
      return verified.id;
    }
  }
  if (typeof formulaName === "string" && formulaName.trim()) {
    const q = formulaName.trim();
    const activeProducts = await prisma.formulaProduct.findMany({
      where: {
        familyId,
        isActive: true,
        OR: [
          { name: { contains: q } },
          { brand: { contains: q } },
        ],
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    if (activeProducts.length > 0) {
      return activeProducts[0].id;
    }
  }
  // Default fallback: active default formula or first active formula
  const defaultFormula =
    (await prisma.formulaProduct.findFirst({
      where: { familyId, isActive: true, isDefault: true },
    })) ||
    (await prisma.formulaProduct.findFirst({
      where: { familyId, isActive: true },
      orderBy: { createdAt: "desc" },
    }));
  return defaultFormula ? defaultFormula.id : null;
}

let cachedFoods: any[] | null = null;
function getFoodsData(): any[] {
  if (!cachedFoods) {
    try {
      const p = path.resolve(process.cwd(), "data/04_foods.json");
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        cachedFoods = raw.foodItems || [];
      }
    } catch {
      cachedFoods = [];
    }
  }
  return cachedFoods || [];
}

let cachedMilestones: any[] | null = null;
function getMilestonesData(): any[] {
  if (!cachedMilestones) {
    try {
      const p = path.resolve(process.cwd(), "data/03_milestones.json");
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        cachedMilestones = raw.milestones || [];
      }
    } catch {
      cachedMilestones = [];
    }
  }
  return cachedMilestones || [];
}

let cachedBooks: any[] | null = null;
function getBooksData(): any[] {
  if (!cachedBooks) {
    try {
      const p = path.resolve(process.cwd(), "data/05_books.json");
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        cachedBooks = raw.books || [];
      }
    } catch {
      cachedBooks = [];
    }
  }
  return cachedBooks || [];
}

let cachedActivities: any[] | null = null;
function getActivitiesData(): any[] {
  if (!cachedActivities) {
    try {
      const p = path.resolve(process.cwd(), "data/06_activities.json");
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        cachedActivities = raw.activities || [];
      }
    } catch {
      cachedActivities = [];
    }
  }
  return cachedActivities || [];
}

export function createMcpServer(principal: UserPrincipal, options?: { accessToken?: string }): Server {
  const babyId = principal.babyId;
  const baby = principal.baby!;
  const sourceAgent = principal.sourceAgent || "Gemini Spark";
  const accessToken = options?.accessToken;
  const recCtx = {
    userId: principal.userId,
    babyId,
    baby,
    familyId: baby.familyId,
    source: "mcp",
    sourceAgent,
  };

  const currentUserSummary: UserIdentitySummary = {
    id: principal.userId,
    username: principal.username,
    displayName: principal.displayName,
    relation: principal.relation || "caregiver",
    role: principal.role || "member",
  };

  const server = new Server(
    {
      name: "baby-panel-mcp",
      version: "2.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List all tools (fine-grained low-granularity tools + legacy composite tools for compatibility)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        // ── Identity & Profile Tools ──
        {
          name: "get_current_user",
          description:
            "【用户身份】获取当前授权连接的家长用户身份信息（用户ID、姓名、用户名、在家庭中的称呼如'妈妈'/'爸爸'、管理权限、操作客户端与来源等）。",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_baby_profile",
          description:
            "【宝宝档案】获取当前绑定的宝宝完整基础档案（ID、昵称、性别、出生日期、精准年龄结构、头像照片URL、所属家庭ID以及家庭照顾者成员列表及各自分工称呼）。",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },

        // ── Activity Read Tools (Raw Records + Recorder Identity) ──
        {
          name: "get_feeding_records",
          description:
            "【喂养读】查询宝宝吃奶/喂养原始记录（支持按日期过滤）。返回喂养类型(亲喂/配方奶/瓶喂母乳/混合)、奶量(ml)、左右亲喂时长(分钟)、吐奶标记、备注以及记录人身份。",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "查询日期 (YYYY-MM-DD，留空则查全部近期记录)" },
              limit: { type: "number", description: "返回条数上限 (1-100，默认 50)" },
            },
          },
        },
        {
          name: "get_sleep_records",
          description:
            "【睡眠读】查询宝宝睡眠作息原始记录（支持按日期过滤）。返回入睡时间(startTime)、醒来时间(endTime)、类型(day白天小睡/night夜觉)、夜醒次数、睡眠状态备注及记录人身份。",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "查询日期 (YYYY-MM-DD，留空则查全部近期记录)" },
              limit: { type: "number", description: "返回条数上限 (1-100，默认 50)" },
            },
          },
        },
        {
          name: "get_diaper_records",
          description:
            "【换尿布读】查询宝宝换尿布/排便原始记录（支持按日期过滤）。返回类型(pee尿/poop便/both尿+便)、大便颜色、性状、备注及记录人身份。",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "查询日期 (YYYY-MM-DD，留空则查全部近期记录)" },
              limit: { type: "number", description: "返回条数上限 (1-100，默认 50)" },
            },
          },
        },
        {
          name: "get_food_records",
          description:
            "【辅食读】查询宝宝辅食餐点打卡原始记录（支持按日期过滤）。返回日期、时间、食材列表(foods)、进食量(portion)、喜欢度(1-5)、进食状态、是否有过敏异常及描述、记录人身份。",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "查询日期 (YYYY-MM-DD，留空则查全部近期记录)" },
              limit: { type: "number", description: "返回条数上限 (1-100，默认 50)" },
            },
          },
        },
        {
          name: "get_supplement_records",
          description:
            "【补剂读】查询宝宝维生素D3/AD/钙/铁等营养补剂打卡原始记录（日期、时间、补剂名称、品牌、剂量、单位、备注及打卡人身份）。",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "查询日期 (YYYY-MM-DD，留空则查全部近期记录)" },
              limit: { type: "number", description: "返回条数上限 (1-100，默认 50)" },
            },
          },
        },
        {
          name: "get_food_plans",
          description:
            "【食谱计划读】查询一日辅食食谱与膳食配餐计划（日期、食谱名称、食材清单、制作步骤、标签）。",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "查询日期 (YYYY-MM-DD，留空则查最新计划)" },
              limit: { type: "number", description: "返回条数上限 (1-20，默认 5)" },
            },
          },
        },
        {
          name: "get_daily_summary",
          description:
            "【作息统计读】获取指定日期的基础作息统计数值汇总（总奶量ml、总睡眠时长分钟、排便换尿布次数、辅食次数。纯数值统计汇总，不附带任何AI主观建议）。",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "查询日期 (YYYY-MM-DD，留空默认今天)" },
            },
          },
        },

        // ── Health, Growth & Medical Exams Read Tools ──
        {
          name: "get_growth_records",
          description:
            "【生长读】查询宝宝身体生长发育测量原始记录（身高/身长cm、体重kg、头围cm、测量日期、体检生长单据照片imageUrl、记录人身份）。",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "查询日期 (YYYY-MM-DD，留空则查全部记录)" },
              limit: { type: "number", description: "返回条数上限 (1-100，默认 50)" },
            },
          },
        },
        {
          name: "get_medical_reports",
          description:
            "【体检/化验单读】查询宝宝化验单与体检报告列表（支持按类别过滤：growth体检、blood血常规、trace_element微量元素、allergy过敏原、general综合）。返回标题、日期、医院、指标项原始数值/单位/参考区间列表、单据照片imageUrl、医生医嘱及记录人身份。",
          inputSchema: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["all", "blood", "growth", "trace_element", "allergy", "general"],
                description: "报告类别: growth(体检), blood(血常规), trace_element(微量元素), allergy(过敏原), general(其他), all(全部)",
              },
              date: { type: "string", description: "检查日期 (YYYY-MM-DD，留空则查全部记录)" },
              limit: { type: "number", description: "返回条数上限 (1-100，默认 50)" },
            },
          },
        },
        {
          name: "get_medical_report_detail",
          description:
            "【体检/化验单明细读】按报告 ID 获取某份化验单或体检报告的完整原始详细内容（包含所有化验检测项目、数值、单位、参考区间、单据照片URL、医院、医嘱等）。",
          inputSchema: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string", description: "体检/化验单报告唯一 ID" },
            },
          },
        },
        {
          name: "get_baby_photos",
          description:
            "【相册/图片读】查询宝宝相关的所有原始图片与照片记录（数据全景：包含化验单照片、体检单照片、生长测量单据照片、宝宝头像等全部视觉资料，返回图片URL、类型、拍摄/归档日期及记录人）。",
          inputSchema: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["all", "medical_report", "growth", "avatar"],
                description: "图片类型: medical_report(化验与体检单据照片), growth(生长测量照片), avatar(宝宝头像), all(全部)",
              },
              limit: { type: "number", description: "返回条数上限 (1-100，默认 50)" },
            },
          },
        },
        {
          name: "get_vaccine_records",
          description:
            "【疫苗读】查询宝宝已接种/登记的疫苗记录列表（疫苗名称、剂次、接种日期、完成状态）。",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "返回条数上限 (1-100，默认 50)" },
            },
          },
        },
        {
          name: "get_vaccine_schedule",
          description:
            "【疫苗规划读】查询国家及地方官方推荐的疫苗接种日程规划库（推荐月龄、疫苗名称、剂次、一类自费/二类自愿等原始日程规划数据）。",
          inputSchema: {
            type: "object",
            properties: {
              maxAgeMonths: { type: "number", description: "查询到指定月龄之前的计划 (默认宝宝当前月龄+3)" },
            },
          },
        },
        {
          name: "get_development_milestones",
          description:
            "【发育里程碑读】查询官方儿童发育里程碑指标原始标准（月龄、领域分类[大运动/精细动作/语言/认知/社交]、指标标题、观察方法。纯指标原始标准，不含本地AI预警）。",
          inputSchema: {
            type: "object",
            properties: {
              month: { type: "number", description: "评估月龄 (1-36，默认宝宝当前月龄)" },
              category: {
                type: "string",
                enum: ["gross_motor", "fine_motor", "language", "cognitive", "social_emotional"],
                description: "领域分类",
              },
            },
          },
        },

        // ── Single Entity Write Tools (Low Granularity) ──
        {
          name: "record_feeding",
          description:
            "【喂养写】记录宝宝单次喂养事件（母乳亲喂、配方奶、瓶喂母乳、混合）。自动关联当前操作家长身份并返回新创建的原始记录。",
          inputSchema: {
            type: "object",
            required: ["type"],
            properties: {
              type: {
                type: "string",
                enum: ["breast", "formula", "bottle_breast", "mixed"],
                description: "喂养类型: breast(母乳亲喂), formula(配方奶), bottle_breast(瓶喂母乳), mixed(混合)",
              },
              amountMl: { type: "number", description: "奶量 (ml，亲喂可选，瓶喂/配方奶建议填写)" },
              leftMinutes: { type: "number", description: "左侧亲喂时长 (分钟)" },
              rightMinutes: { type: "number", description: "右侧亲喂时长 (分钟)" },
              spitUp: { type: "boolean", description: "是否有吐奶/溢奶" },
              notes: { type: "string", description: "喂养备注" },
              timestamp: { type: "string", description: "时间 (ISO 8601 或 HH:mm，默认当前时间)" },
              formulaProductId: {
                type: "string",
                description: "指定奶粉产品ID (可选，若不填可传 formulaName 或自动使用默认主力奶粉)",
              },
              formulaName: {
                type: "string",
                description: "奶粉名称或品牌模糊匹配 (可选，如 '爱他美'、'纽荃星'，若系统有匹配的已建档奶粉则自动关联)",
              },
            },
          },
        },
        {
          name: "record_sleep",
          description:
            "【睡眠写】记录宝宝单次睡眠作息（入睡与醒来时间、白天小睡或夜间长觉）。自动关联当前操作家长身份并返回新创建的原始记录。",
          inputSchema: {
            type: "object",
            required: ["startTime", "endTime"],
            properties: {
              startTime: { type: "string", description: "入睡时间 (HH:mm 或 ISO 8601，如 13:00)" },
              endTime: { type: "string", description: "醒来时间 (HH:mm 或 ISO 8601，如 14:30)" },
              type: { type: "string", enum: ["day", "night"], description: "day(白天小睡), night(夜间长觉)" },
              nightWakingCount: { type: "number", description: "夜醒次数 (夜觉可选)" },
              notes: { type: "string", description: "睡眠状态备注" },
              date: { type: "string", description: "日期 (YYYY-MM-DD，默认今天)" },
            },
          },
        },
        {
          name: "record_diaper",
          description:
            "【换尿布写】记录宝宝单次换尿布/排便事件（尿、便、颜色、性状）。自动关联当前操作家长身份并返回新创建的原始记录。",
          inputSchema: {
            type: "object",
            required: ["type"],
            properties: {
              type: { type: "string", enum: ["pee", "poop", "both"], description: "pee(尿), poop(便), both(尿+便)" },
              poopColor: { type: "string", enum: ["yellow", "green", "brown", "other"], description: "大便颜色" },
              poopConsistency: { type: "string", enum: ["soft", "watery", "hard", "seedy", "loose", "paste", "formed"], description: "大便性状" },
              notes: { type: "string", description: "臀部/皮肤备注" },
              timestamp: { type: "string", description: "时间 (ISO 8601 或 HH:mm，默认当前时间)" },
            },
          },
        },
        {
          name: "record_food",
          description:
            "【辅食写】记录宝宝单次辅食餐点打卡（食材列表、进食量、宝宝状态、异常反应）。自动关联当前操作家长身份并返回新创建的原始记录。",
          inputSchema: {
            type: "object",
            required: ["foods"],
            properties: {
              foods: { type: "array", items: { type: "string" }, description: "食材列表，如 [\"高铁米粉\", \"西蓝花泥\"]" },
              date: { type: "string", description: "日期 (YYYY-MM-DD，默认今天)" },
              time: { type: "string", description: "时间 (HH:mm，默认当前时间)" },
              portion: { type: "string", enum: ["little", "half", "most", "all"], description: "进食量" },
              acceptance: { type: "number", description: "喜欢程度 (1-5 星)" },
              babyState: { type: "string", enum: ["happy", "neutral", "rejected"], description: "进食状态" },
              hasAbnormal: { type: "boolean", description: "是否有过敏或不适异常" },
              abnormalNotes: { type: "string", description: "异常情况描述" },
            },
          },
        },
        {
          name: "record_growth",
          description:
            "【生长写】记录身体生长测量数据（体重kg、身长/身高cm、头围cm、体检单/测量照片URL）。自动关联当前操作家长身份并返回新创建的原始记录。",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "测量日期 (YYYY-MM-DD，默认今天)" },
              weightKg: { type: "number", description: "体重 (kg，如 8.5)" },
              heightCm: { type: "number", description: "身长/身高 (cm，如 70.2)" },
              headCircumferenceCm: { type: "number", description: "头围 (cm，如 43.5)" },
              imageUrl: { type: "string", description: "体检单/测量照片路径 (如 /uploads/medical/xxx.jpg)" },
            },
          },
        },
        {
          name: "record_vaccine",
          description:
            "【疫苗写】登记已完成接种的疫苗剂次（疫苗名称、剂次、接种日期）。自动关联当前操作家长身份并返回新记录。",
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", description: "疫苗名称（如 乙肝疫苗、五联疫苗）" },
              dose: { type: "string", description: "剂次（如 第1剂、第2剂）" },
              completedDate: { type: "string", description: "接种日期 (YYYY-MM-DD，默认今天)" },
            },
          },
        },
        {
          name: "record_medical_report",
          description:
            "【体检/化验单写】保存归档体检报告或化验单（标题、类别[growth体检/blood血常规等]、医院、日期、化验指标项目列表、单据照片imageUrl、医生医嘱）。自动关联当前操作家长身份并返回新记录。",
          inputSchema: {
            type: "object",
            required: ["title", "category"],
            properties: {
              title: { type: "string", description: "报告名称（如 8月龄儿童体格发育体检报告、末梢血常规化验单）" },
              category: {
                type: "string",
                enum: ["blood", "growth", "trace_element", "allergy", "general"],
                description: "报告类别: growth(体检), blood(血常规), trace_element(微量元素), allergy(过敏原), general(其他)",
              },
              date: { type: "string", description: "检查/报告日期 (YYYY-MM-DD，默认今天)" },
              hospital: { type: "string", description: "医院或妇幼保健院名称" },
              doctorNotes: { type: "string", description: "医生诊断医嘱或体检小结" },
              imageUrl: { type: "string", description: "化验单或体检单照片路径 (如 /uploads/medical/xxx.jpg)" },
              items: {
                type: "array",
                description: "化验或体检指标项列表",
                items: {
                  type: "object",
                  required: ["name", "value"],
                  properties: {
                    name: { type: "string", description: "项目名称（如 白细胞计数、血红蛋白、身长）" },
                    value: { type: "string", description: "检测数值或结果" },
                    unit: { type: "string", description: "计量单位（如 10^9/L、g/L、cm）" },
                    referenceRange: { type: "string", description: "参考区间（如 4.0-10.0）" },
                    status: { type: "string", enum: ["normal", "high", "low", "abnormal"], description: "状态标记" },
                  },
                },
              },
            },
          },
        },
        {
          name: "record_supplement",
          description:
            "【补剂写】记录维生素D3/AD/钙/铁等营养补剂打卡。自动关联当前操作家长身份并返回新记录。",
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", description: "补剂名称（如 维生素D3、伊可新AD滴剂、海藻油DHA）" },
              dose: { type: "number", description: "服用剂次/数量 (默认 1)" },
              unitName: { type: "string", description: "单位 (如 滴、粒、ml、袋，默认 粒)" },
              date: { type: "string", description: "日期 (YYYY-MM-DD，默认今天)" },
              time: { type: "string", description: "时间 (HH:mm，默认当前时间)" },
              notes: { type: "string", description: "备注" },
            },
          },
        },
        {
          name: "create_supplement_product",
          description: "【补剂建档写】在当前家庭建档或更新营养补充剂产品，无需同时记录一次服用。",
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", description: "补剂全称" },
              brand: { type: "string", description: "品牌名称，默认家庭自选" },
              dosageForm: { type: "string", enum: ["drops", "capsule", "liquid_ml", "sachet", "tablet"] },
              unitName: { type: "string", description: "单次计量单位，默认滴" },
              defaultDose: { type: "number", description: "单次推荐用量，默认1" },
              nutrients: { type: "object", description: "营养成分表" },
              notes: { type: "string", description: "补充说明或医嘱注意事项" },
            },
          },
        },
        {
          name: "record_food_plan",
          description:
            "【食谱计划写】保存一日辅食食谱与配餐计划（食谱名称、食材清单、制作步骤、标签）。自动关联当前操作家长身份并返回新记录。",
          inputSchema: {
            type: "object",
            required: ["name", "ingredients", "steps"],
            properties: {
              name: { type: "string", description: "食谱名称" },
              ingredients: { type: "array", items: { type: "string" }, description: "食材清单" },
              steps: { type: "array", items: { type: "string" }, description: "制作步骤" },
              date: { type: "string", description: "日期 (YYYY-MM-DD，默认今天)" },
              nutrition: { type: "string", description: "营养要点" },
              tags: { type: "array", items: { type: "string" }, description: "标签" },
            },
          },
        },

        // ── Management & Safety Tools ──
        {
          name: "delete_record",
          description:
            "【删除记录】删除某条错误或重复记录（支持 feeding, sleep, diaper, food, growth, medical_report, vaccine, supplement；food_plan 会由后端安全拒绝）。删除前系统自动生成持久化安全快照备份，随时可撤销恢复。",
          inputSchema: {
            type: "object",
            required: ["type"],
            properties: {
              type: {
                type: "string",
                enum: ["feeding", "sleep", "diaper", "food", "growth", "medical_report", "vaccine", "food_plan", "supplement"],
                description: "要删除的记录类型",
              },
              id: { type: "string", description: "记录唯一 ID（优先提供）" },
              date: { type: "string", description: "日期 (YYYY-MM-DD，若不知 ID 则删除该日最新一条记录)" },
              clientId: { type: "string", maxLength: 200, description: "可选幂等键；重试同一删除命令时保持不变" },
            },
          },
        },
        {
          name: "restore_record",
          description:
            "【撤销删除】从数据快照中恢复刚才被删除的记录（支持指定快照 ID 或按记录类型恢复最近一条删除）。",
          inputSchema: {
            type: "object",
            properties: {
              snapshotId: { type: "string", description: "可选：指定要恢复的快照 ID" },
              entityType: {
                type: "string",
                enum: ["feeding", "sleep", "diaper", "food", "growth", "medical_report", "vaccine", "food_plan", "supplement"],
                description: "可选：指定恢复的记录类型（留空默认恢复最近一条删除）",
              },
            },
          },
        },

        // ── Knowledge & External Search Tools ──
        {
          name: "query_food_item",
          description:
            "【食材库读】从宝宝食材库中检索某食材的原始属性（推荐月龄、禁忌月龄、防噎风险、过敏原属性、加工要点、营养成分）。",
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", description: "食材名称，如'牛油果'、'鸡蛋'、'南瓜'、'三文鱼'等" },
            },
          },
        },
        {
          name: "query_book",
          description:
            "【绘本库读】从精选绘本馆检索适合宝宝月龄的绘本原始信息（书名、作者、适读月龄、评分、简介、共读建议）。",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "搜索关键词或书名" },
              month: { type: "number", description: "适读月龄 (默认宝宝当前月龄)" },
              limit: { type: "number", description: "返回条数 (1-10，默认 5)" },
            },
          },
        },
        {
          name: "query_activity",
          description:
            "【早教活动读】检索分月龄家庭早教亲子互动游戏原始项目（目标月龄、游戏名称、目标、时长、步骤、安全提示）。",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "关键词或主题" },
              month: { type: "number", description: "适龄月龄 (默认宝宝当前月龄)" },
              limit: { type: "number", description: "返回条数 (1-10，默认 5)" },
            },
          },
        },
        {
          name: "web_search",
          description:
            "【联网搜索】通过互联网实时检索最新的儿科医学科普、指南与药品说明。",
          inputSchema: {
            type: "object",
            required: ["query"],
            properties: {
              query: { type: "string", description: "搜索关键词" },
              limit: { type: "number", description: "结果条数 (1-8，默认 5)" },
            },
          },
        },

        // ── Legacy Composite Tools (Convenience & Compatibility) ──
        {
          name: "get_baby_overview",
          description:
            "【全景读(复合)】一次性获取宝宝档案与今日作息汇总、时间轴、疫苗规划及发育里程碑。",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "查询日期 (YYYY-MM-DD，留空则默认今天)" },
              includeSections: {
                type: "array",
                items: { type: "string" },
                description: "指定包含的模块 (profile, daily_summary, timeline, vaccines, nutrition, milestones)",
              },
            },
          },
        },
        {
          name: "record_baby_events",
          description:
            "【复合作息写】原子批量记录喂养、睡眠、换尿布、辅食或食谱事件。",
          inputSchema: {
            type: "object",
            properties: {
              feeding: { type: "object", description: "喂养事件" },
              sleep: { type: "object", description: "睡眠事件" },
              diaper: { type: "object", description: "换尿布事件" },
              food: { type: "object", description: "辅食事件" },
              foodPlan: { type: "object", description: "食谱计划" },
              supplement: { type: "object", description: "补剂打卡" },
            },
          },
        },
        {
          name: "record_health_measurement",
          description:
            "【复合健康写】生长测量数据、疫苗接种、化验单体检报告归档，或删除/撤销记录。",
          inputSchema: {
            type: "object",
            properties: {
              growth: { type: "object", description: "生长测量数据" },
              vaccine: { type: "object", description: "已接种疫苗" },
              medicalReport: { type: "object", description: "化验单或体检报告" },
              deleteAction: { type: "object", description: "删除某条记录" },
              undoAction: { type: "object", description: "撤销刚才的删除操作" },
            },
          },
        },
        {
          name: "query_parenting_knowledge",
          description:
            "【复合知识读】从家庭结构化知识库检索食材属性、绘本、早教游戏或产品规格档案。",
          inputSchema: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["all", "food", "book", "activity", "nutrition_product"] },
              query: { type: "string", description: "搜索关键词" },
              month: { type: "number", description: "目标月龄" },
              limit: { type: "number", description: "结果上限 (1-10)" },
            },
          },
        },
      ],
    };
  });

  // Handle Tool Calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs = {} } = request.params;
    const startTime = Date.now();

    // Sanitize arguments to prevent IDOR
    const args: any = { ...rawArgs };
    delete args.userId;
    delete args.babyId;
    delete args.familyId;
    delete args.tenantId;
    delete args.accountId;

    try {
      // ═════════════════════════════════════════════════════════════════════
      // 1. get_current_user (Identity Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_current_user") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const data = {
          user: currentUserSummary,
          sourceAgent,
          clientId: principal.clientId,
          clientName: principal.clientName || null,
          activeBaby: {
            id: baby.id,
            nickname: baby.nickname,
            gender: baby.gender,
            birthDate: baby.birthDate,
            gestationalAge: baby.gestationalAge,
          },
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 2. get_baby_profile (Profile & Caregivers Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_baby_profile") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const ageDetail = baby.birthDate ? calculateAgeDetail(baby.birthDate) : null;
          const memberLookup = await getFamilyMemberLookup(baby.familyId, accessToken);
          const data = {
            baby: {
              id: baby.id,
              familyId: baby.familyId,
              nickname: baby.nickname,
              gender: baby.gender,
              birthDate: baby.birthDate,
              gestationalAge: baby.gestationalAge,
              avatarUrl: (baby as any).avatarUrl || null,
              age: ageDetail,
            },
            family: {
              id: baby.familyId,
              name: (baby as any).familyName || null,
              members: Array.from(memberLookup.values()),
            },
            currentUser: currentUserSummary,
          };

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const [babyRecord, familyRecord, memberLookup] = await Promise.all([
          prisma.baby.findUnique({ where: { id: babyId } }),
          prisma.family.findUnique({ where: { id: baby.familyId }, select: { id: true, name: true } }),
          getFamilyMemberLookup(baby.familyId),
        ]);

        const ageDetail = baby.birthDate ? calculateAgeDetail(baby.birthDate) : null;

        const data = {
          baby: {
            id: baby.id,
            familyId: baby.familyId,
            nickname: baby.nickname,
            gender: baby.gender,
            birthDate: baby.birthDate,
            gestationalAge: baby.gestationalAge,
            avatarUrl: babyRecord?.avatarUrl || null,
            age: ageDetail,
          },
          family: {
            id: baby.familyId,
            name: familyRecord?.name || null,
            members: Array.from(memberLookup.values()),
          },
          currentUser: currentUserSummary,
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 3. get_feeding_records (Feeding Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_feeding_records") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const query = new URLSearchParams();
          if (args.date) query.set("date", args.date);
          if (args.limit) query.set("limit", String(args.limit));
          const [feedings, memberLookup] = await Promise.all([
            fetchLegacyRecordList<GrowDeskFeedingRecord>(growdeskFetch, accessToken || "", babyId, query, "feeding"),
            getFamilyMemberLookup(baby.familyId, accessToken),
          ]);
          const rawList = feedings.map((item: any) => {
            const f = fromGrowDeskFeedingRecord(item);
            return {
              id: f.id,
              timestamp: f.timestamp,
              type: f.type,
              amountMl: f.amountMl,
              leftMinutes: f.leftMinutes,
              rightMinutes: f.rightMinutes,
              spitUp: f.spitUp,
              notes: f.notes,
              formulaProductId: f.formulaProductId,
              recordedById: item.recordedById || item.userId || null,
              recordedBy: resolveRecorder(item.recordedById || item.userId, memberLookup, principal),
              source: f.source,
              sourceAgent: f.sourceAgent,
              createdAt: f.createdAt,
            };
          });

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const [feedings, memberLookup] = await Promise.all([
          records.getFeedingRecords(recCtx, { date: args.date, limit: args.limit }),
          getFamilyMemberLookup(baby.familyId),
        ]);

        const rawList = feedings.map((f) => ({
          id: f.id,
          timestamp: f.timestamp,
          type: f.type,
          amountMl: f.amountMl,
          leftMinutes: f.leftMinutes,
          rightMinutes: f.rightMinutes,
          spitUp: f.spitUp,
          notes: f.notes,
          formulaProductId: f.formulaProductId,
          recordedById: f.recordedById,
          recordedBy: resolveRecorder(f.recordedById, memberLookup, principal),
          source: f.source,
          sourceAgent: f.sourceAgent,
          createdAt: f.createdAt,
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 4. get_sleep_records (Sleep Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_sleep_records") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const query = new URLSearchParams();
          if (args.date) query.set("date", args.date);
          if (args.limit) query.set("limit", String(args.limit));
          const [sleeps, memberLookup] = await Promise.all([
            fetchLegacyRecordList<GrowDeskSleepRecord>(growdeskFetch, accessToken || "", babyId, query, "sleep"),
            getFamilyMemberLookup(baby.familyId, accessToken),
          ]);
          const rawList = sleeps.map((item: any) => {
            const s = fromGrowDeskSleepRecord(item);
            return {
              id: s.id,
              startTime: s.startTime,
              endTime: s.endTime,
              type: s.type,
              nightWakingCount: s.nightWakingCount,
              notes: s.notes,
              recordedById: item.recordedById || item.userId || null,
              recordedBy: resolveRecorder(item.recordedById || item.userId, memberLookup, principal),
              source: s.source,
              sourceAgent: s.sourceAgent,
              createdAt: s.createdAt,
            };
          });

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const [sleeps, memberLookup] = await Promise.all([
          records.getSleepRecords(recCtx, { date: args.date, limit: args.limit }),
          getFamilyMemberLookup(baby.familyId),
        ]);

        const rawList = sleeps.map((s) => ({
          id: s.id,
          startTime: s.startTime,
          endTime: s.endTime,
          type: s.type,
          nightWakingCount: s.nightWakingCount,
          notes: s.notes,
          recordedById: s.recordedById,
          recordedBy: resolveRecorder(s.recordedById, memberLookup, principal),
          source: s.source,
          sourceAgent: s.sourceAgent,
          createdAt: s.createdAt,
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 5. get_diaper_records (Diaper Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_diaper_records") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const query = new URLSearchParams();
          if (args.date) query.set("date", args.date);
          if (args.limit) query.set("limit", String(args.limit));
          const [diapers, memberLookup] = await Promise.all([
            fetchLegacyRecordList<GrowDeskDiaperRecord>(growdeskFetch, accessToken || "", babyId, query, "diaper"),
            getFamilyMemberLookup(baby.familyId, accessToken),
          ]);
          const rawList = diapers.map((item: any) => {
            const d = fromGrowDeskDiaperRecord(item);
            return {
              id: d.id,
              timestamp: d.timestamp,
              type: d.type,
              poopColor: d.poopColor,
              poopConsistency: d.poopConsistency,
              notes: d.notes,
              recordedById: item.recordedById || item.userId || null,
              recordedBy: resolveRecorder(item.recordedById || item.userId, memberLookup, principal),
              source: d.source,
              sourceAgent: d.sourceAgent,
              createdAt: d.createdAt,
            };
          });

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const [diapers, memberLookup] = await Promise.all([
          records.getDiaperRecords(recCtx, { date: args.date, limit: args.limit }),
          getFamilyMemberLookup(baby.familyId),
        ]);

        const rawList = diapers.map((d) => ({
          id: d.id,
          timestamp: d.timestamp,
          type: d.type,
          poopColor: d.poopColor,
          poopConsistency: d.poopConsistency,
          notes: d.notes,
          recordedById: d.recordedById,
          recordedBy: resolveRecorder(d.recordedById, memberLookup, principal),
          source: d.source,
          sourceAgent: d.sourceAgent,
          createdAt: d.createdAt,
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 6. get_food_records (Food Log Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_food_records") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const query = new URLSearchParams();
          if (args.date) query.set("date", args.date);
          if (args.limit) query.set("limit", String(args.limit));
          const [foods, memberLookup] = await Promise.all([
            fetchLegacyRecordList<GrowDeskFoodRecord>(growdeskFetch, accessToken || "", babyId, query, "food"),
            getFamilyMemberLookup(baby.familyId, accessToken),
          ]);
          const rawList = foods.map((item: any) => {
            const fd = fromGrowDeskFoodRecord(item);
            return {
              id: fd.id,
              date: fd.date,
              time: fd.time,
              foods: fd.foods,
              portion: fd.portion,
              acceptance: (fd as any).acceptance || fd.reaction || null,
              babyState: (fd as any).babyState || null,
              hasAbnormal: (fd as any).hasAbnormal || false,
              abnormalNotes: (fd as any).abnormalNotes || null,
              recordedById: item.recordedById || item.userId || null,
              recordedBy: resolveRecorder(item.recordedById || item.userId, memberLookup, principal),
              source: fd.source,
              sourceAgent: fd.sourceAgent,
              createdAt: fd.createdAt,
            };
          });

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const [foods, memberLookup] = await Promise.all([
          records.getFoodLogRecords(recCtx, { date: args.date, limit: args.limit }),
          getFamilyMemberLookup(baby.familyId),
        ]);

        const rawList = foods.map((fd) => ({
          id: fd.id,
          date: fd.date,
          time: fd.time,
          foods: fd.foods,
          portion: fd.portion,
          acceptance: fd.acceptance,
          babyState: fd.babyState,
          hasAbnormal: fd.hasAbnormal,
          abnormalNotes: fd.abnormalNotes,
          recordedById: fd.recordedById,
          recordedBy: resolveRecorder(fd.recordedById, memberLookup, principal),
          source: fd.source,
          sourceAgent: fd.sourceAgent,
          createdAt: fd.createdAt,
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 7. get_growth_records (Growth Measurement Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_growth_records") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const limit = typeof args.limit === "number" ? Math.min(100, Math.max(1, args.limit)) : 50;
          const [res, memberLookup] = await Promise.all([
            growdeskFetch<GrowDeskGrowthRecord[]>(`/api/v1/babies/${babyId}/growth-measurements?limit=${limit}`, { accessToken }),
            getFamilyMemberLookup(baby.familyId, accessToken),
          ]);
          const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
          let filtered = list;
          if (args.date) {
            filtered = filtered.filter((g: any) => (g.measurementDate || g.date) === args.date);
          }
          const rawList = filtered.slice(0, limit).map((item: any) => {
            const g = fromGrowDeskGrowthRecord(item);
            return {
              id: g.id,
              date: g.date,
              ageInMonths: (g as any).ageInMonths ?? null,
              ageLabel: (g as any).ageLabel ?? null,
              weightKg: g.weightKg ?? g.weight ?? null,
              heightCm: g.heightCm ?? g.height ?? null,
              headCircumferenceCm: g.headCircumferenceCm ?? g.headCircumference ?? null,
              percentile: (g as any).percentile ?? null,
              imageUrl: (g as any).imageUrl ?? null,
              recordedById: item.recordedById || item.userId || null,
              recordedBy: resolveRecorder(item.recordedById || item.userId, memberLookup, principal),
              source: g.source,
              sourceAgent: g.sourceAgent,
              createdAt: g.createdAt,
            };
          });

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const [growths, memberLookup] = await Promise.all([
          records.getGrowthMeasurements(recCtx, { date: args.date, limit: args.limit }),
          getFamilyMemberLookup(baby.familyId),
        ]);

        const rawList = growths.map((g) => ({
          id: g.id,
          date: g.date,
          ageInMonths: g.ageInMonths,
          ageLabel: g.ageLabel,
          weightKg: g.weightKg,
          heightCm: g.heightCm,
          headCircumferenceCm: g.headCircumferenceCm,
          percentile: g.percentile,
          imageUrl: g.imageUrl,
          recordedById: g.recordedById,
          recordedBy: resolveRecorder(g.recordedById, memberLookup, principal),
          source: g.source,
          sourceAgent: g.sourceAgent,
          createdAt: g.createdAt,
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 8. get_medical_reports (Medical Reports & Exams Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_medical_reports") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const limit = typeof args.limit === "number" ? Math.min(100, Math.max(1, args.limit)) : 50;
          const [res, memberLookup] = await Promise.all([
            growdeskFetch<GrowDeskMedicalReport[]>(`/api/v1/babies/${babyId}/medical/reports?limit=${limit}`, { accessToken }),
            getFamilyMemberLookup(baby.familyId, accessToken),
          ]);
          const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
          let legacyList = list.map(fromGrowDeskMedicalRecord);
          if (args.category && args.category !== "all") {
            legacyList = legacyList.filter((r: any) => r.category === args.category);
          }
          if (args.date) {
            legacyList = legacyList.filter((r: any) => r.date === args.date);
          }
          const rawList = legacyList.slice(0, limit).map((r: any) => ({
            id: r.id,
            title: r.title,
            category: r.category,
            date: r.date,
            hospital: r.hospital,
            doctorNotes: r.doctorNotes,
            items: r.items,
            imageUrl: r.imageUrl,
            recordedById: r.recordedById,
            recordedBy: resolveRecorder(r.recordedById, memberLookup, principal),
            source: r.source,
            sourceAgent: r.sourceAgent,
            createdAt: r.createdAt,
          }));

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const [reports, memberLookup] = await Promise.all([
          records.getMedicalReports(recCtx, { category: args.category, date: args.date, limit: args.limit }),
          getFamilyMemberLookup(baby.familyId),
        ]);

        const rawList = reports.map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          date: r.date,
          hospital: r.hospital,
          doctorNotes: r.doctorNotes,
          items: r.items,
          imageUrl: r.imageUrl,
          recordedById: r.recordedById,
          recordedBy: resolveRecorder(r.recordedById, memberLookup, principal),
          source: r.source,
          sourceAgent: r.sourceAgent,
          createdAt: r.createdAt,
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 9. get_medical_report_detail (Single Report Full Detail Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_medical_report_detail") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const targetId = typeof args.id === "string" ? args.id.trim() : "";
        if (!targetId) throw new Error("请提供报告 ID (id)");

        if (GROWDESK_CONFIG.enabled) {
          const [res, memberLookup] = await Promise.all([
            growdeskFetch<GrowDeskMedicalReport>(`/api/v1/babies/${babyId}/medical-reports/${targetId}`, { accessToken }),
            getFamilyMemberLookup(baby.familyId, accessToken),
          ]);
          if (!res.ok || !res.data) {
            throw new McpError(ErrorCode.InvalidRequest, "未找到指定的化验单/体检报告");
          }
          const report = fromGrowDeskMedicalRecord(res.data);
          const data = {
            id: report.id,
            title: report.title,
            category: report.category,
            date: report.date,
            hospital: report.hospital,
            doctorNotes: report.doctorNotes,
            items: report.items,
            imageUrl: report.imageUrl,
            recordedById: (report as any).recordedById || (res.data as any).userId || null,
            recordedBy: resolveRecorder((report as any).recordedById || (res.data as any).userId, memberLookup, principal),
            source: (report as any).source || "mcp",
            sourceAgent: (report as any).sourceAgent || sourceAgent,
            createdAt: report.createdAt,
            updatedAt: report.updatedAt,
          };

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const [report, memberLookup] = await Promise.all([
          prisma.medicalReport.findUnique({ where: { id: targetId } }),
          getFamilyMemberLookup(baby.familyId),
        ]);

        if (!report || report.babyId !== babyId) {
          throw new McpError(ErrorCode.InvalidRequest, "未找到指定的化验单/体检报告");
        }

        const data = {
          id: report.id,
          title: report.title,
          category: report.category,
          date: report.date,
          hospital: report.hospital,
          doctorNotes: report.doctorNotes,
          items: safeJsonParse(report.itemsJson, []),
          imageUrl: report.imageUrl,
          recordedById: report.recordedById,
          recordedBy: resolveRecorder(report.recordedById, memberLookup, principal),
          source: report.source,
          sourceAgent: report.sourceAgent,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 10. get_baby_photos (All Visual Photos/Images Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_baby_photos") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const [photos, memberLookup] = await Promise.all([
          getBabyPhotos(babyId, args.type, args.limit || 50),
          getFamilyMemberLookup(baby.familyId),
        ]);

        const rawList = photos.map((p) => ({
          ...p,
          recordedBy: resolveRecorder(p.recordedById, memberLookup, principal),
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 11. get_vaccine_records (Vaccine Records Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_vaccine_records") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const limit = typeof args.limit === "number" ? Math.min(100, Math.max(1, args.limit)) : 50;

        if (GROWDESK_CONFIG.enabled) {
          const res = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/vaccines/records?limit=${limit}`, { accessToken });
          const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
          const rawList = list.slice(0, limit).map((v: any) => {
            const rec = fromGrowDeskVaccineRecord(v);
            return {
              id: rec.id,
              name: rec.name,
              dose: rec.dose,
              scheduledDate: rec.scheduledDate,
              completedDate: rec.completedDate,
              isCompleted: rec.isCompleted,
            };
          });

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const recordsList = await prisma.vaccineRecord.findMany({
          where: { babyId },
          orderBy: [{ scheduledDate: "desc" }],
          take: limit,
        });

        const rawList = recordsList.map((v) => ({
          id: v.id,
          name: v.name,
          dose: v.dose,
          scheduledDate: v.scheduledDate,
          completedDate: v.completedDate,
          isCompleted: v.isCompleted,
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 12. get_vaccine_schedule (Vaccine Schedule Guidelines Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_vaccine_schedule") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const ageDetail = baby.birthDate ? calculateAgeDetail(baby.birthDate) : null;
        const currentMonth = ageDetail?.months || 6;
        const maxMonths = typeof args.maxAgeMonths === "number" ? args.maxAgeMonths : currentMonth + 3;

        if (GROWDESK_CONFIG.enabled) {
          const fullKb = loadFullVaccineKnowledge("CN-JS");
          const scheduleList = (fullKb?.schedule || [])
            .filter((e: any) => (e.ageMonths ?? 0) <= maxMonths)
            .sort((a: any, b: any) => (a.ageMonths ?? 0) - (b.ageMonths ?? 0))
            .slice(0, 30);
          const rawList = scheduleList.map((e: any) => ({
            ageMonths: e.ageMonths,
            ageLabel: e.ageLabel,
            doseNumber: e.doseNumber,
            vaccineName: e.vaccineName || e.name || e.vaccineId,
            programType: e.programType,
            isOptional: e.isOptional,
            notes: e.notes,
          }));

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const [entries, vaccines] = await Promise.all([
          prisma.vaccineScheduleEntry.findMany({
            where: { ageMonths: { lte: maxMonths } },
            orderBy: [{ ageMonths: "asc" }, { doseNumber: "asc" }],
            take: 30,
          }),
          prisma.vaccine.findMany({
            select: { id: true, vaccineId: true, name: true, shortName: true, programType: true },
          }),
        ]);

        const byUuid = new Map(vaccines.map((v) => [v.id, v]));
        const byCode = new Map(vaccines.map((v) => [v.vaccineId, v]));

        const rawList = entries.map((e) => {
          const v = byUuid.get(e.vaccineId) || byCode.get(e.vaccineId);
          return {
            ageMonths: e.ageMonths,
            ageLabel: e.ageLabel,
            doseNumber: e.doseNumber,
            vaccineName: v?.shortName || v?.name || e.vaccineId,
            programType: v?.programType,
            isOptional: e.isOptional,
            notes: e.notes,
          };
        });

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 13. get_supplement_records (Supplement Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_supplement_records") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const limit = typeof args.limit === "number" ? Math.min(100, Math.max(1, args.limit)) : 50;

        if (GROWDESK_CONFIG.enabled) {
          const [res, memberLookup] = await Promise.all([
            growdeskFetch<any[]>(`/api/v1/babies/${babyId}/records/supplement?limit=${limit}`, { accessToken }),
            getFamilyMemberLookup(baby.familyId, accessToken),
          ]);
          const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
          let filtered = list;
          if (args.date) {
            filtered = filtered.filter((s: any) => {
              const dStr = s.occurredAt ? s.occurredAt.slice(0, 10) : s.date;
              return dStr === args.date;
            });
          }
          const rawList = filtered.slice(0, limit).map((s: any) => {
            const rec = fromGrowDeskSupplementRecord(s);
            const d = s.occurredAt ? new Date(s.occurredAt) : null;
            const timeStr = d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "08:00";
            return {
              id: rec.id,
              date: (s.occurredAt ? s.occurredAt.slice(0, 10) : rec.timestamp?.slice(0, 10)) || getLocalDateStr(),
              time: timeStr,
              productId: (rec as any).productId || s.productId || null,
              productName: rec.supplementName || rec.name,
              brand: (rec as any).brand || "家庭自选",
              dose: s.amount ? Number(s.amount) || 1 : 1,
              unitName: (rec as any).unitName || "粒",
              notes: rec.notes,
              recordedById: s.recordedById || s.userId || null,
              recordedBy: resolveRecorder(s.recordedById || s.userId, memberLookup, principal),
              source: rec.source,
              sourceAgent: rec.sourceAgent,
              createdAt: rec.createdAt,
            };
          });

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const where: any = { babyId };
        if (args.date) {
          if (!isValidDateStr(args.date)) throw new Error("date 必须为有效的 YYYY-MM-DD 格式");
          where.date = args.date;
        }

        const [supplements, memberLookup] = await Promise.all([
          prisma.supplementRecord.findMany({
            where,
            include: { product: true },
            orderBy: [{ date: "desc" }, { time: "desc" }],
            take: limit,
          }),
          getFamilyMemberLookup(baby.familyId),
        ]);

        const rawList = supplements.map((s) => ({
          id: s.id,
          date: s.date,
          time: s.time,
          productId: s.productId,
          productName: s.product?.name,
          brand: s.product?.brand,
          dose: s.dose,
          unitName: s.unitName || s.product?.unitName,
          notes: s.notes,
          recordedById: s.recordedById,
          recordedBy: resolveRecorder(s.recordedById, memberLookup, principal),
          source: s.source,
          sourceAgent: s.sourceAgent,
          createdAt: s.createdAt,
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 14. get_food_plans (Food Plans Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_food_plans") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const limit = typeof args.limit === "number" ? Math.min(20, Math.max(1, args.limit)) : 5;

        if (GROWDESK_CONFIG.enabled) {
          const res = await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, { accessToken });
          const planData = res.data?.data?.planData || res.data?.planData || res.data;
          let plans: any[] = [];
          if (Array.isArray(planData)) {
            plans = planData;
          } else if (planData && typeof planData === "object" && Object.keys(planData).length > 0) {
            plans = [planData];
          }
          if (args.date) {
            plans = plans.filter((p: any) => p.date === args.date);
          }
          const rawList = plans.slice(0, limit).map((p: any) => ({
            id: p.id || `fp_${babyId}`,
            date: p.date || getLocalDateStr(),
            name: p.name || "辅食食谱",
            ingredients: Array.isArray(p.ingredients) ? p.ingredients : safeJsonParse(p.ingredients, []),
            steps: Array.isArray(p.steps) ? p.steps : safeJsonParse(p.steps, []),
            nutrition: p.nutrition || "",
            tags: Array.isArray(p.tags) ? p.tags : safeJsonParse(p.tags, []),
            createdAt: p.createdAt || new Date().toISOString(),
          }));

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const where: any = { babyId };
        if (args.date) {
          if (!isValidDateStr(args.date)) throw new Error("date 必须为有效的 YYYY-MM-DD 格式");
          where.date = args.date;
        }

        const plans = await prisma.foodPlan.findMany({
          where,
          orderBy: { date: "desc" },
          take: limit,
        });

        const rawList = plans.map((p) => ({
          id: p.id,
          date: p.date,
          name: p.name,
          ingredients: safeJsonParse(p.ingredients, []),
          steps: safeJsonParse(p.steps, []),
          nutrition: p.nutrition,
          tags: safeJsonParse(p.tags, []),
          createdAt: p.createdAt,
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 15. get_daily_summary (Daily Aggregate Stats Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_daily_summary") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        if (args.date && !isValidDateStr(args.date)) {
          throw new Error("date 必须为有效的 YYYY-MM-DD 格式");
        }
        const targetDate = args.date || getLocalDateStr();

        if (GROWDESK_CONFIG.enabled) {
          const dateQuery = new URLSearchParams({ date: targetDate });
          const [feedings, sleeps, diapers, foods] = await Promise.all([
            fetchLegacyRecordList<GrowDeskFeedingRecord>(growdeskFetch, accessToken || "", babyId, dateQuery, "feeding"),
            fetchLegacyRecordList<GrowDeskSleepRecord>(growdeskFetch, accessToken || "", babyId, dateQuery, "sleep"),
            fetchLegacyRecordList<GrowDeskDiaperRecord>(growdeskFetch, accessToken || "", babyId, dateQuery, "diaper"),
            fetchLegacyRecordList<GrowDeskFoodRecord>(growdeskFetch, accessToken || "", babyId, dateQuery, "food"),
          ]);
          const legacyFeedings = feedings.map(fromGrowDeskFeedingRecord);
          const legacySleeps = sleeps.map(fromGrowDeskSleepRecord);
          const totalFeedingMl = legacyFeedings.reduce((sum, f) => sum + (f.amountMl || 0), 0);
          let totalSleepMinutes = 0;
          for (const s of legacySleeps) {
            if (s.startTime && s.endTime) {
              const diff = new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
              if (diff > 0) totalSleepMinutes += Math.round(diff / 60000);
            }
          }
          const summary = {
            date: targetDate,
            totalFeedingMl,
            totalSleepMinutes,
            diaperCount: diapers.length,
            foodCount: foods.length,
          };

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
        }

        const summary = await records.getDailySummary(recCtx, targetDate);

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 16. get_development_milestones (Milestone Standards Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_development_milestones") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const ageDetail = baby.birthDate ? calculateAgeDetail(baby.birthDate) : null;
        const currentMonth = typeof args.month === "number" ? Math.max(1, Math.min(36, args.month)) : ageDetail?.months || 6;
        const category = typeof args.category === "string" ? args.category : undefined;

        if (GROWDESK_CONFIG.enabled) {
          const all = getMilestonesData();
          let filtered = all.filter((m: any) => m.assessmentAgeMonths === currentMonth);
          if (category) {
            filtered = filtered.filter((m: any) => m.category === category);
          }
          const rawList = filtered.slice(0, 20).map((m: any) => ({
            milestoneId: m.milestoneId,
            category: m.category,
            assessmentAgeMonths: m.assessmentAgeMonths,
            title: m.title,
            description: m.description,
            observationMethod: m.observationMethod,
          }));

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const milestones = await prisma.developmentMilestone.findMany({
          where: {
            assessmentAgeMonths: currentMonth,
            ...(category ? { category } : {}),
          },
          take: 20,
        });

        const rawList = milestones.map((m) => ({
          milestoneId: m.milestoneId,
          category: m.category,
          assessmentAgeMonths: m.assessmentAgeMonths,
          title: m.title,
          description: m.description,
          observationMethod: m.observationMethod,
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 17. record_feeding (Single Feeding Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_feeding") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        const feedingType = args.type || "formula";
        const formulaProductId = await resolveFormulaProductId(
          recCtx.familyId,
          feedingType,
          args.formulaProductId,
          args.formulaName,
          accessToken
        );

        if (GROWDESK_CONFIG.enabled) {
          const timestamp = args.timestamp || new Date().toISOString();
          const payload = toGrowDeskFeedingCreatePayload({
            babyId,
            type: feedingType,
            amountMl: args.amountMl,
            leftMinutes: args.leftMinutes,
            rightMinutes: args.rightMinutes,
            spitUp: args.spitUp,
            notes: args.notes,
            timestamp,
            formulaProductId: formulaProductId || undefined,
            source: "mcp",
            sourceAgent,
          });
          const res = await growdeskFetch<GrowDeskFeedingRecord>(recordPath("feeding", babyId), {
            method: "POST",
            accessToken,
            body: payload,
          });
          const created = requireWriteData(res, "Failed to create feeding record");
          const result = fromGrowDeskFeedingRecord(created);
          const data = {
            success: true,
            action: "record_feeding",
            record: {
              ...result,
              recordedBy: currentUserSummary,
            },
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const result = await records.createFeeding(recCtx, {
          type: feedingType,
          amountMl: args.amountMl,
          leftMinutes: args.leftMinutes,
          rightMinutes: args.rightMinutes,
          spitUp: args.spitUp,
          notes: args.notes,
          timestamp: args.timestamp,
          formulaProductId: formulaProductId || undefined,
        });

        const data = {
          success: true,
          action: "record_feeding",
          record: {
            ...result,
            recordedBy: currentUserSummary,
          },
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 18. record_sleep (Single Sleep Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_sleep") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const date = args.date && isValidDateStr(args.date) ? args.date : getLocalDateStr();
          const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
          let startIso = args.startTime;
          if (typeof startIso === "string" && TIME_RE.test(startIso.trim())) {
            startIso = localTimeToUtcIso(startIso.trim(), date);
          }
          let endIso = args.endTime;
          if (typeof endIso === "string" && TIME_RE.test(endIso.trim())) {
            endIso = localTimeToUtcIso(endIso.trim(), date);
          }
          const sleepType = args.type === "day" ? "nap" : (args.type || "nap");
          const payload = toGrowDeskSleepCreatePayload({
            babyId,
            startedAt: startIso,
            endedAt: endIso,
            sleepType,
            nightWakingCount: args.nightWakingCount,
            notes: args.notes,
            source: "mcp",
            sourceAgent,
          });
          const res = await growdeskFetch<GrowDeskSleepRecord>(recordPath("sleep", babyId), {
            method: "POST",
            accessToken,
            body: payload,
          });
          const created = requireWriteData(res, "Failed to create sleep record");
          const result = fromGrowDeskSleepRecord(created);
          const data = {
            success: true,
            action: "record_sleep",
            record: {
              ...result,
              recordedBy: currentUserSummary,
            },
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const result = await records.createSleep(recCtx, {
          startTime: args.startTime,
          endTime: args.endTime,
          type: args.type,
          nightWakingCount: args.nightWakingCount,
          notes: args.notes,
          date: args.date,
        });

        const data = {
          success: true,
          action: "record_sleep",
          record: {
            ...result,
            recordedBy: currentUserSummary,
          },
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 19. record_diaper (Single Diaper Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_diaper") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          let ts = args.timestamp;
          if (!ts) {
            ts = new Date().toISOString();
          } else if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(ts).trim())) {
            ts = localTimeToUtcIso(String(ts).trim(), getLocalDateStr());
          }
          const payload = toGrowDeskDiaperCreatePayload({
            babyId,
            type: args.type || "pee",
            poopColor: args.poopColor,
            poopConsistency: args.poopConsistency,
            notes: args.notes,
            timestamp: ts,
            source: "mcp",
            sourceAgent,
          });
          const res = await growdeskFetch<GrowDeskDiaperRecord>(recordPath("diaper", babyId), {
            method: "POST",
            accessToken,
            body: payload,
          });
          const created = requireWriteData(res, "Failed to create diaper record");
          const result = fromGrowDeskDiaperRecord(created);
          const data = {
            success: true,
            action: "record_diaper",
            record: {
              ...result,
              recordedBy: currentUserSummary,
            },
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const result = await records.createDiaper(recCtx, {
          type: args.type || "pee",
          poopColor: args.poopColor,
          poopConsistency: args.poopConsistency,
          notes: args.notes,
          timestamp: args.timestamp,
        });

        const data = {
          success: true,
          action: "record_diaper",
          record: {
            ...result,
            recordedBy: currentUserSummary,
          },
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 20. record_food (Single Food Log Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_food") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const payload = toGrowDeskFoodCreatePayload({
            babyId,
            foods: args.foods,
            date: args.date,
            time: args.time,
            portion: args.portion,
            acceptance: args.acceptance,
            babyState: args.babyState,
            hasAbnormal: args.hasAbnormal,
            abnormalNotes: args.abnormalNotes,
            source: "mcp",
            sourceAgent,
          });
          const res = await growdeskFetch<GrowDeskFoodRecord>(recordPath("food", babyId), {
            method: "POST",
            accessToken,
            body: payload,
          });
          const created = requireWriteData(res, "Failed to create food record");
          const result = fromGrowDeskFoodRecord(created);
          const data = {
            success: true,
            action: "record_food",
            record: {
              ...result,
              recordedBy: currentUserSummary,
            },
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const result = await records.createFoodLog(recCtx, {
          foods: args.foods,
          date: args.date,
          time: args.time,
          portion: args.portion,
          acceptance: args.acceptance,
          babyState: args.babyState,
          hasAbnormal: args.hasAbnormal,
          abnormalNotes: args.abnormalNotes,
        });

        const data = {
          success: true,
          action: "record_food",
          record: {
            ...result,
            recordedBy: currentUserSummary,
          },
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 21. record_growth (Single Growth Measurement Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_growth") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const payload = toGrowDeskGrowthCreatePayload({
            babyId,
            date: args.date || getLocalDateStr(),
            weightKg: args.weightKg,
            heightCm: args.heightCm,
            headCircumferenceCm: args.headCircumferenceCm,
            imageUrl: args.imageUrl,
          });
          const res = await growdeskFetch<GrowDeskGrowthRecord>(`/api/v1/babies/${babyId}/growth-measurements`, {
            method: "POST",
            accessToken,
            body: payload,
          });
          const created = requireWriteData(res, "Failed to create growth measurement");
          const result = fromGrowDeskGrowthRecord(created);
          const data = {
            success: true,
            action: "record_growth",
            record: {
              ...result,
              recordedBy: currentUserSummary,
            },
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const result = await records.createGrowth(recCtx, {
          date: args.date || getLocalDateStr(),
          weightKg: args.weightKg,
          heightCm: args.heightCm,
          headCircumferenceCm: args.headCircumferenceCm,
          imageUrl: args.imageUrl,
        });

        const data = {
          success: true,
          action: "record_growth",
          record: {
            ...result,
            recordedBy: currentUserSummary,
          },
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 22. record_vaccine (Single Vaccine Record Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_vaccine") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        const vName = String(args.name || "").trim();
        if (!vName) throw new Error("请输入疫苗名称");
        const dose = String(args.dose || "第1剂").trim();
        const completedDate = args.completedDate && isValidDateStr(args.completedDate) ? args.completedDate : getLocalDateStr();

        if (GROWDESK_CONFIG.enabled) {
          const payload = toGrowDeskVaccineRecordPayload({
            babyId,
            name: vName,
            dose,
            scheduledDate: completedDate,
            completedDate,
            isCompleted: true,
          });
          const res = await growdeskFetch<GrowDeskVaccineRecord>(`/api/v1/babies/${babyId}/vaccines/records`, {
            method: "POST",
            accessToken,
            body: payload,
          });
          const created = requireWriteData(res, "Failed to record vaccine");
          const record = fromGrowDeskVaccineRecord(created);
          const data = {
            success: true,
            action: "record_vaccine",
            record: {
              ...record,
              recordedBy: currentUserSummary,
            },
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const record = await prisma.vaccineRecord.create({
          data: {
            babyId,
            name: vName,
            dose,
            scheduledDate: completedDate,
            completedDate,
            isCompleted: true,
          },
        });

        // Sync vaccine selection
        const doseMatch = dose.match(/\d+/);
        const doseNum = doseMatch ? parseInt(doseMatch[0], 10) : 1;
        const allVaccines = await prisma.vaccine.findMany();
        const matched = allVaccines.find((v) => v.name.includes(vName) || vName.includes(v.name));
        if (matched) {
          await prisma.vaccineSelection.upsert({
            where: {
              babyId_vaccineId_doseNumber: {
                babyId,
                vaccineId: matched.vaccineId,
                doseNumber: doseNum,
              },
            },
            create: {
              babyId,
              vaccineId: matched.vaccineId,
              doseNumber: doseNum,
              selected: true,
              completed: true,
            },
            update: {
              selected: true,
              completed: true,
            },
          }).catch(() => {});
        }

        const data = {
          success: true,
          action: "record_vaccine",
          record: {
            ...record,
            recordedBy: currentUserSummary,
          },
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 23. record_medical_report (Medical Report Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_medical_report") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        const title = String(args.title || "").trim().slice(0, 100);
        if (!title) throw new Error("请填写报告标题");
        const category = String(args.category || "general");
        if (args.date && !isValidDateStr(args.date)) {
          throw new Error("date 必须为有效的 YYYY-MM-DD 格式");
        }
        const date = args.date || getLocalDateStr();
        const hospital = args.hospital ? String(args.hospital).slice(0, 100) : null;
        const doctorNotes = args.doctorNotes ? String(args.doctorNotes).slice(0, 1000) : null;

        const rawImageUrl = args.imageUrl ? String(args.imageUrl).trim() : null;
        let imageUrl: string | null = null;
        if (rawImageUrl) {
          if (!/^\/uploads\/(avatars|medical|growth)\/[^/]+\.(jpg|jpeg|png|webp|heic)$/i.test(rawImageUrl)) {
            throw new Error("imageUrl 仅支持本站 /uploads/ 路径的合法图片 (jpg/jpeg/png/webp/heic)");
          }
          imageUrl = rawImageUrl.slice(0, 500);
        }

        let items: any[] = [];
        if (Array.isArray(args.items)) {
          items = args.items;
        } else if (typeof args.items === "string") {
          items = safeJsonParse(args.items, []);
        }
        items = Array.isArray(items) ? items.slice(0, 40) : [];

        if (GROWDESK_CONFIG.enabled) {
          const payload = toGrowDeskMedicalCreatePayload({
            babyId,
            title,
            category,
            date,
            hospital,
            doctorNotes,
            imageUrl,
            items,
            source: "mcp",
            sourceAgent,
          });
          const res = await growdeskFetch<GrowDeskMedicalReport>(`/api/v1/babies/${babyId}/medical/reports`, {
            method: "POST",
            accessToken,
            body: payload,
          });
          const created = requireWriteData(res, "Failed to record medical report");
          const record = fromGrowDeskMedicalRecord(created);
          const data = {
            success: true,
            action: "record_medical_report",
            record: {
              ...record,
              items,
              recordedBy: currentUserSummary,
            },
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const record = await prisma.medicalReport.create({
          data: {
            babyId,
            recordedById: principal.userId,
            source: "mcp",
            sourceAgent,
            title,
            category,
            date,
            hospital,
            doctorNotes,
            imageUrl,
            itemsJson: JSON.stringify(items),
          },
        });

        const data = {
          success: true,
          action: "record_medical_report",
          record: {
            ...record,
            items,
            recordedBy: currentUserSummary,
          },
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 24. record_supplement (Supplement Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_supplement") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        const suppName = String(args.name || "").trim();
        if (!suppName) throw new Error("请提供补剂名称");
        const dose = typeof args.dose === "number" && Number.isFinite(args.dose) && args.dose > 0 && args.dose <= 100 ? args.dose : 1.0;
        const unitName = args.unitName ? String(args.unitName).trim() : "粒";
        if (args.date && !isValidDateStr(args.date)) {
          throw new Error("date 必须为有效的 YYYY-MM-DD 格式");
        }
        const recordDate = args.date || getLocalDateStr();
        const recordTime = args.time && /^([01]\d|2[0-3]):([0-5]\d)$/.test(args.time) ? args.time : getLocalTimeStr();

        if (GROWDESK_CONFIG.enabled) {
          const occurredAt = localTimeToUtcIso(recordTime, recordDate);
          const formattedAmount = formatSupplementAmount(dose, unitName);
          const res = await growdeskFetch<GrowDeskSupplementRecord>(`/api/v1/babies/${babyId}/records/supplement`, {
            method: "POST",
            accessToken,
            body: {
              supplementName: suppName,
              occurredAt,
              amount: formattedAmount,
              notes: args.notes ? String(args.notes).trim() : null,
            },
          });
          const created = requireWriteData(res, "Failed to record supplement");
          const record = fromGrowDeskSupplementRecord(created);
          const data = {
            success: true,
            action: "record_supplement",
            record: {
              id: record.id,
              date: recordDate,
              time: recordTime,
              productName: suppName,
              brand: "家庭自选",
              dose,
              unitName,
              notes: args.notes ? String(args.notes).trim() : null,
              recordedById: principal.userId,
              recordedBy: currentUserSummary,
              source: "mcp",
              sourceAgent,
              createdAt: record.createdAt,
            },
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        let suppProduct = await prisma.supplementProduct.findFirst({
          where: {
            familyId: baby.familyId,
            name: { contains: suppName },
            isActive: true,
          },
        });

        if (!suppProduct) {
          suppProduct = await prisma.supplementProduct.create({
            data: {
              familyId: baby.familyId,
              name: suppName,
              brand: "家庭自选",
              dosageForm: "drops",
              unitName,
              defaultDose: dose,
              nutrientsJson: JSON.stringify({}),
              isActive: true,
            },
          });
        }

        const record = await prisma.supplementRecord.create({
          data: {
            babyId,
            productId: suppProduct.id,
            recordedById: principal.userId,
            source: "mcp",
            sourceAgent,
            date: recordDate,
            time: recordTime,
            dose,
            unitName: unitName || suppProduct.unitName,
            notes: args.notes ? String(args.notes).trim() : null,
          },
          include: { product: true },
        });

        const data = {
          success: true,
          action: "record_supplement",
          record: {
            id: record.id,
            date: record.date,
            time: record.time,
            productName: suppProduct.name,
            brand: suppProduct.brand,
            dose: record.dose,
            unitName: record.unitName,
            notes: record.notes,
            recordedById: record.recordedById,
            recordedBy: currentUserSummary,
            source: record.source,
            sourceAgent: record.sourceAgent,
            createdAt: record.createdAt,
          },
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      if (name === "create_supplement_product") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }
        const suppName = String(args.name || "").trim();
        if (!suppName) throw new Error("请提供补剂名称");
        const brand = String(args.brand || "家庭自选").trim() || "家庭自选";
        const dosageForm = String(args.dosageForm || "drops").trim();
        const unitName = String(args.unitName || "滴").trim() || "滴";
        const defaultDose = typeof args.defaultDose === "number" && Number.isFinite(args.defaultDose) && args.defaultDose > 0 ? args.defaultDose : 1;
        const notes = typeof args.notes === "string" && args.notes.trim() ? args.notes.trim() : null;
        const nutrients = normalizeNutrients(args.nutrients);

        let product: unknown;
        if (GROWDESK_CONFIG.enabled) {
          const response = await growdeskFetch<GrowDeskSupplementProduct>(
            `/api/v1/families/${baby.familyId}/nutrition/supplement-products`,
            {
              method: "POST",
              accessToken,
              body: { name: suppName, brand, dosageForm, unitName, defaultDose: String(defaultDose), nutrientsJson: nutrients, notes },
            },
          );
          product = fromGrowDeskSupplementProduct(requireWriteData(response, "Failed to create supplement product"));
        } else {
          const existing = await prisma.supplementProduct.findFirst({ where: { familyId: baby.familyId, name: suppName } });
          const saved = existing
            ? await prisma.supplementProduct.update({
                where: { id: existing.id },
                data: { brand, dosageForm, unitName, defaultDose, nutrientsJson: JSON.stringify(nutrients), notes, isActive: true },
              })
            : await prisma.supplementProduct.create({
                data: { familyId: baby.familyId, name: suppName, brand, dosageForm, unitName, defaultDose, nutrientsJson: JSON.stringify(nutrients), notes, isActive: true },
              });
          product = { ...saved, nutrients };
        }

        const data = { success: true, action: "create_supplement_product", product };
        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 25. record_food_plan (Food Plan Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_food_plan") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        if (args.date && !isValidDateStr(args.date)) {
          throw new Error("date 必须为有效的 YYYY-MM-DD 格式");
        }
        const date = args.date || getLocalDateStr();

        let ingredients = Array.isArray(args.ingredients) ? args.ingredients : [];
        if (typeof args.ingredients === "string") ingredients = safeJsonParse(args.ingredients, []);
        let steps = Array.isArray(args.steps) ? args.steps : [];
        if (typeof args.steps === "string") steps = safeJsonParse(args.steps, []);
        let tags = Array.isArray(args.tags) ? args.tags : ["营养辅食"];
        if (typeof args.tags === "string") tags = safeJsonParse(args.tags, ["营养辅食"]);

        if (GROWDESK_CONFIG.enabled) {
          const existingRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
            method: "GET",
            accessToken,
          });
          const existingData = (existingRes.ok && (existingRes.data?.data?.planData || existingRes.data?.planData)) || {};
          const newPlan = {
            id: crypto.randomUUID(),
            name: String(args.name || "辅食食谱").trim().slice(0, 100),
            date,
            ingredients,
            steps,
            nutrition: String(args.nutrition || "").slice(0, 500),
            tags,
            recordedBy: currentUserSummary,
            createdAt: new Date().toISOString(),
          };
          const plans = Array.isArray(existingData.plans) ? existingData.plans : [];
          plans.unshift(newPlan);

          const putRes = await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
            method: "PUT",
            accessToken,
            body: {
              planData: {
                ...existingData,
                plans,
              },
            },
          });
          if (!putRes.ok) {
            throw new Error(putRes.error?.message || "Failed to save food plan");
          }

          const data = {
            success: true,
            action: "record_food_plan",
            record: newPlan,
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const plan = await prisma.foodPlan.create({
          data: {
            babyId,
            name: String(args.name || "辅食食谱").trim().slice(0, 100),
            date,
            ingredients: JSON.stringify(ingredients),
            steps: JSON.stringify(steps),
            nutrition: String(args.nutrition || "").slice(0, 500),
            tags: JSON.stringify(tags),
          },
        });

        const data = {
          success: true,
          action: "record_food_plan",
          record: {
            id: plan.id,
            name: plan.name,
            date: plan.date,
            ingredients: safeJsonParse(plan.ingredients, []),
            steps: safeJsonParse(plan.steps, []),
            nutrition: plan.nutrition,
            tags: safeJsonParse(plan.tags, []),
            recordedBy: currentUserSummary,
            createdAt: plan.createdAt,
          },
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 26. delete_record (Record Deletion with Auto-Snapshot)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "delete_record") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        const type = String(args.type);
        let targetId = typeof args.id === "string" ? args.id.trim() : (typeof args.recordId === "string" ? args.recordId.trim() : "");
        const date = typeof args.date === "string" && isValidDateStr(args.date) ? args.date : undefined;
        let baseVersion: number | undefined;

        if (GROWDESK_CONFIG.enabled) {
          if (!targetId && date) {
            if (type === "growth") {
              const res = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/growth-measurements`, { accessToken });
              const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
              const found = list.find((r: any) => r.measurementDate?.slice(0, 10) === date || r.date === date);
              if (found) {
                targetId = found.id;
                if (Number.isInteger(found.version)) baseVersion = found.version;
              }
            } else if (type === "medical_report") {
              const res = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/medical/reports`, { accessToken });
              const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
              const found = list.find((r: any) => r.reportDate?.slice(0, 10) === date || r.date === date);
              if (found) {
                targetId = found.id;
                if (Number.isInteger(found.version)) baseVersion = found.version;
              }
            } else if (type === "vaccine") {
              const res = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/vaccines/records?limit=50`, { accessToken });
              const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
              const found = list.find((r: any) => (r.completedDate || r.administeredDate || r.scheduledDate || r.date)?.slice(0, 10) === date);
              if (found) {
                targetId = found.id;
                if (Number.isInteger(found.version)) baseVersion = found.version;
              }
            } else if (type === "feeding" || type === "sleep" || type === "diaper" || type === "food" || type === "supplement") {
              const res = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/records/${type}?limit=50`, { accessToken });
              const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
              const found = list.find((r: any) => (r.occurredAt || r.startTime || r.date)?.slice(0, 10) === date);
              if (found) {
                targetId = found.id;
                if (Number.isInteger(found.version)) baseVersion = found.version;
              }
            }
          }

          if (!targetId) {
            throw new Error(`未找到指定的 ${type} 记录，请确认记录 ID 或具体日期`);
          }

          const clientId = typeof args.clientId === "string" && args.clientId.trim() ? args.clientId.trim() : undefined;
          const delRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/record-snapshots/${encodeURIComponent(type)}/${encodeURIComponent(targetId)}`, {
            method: "DELETE",
            accessToken,
            idempotencyKey: clientId,
            body: baseVersion === undefined ? {} : { baseVersion: String(baseVersion) },
          });
          requireWriteData(delRes, `Failed to delete ${type} record`);

          const data = {
            success: true,
            action: "delete_record",
            deletedType: type,
            deletedId: targetId,
            operator: currentUserSummary,
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        if (!targetId && date) {
          if (type === "growth") {
            const rec = await prisma.growthMeasurement.findFirst({ where: { babyId, date }, orderBy: { createdAt: "desc" } });
            if (rec) targetId = rec.id;
          } else if (type === "medical_report") {
            const rec = await prisma.medicalReport.findFirst({ where: { babyId, date }, orderBy: { createdAt: "desc" } });
            if (rec) targetId = rec.id;
          } else if (type === "feeding") {
            const { start, end } = getLocalDayUtcRange(date);
            const rec = await prisma.feedingRecord.findFirst({ where: { babyId, timestamp: { gte: start, lt: end } }, orderBy: { timestamp: "desc" } });
            if (rec) targetId = rec.id;
          } else if (type === "sleep") {
            const { start, end } = getLocalDayUtcRange(date);
            const rec = await prisma.sleepRecord.findFirst({ where: { babyId, startTime: { gte: start, lt: end } }, orderBy: { startTime: "desc" } });
            if (rec) targetId = rec.id;
          } else if (type === "diaper") {
            const { start, end } = getLocalDayUtcRange(date);
            const rec = await prisma.diaperRecord.findFirst({ where: { babyId, timestamp: { gte: start, lt: end } }, orderBy: { timestamp: "desc" } });
            if (rec) targetId = rec.id;
          } else if (type === "food") {
            const rec = await prisma.foodLogRecord.findFirst({ where: { babyId, date }, orderBy: { createdAt: "desc" } });
            if (rec) targetId = rec.id;
          } else if (type === "supplement") {
            const rec = await prisma.supplementRecord.findFirst({ where: { babyId, date }, orderBy: { createdAt: "desc" } });
            if (rec) targetId = rec.id;
          }
        }

        if (!targetId) {
          throw new Error(`未找到指定的 ${type} 记录，请确认记录 ID 或具体日期`);
        }

        if (type === "medical_report") {
          const rep = await prisma.medicalReport.findUnique({ where: { id: targetId } });
          if (!rep || rep.babyId !== babyId) throw new records.ForbiddenError();
          const { captureRecordSnapshot } = await import("@/lib/records/snapshot");
          await captureRecordSnapshot({
            ctx: { babyId, userId: principal.userId, source: "mcp" },
            action: "delete",
            entityType: "medical_report",
            entityId: targetId,
            payload: rep,
          });
          await prisma.medicalReport.delete({ where: { id: targetId } });
        } else {
          await records.deleteRecord(recCtx, type as any, targetId);
        }

        const data = {
          success: true,
          action: "delete_record",
          deletedType: type,
          deletedId: targetId,
          operator: currentUserSummary,
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 27. restore_record (Snapshot Undo / Rollback)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "restore_record") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        if (GROWDESK_CONFIG.enabled) {
          const restoreRes = args.snapshotId
            ? await growdeskFetch<any>(`/api/v1/babies/${babyId}/record-snapshots/${encodeURIComponent(String(args.snapshotId))}/restore`, {
                method: "POST",
                accessToken,
              })
            : await growdeskFetch<any>(`/api/v1/babies/${babyId}/record-snapshots/restore`, {
                method: "POST",
                accessToken,
                body: args.entityType ? { entityType: String(args.entityType) } : {},
              });
          const restored = requireWriteData(restoreRes, "Failed to restore record snapshot");

          const data = {
            success: true,
            action: "restore_record",
            restoredId: restored.restoredId,
            entityType: restored.entityType,
            operator: currentUserSummary,
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const { restoreLastDeletedRecord, restoreSnapshot } = await import("@/lib/records/snapshot");
        const snapCtx = { babyId, userId: principal.userId, source: "mcp" as const };
        let restoreResult: any;

        if (args.snapshotId) {
          restoreResult = await restoreSnapshot(snapCtx, args.snapshotId);
        } else {
          restoreResult = await restoreLastDeletedRecord(snapCtx, args.entityType);
        }

        const data = {
          success: true,
          action: "restore_record",
          restoredId: restoreResult.restoredId,
          entityType: restoreResult.entityType,
          operator: currentUserSummary,
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 28. query_food_item (Food Ingredient Knowledge Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "query_food_item") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const queryName = String(args.name || args.query || "").trim();
        if (!queryName) throw new Error("请输入食材名称");

        if (GROWDESK_CONFIG.enabled) {
          const foods = getFoodsData();
          const q = queryName.toLowerCase();
          const filtered = foods.filter((item: any) =>
            item.name?.toLowerCase().includes(q) ||
            item.foodGroup?.toLowerCase().includes(q) ||
            item.category?.toLowerCase().includes(q)
          ).slice(0, 5);
          const rawList = filtered.map((item: any) => ({
            name: item.name,
            icon: item.icon,
            category: item.category,
            foodGroup: item.foodGroup,
            recommendedFromMonth: item.recommendedFromMonth,
            avoidBeforeMonths: item.avoidBeforeMonths,
            chokingRisk: item.chokingRisk,
            chokingNotes: item.chokingNotes,
            isCommonAllergen: item.isCommonAllergen,
            allergenIntroductionGuidance: item.allergenIntroductionGuidance,
            guidance: item.guidance,
            preparation: item.preparation || [],
            nutrition: item.nutrition || [],
          }));
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const items = await prisma.foodItem.findMany({
          where: {
            OR: [
              { name: { contains: queryName } },
              { foodGroup: { contains: queryName } },
              { category: { contains: queryName } },
            ],
          },
          take: 5,
        });

        const rawList = items.map((item) => ({
          name: item.name,
          icon: item.icon,
          category: item.category,
          foodGroup: item.foodGroup,
          recommendedFromMonth: item.recommendedFromMonth,
          avoidBeforeMonths: item.avoidBeforeMonths,
          chokingRisk: item.chokingRisk,
          chokingNotes: item.chokingNotes,
          isCommonAllergen: item.isCommonAllergen,
          allergenIntroductionGuidance: item.allergenIntroductionGuidance,
          guidance: item.guidance,
          preparation: safeJsonParse(item.preparationJson, []),
          nutrition: safeJsonParse(item.nutritionJson, []),
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 29. query_book (Picture Book Library Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "query_book") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const query = typeof args.query === "string" ? args.query.trim() : "";
        const limit = typeof args.limit === "number" ? Math.min(10, Math.max(1, args.limit)) : 5;
        const ageDetail = baby.birthDate ? calculateAgeDetail(baby.birthDate) : null;
        const targetMonth = typeof args.month === "number" && Number.isFinite(args.month) ? args.month : ageDetail?.months;

        if (GROWDESK_CONFIG.enabled) {
          const books = getBooksData();
          let filtered = books;
          if (typeof targetMonth === "number") {
            filtered = filtered.filter((b: any) => (b.ageMinMonths == null || b.ageMinMonths <= targetMonth) && (b.ageMaxMonths == null || b.ageMaxMonths >= targetMonth));
          }
          if (query) {
            const q = query.toLowerCase();
            filtered = filtered.filter((b: any) =>
              b.title?.toLowerCase().includes(q) ||
              b.description?.toLowerCase().includes(q) ||
              (Array.isArray(b.categories) && b.categories.some((c: any) => String(c).toLowerCase().includes(q)))
            );
          }
          const rawList = filtered.slice(0, limit).map((b: any) => ({
            title: b.title,
            authors: Array.isArray(b.authors) ? b.authors : safeJsonParse(b.authorJson, []),
            ageMinMonths: b.ageMinMonths,
            ageMaxMonths: b.ageMaxMonths,
            ratingScore: b.ratingScore,
            description: b.description,
            whyAgeAppropriate: b.whyAgeAppropriate,
            interactionSuggestions: Array.isArray(b.interactionSuggestions) ? b.interactionSuggestions : safeJsonParse(b.interactionSuggestionsJson, []),
          }));
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const where: any = {};
        if (typeof targetMonth === "number") {
          where.ageMinMonths = { lte: targetMonth };
          where.ageMaxMonths = { gte: targetMonth };
        }
        if (query) {
          where.OR = [{ title: { contains: query } }, { description: { contains: query } }, { categoriesJson: { contains: query } }];
        }

        const books = await prisma.book.findMany({
          where,
          take: limit,
        });

        const rawList = books.map((b) => ({
          title: b.title,
          authors: safeJsonParse(b.authorJson, []),
          ageMinMonths: b.ageMinMonths,
          ageMaxMonths: b.ageMaxMonths,
          ratingScore: b.ratingScore,
          description: b.description,
          whyAgeAppropriate: b.whyAgeAppropriate,
          interactionSuggestions: safeJsonParse(b.interactionSuggestionsJson, []),
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 30. query_activity (Parent-Child Activity Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "query_activity") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const ageDetail = baby.birthDate ? calculateAgeDetail(baby.birthDate) : null;
        const month = typeof args.month === "number" ? args.month : ageDetail?.months || 6;
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const limit = typeof args.limit === "number" ? Math.min(10, Math.max(1, args.limit)) : 5;

        if (GROWDESK_CONFIG.enabled) {
          const activities = getActivitiesData();
          let filtered = activities.filter((a: any) =>
            (a.targetMonthMin == null || a.targetMonthMin <= month) &&
            (a.targetMonthMax == null || a.targetMonthMax >= month)
          );
          if (query) {
            const q = query.toLowerCase();
            filtered = filtered.filter((a: any) => a.title?.toLowerCase().includes(q));
          }
          const rawList = filtered.slice(0, limit).map((a: any) => ({
            title: a.title,
            goal: a.goal,
            durationMinutes: a.durationMinutes,
            steps: Array.isArray(a.steps) ? a.steps : safeJsonParse(a.stepsJson, []),
            safety: Array.isArray(a.safety) ? a.safety : safeJsonParse(a.safetyJson, []),
          }));
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
        }

        const activities = await prisma.activityRecommendation.findMany({
          where: {
            targetMonthMin: { lte: month },
            targetMonthMax: { gte: month },
            ...(query ? { title: { contains: query } } : {}),
          },
          take: limit,
        });

        const rawList = activities.map((a) => ({
          title: a.title,
          goal: a.goal,
          durationMinutes: a.durationMinutes,
          steps: safeJsonParse(a.stepsJson, []),
          safety: safeJsonParse(a.safetyJson, []),
        }));

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(rawList, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 31. web_search (External Research Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "web_search") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }
        const query = String(args.query || "").trim();
        if (!query) throw new Error("请输入搜索关键词");
        const rl = checkRateLimit(`web_search:${principal.userId}`, 10, 60_000);
        if (!rl.success) throw new Error("搜索过于频繁，请稍后再试");

        const searchResults = await performWebSearch(query, args.limit || 5);
        await logToolCall(name, "success", startTime);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ query, total: searchResults.length, results: searchResults }, null, 2),
            },
          ],
        };
      }

      // ═════════════════════════════════════════════════════════════════════
      // Backward Compatibility Aliases (Coarse-grained calls from legacy clients)
      // ═════════════════════════════════════════════════════════════════════

      // Legacy Alias: get_baby_overview
      if (name === "get_baby_overview") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const targetDate = args.date && isValidDateStr(args.date) ? args.date : getLocalDateStr();
        const ageDetail = baby.birthDate ? calculateAgeDetail(baby.birthDate) : null;

        if (GROWDESK_CONFIG.enabled) {
          const query = new URLSearchParams({ date: targetDate });
          const [feedings, sleep, diapers, foods, tlRes] = await Promise.all([
            fetchLegacyRecordList<GrowDeskFeedingRecord>(growdeskFetch, accessToken || "", babyId, query, "feeding"),
            fetchLegacyRecordList<GrowDeskSleepRecord>(growdeskFetch, accessToken || "", babyId, query, "sleep"),
            fetchLegacyRecordList<GrowDeskDiaperRecord>(growdeskFetch, accessToken || "", babyId, query, "diaper"),
            fetchLegacyRecordList<GrowDeskFoodRecord>(growdeskFetch, accessToken || "", babyId, query, "food"),
            growdeskFetch<any>(`/api/v1/babies/${babyId}/timeline?date=${targetDate}&limit=15`, {
              method: "GET",
              accessToken,
            }),
          ]);
          let totalFeedingMl = 0;
          for (const f of feedings) {
            if (f.amountMl) totalFeedingMl += Number(f.amountMl);
          }
          let totalSleepMinutes = 0;
          for (const s of sleep) {
            const start = (s as any).startTime || (s as any).startedAt;
            const end = (s as any).endTime || (s as any).endedAt;
            if (start && end) {
              const diff = new Date(end).getTime() - new Date(start).getTime();
              if (diff > 0) totalSleepMinutes += Math.round(diff / 60000);
            }
          }
          const dailySummary = {
            date: targetDate,
            totalFeedingMl,
            totalSleepMinutes,
            diaperCount: diapers.length,
            foodCount: foods.length,
          };
          const rawTimeline = (tlRes.ok && (tlRes.data?.data?.items || tlRes.data?.items || tlRes.data)) || [];
          const overview: Record<string, any> = {
            date: targetDate,
            currentUser: currentUserSummary,
            profile: {
              id: baby.id,
              nickname: baby.nickname,
              gender: baby.gender,
              birthDate: baby.birthDate,
              gestationalAge: baby.gestationalAge,
              age: ageDetail,
            },
            dailySummary,
            recentTimeline: Array.isArray(rawTimeline) ? rawTimeline.slice(0, 15) : [],
          };
          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(overview, null, 2) }] };
        }

        const [dailySummary, timeline] = await Promise.all([
          records.getDailySummary(recCtx, targetDate),
          records.getTimeline(recCtx, targetDate),
        ]);

        const overview: Record<string, any> = {
          date: targetDate,
          currentUser: currentUserSummary,
          profile: {
            nickname: baby.nickname,
            gender: baby.gender,
            birthDate: baby.birthDate,
            gestationalAge: baby.gestationalAge,
            age: ageDetail,
          },
          dailySummary,
          recentTimeline: timeline.slice(0, 15),
        };

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(overview, null, 2) }] };
      }

      // Legacy Alias: record_baby_events
      if (name === "record_baby_events") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        const savedItems: string[] = [];

        if (GROWDESK_CONFIG.enabled) {
          if (args.feeding) {
            const f = args.feeding;
            const feedingType = f.type || "formula";
            const formulaProductId = await resolveFormulaProductId(
              recCtx.familyId,
              feedingType,
              f.formulaProductId,
              f.formulaName,
              accessToken
            );
            const payload = toGrowDeskFeedingCreatePayload({
              babyId,
              type: feedingType,
              amountMl: f.amountMl,
              leftMinutes: f.leftMinutes,
              rightMinutes: f.rightMinutes,
              spitUp: f.spitUp,
              notes: f.notes,
              timestamp: f.timestamp || new Date().toISOString(),
              formulaProductId: formulaProductId || undefined,
              source: "mcp",
              sourceAgent,
            });
            const res = await growdeskFetch<GrowDeskFeedingRecord>(recordPath("feeding", babyId), {
              method: "POST",
              accessToken,
              body: payload,
            });
            const created = requireWriteData(res, "Failed to create feeding record");
            savedItems.push(`🍼 喂养记录 (ID: ${created.id})`);
          }

          if (args.sleep) {
            const s = args.sleep;
            const date = s.date && isValidDateStr(s.date) ? s.date : getLocalDateStr();
            const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
            let startIso = s.startTime;
            if (typeof startIso === "string" && TIME_RE.test(startIso.trim())) {
              startIso = localTimeToUtcIso(startIso.trim(), date);
            }
            let endIso = s.endTime;
            if (typeof endIso === "string" && TIME_RE.test(endIso.trim())) {
              endIso = localTimeToUtcIso(endIso.trim(), date);
            }
            const sleepType = s.type === "day" ? "nap" : (s.type || "nap");
            const payload = toGrowDeskSleepCreatePayload({
              babyId,
              startedAt: startIso,
              endedAt: endIso,
              sleepType,
              nightWakingCount: s.nightWakingCount,
              notes: s.notes,
              source: "mcp",
              sourceAgent,
            });
            const res = await growdeskFetch<GrowDeskSleepRecord>(recordPath("sleep", babyId), {
              method: "POST",
              accessToken,
              body: payload,
            });
            const created = requireWriteData(res, "Failed to create sleep record");
            savedItems.push(`💤 睡眠记录 (ID: ${created.id})`);
          }

          if (args.diaper) {
            const d = args.diaper;
            let ts = d.timestamp;
            if (!ts) {
              ts = new Date().toISOString();
            } else if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(ts).trim())) {
              ts = localTimeToUtcIso(String(ts).trim(), getLocalDateStr());
            }
            const payload = toGrowDeskDiaperCreatePayload({
              babyId,
              type: d.type || "pee",
              poopColor: d.poopColor,
              poopConsistency: d.poopConsistency,
              notes: d.notes,
              timestamp: ts,
              source: "mcp",
              sourceAgent,
            });
            const res = await growdeskFetch<GrowDeskDiaperRecord>(recordPath("diaper", babyId), {
              method: "POST",
              accessToken,
              body: payload,
            });
            const created = requireWriteData(res, "Failed to create diaper record");
            savedItems.push(`🧷 换尿布/排便记录 (ID: ${created.id})`);
          }

          if (args.food) {
            const fd = args.food;
            const payload = toGrowDeskFoodCreatePayload({
              babyId,
              foods: fd.foods,
              date: fd.date,
              time: fd.time,
              portion: fd.portion,
              acceptance: fd.acceptance,
              babyState: fd.babyState,
              hasAbnormal: fd.hasAbnormal,
              abnormalNotes: fd.abnormalNotes,
              source: "mcp",
              sourceAgent,
            });
            const res = await growdeskFetch<GrowDeskFoodRecord>(recordPath("food", babyId), {
              method: "POST",
              accessToken,
              body: payload,
            });
            const created = requireWriteData(res, "Failed to create food record");
            savedItems.push(`🥣 辅食打卡 (ID: ${created.id})`);
          }

          if (args.supplement) {
            const sp = args.supplement;
            const suppName = String(sp.name || "").trim();
            if (suppName) {
              const dose = typeof sp.dose === "number" && Number.isFinite(sp.dose) && sp.dose > 0 && sp.dose <= 100 ? sp.dose : 1.0;
              const unitName = sp.unitName ? String(sp.unitName).trim() : "粒";
              const recordDate = sp.date && isValidDateStr(sp.date) ? sp.date : getLocalDateStr();
              const recordTime = sp.time && /^([01]\d|2[0-3]):([0-5]\d)$/.test(sp.time) ? sp.time : getLocalTimeStr();
              const occurredAt = localTimeToUtcIso(recordTime, recordDate);
              const formattedAmount = formatSupplementAmount(dose, unitName);
              const res = await growdeskFetch<GrowDeskSupplementRecord>(`/api/v1/babies/${babyId}/records/supplement`, {
                method: "POST",
                accessToken,
                body: {
                  supplementName: suppName,
                  occurredAt,
                  amount: formattedAmount,
                  notes: sp.notes ? String(sp.notes).trim() : null,
                },
              });
              const created = requireWriteData(res, "Failed to record supplement");
              savedItems.push(`💊 补剂记录 (ID: ${created.id})`);
            }
          }

          if (args.foodPlan) {
            const fp = args.foodPlan;
            const existingRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
              method: "GET",
              accessToken,
            });
            const existingData = (existingRes.ok && (existingRes.data?.data?.planData || existingRes.data?.planData)) || {};
            const newPlan = {
              id: crypto.randomUUID(),
              name: String(fp.name || "辅食食谱"),
              date: fp.date && isValidDateStr(fp.date) ? fp.date : getLocalDateStr(),
              ingredients: Array.isArray(fp.ingredients) ? fp.ingredients : [],
              steps: Array.isArray(fp.steps) ? fp.steps : [],
              nutrition: String(fp.nutrition || ""),
              tags: Array.isArray(fp.tags) ? fp.tags : ["营养辅食"],
              recordedBy: currentUserSummary,
              createdAt: new Date().toISOString(),
            };
            const plans = Array.isArray(existingData.plans) ? existingData.plans : [];
            plans.unshift(newPlan);
            await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
              method: "PUT",
              accessToken,
              body: {
                planData: {
                  ...existingData,
                  plans,
                },
              },
            });
            savedItems.push(`📋 辅食食谱计划 (ID: ${newPlan.id})`);
          }

          if (savedItems.length === 0) {
            throw new Error("未提供任何有效的事件数据 (feeding / sleep / diaper / food / supplement / foodPlan)");
          }

          await logToolCall(name, "success", startTime);
          return {
            content: [
              {
                type: "text",
                text: `✅ 复合作息事件已成功保存：\n${savedItems.join("\n")}`,
              },
            ],
          };
        }

        if (args.feeding) {
          const f = args.feeding;
          const feedingType = f.type || "formula";
          const formulaProductId = await resolveFormulaProductId(
            recCtx.familyId,
            feedingType,
            f.formulaProductId,
            f.formulaName
          );
          const result = await records.createFeeding(recCtx, {
            type: feedingType,
            amountMl: f.amountMl,
            leftMinutes: f.leftMinutes,
            rightMinutes: f.rightMinutes,
            spitUp: f.spitUp,
            notes: f.notes,
            timestamp: f.timestamp,
            formulaProductId: formulaProductId || undefined,
          });
          savedItems.push(`🍼 喂养记录 (ID: ${result.id})`);
        }

        if (args.sleep) {
          const s = args.sleep;
          const result = await records.createSleep(recCtx, {
            startTime: s.startTime,
            endTime: s.endTime,
            type: s.type,
            nightWakingCount: s.nightWakingCount,
            notes: s.notes,
            date: s.date,
          });
          savedItems.push(`💤 睡眠记录 (ID: ${result.id})`);
        }

        if (args.diaper) {
          const d = args.diaper;
          const result = await records.createDiaper(recCtx, {
            type: d.type || "pee",
            poopColor: d.poopColor,
            poopConsistency: d.poopConsistency,
            notes: d.notes,
            timestamp: d.timestamp,
          });
          savedItems.push(`🧷 换尿布/排便记录 (ID: ${result.id})`);
        }

        if (args.food) {
          const fd = args.food;
          const result = await records.createFoodLog(recCtx, {
            foods: fd.foods,
            date: fd.date,
            time: fd.time,
            portion: fd.portion,
            acceptance: fd.acceptance,
            babyState: fd.babyState,
            hasAbnormal: fd.hasAbnormal,
            abnormalNotes: fd.abnormalNotes,
          });
          savedItems.push(`🥣 辅食打卡 (ID: ${result.id})`);
        }

        if (args.supplement) {
          const sp = args.supplement;
          const suppName = String(sp.name || "").trim();
          if (suppName) {
            let suppProduct = await prisma.supplementProduct.findFirst({
              where: {
                familyId: baby.familyId,
                name: { contains: suppName },
                isActive: true,
              },
            });
            if (!suppProduct) {
              suppProduct = await prisma.supplementProduct.create({
                data: {
                  familyId: baby.familyId,
                  name: suppName,
                  brand: "家庭自选",
                  dosageForm: "drops",
                  unitName: sp.unitName ? String(sp.unitName).trim() : "粒",
                  defaultDose: 1.0,
                  nutrientsJson: JSON.stringify({}),
                  isActive: true,
                },
              });
            }
            const recordDate = sp.date && isValidDateStr(sp.date) ? sp.date : getLocalDateStr();
            const recordTime = sp.time && /^([01]\d|2[0-3]):([0-5]\d)$/.test(sp.time) ? sp.time : getLocalTimeStr();
            const suppRecord = await prisma.supplementRecord.create({
              data: {
                babyId,
                productId: suppProduct.id,
                recordedById: principal.userId,
                source: "mcp",
                sourceAgent,
                date: recordDate,
                time: recordTime,
                dose: typeof sp.dose === "number" && Number.isFinite(sp.dose) && sp.dose > 0 && sp.dose <= 100 ? sp.dose : 1.0,
                unitName: sp.unitName ? String(sp.unitName).trim() : suppProduct.unitName,
                notes: sp.notes ? String(sp.notes).slice(0, 500) : null,
              },
            });
            savedItems.push(`💊 补剂记录 (ID: ${suppRecord.id})`);
          }
        }

        if (args.foodPlan) {
          const fp = args.foodPlan;
          const plan = await prisma.foodPlan.create({
            data: {
              babyId,
              name: String(fp.name || "辅食食谱"),
              date: fp.date && isValidDateStr(fp.date) ? fp.date : getLocalDateStr(),
              ingredients: JSON.stringify(fp.ingredients || []),
              steps: JSON.stringify(fp.steps || []),
              nutrition: String(fp.nutrition || ""),
              tags: JSON.stringify(fp.tags || ["营养辅食"]),
            },
          });
          savedItems.push(`📋 辅食食谱计划 (ID: ${plan.id})`);
        }

        if (savedItems.length === 0) {
          throw new Error("未提供任何有效的事件数据 (feeding / sleep / diaper / food / supplement / foodPlan)");
        }

        await logToolCall(name, "success", startTime);
        return {
          content: [
            {
              type: "text",
              text: `✅ 复合作息事件已成功保存：\n${savedItems.join("\n")}`,
            },
          ],
        };
      }

      // Legacy Alias: record_health_measurement
      if (name === "record_health_measurement") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        const messages: string[] = [];

        if (GROWDESK_CONFIG.enabled) {
          if (args.growth) {
            const g = args.growth;
            const payload = toGrowDeskGrowthCreatePayload({
              babyId,
              date: g.date || getLocalDateStr(),
              weightKg: g.weightKg,
              heightCm: g.heightCm,
              headCircumferenceCm: g.headCircumferenceCm,
              imageUrl: g.imageUrl,
            });
            const res = await growdeskFetch<GrowDeskGrowthRecord>(`/api/v1/babies/${babyId}/growth-measurements`, {
              method: "POST",
              accessToken,
              body: payload,
            });
            const created = requireWriteData(res, "Failed to create growth measurement");
            messages.push(`📏 生长测量记录已保存 (体重: ${created.weightKg ?? "-"}kg, 身长: ${created.heightCm ?? "-"}cm)`);
          }

          if (args.vaccine) {
            const v = args.vaccine;
            const vName = String(v.name || "").trim();
            const dose = String(v.dose || "第1剂").trim();
            const completedDate = v.completedDate && isValidDateStr(v.completedDate) ? v.completedDate : getLocalDateStr();
            if (!vName) throw new Error("请输入疫苗名称");
            const payload = toGrowDeskVaccineRecordPayload({
              babyId,
              name: vName,
              dose,
              scheduledDate: completedDate,
              completedDate,
              isCompleted: true,
            });
            const res = await growdeskFetch<GrowDeskVaccineRecord>(`/api/v1/babies/${babyId}/vaccines/records`, {
              method: "POST",
              accessToken,
              body: payload,
            });
            const created = requireWriteData(res, "Failed to record vaccine");
            messages.push(`💉 疫苗接种已登记【${vName} ${dose}】(完成日期: ${completedDate})`);
          }

          if (args.medicalReport) {
            const mr = args.medicalReport;
            const title = String(mr.title || "").trim().slice(0, 100);
            if (!title) throw new Error("请填写报告标题");
            const date = mr.date && isValidDateStr(mr.date) ? mr.date : getLocalDateStr();
            const items = Array.isArray(mr.items) ? mr.items.slice(0, 40) : [];
            const payload = toGrowDeskMedicalCreatePayload({
              babyId,
              title,
              category: String(mr.category || "general"),
              date,
              hospital: mr.hospital ? String(mr.hospital).slice(0, 100) : null,
              doctorNotes: mr.doctorNotes ? String(mr.doctorNotes).slice(0, 1000) : null,
              imageUrl: (() => {
                const raw = mr.imageUrl ? String(mr.imageUrl).trim() : null;
                if (!raw) return null;
                if (!/^\/uploads\/(avatars|medical|growth)\/[^/]+\.(jpg|jpeg|png|webp|heic)$/i.test(raw)) {
                  throw new Error("imageUrl 仅支持本站 /uploads/ 路径的合法图片 (jpg/jpeg/png/webp/heic)");
                }
                return raw.slice(0, 500);
              })(),
              items,
              source: "mcp",
              sourceAgent,
            });
            const res = await growdeskFetch<GrowDeskMedicalReport>(`/api/v1/babies/${babyId}/medical/reports`, {
              method: "POST",
              accessToken,
              body: payload,
            });
            const created = requireWriteData(res, "Failed to record medical report");
            messages.push(`📑 化验单/体检档案「${title}」已归档 (ID: ${created.id})`);
          }

          if (args.deleteAction) {
            const del = args.deleteAction;
            const type = String(del.type);
            let targetId = typeof del.id === "string" ? del.id.trim() : "";
            const date = typeof del.date === "string" && isValidDateStr(del.date) ? del.date : undefined;
            let baseVersion: number | undefined;

            if (!targetId && date) {
              if (type === "growth") {
                const res = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/growth-measurements`, { accessToken });
                const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
                const found = list.find((r: any) => r.measurementDate?.slice(0, 10) === date || r.date === date);
                if (found) {
                  targetId = found.id;
                  if (Number.isInteger(found.version)) baseVersion = found.version;
                }
              } else if (type === "medical_report") {
                const res = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/medical/reports`, { accessToken });
                const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
                const found = list.find((r: any) => r.reportDate?.slice(0, 10) === date || r.date === date);
                if (found) {
                  targetId = found.id;
                  if (Number.isInteger(found.version)) baseVersion = found.version;
                }
              } else if (type === "vaccine") {
                const res = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/vaccines/records?limit=50`, { accessToken });
                const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
                const found = list.find((r: any) => (r.completedDate || r.administeredDate || r.scheduledDate || r.date)?.slice(0, 10) === date);
                if (found) {
                  targetId = found.id;
                  if (Number.isInteger(found.version)) baseVersion = found.version;
                }
              } else if (type === "feeding" || type === "sleep" || type === "diaper" || type === "food" || type === "supplement") {
                const res = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/records/${type}?limit=50`, { accessToken });
                const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
                const found = list.find((r: any) => (r.occurredAt || r.startTime || r.date)?.slice(0, 10) === date);
                if (found) {
                  targetId = found.id;
                  if (Number.isInteger(found.version)) baseVersion = found.version;
                }
              }
            }

            if (!targetId) throw new Error(`未找到指定的 ${type} 记录`);

            const clientId = typeof del.clientId === "string" && del.clientId.trim() ? del.clientId.trim() : undefined;
            const deleteRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/record-snapshots/${encodeURIComponent(type)}/${encodeURIComponent(targetId)}`, {
              method: "DELETE",
              accessToken,
              idempotencyKey: clientId,
              body: baseVersion === undefined ? {} : { baseVersion: String(baseVersion) },
            });
            requireWriteData(deleteRes, `Failed to delete ${type} record`);
            messages.push(`🗑️ 已成功删除 ${type} 记录 (ID: ${targetId})，系统已自动备份安全快照，随时可撤销恢复。`);
          }

          if (args.undoAction) {
            const undo = args.undoAction;
            const restoreRes = undo.snapshotId
              ? await growdeskFetch<any>(`/api/v1/babies/${babyId}/record-snapshots/${encodeURIComponent(String(undo.snapshotId))}/restore`, {
                  method: "POST",
                  accessToken,
                })
              : await growdeskFetch<any>(`/api/v1/babies/${babyId}/record-snapshots/restore`, {
                  method: "POST",
                  accessToken,
                  body: undo.entityType ? { entityType: String(undo.entityType) } : {},
                });
            const restored = requireWriteData(restoreRes, "Failed to restore record snapshot");
            messages.push(`↩️ 已成功撤销并恢复【${restored.entityType}】记录 (新记录 ID: ${restored.restoredId})`);
          }

          if (messages.length === 0) {
            throw new Error("请提供 growth, vaccine, medicalReport, deleteAction 或 undoAction 数据");
          }

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: `✅ 健康档案更新成功：\n${messages.join("\n")}` }] };
        }

        if (args.growth) {
          const g = args.growth;
          const result = await records.createGrowth(recCtx, {
            date: g.date || getLocalDateStr(),
            weightKg: g.weightKg,
            heightCm: g.heightCm,
            headCircumferenceCm: g.headCircumferenceCm,
            imageUrl: g.imageUrl,
          });
          messages.push(`📏 生长测量记录已保存 (体重: ${result.weightKg || "-"}kg, 身长: ${result.heightCm || "-"}cm)`);
        }

        if (args.vaccine) {
          const v = args.vaccine;
          const vName = String(v.name || "").trim();
          const dose = String(v.dose || "第1剂").trim();
          const completedDate = v.completedDate && isValidDateStr(v.completedDate) ? v.completedDate : getLocalDateStr();
          if (!vName) throw new Error("请输入疫苗名称");
          const record = await prisma.vaccineRecord.create({
            data: {
              babyId,
              name: vName,
              dose,
              scheduledDate: completedDate,
              completedDate,
              isCompleted: true,
            },
          });
          messages.push(`💉 疫苗接种已登记【${vName} ${dose}】(完成日期: ${completedDate})`);
        }

        if (args.medicalReport) {
          const mr = args.medicalReport;
          const title = String(mr.title || "").trim().slice(0, 100);
          if (!title) throw new Error("请填写报告标题");
          const date = mr.date && isValidDateStr(mr.date) ? mr.date : getLocalDateStr();
          const items = Array.isArray(mr.items) ? mr.items.slice(0, 40) : [];
          const record = await prisma.medicalReport.create({
            data: {
              babyId,
              recordedById: principal.userId,
              source: "mcp",
              sourceAgent,
              title,
              category: String(mr.category || "general"),
              date,
              hospital: mr.hospital ? String(mr.hospital).slice(0, 100) : null,
              doctorNotes: mr.doctorNotes ? String(mr.doctorNotes).slice(0, 1000) : null,
              imageUrl: (() => {
                const raw = mr.imageUrl ? String(mr.imageUrl).trim() : null;
                if (!raw) return null;
                if (!/^\/uploads\/(avatars|medical|growth)\/[^/]+\.(jpg|jpeg|png|webp|heic)$/i.test(raw)) {
                  throw new Error("imageUrl 仅支持本站 /uploads/ 路径的合法图片 (jpg/jpeg/png/webp/heic)");
                }
                return raw.slice(0, 500);
              })(),
              itemsJson: JSON.stringify(items),
            },
          });
          messages.push(`📑 化验单/体检档案「${title}」已归档 (ID: ${record.id})`);
        }

        if (args.deleteAction) {
          const del = args.deleteAction;
          const type = String(del.type);
          let targetId = typeof del.id === "string" ? del.id.trim() : "";
          const date = typeof del.date === "string" && isValidDateStr(del.date) ? del.date : undefined;

          if (!targetId && date) {
            if (type === "growth") {
              const rec = await prisma.growthMeasurement.findFirst({ where: { babyId, date }, orderBy: { createdAt: "desc" } });
              if (rec) targetId = rec.id;
            } else if (type === "medical_report") {
              const rec = await prisma.medicalReport.findFirst({ where: { babyId, date }, orderBy: { createdAt: "desc" } });
              if (rec) targetId = rec.id;
            } else if (type === "feeding") {
              const { start, end } = getLocalDayUtcRange(date);
              const rec = await prisma.feedingRecord.findFirst({ where: { babyId, timestamp: { gte: start, lt: end } }, orderBy: { timestamp: "desc" } });
              if (rec) targetId = rec.id;
            } else if (type === "sleep") {
              const { start, end } = getLocalDayUtcRange(date);
              const rec = await prisma.sleepRecord.findFirst({ where: { babyId, startTime: { gte: start, lt: end } }, orderBy: { startTime: "desc" } });
              if (rec) targetId = rec.id;
            } else if (type === "diaper") {
              const { start, end } = getLocalDayUtcRange(date);
              const rec = await prisma.diaperRecord.findFirst({ where: { babyId, timestamp: { gte: start, lt: end } }, orderBy: { timestamp: "desc" } });
              if (rec) targetId = rec.id;
            } else if (type === "food") {
              const rec = await prisma.foodLogRecord.findFirst({ where: { babyId, date }, orderBy: { createdAt: "desc" } });
              if (rec) targetId = rec.id;
            } else if (type === "supplement") {
              const rec = await prisma.supplementRecord.findFirst({ where: { babyId, date }, orderBy: { createdAt: "desc" } });
              if (rec) targetId = rec.id;
            }
          }

          if (!targetId) throw new Error(`未找到指定的 ${type} 记录`);
          if (type === "medical_report") {
            const rep = await prisma.medicalReport.findUnique({ where: { id: targetId } });
            if (!rep || rep.babyId !== babyId) throw new records.ForbiddenError();
            const { captureRecordSnapshot } = await import("@/lib/records/snapshot");
            await captureRecordSnapshot({
              ctx: { babyId, userId: principal.userId, source: "mcp" },
              action: "delete",
              entityType: "medical_report",
              entityId: targetId,
              payload: rep,
            });
            await prisma.medicalReport.delete({ where: { id: targetId } });
          } else {
            await records.deleteRecord(recCtx, type as any, targetId);
          }
          messages.push(`🗑️ 已成功删除 ${type} 记录 (ID: ${targetId})，系统已自动备份安全快照，随时可撤销恢复。`);
        }

        if (args.undoAction) {
          const undo = args.undoAction;
          const { restoreLastDeletedRecord, restoreSnapshot } = await import("@/lib/records/snapshot");
          const snapCtx = { babyId, userId: principal.userId, source: "mcp" as const };
          let restoreResult: any;
          if (undo.snapshotId) {
            restoreResult = await restoreSnapshot(snapCtx, undo.snapshotId);
          } else {
            restoreResult = await restoreLastDeletedRecord(snapCtx, undo.entityType);
          }
          messages.push(`↩️ 已成功撤销并恢复【${restoreResult.entityType}】记录 (新记录 ID: ${restoreResult.restoredId})`);
        }

        if (messages.length === 0) {
          throw new Error("请提供 growth, vaccine, medicalReport, deleteAction 或 undoAction 数据");
        }

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: `✅ 健康档案更新成功：\n${messages.join("\n")}` }] };
      }

      // Legacy Alias: query_parenting_knowledge
      if (name === "query_parenting_knowledge") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const category = args.category || "all";
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const ageDetail = baby.birthDate ? calculateAgeDetail(baby.birthDate) : null;
        const month = typeof args.month === "number" ? args.month : ageDetail?.months || 6;
        const limit = typeof args.limit === "number" ? Math.min(10, Math.max(1, args.limit)) : 5;

        if (GROWDESK_CONFIG.enabled) {
          const results: Record<string, any> = {};

          if (category === "all" || category === "food") {
            const allFoods = getFoodsData();
            let foods = allFoods;
            if (query) {
              const q = query.toLowerCase();
              foods = foods.filter((f: any) =>
                f.name?.toLowerCase().includes(q) ||
                f.foodGroup?.toLowerCase().includes(q) ||
                f.category?.toLowerCase().includes(q)
              );
            }
            results.foods = foods.slice(0, limit).map((f: any) => ({
              name: f.name,
              icon: f.icon,
              category: f.category,
              recommendedFromMonth: f.recommendedFromMonth,
              avoidBeforeMonths: f.avoidBeforeMonths,
              chokingRisk: f.chokingRisk,
              isCommonAllergen: f.isCommonAllergen,
            }));
          }

          if (category === "all" || category === "book") {
            const allBooks = getBooksData();
            let books = allBooks;
            if (query) {
              const q = query.toLowerCase();
              books = books.filter((b: any) =>
                b.title?.toLowerCase().includes(q) ||
                b.description?.toLowerCase().includes(q)
              );
            }
            results.books = books.slice(0, limit).map((b: any) => ({
              title: b.title,
              ratingScore: b.ratingScore,
              ageRange: `${b.ageMinMonths || 0}-${b.ageMaxMonths || 36}月`,
              description: b.description,
            }));
          }

          if (category === "all" || category === "activity") {
            const allActivities = getActivitiesData();
            let activities = allActivities.filter((a: any) =>
              (a.targetMonthMin == null || a.targetMonthMin <= month) &&
              (a.targetMonthMax == null || a.targetMonthMax >= month)
            );
            if (query) {
              const q = query.toLowerCase();
              activities = activities.filter((a: any) => a.title?.toLowerCase().includes(q));
            }
            results.activities = activities.slice(0, limit).map((a: any) => ({
              title: a.title,
              goal: a.goal,
              durationMinutes: a.durationMinutes,
            }));
          }

          await logToolCall(name, "success", startTime);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        const results: Record<string, any> = {};

        if (category === "all" || category === "food") {
          const foods = await prisma.foodItem.findMany({
            where: query
              ? {
                  OR: [{ name: { contains: query } }, { foodGroup: { contains: query } }, { category: { contains: query } }],
                }
              : {},
            take: limit,
          });
          results.foods = foods.map((f) => ({
            name: f.name,
            icon: f.icon,
            category: f.category,
            recommendedFromMonth: f.recommendedFromMonth,
            avoidBeforeMonths: f.avoidBeforeMonths,
            chokingRisk: f.chokingRisk,
            isCommonAllergen: f.isCommonAllergen,
          }));
        }

        if (category === "all" || category === "book") {
          const books = await prisma.book.findMany({
            where: query
              ? { OR: [{ title: { contains: query } }, { description: { contains: query } }] }
              : {},
            take: limit,
          });
          results.books = books.map((b) => ({
            title: b.title,
            ratingScore: b.ratingScore,
            ageRange: `${b.ageMinMonths || 0}-${b.ageMaxMonths || 36}月`,
            description: b.description,
          }));
        }

        if (category === "all" || category === "activity") {
          const activities = await prisma.activityRecommendation.findMany({
            where: {
              targetMonthMin: { lte: month },
              targetMonthMax: { gte: month },
              ...(query ? { title: { contains: query } } : {}),
            },
            take: limit,
          });
          results.activities = activities.map((a) => ({
            title: a.title,
            goal: a.goal,
            durationMinutes: a.durationMinutes,
          }));
        }

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      throw new McpError(ErrorCode.MethodNotFound, `Tool '${name}' not recognized`);
    } catch (err: any) {
      await logToolCall(name, "error", startTime, err.message);
      if (err instanceof McpError) throw err;
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: true, message: err?.message || "Internal error" }, null, 2) }],
      };
    }
  });

  async function logToolCall(toolName: string, status: "success" | "error", startTime: number, errorMsg?: string) {
    const duration = Date.now() - startTime;
    await logOAuthAudit({
      clientId: principal.clientId,
      userId: principal.userId,
      babyId: principal.babyId,
      action: "mcp_tool_call",
      toolName,
      authResult: status === "success" ? "success" : errorMsg?.includes("Forbidden") ? "denied" : "error",
      durationMs: duration,
      userAgent: principal.userAgent,
      ip: principal.ip,
      metadata: {
        agent: principal.sourceAgent,
        clientName: principal.clientName,
        ...(errorMsg ? { error: errorMsg } : {}),
      },
    });
  }

  return server;
}
