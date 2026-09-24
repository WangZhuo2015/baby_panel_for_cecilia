import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import {
  registerClient,
  createAuthorizationCode,
  exchangeAuthorizationCode,
} from "@/lib/oauth/service";
import { POST as mcpPost } from "@/app/mcp/route";

function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

test("Fine-Grained MCP Tools & Raw Data Test Suite", async (t) => {
  const prefix = `test_${Date.now()}_`;
  const passwordHash = await hashPassword("password123");

  // Cleanup test tenant
  t.after(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } }).catch(() => {});
    await prisma.family
      .deleteMany({ where: { name: { startsWith: prefix }, members: { none: {} } } })
      .catch(() => {});
  });

  // Setup test user, family with relation "mother", and baby
  const user = await prisma.user.create({
    data: {
      username: `${prefix}mother`,
      displayName: "Alice Mother",
      passwordHash,
    },
  });

  const family = await prisma.family.create({
    data: {
      name: `${prefix}family`,
      inviteCode: `FM${Date.now().toString().slice(-4)}`,
      members: {
        create: [
          {
            userId: user.id,
            role: "admin",
            relation: "mother",
          },
        ],
      },
      babies: {
        create: [
          {
            nickname: `${prefix}baby`,
            gender: "female",
            birthDate: "2025-01-15",
            avatarUrl: "/uploads/avatars/test_baby_avatar.jpg",
          },
        ],
      },
    },
    include: { babies: true },
  });
  const baby = family.babies[0];

  // Dynamic Client Registration & OAuth Token
  const client = await registerClient({
    client_name: "Test Fine-Grained MCP Agent",
    redirect_uris: ["http://localhost:3000/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "baby:read baby:write",
  });

  const pkce = generatePkce();
  const authCode = await createAuthorizationCode({
    clientId: client.client_id,
    userId: user.id,
    babyId: baby.id,
    redirectUri: "http://localhost:3000/callback",
    scope: "baby:read baby:write",
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: "S256",
    resource: "http://localhost:3000/mcp",
  });

  const tokenResp = await exchangeAuthorizationCode({
    clientId: client.client_id,
    code: authCode,
    redirectUri: "http://localhost:3000/callback",
    codeVerifier: pkce.codeVerifier,
    resource: "http://localhost:3000/mcp",
    baseUrl: "http://localhost:3000",
  });
  const token = tokenResp.access_token;

  // Helper function to call MCP
  async function callMcp(toolName: string, args: Record<string, any> = {}) {
    const req = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `call-${Date.now()}-${Math.random()}`,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });
    const res = await mcpPost(req);
    assert.equal(res.status, 200, `MCP call to ${toolName} failed with HTTP ${res.status}`);
    const body = await res.json();
    assert.ok(!body.error, `MCP returned JSON-RPC error: ${JSON.stringify(body.error)}`);
    assert.ok(!body.result?.isError, `MCP tool execution failed for ${toolName}: ${body.result?.content?.[0]?.text}`);
    assert.ok(body.result?.content?.[0]?.text, `MCP returned empty content for ${toolName}`);
    return JSON.parse(body.result.content[0].text);
  }

  await t.test("tools/list lists all fine-grained tools", async () => {
    const req = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "list-tools",
        method: "tools/list",
        params: {},
      }),
    });
    const res = await mcpPost(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    const toolNames = body.result.tools.map((x: any) => x.name);

    // Verify fine-grained tools exist
    const expectedTools = [
      "get_current_user",
      "get_baby_profile",
      "get_feeding_records",
      "get_sleep_records",
      "get_diaper_records",
      "get_food_records",
      "get_growth_records",
      "get_medical_reports",
      "get_medical_report_detail",
      "get_baby_photos",
      "get_vaccine_records",
      "get_vaccine_schedule",
      "get_supplement_records",
      "get_food_plans",
      "get_daily_summary",
      "get_development_milestones",
      "record_feeding",
      "record_sleep",
      "record_diaper",
      "record_food",
      "record_growth",
      "record_vaccine",
      "record_medical_report",
      "record_supplement",
      "create_supplement_product",
      "record_food_plan",
      "delete_record",
      "restore_record",
      "query_food_item",
      "query_book",
      "query_activity",
      "web_search",
    ];

    for (const expected of expectedTools) {
      assert.ok(toolNames.includes(expected), `Missing expected tool: ${expected}`);
    }
  });

  await t.test("get_current_user returns caller identity, role, and relation", async () => {
    const userRes = await callMcp("get_current_user");
    assert.equal(userRes.user.id, user.id);
    assert.equal(userRes.user.username, user.username);
    assert.equal(userRes.user.displayName, "Alice Mother");
    assert.equal(userRes.user.relation, "mother");
    assert.equal(userRes.user.role, "admin");
    assert.equal(userRes.activeBaby.id, baby.id);
  });

  await t.test("get_baby_profile returns baby metadata with avatar and caller relation", async () => {
    const profileRes = await callMcp("get_baby_profile");
    assert.equal(profileRes.baby.nickname, `${prefix}baby`);
    assert.equal(profileRes.baby.avatarUrl, "/uploads/avatars/test_baby_avatar.jpg");
    assert.equal(profileRes.currentUser.relation, "mother");
    assert.ok(profileRes.baby.age !== null);
  });

  let createdFeedingId = "";
  await t.test("record_feeding writes raw feeding record with caller recordedBy", async () => {
    const feedRes = await callMcp("record_feeding", {
      type: "formula",
      amountMl: 150,
      notes: "Night feeding",
    });

    assert.equal(feedRes.success, true);
    assert.ok(feedRes.record);
    assert.equal(feedRes.record.type, "formula");
    assert.equal(feedRes.record.amountMl, 150);
    assert.equal(feedRes.record.notes, "Night feeding");
    assert.equal(feedRes.record.recordedBy.displayName, "Alice Mother");
    assert.equal(feedRes.record.recordedBy.relation, "mother");
    // Ensure raw data: no local AI advice string
    assert.equal(feedRes.aiAdvice, undefined);
    assert.equal(feedRes.aiEvaluation, undefined);

    createdFeedingId = feedRes.record.id;
  });

  await t.test("get_feeding_records returns raw feeding records", async () => {
    const feedingsList = await callMcp("get_feeding_records", { limit: 10 });
    assert.ok(Array.isArray(feedingsList));
    const found = feedingsList.find((r: any) => r.id === createdFeedingId);
    assert.ok(found, "Created feeding record should be in feeding records list");
    assert.equal(found.amountMl, 150);
    assert.equal(found.recordedBy.relation, "mother");
  });

  let createdGrowthId = "";
  await t.test("record_growth writes measurement with imageUrl and returns raw record", async () => {
    const growthRes = await callMcp("record_growth", {
      weightKg: 6.85,
      heightCm: 64.2,
      headCircumferenceCm: 41.5,
      imageUrl: "/uploads/growth/test_growth_chart.png",
      notes: "3-month pediatric measurement",
    });

    assert.equal(growthRes.success, true);
    assert.ok(growthRes.record);
    assert.equal(growthRes.record.weightKg, 6.85);
    assert.equal(growthRes.record.heightCm, 64.2);
    assert.equal(growthRes.record.headCircumferenceCm, 41.5);
    assert.equal(growthRes.record.imageUrl, "/uploads/growth/test_growth_chart.png");
    assert.equal(growthRes.record.recordedBy.displayName, "Alice Mother");

    createdGrowthId = growthRes.record.id;
  });

  let createdReportId = "";
  await t.test("record_medical_report creates physical exam (体检) with items and imageUrl", async () => {
    const reportRes = await callMcp("record_medical_report", {
      category: "growth",
      title: "6-Month Pediatric Health Checkup",
      hospital: "Children's Hospital",
      imageUrl: "/uploads/medical/test_checkup_page.jpg",
      items: [
        { name: "Height", value: "68", unit: "cm", status: "normal" },
        { name: "Weight", value: "7.9", unit: "kg", status: "normal" },
        { name: "Hemoglobin", value: "118", unit: "g/L", refRange: "110-140", status: "normal" },
      ],
      doctorNotes: "Baby is developing very well across all percentiles.",
    });

    assert.equal(reportRes.success, true);
    assert.ok(reportRes.record);
    assert.equal(reportRes.record.category, "growth");
    assert.equal(reportRes.record.title, "6-Month Pediatric Health Checkup");
    assert.equal(reportRes.record.hospital, "Children's Hospital");
    assert.equal(reportRes.record.imageUrl, "/uploads/medical/test_checkup_page.jpg");
    assert.equal(reportRes.record.doctorNotes, "Baby is developing very well across all percentiles.");
    assert.ok(Array.isArray(reportRes.record.items));
    assert.equal(reportRes.record.items.length, 3);
    assert.equal(reportRes.record.recordedBy.relation, "mother");

    createdReportId = reportRes.record.id;
  });

  await t.test("get_medical_reports and get_medical_report_detail query full report data", async () => {
    // 1. List
    const reportsList = await callMcp("get_medical_reports", { category: "growth" });
    assert.ok(Array.isArray(reportsList));
    const found = reportsList.find((r: any) => r.id === createdReportId);
    assert.ok(found, "Medical report should be in medical reports list");
    assert.equal(found.category, "growth");
    assert.equal(found.hospital, "Children's Hospital");
    assert.equal(found.items.length, 3);

    // 2. Detail
    const detailRes = await callMcp("get_medical_report_detail", { id: createdReportId });
    assert.equal(detailRes.id, createdReportId);
    assert.equal(detailRes.doctorNotes, "Baby is developing very well across all percentiles.");
    assert.equal(detailRes.imageUrl, "/uploads/medical/test_checkup_page.jpg");
  });

  await t.test("get_baby_photos aggregates all photos across profile, growth, and medical reports", async () => {
    const photosList = await callMcp("get_baby_photos");
    assert.ok(Array.isArray(photosList));
    assert.ok(photosList.length >= 3, `Expected at least 3 photos, found ${photosList.length}`);

    const types = photosList.map((p: any) => p.type);
    assert.ok(types.includes("avatar"), "Should include baby avatar photo");
    assert.ok(types.includes("growth"), "Should include growth measurement photo");
    assert.ok(types.includes("medical_report"), "Should include medical checkup report photo");

    const avatarPhoto = photosList.find((p: any) => p.type === "avatar");
    assert.equal(avatarPhoto.imageUrl, "/uploads/avatars/test_baby_avatar.jpg");

    const growthPhoto = photosList.find((p: any) => p.type === "growth");
    assert.equal(growthPhoto.imageUrl, "/uploads/growth/test_growth_chart.png");

    const reportPhoto = photosList.find((p: any) => p.type === "medical_report");
    assert.equal(reportPhoto.imageUrl, "/uploads/medical/test_checkup_page.jpg");
  });

  await t.test("delete_record and restore_record allow safe undo", async () => {
    // Delete feeding
    const delRes = await callMcp("delete_record", {
      type: "feeding",
      id: createdFeedingId,
    });
    assert.equal(delRes.success, true);
    assert.ok(delRes.deletedId);

    // Verify it is no longer in active records list
    const listAfterDel = await callMcp("get_feeding_records", { limit: 10 });
    const foundInActive = listAfterDel.find((r: any) => r.id === createdFeedingId);
    assert.equal(foundInActive, undefined, "Deleted record should not appear in active records");

    // Restore feeding
    const restoreRes = await callMcp("restore_record", {
      entityType: "feeding",
    });
    assert.equal(restoreRes.success, true);

    // Verify it is back in active records list
    const listAfterRestore = await callMcp("get_feeding_records", { limit: 10 });
    const foundRestored = listAfterRestore.find((r: any) => r.id === createdFeedingId);
    assert.ok(foundRestored, "Restored record should reappear in active records");
  });

  await t.test("record_diaper accepts HH:mm timestamp format without crashing", async () => {
    const diaperRes = await callMcp("record_diaper", {
      type: "pee",
      timestamp: "14:30",
      notes: "Afternoon diaper change",
    });
    assert.equal(diaperRes.success, true);
    assert.ok(diaperRes.record);
    assert.equal(diaperRes.record.type, "pee");
    assert.ok(diaperRes.record.timestamp.includes("T14:30:00") || diaperRes.record.timestamp.includes(":30:00"));
  });

  await t.test("record_medical_report rejects untrusted external imageUrl", async () => {
    const req = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-bad-img",
        method: "tools/call",
        params: {
          name: "record_medical_report",
          arguments: {
            title: "Malicious Report Image",
            category: "growth",
            imageUrl: "https://evil.com/fake-checkup.jpg",
          },
        },
      }),
    });
    const res = await mcpPost(req);
    const body = await res.json();
    assert.ok(body.result?.isError, "Should return isError: true when imageUrl is external URL");
    assert.ok(body.result?.content?.[0]?.text.includes("imageUrl 仅支持本站 /uploads/ 路径"));
  });

  await t.test("medical report restoration preserves doctorNotes and items", async () => {
    // Delete medical report
    const delRepRes = await callMcp("delete_record", {
      type: "medical_report",
      id: createdReportId,
    });
    assert.equal(delRepRes.success, true);
    assert.equal(delRepRes.deletedId, createdReportId);

    // Restore medical report
    const restoreRepRes = await callMcp("restore_record", {
      entityType: "medical_report",
    });
    assert.equal(restoreRepRes.success, true);

    // Fetch detail and verify doctorNotes is completely preserved
    const detailAfterRestore = await callMcp("get_medical_report_detail", { id: createdReportId });
    assert.equal(detailAfterRestore.id, createdReportId);
    assert.equal(detailAfterRestore.doctorNotes, "Baby is developing very well across all percentiles.");
    assert.equal(detailAfterRestore.items.length, 3);
  });

  await t.test("read-only token cannot invoke write tools (scope enforcement)", async () => {
    // Create read-only client token
    const readOnlyPkce = generatePkce();
    const roAuthCode = await createAuthorizationCode({
      clientId: client.client_id,
      userId: user.id,
      babyId: baby.id,
      redirectUri: "http://localhost:3000/callback",
      scope: "baby:read",
      codeChallenge: readOnlyPkce.codeChallenge,
      codeChallengeMethod: "S256",
      resource: "http://localhost:3000/mcp",
    });

    const roTokenResp = await exchangeAuthorizationCode({
      clientId: client.client_id,
      code: roAuthCode,
      redirectUri: "http://localhost:3000/callback",
      codeVerifier: readOnlyPkce.codeVerifier,
      resource: "http://localhost:3000/mcp",
      baseUrl: "http://localhost:3000",
    });
    const roToken = roTokenResp.access_token;

    // Attempt to write feeding with read-only token
    const writeReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${roToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-forbidden-write",
        method: "tools/call",
        params: {
          name: "record_feeding",
          arguments: { type: "formula", amountMl: 100 },
        },
      }),
    });
    const writeRes = await mcpPost(writeReq);
    const writeBody = await writeRes.json();
    assert.ok(
      writeBody.error?.message?.includes("Forbidden: Missing baby:write scope") ||
      writeBody.result?.isError,
      "Write tool must be rejected when token lacks baby:write scope"
    );
  });

  await t.test("query tools reject invalid date formats", async () => {
    const req = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-invalid-date",
        method: "tools/call",
        params: {
          name: "get_feeding_records",
          arguments: { date: "invalid-date-format" },
        },
      }),
    });
    const res = await mcpPost(req);
    const body = await res.json();
    assert.ok(body.result?.isError || body.error, "Should reject invalid date format");
  });
});
