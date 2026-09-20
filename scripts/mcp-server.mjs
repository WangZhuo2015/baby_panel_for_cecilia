#!/usr/bin/env node

/**
 * Baby Panel MCP Server
 * Exposes Model Context Protocol (MCP) tools for external AI assistants
 * to read and record baby daily activities, growth metrics, vaccines, and medical reports.
 * Web chat does not use this server; see docs/adr/0001-no-hermes-for-web-chat.md.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Auto-load .env from project root
try {
  const envPath = path.join(projectRoot, ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        if (!process.env[key]) process.env[key] = value;
      }
    }
  }
} catch {}

const BASE_URL = process.env.BABY_PANEL_URL || `http://127.0.0.1:${process.env.PORT || 3088}`;
const JWT_SECRET = process.env.JWT_SECRET || "";
const MCP_TOKEN = process.env.BABY_PANEL_TOKEN || process.env.JWT_TOKEN || "";
const MCP_USER_ID = process.env.BABY_PANEL_USER_ID || "";
const ALLOW_STATIC_USER = process.env.MCP_ALLOW_STATIC_USER === "1";

const SESSION_PROP = {
  session: {
    type: "string",
    description:
      "必填。从系统提示【MCP会话凭证】原样复制的整串，禁止修改、禁止使用其他值。用于绑定当前家长与当前宝宝，防止串号。",
  },
};

function apiUrl(pathname, babyId, extraQuery = {}) {
  const url = new URL(pathname, BASE_URL);
  if (babyId) url.searchParams.set("babyId", babyId);
  for (const [k, v] of Object.entries(extraQuery)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** Bind this tool call to one parent + one baby. Never trust model-supplied babyId. */
async function bindCall(args = {}) {
  const session = typeof args.session === "string" ? args.session.trim() : "";
  if (session) {
    if (!JWT_SECRET) throw new Error("JWT_SECRET 未配置，拒绝执行 MCP 工具");
    try {
      const { payload } = await jwtVerify(session, new TextEncoder().encode(JWT_SECRET));
      if (
        payload.typ !== "mcp" ||
        typeof payload.userId !== "string" ||
        typeof payload.babyId !== "string" ||
        typeof payload.username !== "string" ||
        !payload.userId ||
        !payload.babyId
      ) {
        throw new Error("invalid");
      }
      const rest = { ...args };
      delete rest.session;
      delete rest.babyId;
      delete rest.userId;
      return {
        userId: payload.userId,
        babyId: payload.babyId,
        args: rest,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session}`,
        },
      };
    } catch {
      throw new Error("session 凭证无效或已过期（防串号）");
    }
  }

  // CLI 单用户兜底：默认关闭。打开等于全网关共用一个家庭，会串号。
  if (ALLOW_STATIC_USER && JWT_SECRET && MCP_USER_ID) {
    const secretBytes = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT({ userId: MCP_USER_ID, username: "mcp-agent" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime("24h")
      .sign(secretBytes);
    const rest = { ...args };
    delete rest.session;
    return {
      userId: MCP_USER_ID,
      babyId: null,
      args: rest,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    };
  }

  if (ALLOW_STATIC_USER && MCP_TOKEN) {
    const rest = { ...args };
    delete rest.session;
    return {
      userId: null,
      babyId: null,
      args: rest,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MCP_TOKEN}`,
      },
    };
  }

  throw new Error("缺少 session 会话凭证，拒绝执行（防串号：不在未绑定家长/宝宝时读写档案）");
}


const server = new Server(
  {
    name: "baby-panel-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tool schemas
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_baby_profile",
        description: "获取当前会话绑定宝宝的基本档案。必须传入 session。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: { ...SESSION_PROP },
        },
      },
      {
        name: "get_daily_summary",
        description: "获取宝宝当天的日常汇总数据（今日累计总奶量ml、总睡眠时长分钟、排便换尿布次数及时间轴记录）。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: {
            ...SESSION_PROP,
            date: {
              type: "string",
              description: "查询日期 (格式: YYYY-MM-DD，留空则默认今天)",
            },
          },
        },
      },
      {
        name: "record_feeding",
        description: "记录宝宝一次喂养事件（母乳亲喂、配方奶粉、瓶喂母乳或混合喂养）。",
        inputSchema: {
          type: "object",
          required: ["session", "type"],
          properties: {
            ...SESSION_PROP,
            type: {
              type: "string",
              enum: ["breast", "formula", "bottle_breast", "mixed"],
              description: "喂养类型: breast(母乳亲喂), formula(配方奶), bottle_breast(瓶喂母乳), mixed(混合)",
            },
            amountMl: {
              type: "number",
              description: "喂养奶量毫升数（配方奶或瓶喂必填，亲喂可选）",
            },
            durationMinutes: {
              type: "number",
              description: "喂养时长（分钟）",
            },
            notes: {
              type: "string",
              description: "喂养备注（如：拍嗝顺畅、有轻微溢奶、添加维生素D等）",
            },
            timestamp: {
              type: "string",
              description: "记录时间 (ISO 8601 字符串，留空默认为当前时间)",
            },
          },
        },
      },
      {
        name: "record_food",
        description: "记录宝宝一次辅食餐点（米粉、菜泥、果泥、肉泥、手指食物等）。",
        inputSchema: {
          type: "object",
          required: ["session", "foods"],
          properties: {
            ...SESSION_PROP,
            foods: {
              type: "array",
              items: { type: "string" },
              description: "辅食食材名称列表（如 [\"高铁米粉\", \"胡萝卜泥\"]）",
            },
            date: {
              type: "string",
              description: "日期 (格式: YYYY-MM-DD，默认今天)",
            },
            time: {
              type: "string",
              description: "时间 (格式: HH:mm，如 12:30，默认当前时间)",
            },
            portion: {
              type: "string",
              enum: ["little", "half", "most", "all"],
              description: "进食量: little(少量), half(半碗), most(大部分), all(全部)",
            },
            acceptance: {
              type: "number",
              description: "宝宝喜欢程度 (1-5 星)",
            },
            babyState: {
              type: "string",
              enum: ["happy", "neutral", "rejected"],
              description: "进食状态: happy(开心), neutral(一般), rejected(抗拒)",
            },
            hasAbnormal: {
              type: "boolean",
              description: "是否有过敏或不适等异常",
            },
            abnormalNotes: {
              type: "string",
              description: "异常情况描述或备注",
            },
          },
        },
      },
      {
        name: "record_sleep",
        description: "记录宝宝一次睡眠作息（入睡与醒来时间、白天小睡或夜间长睡眠）。",
        inputSchema: {
          type: "object",
          required: ["session", "startTime", "endTime"],
          properties: {
            ...SESSION_PROP,
            startTime: {
              type: "string",
              description: "入睡时间 (格式: HH:mm，如 14:00)",
            },
            endTime: {
              type: "string",
              description: "醒来时间 (格式: HH:mm，如 15:30)",
            },
            type: {
              type: "string",
              enum: ["day", "night"],
              description: "睡眠类型: day(白天小睡), night(夜间睡眠)",
            },
            fallingAsleepMethod: {
              type: "string",
              description: "入睡方式（自主入睡、奶睡、抱哄等）",
            },
            wakeUpMood: {
              type: "string",
              description: "醒来情绪（开心微笑、哭闹等）",
            },
            notes: {
              type: "string",
              description: "睡眠状态备注",
            },
            date: {
              type: "string",
              description: "记录日期 (YYYY-MM-DD，留空默认为今天)",
            },
          },
        },
      },
      {
        name: "record_diaper",
        description: "记录宝宝一次换尿布/排便事件（尿尿、便便状态与颜色）。",
        inputSchema: {
          type: "object",
          required: ["session", "type"],
          properties: {
            ...SESSION_PROP,
            type: {
              type: "string",
              enum: ["pee", "poop", "both"],
              description: "类型: pee(仅尿), poop(仅便), both(尿+便)",
            },
            poopColor: {
              type: "string",
              enum: ["yellow", "green", "brown", "other"],
              description: "大便颜色: yellow(黄色), green(绿色), brown(棕色), other(其他)",
            },
            poopConsistency: {
              type: "string",
              enum: ["soft", "watery", "hard", "seedy"],
              description: "大便性状: soft(软糊状), watery(水样稀便), hard(干硬便), seedy(含奶瓣)",
            },
            notes: {
              type: "string",
              description: "排便与臀部皮肤状态备注（如：轻微红屁屁、已涂护臀霜）",
            },
            timestamp: {
              type: "string",
              description: "记录时间 (ISO 8601 字符串，留空默认为当前时间)",
            },
          },
        },
      },
      {
        name: "record_growth",
        description: "记录宝宝一次生长发育测量数据（体重、身长、头围），并可评估 WHO 百分位。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: {
            ...SESSION_PROP,
            weightKg: {
              type: "number",
              description: "体重 (千克/kg，如 8.2)",
            },
            heightCm: {
              type: "number",
              description: "身长/身高 (厘米/cm，如 68.5)",
            },
            headCircumferenceCm: {
              type: "number",
              description: "头围 (厘米/cm，如 43.0)",
            },
            date: {
              type: "string",
              description: "测量日期 (YYYY-MM-DD，留空默认为今天)",
            },
            notes: {
              type: "string",
              description: "测量备注（如：社区体检、空腹测量等）",
            },
          },
        },
      },
      {
        name: "get_vaccine_schedule",
        description: "查询宝宝当前的疫苗接种规划（近30天待接种项、已过期项、0-3岁完整接种日程与二类苗推荐）。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: { ...SESSION_PROP },
        },
      },
      {
        name: "save_medical_report",
        description: "保存一份儿童医学化验单或体检档案（血常规、微量元素、儿保体检、过敏原等），包含各检验项目指标。",
        inputSchema: {
          type: "object",
          required: ["session", "title", "category"],
          properties: {
            ...SESSION_PROP,
            title: {
              type: "string",
              description: "报告名称（如：末梢血常规化验单、6月龄儿保体检表）",
            },
            category: {
              type: "string",
              enum: ["blood", "growth", "trace_element", "allergy", "general"],
              description: "单据类型: blood(血常规), growth(体检), trace_element(微量元素), allergy(过敏原), general(其他)",
            },
            date: {
              type: "string",
              description: "就诊/检查日期 (YYYY-MM-DD，留空默认为今天)",
            },
            hospital: {
              type: "string",
              description: "就诊医院或医疗机构名称",
            },
            aiSummary: {
              type: "string",
              description: "AI 儿科医学总结与注意事项解读",
            },
            growthData: {
              type: "object",
              description: "体检伴随的体格测量（weightKg, heightCm, headCircumferenceCm）",
            },
            items: {
              type: "array",
              description: "检测指标列表",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "项目名称，如 白细胞计数 (WBC)" },
                  value: { type: "string", description: "结果数值" },
                  unit: { type: "string", description: "单位" },
                  referenceRange: { type: "string", description: "参考区间" },
                  status: { type: "string", enum: ["normal", "high", "low", "abnormal"] },
                },
              },
            },
          },
        },
      },
      {
        name: "get_recent_records",
        description: "查询宝宝今日或近期的具体活动时间轴记录（包含吃奶、睡眠、排便、辅食每次的具体时间与量）。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: {
            ...SESSION_PROP,
            date: { type: "string", description: "日期 (YYYY-MM-DD，默认今天)" },
            limit: { type: "number", description: "返回数量上限，默认 20" },
          },
        },
      },
      {
        name: "query_food_item",
        description: "查询食材库中某食材的月龄指引、防噎防窒息处理方式、过敏原风险与营养搭配。",
        inputSchema: {
          type: "object",
          required: ["session", "name"],
          properties: {
            ...SESSION_PROP,
            name: { type: "string", description: "食材名称，如'牛油果'、'南瓜'、'鸡蛋'等" },
          },
        },
      },
      {
        name: "record_food_plan",
        description: "为宝宝保存一日辅食食谱计划（包含餐点名、主要食材、制作步骤与营养要点）。",
        inputSchema: {
          type: "object",
          required: ["session", "name", "ingredients", "steps"],
          properties: {
            ...SESSION_PROP,
            date: { type: "string", description: "日期 (YYYY-MM-DD，默认今天或明天)" },
            name: { type: "string", description: "食谱名称，如'高铁牛肉胡萝卜米糊'" },
            ingredients: { type: "array", items: { type: "string" }, description: "食材清单" },
            steps: { type: "array", items: { type: "string" }, description: "制作步骤" },
            nutrition: { type: "string", description: "营养要点" },
            tags: { type: "array", items: { type: "string" }, description: "标签" },
          },
        },
      },
      {
        name: "get_development_milestones",
        description: "查询指定月龄或领域的国家卫健委儿童发育里程碑（大运动、精细动作、语言、认知、社交）。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: {
            ...SESSION_PROP,
            month: { type: "number", description: "评估月龄（1-36），默认当前月龄" },
            category: { type: "string", description: "领域分类（gross_motor, fine_motor, language, cognitive, social_emotional）" },
          },
        },
      },
      {
        name: "get_warning_signs",
        description: "查询指定月龄的发育迟缓预警信号与红线就医指征。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: {
            ...SESSION_PROP,
            month: { type: "number", description: "月龄（1-36）" },
          },
        },
      },
      {
        name: "record_vaccine",
        description: "记录宝宝已完成接种的疫苗剂次（如'乙肝疫苗第2剂'）。",
        inputSchema: {
          type: "object",
          required: ["session", "name"],
          properties: {
            ...SESSION_PROP,
            name: { type: "string", description: "疫苗名称" },
            dose: { type: "string", description: "剂次，如'第1剂'、'第2剂'" },
            completedDate: { type: "string", description: "接种日期 (YYYY-MM-DD，默认今天)" },
          },
        },
      },
      {
        name: "get_recommended_books",
        description: "查询精选绘本馆中适合当前宝宝月龄的绘本、评分、适读要点及亲子共读互动建议。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: {
            ...SESSION_PROP,
            tag: { type: "string", description: "主题标签或关键词" },
            month: { type: "number", description: "适读月龄" },
          },
        },
      },
      {
        name: "get_activity_recommendations",
        description: "查询适合当前宝宝月龄的家庭早教与亲子互动游戏、安全指引与发展目标。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: {
            ...SESSION_PROP,
            month: { type: "number", description: "月龄" },
          },
        },
      },
      {
        name: "web_search",
        description: "通过互联网实时搜索最新的育儿科普、儿科指南、药品说明、疫苗政策与专业护理知识。",
        inputSchema: {
          type: "object",
          required: ["session", "query"],
          properties: {
            ...SESSION_PROP,
            query: { type: "string", description: "搜索关键词" },
            limit: { type: "number", description: "结果条数，默认 5" },
          },
        },
      },
      {
        name: "record_supplement",
        description: "为宝宝打卡补充剂（如维生素D3滴剂、伊可新AD、液体钙/乳钙、补铁滴剂、锌剂、DHA等），内置儿科安全上限与防过量冲突检测。",
        inputSchema: {
          type: "object",
          required: ["session", "name"],
          properties: {
            ...SESSION_PROP,
            name: { type: "string", description: "补剂名称（如'维生素D3'、'伊可新AD'、'液体钙'）" },
            units: { type: "number", description: "服用剂量单位数（如 1 粒、2 滴、5 ml），默认 1.0" },
            timestamp: { type: "string", description: "服用时间 (ISO 8601 字符串或 HH:mm，默认当前时间)" },
            notes: { type: "string", description: "备注说明" },
            forceOverride: { type: "boolean", description: "如检测到同日成分冲突或超量警告，是否遵医嘱强制打卡，默认 false" },
          },
        },
      },
      {
        name: "create_supplement_product",
        description: "在当前家庭建档或更新营养补充剂产品，无需同时记录一次服用。",
        inputSchema: {
          type: "object",
          required: ["session", "name"],
          properties: {
            ...SESSION_PROP,
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
        name: "get_nutrition_analysis",
        description: "查询宝宝单日或近7天/30天全量营养素摄入汇总（包含总奶量、维生素D、维生素A、钙、铁、锌、DHA、能量、蛋白质等）、DRIs 2023 推荐量达标率与安全上限 (UL) 状态。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: {
            ...SESSION_PROP,
            date: { type: "string", description: "查询日期 (YYYY-MM-DD)，默认今天" },
            days: { type: "number", description: "分析时间跨度天数: 1 (单日详情), 7 (近7天趋势), 30 (近30天趋势)，默认 1" },
          },
        },
      },
      {
        name: "query_nutrition_products",
        description: "查询家庭当前正在使用 (Active) 或已录入的配方奶粉与补剂档案详情（包含冲调浓度、成分表、单次剂量等）。",
        inputSchema: {
          type: "object",
          required: ["session"],
          properties: {
            ...SESSION_PROP,
            type: { type: "string", enum: ["all", "formula", "supplement"], description: "筛选类型" },
          },
        },
      },
    ],
  };
});

async function postJson(path, bound, payload) {
  const body = bound.babyId ? { ...payload, babyId: bound.babyId } : payload;
  const res = await fetch(apiUrl(path, bound.babyId || ""), {
    method: "POST",
    headers: bound.headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Handle tool executions
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs = {} } = request.params;

  try {
    const bound = await bindCall(rawArgs);
    const args = bound.args;
    const headers = bound.headers;

    if (name === "get_baby_profile") {
      const res = await fetch(apiUrl("/api/baby", bound.babyId || ""), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "get_daily_summary") {
      const extra = args.date ? { date: args.date } : {};
      const res = await fetch(apiUrl("/api/records/daily-summary", bound.babyId || "", extra), {
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "record_feeding") {
      const data = await postJson("/api/records/feeding", bound, {
        ...args,
        timestamp: args.timestamp || new Date().toISOString(),
      });
      return {
        content: [
          { type: "text", text: `✅ 喂养记录保存成功！\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    if (name === "record_food") {
      const data = await postJson("/api/food/logs", bound, {
        ...args,
        date: args.date || new Date().toISOString().split("T")[0],
        time: args.time || new Date().toTimeString().slice(0, 5),
      });
      return {
        content: [
          { type: "text", text: `✅ 辅食记录保存成功！\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    if (name === "record_sleep") {
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      const start = String(args.startTime || "").trim();
      const end = String(args.endTime || "").trim();
      if (!timeRegex.test(start) || !timeRegex.test(end)) {
        throw new Error(`时间格式不正确，需为 24小时制 HH:mm (00:00-23:59)，如 "14:00"`);
      }
      const data = await postJson("/api/records/sleep", bound, {
        ...args,
        startTime: start,
        endTime: end,
        date: args.date || new Date().toISOString().split("T")[0],
      });
      return {
        content: [
          { type: "text", text: `✅ 睡眠记录保存成功！\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    if (name === "record_diaper") {
      const data = await postJson("/api/records/diaper", bound, {
        ...args,
        type: args.type || "pee",
        timestamp: args.timestamp || new Date().toISOString(),
      });
      return {
        content: [
          { type: "text", text: `✅ 排便/换尿布记录保存成功！\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    if (name === "record_growth") {
      const data = await postJson("/api/growth", bound, {
        ...args,
        date: args.date || new Date().toISOString().split("T")[0],
      });
      return {
        content: [
          { type: "text", text: `✅ 生长发育测量记录保存成功！\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    if (name === "get_vaccine_schedule") {
      const res = await fetch(apiUrl("/api/vaccines", bound.babyId || ""), { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "save_medical_report") {
      const data = await postJson("/api/medical/reports", bound, {
        ...args,
        date: args.date || new Date().toISOString().split("T")[0],
      });
      return {
        content: [
          { type: "text", text: `✅ 医学化验单/体检档案保存成功！\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    if (name === "get_recent_records") {
      const extra = {};
      if (args.date) extra.date = args.date;
      const res = await fetch(apiUrl("/api/records/timeline", bound.babyId || "", extra), { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "query_food_item") {
      const res = await fetch(apiUrl("/api/food/items", "", { search: args.name }), { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "record_food_plan") {
      const data = await postJson("/api/food/plans", bound, {
        ...args,
        date: args.date || new Date().toISOString().split("T")[0],
        ingredients: args.ingredients || [],
        steps: args.steps || [],
        tags: args.tags || ["营养辅食"],
      });
      return {
        content: [
          { type: "text", text: `✅ 辅食计划食谱保存成功！\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    if (name === "get_development_milestones") {
      const extra = {};
      if (args.month != null) extra.month = args.month;
      if (args.category) extra.category = args.category;
      const res = await fetch(apiUrl("/api/development/milestones", "", extra), { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "get_warning_signs") {
      const res = await fetch(apiUrl("/api/development/warning-signs", ""), { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "record_vaccine") {
      const data = await postJson("/api/vaccines", bound, {
        ...args,
        completedDate: args.completedDate || new Date().toISOString().split("T")[0],
        isCompleted: true,
      });
      return {
        content: [
          { type: "text", text: `✅ 疫苗接种记录保存成功！\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    if (name === "get_recommended_books") {
      const extra = {};
      if (args.tag) extra.tab = args.tag;
      const res = await fetch(apiUrl("/api/books", "", extra), { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "get_activity_recommendations") {
      const extra = {};
      if (args.month != null) extra.month = args.month;
      const res = await fetch(apiUrl("/api/development/activities", "", extra), { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "web_search") {
      const extra = { q: args.query };
      if (args.limit) extra.limit = args.limit;
      const res = await fetch(apiUrl("/api/ai/search", "", extra), { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "record_supplement") {
      const data = await postJson("/api/nutrition/records", bound, {
        ...args,
        units: args.units || 1.0,
        timestamp: args.timestamp || new Date().toISOString(),
      });
      return {
        content: [
          { type: "text", text: `✅ 补剂打卡记录成功！\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    if (name === "create_supplement_product") {
      const data = await postJson("/api/nutrition/products", bound, {
        type: "supplement",
        name: args.name,
        brand: args.brand,
        dosageForm: args.dosageForm || "drops",
        unitName: args.unitName || "滴",
        defaultDose: args.defaultDose || 1,
        nutrients: args.nutrients || {},
        notes: args.notes,
      });
      return { content: [{ type: "text", text: `✅ 营养补剂建档成功！\n${JSON.stringify(data, null, 2)}` }] };
    }

    if (name === "get_nutrition_analysis") {
      const extra = {};
      if (args.date) extra.date = args.date;
      if (args.days) extra.days = args.days;
      const res = await fetch(apiUrl("/api/nutrition/analysis", bound.babyId || "", extra), { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "query_nutrition_products") {
      const extra = {};
      if (args.type) extra.type = args.type;
      const res = await fetch(apiUrl("/api/nutrition/products", bound.babyId || "", extra), { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `❌ 执行失败: ${error?.message || String(error)}` }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error in MCP server:", error);
  process.exit(1);
});
