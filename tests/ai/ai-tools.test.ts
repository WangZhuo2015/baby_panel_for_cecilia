import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { createBabyPanelTools } from "../../lib/agent/tools";
import { getLocalDateStr } from "../../lib/date";

test("AI Tools: Direct invocation of agent tools", async () => {
  const user = await prisma.user.findFirst();
  const baby = await prisma.baby.findFirst();
  assert.ok(user && baby, "User and Baby must exist");

  const today = getLocalDateStr();
  const createdRecordIds: { type: string; id: string }[] = [];

  const tools = createBabyPanelTools({
    userId: user.id,
    baby,
  });

  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // 1. Tool: get_baby_profile
  console.log("-> Testing get_baby_profile tool...");
  const profileTool = toolMap.get("get_baby_profile");
  assert.ok(profileTool, "get_baby_profile tool must exist");
  const profileResult: any = await profileTool.execute("call-1", {});
  const profileText = profileResult.content[0].text;
  const profileData = JSON.parse(profileText);
  assert.equal(profileData.nickname, baby.nickname);

  // 2. Tool: record_feeding
  console.log("-> Testing record_feeding tool...");
  const feedTool = toolMap.get("record_feeding");
  assert.ok(feedTool, "record_feeding tool must exist");
  const feedResult: any = await feedTool.execute("call-2", {
    type: "formula",
    amountMl: 150,
    notes: "AI工具测试喂奶",
  });
  const feedText = feedResult.content[0].text;
  assert.ok(feedText.includes("150ml") || feedText.includes("formula"));
  if (feedResult.details?.id) {
    createdRecordIds.push({ type: "feeding", id: feedResult.details.id });
  }

  // 3. Tool: record_sleep
  console.log("-> Testing record_sleep tool...");
  const sleepTool = toolMap.get("record_sleep");
  assert.ok(sleepTool, "record_sleep tool must exist");
  const sleepResult: any = await sleepTool.execute("call-3", {
    startTime: "12:00",
    endTime: "13:30",
    notes: "AI工具测试睡觉",
  });
  const sleepText = sleepResult.content[0].text;
  assert.ok(sleepText.includes("12:00–13:30"));
  if (sleepResult.details?.id) {
    createdRecordIds.push({ type: "sleep", id: sleepResult.details.id });
  }

  // 4. Tool: record_diaper
  console.log("-> Testing record_diaper tool...");
  const diaperTool = toolMap.get("record_diaper");
  assert.ok(diaperTool, "record_diaper tool must exist");
  const diaperResult: any = await diaperTool.execute("call-4", {
    type: "both",
    poopColor: "yellow",
    poopConsistency: "soft",
  });
  const diaperText = diaperResult.content[0].text;
  assert.ok(diaperText.includes("已记录尿布"));
  if (diaperResult.details?.id) {
    createdRecordIds.push({ type: "diaper", id: diaperResult.details.id });
  }

  // 5. Tool: record_food
  console.log("-> Testing record_food tool...");
  const foodTool = toolMap.get("record_food");
  assert.ok(foodTool, "record_food tool must exist");
  const foodResult: any = await foodTool.execute("call-5", {
    foods: ["胡萝卜米糊", "西蓝花泥"],
    portion: "all",
    acceptance: 5,
    babyState: "happy",
  });
  const foodText = foodResult.content[0].text;
  assert.ok(foodText.includes("胡萝卜米糊") || foodText.includes("已记录辅食"));
  if (foodResult.details?.id) {
    createdRecordIds.push({ type: "food", id: foodResult.details.id });
  }

  // 6. Tool: get_daily_summary
  console.log("-> Testing get_daily_summary tool...");
  const summaryTool = toolMap.get("get_daily_summary");
  assert.ok(summaryTool, "get_daily_summary tool must exist");
  const summaryResult: any = await summaryTool.execute("call-6", { date: today });
  assert.ok(summaryResult.content[0].text.length > 0);

  // 7. Tool: get_vaccine_schedule
  console.log("-> Testing get_vaccine_schedule tool...");
  const vacTool = toolMap.get("get_vaccine_schedule");
  assert.ok(vacTool, "get_vaccine_schedule tool must exist");
  const vacResult: any = await vacTool.execute("call-7", {});
  assert.ok(vacResult.content[0].text.length > 0);

  // 8. Tool: web_search
  console.log("-> Testing web_search tool...");
  const searchTool = toolMap.get("web_search");
  assert.ok(searchTool, "web_search tool must exist");
  const searchResult: any = await searchTool.execute("call-8", { query: "婴儿辅食添加顺序" });
  assert.ok(searchResult.content[0].text.length > 0, "web_search should return text response");

  // Clean up created records
  for (const item of createdRecordIds) {
    if (item.type === "feeding") await prisma.feedingRecord.delete({ where: { id: item.id } }).catch(() => {});
    if (item.type === "sleep") await prisma.sleepRecord.delete({ where: { id: item.id } }).catch(() => {});
    if (item.type === "diaper") await prisma.diaperRecord.delete({ where: { id: item.id } }).catch(() => {});
    if (item.type === "food") await prisma.foodLogRecord.delete({ where: { id: item.id } }).catch(() => {});
  }
});
