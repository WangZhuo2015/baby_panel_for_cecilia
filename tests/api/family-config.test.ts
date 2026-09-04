import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";

const BASE_URL = process.env.BABY_PANEL_URL || "http://127.0.0.1:3088";

test("API: Family, Config, Notifications, and Books Domain", async (t) => {
  // 隔离租户（本文件仅 GET，但仍不用真实账号）
  const tenant = await createTestTenant(prisma, "famcfg");
  const baby = { id: tenant.babyId };
  t.after(() => destroyTestTenant(prisma, tenant.username));

  const headers = {
    Authorization: `Bearer ${tenant.token}`,
  };

  // 1. App Config
  console.log("-> Testing App Config API...");
  const configRes = await fetch(`${BASE_URL}/api/app-config`);
  assert.equal(configRes.status, 200, "GET /api/app-config should succeed");
  const configData = await configRes.json();
  assert.ok(configData !== null && typeof configData === "object");

  // 2. Family Members
  console.log("-> Testing Family Members API...");
  const famRes = await fetch(`${BASE_URL}/api/family/members`, { headers });
  assert.equal(famRes.status, 200, "GET /api/family/members should succeed");
  const famData = await famRes.json();
  const members = Array.isArray(famData) ? famData : famData.members || [];
  assert.ok(members.length > 0, "Family members list should contain current user");

  // 3. Notifications API
  console.log("-> Testing Notifications API...");
  const notifRes = await fetch(`${BASE_URL}/api/notifications?babyId=${baby.id}`, { headers });
  assert.equal(notifRes.status, 200, "GET /api/notifications should succeed");
  const notifData = await notifRes.json();
  assert.ok(Array.isArray(notifData) || Array.isArray(notifData.notifications));

  // 4. Parenting Books API
  console.log("-> Testing Books API...");
  const booksRes = await fetch(`${BASE_URL}/api/books`, { headers });
  assert.equal(booksRes.status, 200, "GET /api/books should succeed");
  const booksData = await booksRes.json();
  const books = Array.isArray(booksData) ? booksData : booksData.books || [];
  assert.ok(Array.isArray(books), "Books list should be an array");
});
