import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { signAuthToken } from "../../lib/auth";
import { getLocalDateStr } from "../../lib/date";

const BASE_URL = "http://127.0.0.1:3088";

test("API: Food Domain (Food Items, Plans, Food Logs, Feeding Guidelines)", async () => {
  const user = await prisma.user.findFirst();
  const baby = await prisma.baby.findFirst();
  assert.ok(user && baby, "User and Baby must exist");

  const token = await signAuthToken({ userId: user.id, username: user.username });
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const today = getLocalDateStr();

  // 1. Food Library Items
  console.log("-> Testing Food Library API...");
  const itemsRes = await fetch(`${BASE_URL}/api/food/items`, { headers });
  assert.equal(itemsRes.status, 200, "GET /api/food/items should succeed");
  const itemsData = await itemsRes.json();
  const items = Array.isArray(itemsData) ? itemsData : itemsData.items || [];
  assert.ok(items.length > 0, "Food items library should not be empty");

  // 2. Feeding Guidelines
  console.log("-> Testing Feeding Guidelines API...");
  const guideRes = await fetch(`${BASE_URL}/api/food/feeding-guidelines?babyId=${baby.id}`, { headers });
  assert.equal(guideRes.status, 200, "GET /api/food/feeding-guidelines should succeed");
  const guidelines = await guideRes.json();
  assert.ok(guidelines !== null && typeof guidelines === "object");

  // 3. Daily Food Plan (Recipe Recommendation)
  console.log("-> Testing Daily Food Plan API...");
  const planRes = await fetch(`${BASE_URL}/api/food/plans?babyId=${baby.id}&date=${today}`, { headers });
  assert.equal(planRes.status, 200, "GET /api/food/plans should succeed");
  const planData = await planRes.json();
  assert.ok(planData !== null);

  // 4. Food Log Recording (Solid Food Intake)
  console.log("-> Testing Food Log Recording API...");
  const foodLogRes = await fetch(`${BASE_URL}/api/food/logs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      babyId: baby.id,
      date: today,
      mealType: "lunch",
      foodName: "自动化测试西蓝花牛肉泥",
      amount: "50g",
      reaction: "none",
      liked: true,
      notes: "测试进食打卡",
    }),
  });
  assert.ok(foodLogRes.status === 200 || foodLogRes.status === 201, `POST /api/food/logs status ${foodLogRes.status}`);
  const foodLogData = await foodLogRes.json();
  const logId = foodLogData.id || foodLogData.log?.id;
  assert.ok(logId, "Food log ID should exist");

  const queryLogRes = await fetch(`${BASE_URL}/api/food/logs?babyId=${baby.id}&date=${today}`, { headers });
  assert.equal(queryLogRes.status, 200);
  const queryLogs = await queryLogRes.json();
  const logsList = Array.isArray(queryLogs) ? queryLogs : queryLogs.logs || [];
  assert.ok(logsList.some((l: any) => l.id === logId), "Created food log should be in list");

  // Clean up
  await prisma.foodLogRecord.delete({ where: { id: logId } }).catch(() => {});
});
