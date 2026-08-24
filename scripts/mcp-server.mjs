#!/usr/bin/env node

/**
 * Baby Panel MCP Server
 * Exposes Model Context Protocol (MCP) tools for Hermes Agent / AI assistants
 * to read and record baby daily activities, growth metrics, vaccines, and medical reports.
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
import { SignJWT } from "jose";

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

const BASE_URL = process.env.BABY_PANEL_URL || "http://127.0.0.1:3088";
const JWT_SECRET = process.env.JWT_SECRET || "baby_panel_sec_993b482f7d1a4e259c63b88d2f10e4a7";
const secretBytes = new TextEncoder().encode(JWT_SECRET);

async function getServiceAuthHeader() {
  const token = await new SignJWT({ userId: "system-mcp", username: "hermes-agent" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(secretBytes);
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
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
        description: "获取宝宝基本档案信息（姓名、性别、出生日期、实际精准月龄天数、胎龄/早产周数、头像）。",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_daily_summary",
        description: "获取宝宝当天的日常汇总数据（今日累计总奶量ml、总睡眠时长分钟、排便换尿布次数及时间轴记录）。",
        inputSchema: {
          type: "object",
          properties: {
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
          required: ["type"],
          properties: {
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
        name: "record_sleep",
        description: "记录宝宝一次睡眠作息（入睡与醒来时间、白天小睡或夜间长睡眠）。",
        inputSchema: {
          type: "object",
          required: ["startTime", "endTime"],
          properties: {
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
          required: ["type"],
          properties: {
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
          properties: {
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
          properties: {},
        },
      },
      {
        name: "save_medical_report",
        description: "保存一份儿童医学化验单或体检档案（血常规、微量元素、儿保体检、过敏原等），包含各检验项目指标。",
        inputSchema: {
          type: "object",
          required: ["title", "category"],
          properties: {
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
    ],
  };
});

// Handle tool executions
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    const headers = await getServiceAuthHeader();

    if (name === "get_baby_profile") {
      const res = await fetch(`${BASE_URL}/api/baby`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "get_daily_summary") {
      const dateParam = args.date ? `?date=${args.date}` : "";
      const res = await fetch(`${BASE_URL}/api/records/daily-summary${dateParam}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "record_feeding") {
      const payload = {
        ...args,
        timestamp: args.timestamp || new Date().toISOString(),
      };
      const res = await fetch(`${BASE_URL}/api/records/feeding`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return {
        content: [
          {
            type: "text",
            text: `✅ 喂养记录保存成功！\n${JSON.stringify(data, null, 2)}`,
          },
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

      const payload = {
        ...args,
        startTime: start,
        endTime: end,
        date: args.date || new Date().toISOString().split("T")[0],
      };
      const res = await fetch(`${BASE_URL}/api/records/sleep`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return {
        content: [
          {
            type: "text",
            text: `✅ 睡眠记录保存成功！\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    }

    if (name === "record_diaper") {
      const payload = {
        ...args,
        type: args.type || "pee",
        timestamp: args.timestamp || new Date().toISOString(),
      };
      const res = await fetch(`${BASE_URL}/api/records/diaper`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return {
        content: [
          {
            type: "text",
            text: `✅ 排便/换尿布记录保存成功！\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    }

    if (name === "record_growth") {
      const payload = {
        ...args,
        date: args.date || new Date().toISOString().split("T")[0],
      };
      const res = await fetch(`${BASE_URL}/api/growth`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return {
        content: [
          {
            type: "text",
            text: `✅ 生长发育测量记录保存成功！\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    }

    if (name === "get_vaccine_schedule") {
      const res = await fetch(`${BASE_URL}/api/vaccines`, { headers });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "save_medical_report") {
      const payload = {
        ...args,
        date: args.date || new Date().toISOString().split("T")[0],
      };
      const res = await fetch(`${BASE_URL}/api/medical/reports`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return {
        content: [
          {
            type: "text",
            text: `✅ 医学化验单/体检档案保存成功！\n${JSON.stringify(data, null, 2)}`,
          },
        ],
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
