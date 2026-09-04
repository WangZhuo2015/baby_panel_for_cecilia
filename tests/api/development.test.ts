import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";

const BASE_URL = process.env.BABY_PANEL_URL || "http://127.0.0.1:3088";

test("API: Development Domain (Milestones, Activities, Warning Signs)", async (t) => {
  // 隔离租户（本文件仅 GET，但仍不用真实账号）
  const tenant = await createTestTenant(prisma, "devmt");
  const baby = { id: tenant.babyId };
  t.after(() => destroyTestTenant(prisma, tenant.username));

  const headers = {
    Authorization: `Bearer ${tenant.token}`,
  };

  // 1. Milestones
  console.log("-> Testing Development Milestones API...");
  const mileRes = await fetch(`${BASE_URL}/api/development/milestones?babyId=${baby.id}`, { headers });
  assert.equal(mileRes.status, 200, "GET /api/development/milestones should succeed");
  const mileData = await mileRes.json();
  const milestones = Array.isArray(mileData) ? mileData : mileData.milestones || [];
  assert.ok(milestones.length > 0, "Milestones list should not be empty");

  // 2. Activities
  console.log("-> Testing Development Activities API...");
  const actRes = await fetch(`${BASE_URL}/api/development/activities?babyId=${baby.id}`, { headers });
  assert.equal(actRes.status, 200, "GET /api/development/activities should succeed");
  const actData = await actRes.json();
  const activities = Array.isArray(actData) ? actData : actData.activities || [];
  assert.ok(activities.length > 0, "Activities list should not be empty");

  // 3. Warning Signs
  console.log("-> Testing Development Warning Signs API...");
  const warnRes = await fetch(`${BASE_URL}/api/development/warning-signs?babyId=${baby.id}`, { headers });
  assert.equal(warnRes.status, 200, "GET /api/development/warning-signs should succeed");
  const warnData = await warnRes.json();
  const warnings = Array.isArray(warnData) ? warnData : warnData.warningSigns || [];
  assert.ok(warnings.length > 0, "Warning signs list should not be empty");
});
