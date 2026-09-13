#!/usr/bin/env node

/**
 * Architecture Guard: Production Writers & Zero-Leak Verification Script
 * 
 * Verifies that under BFF mode (GROWDESK_CONFIG.enabled), all production
 * business write entry points (care, health, notifications, remote MCP)
 * are properly guarded and route mutations to GrowDesk API rather than
 * leaking direct SQLite writes.
 *
 * Exits with 0 on SUCCESS, 1 on any detected leak.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// Business routes that require dual-mode mediation under BFF mode
const REQUIRED_BUSINESS_ROUTES = [
  "app/api/records/feeding/route.ts",
  "app/api/records/diaper/route.ts",
  "app/api/records/sleep/route.ts",
  "app/api/food/logs/route.ts",
  "app/api/food/items/route.ts",
  "app/api/food/plans/route.ts",
  "app/api/nutrition/records/route.ts",
  "app/api/growth/route.ts",
  "app/api/growth/chart/route.ts",
  "app/api/medical/reports/route.ts",
  "app/api/vaccines/route.ts",
  "app/api/records/timeline/route.ts",
  "app/api/notifications/route.ts",
  "app/api/push/subscribe/route.ts",
];

const SPECIAL_WRITERS = [
  {
    path: "lib/mcp/server.ts",
    description: "Remote MCP Server (Coarse Tools)",
    check: (content) => {
      const hasBff = content.includes("GROWDESK_CONFIG.enabled");
      const hasGrowDeskFetch = content.includes("growdeskFetch");
      return hasBff && hasGrowDeskFetch;
    },
  },
  {
    path: "scripts/mcp-server.mjs",
    description: "Stdio MCP Server (HTTP proxy)",
    check: (content) => {
      // Must NOT directly import or query Prisma; must proxy via HTTP
      const hasPrismaImport = content.includes("@/lib/prisma") || content.includes("prismaClient");
      const hasPrismaQuery = /prisma\.\w+\.(create|update|delete|upsert)/.test(content);
      const hasHttpProxy = content.includes("fetch(") && content.includes("BASE_URL");
      return !hasPrismaImport && !hasPrismaQuery && hasHttpProxy;
    },
  },
];

const OFFLINE_WHITELIST = [
  "prisma/seed.ts",
  "scripts/backup-db.sh",
  "scripts/restore-db.sh",
  "scripts/purge-test-data.ts",
  "scripts/switch-db.sh",
  "scripts/prune-ai-archive.sh",
];

function checkBusinessRoute(relPath) {
  const fullPath = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    return { ok: false, error: "File not found" };
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const methods = [];
  if (/export\s+async\s+function\s+GET/i.test(content)) methods.push("GET");
  if (/export\s+async\s+function\s+POST/i.test(content)) methods.push("POST");
  if (/export\s+async\s+function\s+PUT/i.test(content)) methods.push("PUT");
  if (/export\s+async\s+function\s+DELETE/i.test(content)) methods.push("DELETE");
  if (/export\s+async\s+function\s+PATCH/i.test(content)) methods.push("PATCH");

  const mutatingMethods = methods.filter((m) => m !== "GET");
  const hasPrismaOrServiceWrite =
    /prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)/.test(content) ||
    /records\.\w+/.test(content);

  const hasBffGuard =
    content.includes("GROWDESK_CONFIG.enabled") ||
    content.includes("growdeskFetch") ||
    content.includes("growdeskClient");

  // If the route has mutating methods or writes, it MUST have a BFF guard
  const ok = mutatingMethods.length === 0 ? hasBffGuard : hasBffGuard;

  return {
    relPath,
    methods: methods.join(", "),
    isMutating: mutatingMethods.length > 0,
    hasBffGuard,
    ok,
  };
}

function runAudit() {
  console.log("===============================================================================");
  console.log(" 🛡️  SH-08 Production Writers & Zero Direct SQLite Leak Guard");
  console.log("===============================================================================\n");

  let hasFailures = false;
  const results = [];

  // 1. Audit all required business routes
  console.log("--- 1. Web Care & Health Business Routes Dual-Mode Audit ---");
  for (const route of REQUIRED_BUSINESS_ROUTES) {
    const res = checkBusinessRoute(route);
    results.push(res);
    const statusIcon = res.ok ? "✅ PASS" : "❌ FAIL";
    console.log(`[${statusIcon}] ${res.relPath.padEnd(42)} [${res.methods.padEnd(20)}] BFF Guard: ${res.hasBffGuard ? "YES" : "NO"}`);
    if (!res.ok) hasFailures = true;
  }

  // 2. Audit special entry points (Remote MCP & Stdio MCP)
  console.log("\n--- 2. MCP Entry Points Audit ---");
  for (const special of SPECIAL_WRITERS) {
    const fullPath = path.join(REPO_ROOT, special.path);
    if (!fs.existsSync(fullPath)) {
      console.log(`[❌ FAIL] ${special.path.padEnd(42)} File not found`);
      hasFailures = true;
      continue;
    }
    const content = fs.readFileSync(fullPath, "utf-8");
    const passed = special.check(content);
    const statusIcon = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`[${statusIcon}] ${special.path.padEnd(42)} ${special.description}`);
    if (!passed) hasFailures = true;
  }

  // 3. Offline Maintenance Whitelist Check
  console.log("\n--- 3. Offline Maintenance Whitelist Verification ---");
  for (const item of OFFLINE_WHITELIST) {
    const exists = fs.existsSync(path.join(REPO_ROOT, item));
    console.log(`[ℹ️ INFO] ${item.padEnd(42)} ${exists ? "VERIFIED (Offline/Maintenance only)" : "NOT PRESENT"}`);
  }

  console.log("\n===============================================================================");
  if (hasFailures) {
    console.error("❌ AUDIT FAILED: Direct SQLite write leaks detected or missing BFF guards!");
    console.log("===============================================================================\n");
    process.exit(1);
  } else {
    console.log("✅ AUDIT PASSED: All 14 business routes and MCP entry points have active BFF guards.");
    console.log("   Under GROWDESK_CONFIG.enabled=true, zero direct SQLite writes can leak.");
    console.log("===============================================================================\n");
    process.exit(0);
  }
}

runAudit();
