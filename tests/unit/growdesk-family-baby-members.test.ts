import test from "node:test";
import assert from "node:assert/strict";

import { createIdentityEndpoints } from "../../lib/growdesk/bridge-endpoints";
import { isBridgedMethod } from "../../lib/growdesk/bridge-policy";
import { GET as getBabyMembers } from "../../app/api/baby/members/route";
import fs from "node:fs";
import path from "node:path";

const babyId = "550e8400-e29b-41d4-a716-446655440000";
const familyId = "550e8400-e29b-41d4-a716-446655440001";
const adminId = "550e8400-e29b-41d4-a716-446655440002";
const memberId = "550e8400-e29b-41d4-a716-446655440003";

const session = {
  accessToken: "test_access_token",
  user: { id: adminId, username: "test_admin", displayName: "测试管理员" },
};

function makeEndpoints(options: {
  session?: typeof session | null;
  result?: unknown;
  csrf?: Response | null;
} = {}) {
  const calls: Array<{ path: string; options: Record<string, unknown> }> = [];
  const endpoints = createIdentityEndpoints({
    resolveSession: async () => options.session === undefined ? session : options.session,
    verifyCsrf: () => options.csrf ?? null,
    fetchApi: async <T>(path: string, requestOptions = {}): Promise<{ ok: true; status: number; data?: T }> => {
      calls.push({ path, options: requestOptions as Record<string, unknown> });
      return { ok: true, status: 200, data: options.result as T };
    },
  });
  return { endpoints, calls };
}

test("baby member endpoints are fenced into the GrowDesk migration policy", () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    assert.equal(isBridgedMethod("/api/baby/members", method), true);
  }
  assert.equal(isBridgedMethod("/api/baby/members", "PUT"), false);
});

test("legacy mode exposes a capability response without pretending to have BabyMember data", async () => {
  const previous = process.env.GROWDESK_ENABLED;
  delete process.env.GROWDESK_ENABLED;
  try {
    const response = await getBabyMembers(new Request("https://test.invalid/api/baby/members"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { supported: false, babyId: null, members: [] });
  } finally {
    if (previous === undefined) delete process.env.GROWDESK_ENABLED;
    else process.env.GROWDESK_ENABLED = previous;
  }
});

test("family page gates baby-level authorization UI on the capability response", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "app/family/page.tsx"), "utf8");
  assert.match(source, /babyMembersSupported/);
  assert.match(source, /babyMembersSupported\s*&&/);
  assert.match(source, /共享喂奶、睡眠、成长与疫苗全部记录/);
});

test("baby member GET forwards the explicit baby scope and authenticated token", async () => {
  const { endpoints, calls } = makeEndpoints({
    result: [{ userId: adminId, babyId, familyId, role: "admin", displayName: "测试管理员", joinedAt: "2026-09-19T00:00:00.000Z" }],
  });
  const response = await endpoints.babyMembers(new Request(`https://test.invalid/api/baby/members?babyId=${babyId}`));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    supported: true,
    babyId,
    members: [{ userId: adminId, babyId, familyId, role: "admin", displayName: "测试管理员", joinedAt: "2026-09-19T00:00:00.000Z" }],
  });
  assert.deepEqual(calls, [{
    path: `/api/v1/babies/${babyId}/members`,
    options: { accessToken: session.accessToken },
  }]);
});

test("baby member POST and DELETE keep babyId/userId explicit and preserve canonical result", async (t) => {
  await t.test("POST grant", async () => {
    const { endpoints, calls } = makeEndpoints({ result: { success: true } });
    const response = await endpoints.babyMembers(new Request("https://test.invalid/api/baby/members", {
      method: "POST",
      headers: { origin: "https://test.invalid", "content-type": "application/json" },
      body: JSON.stringify({ babyId, userId: memberId, role: "member" }),
    }));

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { babyId, userId: memberId, success: true });
    assert.deepEqual(calls, [{
      path: `/api/v1/babies/${babyId}/members`,
      options: { method: "POST", accessToken: session.accessToken, body: { userId: memberId, role: "member" } },
    }]);
  });

  await t.test("DELETE revoke", async () => {
    const { endpoints, calls } = makeEndpoints({ result: { removed: true } });
    const response = await endpoints.babyMembers(new Request("https://test.invalid/api/baby/members", {
      method: "DELETE",
      headers: { origin: "https://test.invalid", "content-type": "application/json" },
      body: JSON.stringify({ babyId, userId: memberId }),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { babyId, userId: memberId, removed: true });
    assert.deepEqual(calls, [{
      path: `/api/v1/babies/${babyId}/members/${memberId}`,
      options: { method: "DELETE", accessToken: session.accessToken },
    }]);
  });
});

test("baby member mutations stop at CSRF/session/id validation before upstream", async (t) => {
  await t.test("foreign origin response is returned without resolving or forwarding", async () => {
    const csrf = Response.json({ error: "Forbidden" }, { status: 403 });
    const { endpoints, calls } = makeEndpoints({ csrf });
    const response = await endpoints.babyMembers(new Request("https://test.invalid/api/baby/members", {
      method: "POST",
      body: JSON.stringify({ babyId, userId: memberId }),
    }));
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  });

  await t.test("missing session is rejected", async () => {
    const { endpoints, calls } = makeEndpoints({ session: null });
    const response = await endpoints.babyMembers(new Request(`https://test.invalid/api/baby/members?babyId=${babyId}`));
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });

  await t.test("missing baby scope and invalid role are rejected", async () => {
    const { endpoints, calls } = makeEndpoints();
    const missingBaby = await endpoints.babyMembers(new Request("https://test.invalid/api/baby/members"));
    assert.equal(missingBaby.status, 200);
    assert.deepEqual(await missingBaby.json(), { supported: true, babyId: null, members: [] });

    const invalidRole = await endpoints.babyMembers(new Request("https://test.invalid/api/baby/members", {
      method: "POST",
      body: JSON.stringify({ babyId, userId: memberId, role: "owner" }),
    }));
    assert.equal(invalidRole.status, 400);
    assert.equal(calls.length, 0);
  });
});
