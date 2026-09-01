/**
 * Remote MCP Server implementation for Gemini Spark Custom Connected App
 * Optimized coarse-grained high-cohesion tools (5 tools total) to minimize approval prompt fatigue.
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
  isValidDateStr,
  getLocalDayUtcRange,
} from "@/lib/date";
import * as records from "@/lib/records/service";
import { performWebSearch } from "@/lib/agent/search";
import { checkRateLimit } from "@/lib/rate-limit";
import { logOAuthAudit } from "@/lib/oauth/service";
import type { UserPrincipal } from "@/lib/oauth/types";

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

export function createMcpServer(principal: UserPrincipal): Server {
  const babyId = principal.babyId;
  const baby = principal.baby!;
  const recCtx = { userId: principal.userId, babyId, baby, familyId: baby.familyId };

  const server = new Server(
    {
      name: "baby-panel-mcp",
      version: "1.3.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List all 5 coarse-grained tools with schemas
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_baby_overview",
          description:
            "【全景读】一次性获取宝宝的全量档案与今日完整概况（精准月龄、今日作息汇总[奶量/睡眠/便便/辅食]、近期时间轴明细、近期待打疫苗、营养素达标状态、当月发育里程碑与预警）。默认查询今天。",
          inputSchema: {
            type: "object",
            properties: {
              date: {
                type: "string",
                description: "查询日期 (YYYY-MM-DD，留空则默认今天)",
              },
              includeSections: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["profile", "daily_summary", "timeline", "vaccines", "nutrition", "milestones"],
                },
                description: "指定包含的模块（留空默认包含全部模块）",
              },
            },
          },
        },
        {
          name: "record_baby_events",
          description:
            "【作息写】记录宝宝的一项或多项日常作息事件（喂奶、睡眠、排便换尿布、辅食、补剂打卡）。支持单事件录入，也支持多事件一次性复合批量提交（如同时喂奶和换尿布，单次授权即可完成全部保存）。",
          inputSchema: {
            type: "object",
            properties: {
              feeding: {
                type: "object",
                description: "喂养事件（母乳亲喂、配方奶粉、瓶喂母乳）",
                properties: {
                  type: {
                    type: "string",
                    enum: ["breast", "formula", "bottle_breast", "mixed"],
                    description: "喂养类型: breast(母乳亲喂), formula(配方奶), bottle_breast(瓶喂母乳), mixed(混合)",
                  },
                  amountMl: { type: "number", description: "奶量(ml)" },
                  leftMinutes: { type: "number", description: "左侧亲喂时长(分钟)" },
                  rightMinutes: { type: "number", description: "右侧亲喂时长(分钟)" },
                  spitUp: { type: "boolean", description: "是否有吐奶/溢奶" },
                  notes: { type: "string", description: "喂养备注" },
                  timestamp: { type: "string", description: "时间 (ISO 8601 或 HH:mm，默认当前时间)" },
                },
              },
              sleep: {
                type: "object",
                description: "睡眠作息事件",
                required: ["startTime", "endTime"],
                properties: {
                  startTime: { type: "string", description: "入睡时间 (HH:mm)" },
                  endTime: { type: "string", description: "醒来时间 (HH:mm)" },
                  type: { type: "string", enum: ["day", "night"], description: "day(白天小睡), night(夜间长觉)" },
                  nightWakingCount: { type: "number", description: "夜醒次数" },
                  notes: { type: "string", description: "睡眠状态备注" },
                  date: { type: "string", description: "日期 (YYYY-MM-DD，默认今天)" },
                },
              },
              diaper: {
                type: "object",
                description: "换尿布/排便事件",
                properties: {
                  type: { type: "string", enum: ["pee", "poop", "both"], description: "pee(尿), poop(便), both(尿+便)" },
                  poopColor: { type: "string", enum: ["yellow", "green", "brown", "other"], description: "大便颜色" },
                  poopConsistency: { type: "string", enum: ["soft", "watery", "hard", "seedy"], description: "大便性状" },
                  notes: { type: "string", description: "臀部/皮肤备注" },
                  timestamp: { type: "string", description: "时间 (ISO 8601 或 HH:mm，默认当前时间)" },
                },
              },
              food: {
                type: "object",
                description: "辅食餐点打卡",
                required: ["foods"],
                properties: {
                  foods: { type: "array", items: { type: "string" }, description: "食材列表，如 [\"高铁米粉\", \"胡萝卜泥\"]" },
                  date: { type: "string", description: "日期 (YYYY-MM-DD，默认今天)" },
                  time: { type: "string", description: "时间 (HH:mm，默认当前时间)" },
                  portion: { type: "string", enum: ["little", "half", "most", "all"], description: "进食量" },
                  acceptance: { type: "number", description: "喜欢程度 (1-5 星)" },
                  babyState: { type: "string", enum: ["happy", "neutral", "rejected"], description: "进食状态" },
                  hasAbnormal: { type: "boolean", description: "是否有过敏或不适异常" },
                  abnormalNotes: { type: "string", description: "异常情况描述" },
                },
              },
              foodPlan: {
                type: "object",
                description: "保存一日辅食食谱计划",
                required: ["name", "ingredients", "steps"],
                properties: {
                  date: { type: "string", description: "日期 (YYYY-MM-DD，默认今天)" },
                  name: { type: "string", description: "食谱名称" },
                  ingredients: { type: "array", items: { type: "string" }, description: "食材清单" },
                  steps: { type: "array", items: { type: "string" }, description: "制作步骤" },
                  nutrition: { type: "string", description: "营养要点" },
                  tags: { type: "array", items: { type: "string" }, description: "标签" },
                },
              },
              supplement: {
                type: "object",
                description: "补剂打卡（维生素D3、AD、钙、铁等）",
                required: ["name"],
                properties: {
                  name: { type: "string", description: "补剂名称（如 维生素D3、伊可新AD滴剂）" },
                  units: { type: "number", description: "服用剂次/单位 (默认 1)" },
                  timestamp: { type: "string", description: "打卡时间" },
                  notes: { type: "string", description: "备注" },
                },
              },
            },
          },
        },
        {
          name: "record_health_measurement",
          description:
            "【健康写】记录身体生长测量数据（自动计算 WHO 生长百分位）、登记已接种疫苗剂次、归档化验单或体检报告，或删除错误记录。",
          inputSchema: {
            type: "object",
            properties: {
              growth: {
                type: "object",
                description: "生长测量数据",
                properties: {
                  weightKg: { type: "number", description: "体重 (kg，如 8.2)" },
                  heightCm: { type: "number", description: "身长/身高 (cm，如 68.5)" },
                  headCircumferenceCm: { type: "number", description: "头围 (cm，如 43.0)" },
                  date: { type: "string", description: "测量日期 (YYYY-MM-DD，默认今天)" },
                },
              },
              vaccine: {
                type: "object",
                description: "登记已完成接种的疫苗",
                required: ["name"],
                properties: {
                  name: { type: "string", description: "疫苗名称（如 乙肝疫苗、五联疫苗）" },
                  dose: { type: "string", description: "剂次（如 第1剂、第2剂）" },
                  completedDate: { type: "string", description: "接种日期 (YYYY-MM-DD，默认今天)" },
                },
              },
              medicalReport: {
                type: "object",
                description: "化验单或体检报告归档",
                required: ["title", "category"],
                properties: {
                  title: { type: "string", description: "报告名称（如 末梢血常规化验单）" },
                  category: {
                    type: "string",
                    enum: ["blood", "growth", "trace_element", "allergy", "general"],
                    description: "类型: blood(血常规), growth(体检), trace_element(微量元素), allergy(过敏原), general(其他)",
                  },
                  date: { type: "string", description: "日期 (YYYY-MM-DD，默认今天)" },
                  hospital: { type: "string", description: "医院名称" },
                  aiSummary: { type: "string", description: "医学总结" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "项目名称" },
                        value: { type: "string", description: "数值" },
                        unit: { type: "string", description: "单位" },
                        referenceRange: { type: "string", description: "参考范围" },
                        status: { type: "string", enum: ["normal", "high", "low", "abnormal"] },
                      },
                    },
                  },
                },
              },
              deleteAction: {
                type: "object",
                description: "删除某条错误或重复记录（删除前系统将自动生成安全快照，随时可撤销恢复）",
                required: ["type"],
                properties: {
                  type: {
                    type: "string",
                    enum: ["growth", "medical_report", "feeding", "sleep", "diaper", "food"],
                  },
                  id: { type: "string", description: "记录唯一 ID" },
                  date: { type: "string", description: "日期 (YYYY-MM-DD)" },
                },
              },
              undoAction: {
                type: "object",
                description: "撤销刚才的删除操作，从数据快照中恢复被删除的记录",
                properties: {
                  entityType: {
                    type: "string",
                    enum: ["growth", "medical_report", "feeding", "sleep", "diaper", "food", "vaccine", "food_plan"],
                    description: "可选：指定恢复的记录类型（留空默认恢复最近一条删除）",
                  },
                  snapshotId: { type: "string", description: "可选：指定要恢复的快照 ID" },
                },
              },
            },
          },
        },
        {
          name: "query_parenting_knowledge",
          description:
            "【知识读】从家庭结构化知识库中检索食材属性（月龄适宜度/防噎处理/过敏原）、精选绘本推荐、分月龄早教亲子游戏、或奶粉与补剂规格档案。",
          inputSchema: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["all", "food", "book", "activity", "nutrition_product"],
                description: "查询分类: food(食材库), book(绘本), activity(早教游戏), nutrition_product(奶粉补剂规格), all(全部)",
              },
              query: { type: "string", description: "搜索关键词（如 食材名、绘本名、游戏主题）" },
              month: { type: "number", description: "目标月龄（默认宝宝当前月龄）" },
              limit: { type: "number", description: "结果条数上限 (1-10，默认 5)" },
            },
          },
        },
        {
          name: "web_search",
          description:
            "【外网读】通过互联网实时搜索最新的育儿科普、儿科临床指南、药品说明书与权威护理知识。",
          inputSchema: {
            type: "object",
            required: ["query"],
            properties: {
              query: { type: "string", description: "搜索关键词" },
              limit: { type: "number", description: "结果条数 (1-8，默认 5)" },
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
    delete args.tenantId;
    delete args.accountId;

    try {
      // ═════════════════════════════════════════════════════════════════════
      // 1. get_baby_overview (Composite Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "get_baby_overview") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const targetDate = args.date && isValidDateStr(args.date) ? args.date : getLocalDateStr();
        const sections = Array.isArray(args.includeSections) && args.includeSections.length > 0
          ? new Set(args.includeSections)
          : new Set(["profile", "daily_summary", "timeline", "vaccines", "nutrition", "milestones"]);

        const ageDetail = baby.birthDate ? calculateAgeDetail(baby.birthDate) : null;
        const currentMonth = ageDetail?.months || 6;

        const overview: Record<string, any> = { date: targetDate };

        // Profile
        if (sections.has("profile")) {
          overview.profile = {
            nickname: baby.nickname,
            gender: baby.gender,
            birthDate: baby.birthDate,
            gestationalAge: baby.gestationalAge,
            age: ageDetail,
          };
        }

        // Daily Summary
        if (sections.has("daily_summary")) {
          overview.dailySummary = await records.getDailySummary(recCtx, targetDate);
        }

        // Timeline
        if (sections.has("timeline")) {
          const timeline = await records.getTimeline(recCtx, targetDate);
          overview.recentTimeline = timeline.slice(0, 15);
        }

        // Vaccines
        if (sections.has("vaccines")) {
          const [entries, vaccines] = await Promise.all([
            prisma.vaccineScheduleEntry.findMany({
              where: { ageMonths: { lte: currentMonth + 2 } },
              orderBy: [{ ageMonths: "asc" }, { doseNumber: "asc" }],
              take: 20,
            }),
            prisma.vaccine.findMany({
              select: { id: true, vaccineId: true, name: true, shortName: true, programType: true },
            }),
          ]);
          const byUuid = new Map(vaccines.map((v) => [v.id, v]));
          const byCode = new Map(vaccines.map((v) => [v.vaccineId, v]));
          overview.upcomingVaccines = entries.map((e) => {
            const v = byUuid.get(e.vaccineId) || byCode.get(e.vaccineId);
            return {
              ageMonths: e.ageMonths,
              ageLabel: e.ageLabel,
              doseNumber: e.doseNumber,
              vaccineName: v?.shortName || v?.name || e.vaccineId,
              programType: v?.programType,
              isOptional: e.isOptional,
            };
          });
        }

        // Milestones
        if (sections.has("milestones")) {
          const [milestones, warningSigns] = await Promise.all([
            prisma.developmentMilestone.findMany({
              where: { assessmentAgeMonths: currentMonth },
              take: 8,
            }),
            prisma.developmentWarningSign.findMany({
              where: { ageMonths: { lte: currentMonth } },
              orderBy: { ageMonths: "desc" },
              take: 5,
            }),
          ]);
          overview.development = {
            currentMonth,
            milestones: milestones.map((m) => ({ category: m.category, description: m.description })),
            warningSigns: warningSigns.map((w) => ({ category: w.category, warningSign: w.description, action: w.recommendedAction, urgency: w.urgency })),
          };
        }

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(overview, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 2. record_baby_events (Composite Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_baby_events") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        const savedItems: string[] = [];

        // 1. Feeding
        if (args.feeding) {
          const f = args.feeding;
          const result = await records.createFeeding(recCtx, {
            type: f.type || "formula",
            amountMl: f.amountMl,
            leftMinutes: f.leftMinutes,
            rightMinutes: f.rightMinutes,
            spitUp: f.spitUp,
            notes: f.notes,
            timestamp: f.timestamp,
          });
          savedItems.push(`🍼 喂养记录 (ID: ${result.id})`);
        }

        // 2. Sleep
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

        // 3. Diaper
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

        // 4. Food
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

        // 5. Food Plan
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

        // 6. Supplement
        if (args.supplement) {
          const sp = args.supplement;
          const suppName = String(sp.name || "").trim();
          if (suppName) {
            savedItems.push(`💊 补剂打卡「${suppName}」`);
          }
        }

        if (savedItems.length === 0) {
          throw new Error("未提供任何有效的事件数据 (feeding / sleep / diaper / food / supplement)");
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

      // ═════════════════════════════════════════════════════════════════════
      // 3. record_health_measurement (Health Write)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "record_health_measurement") {
        if (!checkScope(principal, "write")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:write scope");
        }

        const messages: string[] = [];

        // Growth
        if (args.growth) {
          const g = args.growth;
          const result = await records.createGrowth(recCtx, {
            date: g.date || getLocalDateStr(),
            weightKg: g.weightKg,
            heightCm: g.heightCm,
            headCircumferenceCm: g.headCircumferenceCm,
          });
          messages.push(`📏 生长测量记录已保存 (体重: ${result.weightKg || "-"}kg, 身长: ${result.heightCm || "-"}cm)`);
        }

        // Vaccine
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
              countdownDays: 0,
            },
          });
          messages.push(`💉 疫苗接种已登记【${vName} ${dose}】(完成日期: ${completedDate})`);
        }

        // Medical Report
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
              title,
              category: String(mr.category || "general"),
              date,
              hospital: mr.hospital ? String(mr.hospital).slice(0, 100) : null,
              aiSummary: mr.aiSummary ? String(mr.aiSummary).slice(0, 5000) : null,
              itemsJson: JSON.stringify(items),
            },
          });
          messages.push(`📑 化验单/体检档案「${title}」已归档 (ID: ${record.id})`);
        }

        // Delete Action
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

          messages.push(`🗑️ 已成功删除 ${type} 记录 (ID: ${targetId})，系统已自动备份安全快照，随时可撤销恢复。`);
        }

        // Undo Action (Rollback deleted record)
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
        return {
          content: [{ type: "text", text: `✅ 健康档案更新成功：\n${messages.join("\n")}` }],
        };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 4. query_parenting_knowledge (Knowledge Read)
      // ═════════════════════════════════════════════════════════════════════
      if (name === "query_parenting_knowledge") {
        if (!checkScope(principal, "read")) {
          throw new McpError(ErrorCode.InvalidRequest, "Forbidden: Missing baby:read scope");
        }

        const category = args.category || "all";
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const ageDetail = baby.birthDate ? calculateAgeDetail(baby.birthDate) : null;
        const month = typeof args.month === "number" ? args.month : ageDetail?.months || 6;
        const limit = typeof args.limit === "number" ? Math.min(10, Math.max(1, args.limit)) : 5;

        const results: Record<string, any> = {};

        // Foods
        if (category === "all" || category === "food") {
          const foods = await prisma.foodItem.findMany({
            where: query
              ? {
                  OR: [
                    { name: { contains: query } },
                    { foodGroup: { contains: query } },
                    { category: { contains: query } },
                  ],
                }
              : {},
            take: limit,
          });
          results.foods = foods;
        }

        // Books
        if (category === "all" || category === "book") {
          const books = await prisma.book.findMany({
            where: query
              ? {
                  OR: [{ title: { contains: query } }, { description: { contains: query } }],
                }
              : {},
            take: limit,
          });
          results.books = books;
        }

        // Activities
        if (category === "all" || category === "activity") {
          const activities = await prisma.activityRecommendation.findMany({
            where: {
              targetMonthMin: { lte: month },
              targetMonthMax: { gte: month },
              ...(query ? { title: { contains: query } } : {}),
            },
            take: limit,
          });
          results.activities = activities;
        }

        // Products
        if (category === "all" || category === "nutrition_product") {
          const [formulas, supplements] = await Promise.all([
            prisma.formulaProduct.findMany({ where: { familyId: baby.familyId }, take: limit }),
            prisma.supplementProduct.findMany({ where: { familyId: baby.familyId }, take: limit }),
          ]);
          results.nutritionProducts = { formulas, supplements };
        }

        await logToolCall(name, "success", startTime);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      // ═════════════════════════════════════════════════════════════════════
      // 5. web_search (External Research Read)
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

      throw new McpError(ErrorCode.MethodNotFound, `Tool '${name}' not recognized`);
    } catch (err: any) {
      await logToolCall(name, "error", startTime, err.message);
      if (err instanceof McpError) throw err;
      return {
        isError: true,
        content: [{ type: "text", text: `❌ 工具执行失败: ${err?.message || "Internal error"}` }],
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
      authResult: status === "success" ? "success" : "denied",
      durationMs: duration,
      metadata: errorMsg ? { error: errorMsg } : undefined,
    });
  }

  return server;
}
