import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { buildAgentSystemPrompt } from "@/lib/agent/prompt";
import { makeRecordFeedingTool } from "@/lib/agent/tools/feeding";
import { makeRecordSleepTool } from "@/lib/agent/tools/sleep";
import { makeRecordFoodTool } from "@/lib/agent/tools/food";
import { makeRecordGrowthTool } from "@/lib/agent/tools/growth";
import type { Baby } from "@/generated/prisma/client";

const mockBaby: Baby = {
  id: "baby_test_123",
  familyId: "fam_test_123",
  nickname: "小核桃",
  gender: "male",
  birthDate: "2026-01-01",
  gestationalAge: 39,
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

test("Data Entry Clarification: System Prompt contains strict follow-up rules", () => {
  const prompt = buildAgentSystemPrompt({ baby: mockBaby });
  
  assert.ok(prompt.includes("数据录入智能追问与确认机制"), "System prompt must include clarification protocol");
  assert.ok(prompt.includes("严禁直接调用工具生成残缺或占位记录"), "System prompt must ban saving incomplete placeholder records");
  assert.ok(prompt.includes("喂养记录 (record_feeding)"), "Must cover feeding clarification");
  assert.ok(prompt.includes("睡眠记录 (record_sleep)"), "Must cover sleep clarification");
  assert.ok(prompt.includes("尿布与排便 (record_diaper)"), "Must cover diaper clarification");
  assert.ok(prompt.includes("辅食餐点 (record_food)"), "Must cover food clarification");
  assert.ok(prompt.includes("生长测量 (record_growth)"), "Must cover growth clarification");
});

test("Data Entry Clarification: Tools guard against missing data", async () => {
  const ctx = { userId: "user_test_123", baby: mockBaby };

  // 1. Feeding tool guards against missing amount and duration
  const feedingTool = makeRecordFeedingTool(ctx);
  await assert.rejects(
    async () => {
      await feedingTool.execute("call-1", { type: "formula" });
    },
    (err: any) => {
      assert.ok(err.message.includes("缺少关键数据") || err.message.includes("追问"));
      return true;
    }
  );

  // 2. Sleep tool guards against missing start/end and duration
  const sleepTool = makeRecordSleepTool(ctx);
  await assert.rejects(
    async () => {
      await sleepTool.execute("call-2", {});
    },
    (err: any) => {
      assert.ok(err.message.includes("缺少具体入睡与醒来时间") || err.message.includes("追问"));
      return true;
    }
  );

  // 3. Food tool guards against generic '辅食' without specific ingredients
  const foodTool = makeRecordFoodTool(ctx);
  await assert.rejects(
    async () => {
      await foodTool.execute("call-3", { foods: ["辅食"] });
    },
    (err: any) => {
      assert.ok(err.message.includes("缺少具体食材名称") || err.message.includes("追问"));
      return true;
    }
  );

  // 4. Growth tool guards against missing measurements
  const growthTool = makeRecordGrowthTool(ctx);
  await assert.rejects(
    async () => {
      await growthTool.execute("call-4", { date: "2026-03-01" });
    },
    (err: any) => {
      assert.ok(err.message.includes("缺少测量数值") || err.message.includes("追问"));
      return true;
    }
  );
});
