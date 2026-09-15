import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "@/lib/prisma";
import { getLocalDateStr } from "@/lib/date";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";
import * as records from "@/lib/records/service";
import { resolveFormulaProductId } from "@/lib/mcp/server";

test("Records & Timeline: Multi-Formula Management, Timeline Detail & RawRecord Integrity", async (t) => {
  // 严格隔离测试租户（遵循 AGENTS.md 规范）
  const tenant = await createTestTenant(prisma, "records_formula");
  t.after(() => destroyTestTenant(prisma, tenant.username));

  const today = getLocalDateStr();
  const recCtx = {
    userId: tenant.userId,
    babyId: tenant.babyId,
    familyId: tenant.familyId,
    source: "ui_manual",
  };

  // ── 1. 创建两款不同的测试配方奶粉 ──
  console.log("-> [Step 1] Creating two test formula products...");
  const formulaA = await prisma.formulaProduct.create({
    data: {
      familyId: tenant.familyId,
      name: "德国爱他美白金版 Pre段",
      brand: "爱他美(德版)",
      stage: 0,
      scoopWeightG: 4.6,
      waterPerScoopMl: 30.0,
      reconstitutionRatio: 0.138,
      servingSizeUnit: "per_100g",
      nutrientsJson: JSON.stringify({ energy_kcal: { amount: 475, unit: "kcal" } }),
      isActive: true,
      isDefault: true,
    },
  });
  assert.ok(formulaA.id);
  assert.equal(formulaA.isDefault, true);

  const formulaB = await prisma.formulaProduct.create({
    data: {
      familyId: tenant.familyId,
      name: "纽荃星高能量特医配方粉",
      brand: "纽迪希亚",
      stage: 1,
      scoopWeightG: 5.0,
      waterPerScoopMl: 22.5,
      reconstitutionRatio: 0.200,
      servingSizeUnit: "per_100g",
      nutrientsJson: JSON.stringify({ energy_kcal: { amount: 500, unit: "kcal" } }),
      isActive: true,
      isDefault: false,
    },
  });
  assert.ok(formulaB.id);
  assert.equal(formulaB.isDefault, false);

  // ── 2. 记录两顿不同的喂养记录（分别绑定 Formula A 与 Formula B） ──
  console.log("-> [Step 2] Recording two feedings with distinct formulas...");
  const feeding1 = await records.createFeeding(recCtx, {
    type: "formula",
    amountMl: 150,
    timestamp: `${today}T08:00:00+08:00`,
    formulaProductId: formulaA.id,
    notes: "晨起喝奶",
  });
  assert.ok(feeding1.id);
  assert.equal(feeding1.formulaProductId, formulaA.id);

  const feeding2 = await records.createFeeding(recCtx, {
    type: "formula",
    amountMl: 180,
    timestamp: `${today}T12:30:00+08:00`,
    formulaProductId: formulaB.id,
    spitUp: true,
    notes: "高能量午餐",
  });
  assert.ok(feeding2.id);
  assert.equal(feeding2.formulaProductId, formulaB.id);

  // 记录一顿混合喂养（携带 Formula A）
  const feedingMixed = await records.createFeeding(recCtx, {
    type: "mixed",
    amountMl: 90,
    leftMinutes: 10,
    rightMinutes: 10,
    timestamp: `${today}T16:00:00+08:00`,
    formulaProductId: formulaA.id,
  });
  assert.ok(feedingMixed.id);
  assert.equal(feedingMixed.formulaProductId, formulaA.id);

  // ── 3. 验证 getFeedingRecords 包含 formulaProduct 关联 ──
  console.log("-> [Step 3] Verifying getFeedingRecords includes formulaProduct...");
  const feedingList = await records.getFeedingRecords(recCtx, { date: today });
  assert.equal(feedingList.length, 3);
  const foundFeeding2 = feedingList.find((r: any) => r.id === feeding2.id);
  assert.ok(foundFeeding2);
  assert.ok(foundFeeding2.formulaProduct);
  assert.equal(foundFeeding2.formulaProduct.name, "纽荃星高能量特医配方粉");
  assert.equal(foundFeeding2.formulaProduct.brand, "纽迪希亚");

  // ── 4. 验证 getTimeline 展示奶粉名称及 rawRecord 中包含 formulaProductId ──
  console.log("-> [Step 4] Verifying getTimeline detail and rawRecord.formulaProductId...");
  const timeline = await records.getTimeline(recCtx, today);
  const timelineFeeding1 = timeline.find((item: any) => item.id === feeding1.id);
  const timelineFeeding2 = timeline.find((item: any) => item.id === feeding2.id);
  const timelineMixed = timeline.find((item: any) => item.id === feedingMixed.id);

  assert.ok(timelineFeeding1, "Timeline should contain feeding 1");
  assert.ok(timelineFeeding2, "Timeline should contain feeding 2");
  assert.ok(timelineMixed, "Timeline should contain mixed feeding");

  // 验证 detail 整合了奶粉信息
  assert.ok(timelineFeeding1.detail.includes("德国爱他美白金版 Pre段"), "Feeding 1 detail should include Formula A name");
  assert.ok(timelineFeeding1.detail.includes("配方150ml"), "Feeding 1 detail should include amount");

  assert.ok(timelineFeeding2.detail.includes("纽荃星高能量特医配方粉"), "Feeding 2 detail should include Formula B name");
  assert.ok(timelineFeeding2.detail.includes("配方180ml"), "Feeding 2 detail should include amount");
  assert.ok(timelineFeeding2.detail.includes("吐奶"), "Feeding 2 detail should include spitUp label");

  assert.ok(timelineMixed.detail.includes("德国爱他美白金版 Pre段"), "Mixed feeding detail should include Formula A name");
  assert.ok(timelineMixed.detail.includes("配方90ml"), "Mixed feeding detail should include formula amount");

  // 关键检查：rawRecord 必须回显 formulaProductId 供编辑弹窗使用
  assert.equal(
    timelineFeeding1.rawRecord?.formulaProductId,
    formulaA.id,
    "rawRecord must contain formulaProductId for feeding 1"
  );
  assert.equal(
    timelineFeeding2.rawRecord?.formulaProductId,
    formulaB.id,
    "rawRecord must contain formulaProductId for feeding 2"
  );
  assert.equal(
    timelineMixed.rawRecord?.formulaProductId,
    formulaA.id,
    "rawRecord must contain formulaProductId for mixed feeding"
  );

  // ── 5. 验证编辑已有记录更换奶粉 ──
  console.log("-> [Step 5] Editing feeding record to switch formula product...");
  const updatedFeeding2 = await records.updateFeeding(recCtx, feeding2.id, {
    formulaProductId: formulaA.id,
    amountMl: 200,
  });
  assert.equal(updatedFeeding2.formulaProductId, formulaA.id);
  assert.equal(updatedFeeding2.amountMl, 200);

  // 验证更新后的 timeline 反映新奶粉
  const updatedTimeline = await records.getTimeline(recCtx, today);
  const updatedItem2 = updatedTimeline.find((item: any) => item.id === feeding2.id);
  assert.ok(updatedItem2);
  assert.equal(updatedItem2.rawRecord?.formulaProductId, formulaA.id);
  assert.ok(updatedItem2.detail.includes("德国爱他美白金版 Pre段"));
  assert.ok(updatedItem2.detail.includes("配方200ml"));

  // 再次编辑（不传 formulaProductId 只改备注），确保绑定的奶粉不被置空或丢失
  await records.updateFeeding(recCtx, feeding2.id, {
    notes: "更换奶粉后吃得很好",
  });
  const updatedTimelinePreserve = await records.getTimeline(recCtx, today);
  const preservedItem2 = updatedTimelinePreserve.find((item: any) => item.id === feeding2.id);
  assert.equal(preservedItem2.rawRecord?.formulaProductId, formulaA.id);
  assert.ok(preservedItem2.detail.includes("更换奶粉后吃得很好"));

  // ── 6. 验证奶粉主力切换与归档逻辑 ──
  console.log("-> [Step 6] Verifying default switching and archiving...");
  // 将 Formula B 设为主力
  await prisma.formulaProduct.updateMany({
    where: { familyId: tenant.familyId },
    data: { isDefault: false },
  });
  await prisma.formulaProduct.update({
    where: { id: formulaB.id },
    data: { isDefault: true },
  });

  const checkB = await prisma.formulaProduct.findUnique({ where: { id: formulaB.id } });
  assert.equal(checkB?.isDefault, true);

  // 归档 Formula A
  await prisma.formulaProduct.update({
    where: { id: formulaA.id },
    data: { isActive: false },
  });
  const checkA = await prisma.formulaProduct.findUnique({ where: { id: formulaA.id } });
  assert.equal(checkA?.isActive, false);

  // ── 7. 验证 MCP resolveFormulaProductId 逻辑与安全防御 ──
  console.log("-> [Step 7] Verifying MCP resolveFormulaProductId behavior & IDOR defense...");
  // a) 非配方奶/非混合喂养，返回 null
  const breastFormula = await resolveFormulaProductId(tenant.familyId, "breast");
  assert.equal(breastFormula, null);

  // b) 明确传入当前家庭有效 formulaProductId，直接返回
  const explicitResult = await resolveFormulaProductId(tenant.familyId, "formula", formulaA.id);
  assert.equal(explicitResult, formulaA.id);

  // c) 传入不存在或恶意 IDOR ID，安全回退到当前家庭默认主力奶粉，不引发 P2003 崩溃
  const invalidResult = await resolveFormulaProductId(tenant.familyId, "formula", "non-existent-or-other-family-id");
  assert.equal(invalidResult, formulaB.id);

  // d) 传入 formulaName 模糊匹配活跃奶粉
  const fuzzyResult = await resolveFormulaProductId(tenant.familyId, "formula", undefined, "纽荃星");
  assert.equal(fuzzyResult, formulaB.id);

  // e) 未传任何参数，自动选择当前活跃默认主力奶粉（当前为 Formula B）
  const defaultResult = await resolveFormulaProductId(tenant.familyId, "formula");
  assert.equal(defaultResult, formulaB.id);

  // ── 8. 验证 createFeeding 对不存在或跨家庭奶粉 ID 的防御与安全置空 ──
  console.log("-> [Step 8] Verifying createFeeding foreign key guard for invalid formulaProductId...");
  const safeFeeding = await records.createFeeding(recCtx, {
    type: "formula",
    amountMl: 100,
    timestamp: `${today}T18:00:00+08:00`,
    formulaProductId: "non-existent-invalid-uuid-404",
  });
  assert.ok(safeFeeding.id, "Should safely create feeding record without throwing P2003");
  assert.equal(safeFeeding.formulaProductId, null, "Invalid formulaProductId should be safely sanitized to null");

  console.log("✔ All Multi-Formula records and timeline assertions passed successfully!");
});
