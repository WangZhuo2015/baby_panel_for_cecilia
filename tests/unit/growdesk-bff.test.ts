import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  toGrowDeskFeedingCreatePayload,
  toGrowDeskFeedingUpdatePayload,
  fromGrowDeskFeedingRecord,
} from "../../lib/growdesk/feeding-compat";
import {
  hashSessionSecret,
} from "../../lib/growdesk/session";
import { verifyBffCsrf } from "../../lib/growdesk/csrf";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/records/feeding/route";

let savedOrigin: string | undefined;
beforeEach(() => {
  savedOrigin = process.env.GROWDESK_WEB_ORIGIN;
  process.env.GROWDESK_WEB_ORIGIN = "http://127.0.0.1:3000";
});
afterEach(() => {
  if (savedOrigin === undefined) delete process.env.GROWDESK_WEB_ORIGIN;
  else process.env.GROWDESK_WEB_ORIGIN = savedOrigin;
});

test("SH-05: Web BFF DTO Compat Layer", async (t) => {
  await t.test("toGrowDeskFeedingCreatePayload: formula feeding mapping", () => {
    const payload = toGrowDeskFeedingCreatePayload({
      babyId: "test-baby-1",
      type: "formula",
      amountMl: 150.5,
      timestamp: "2026-09-12T10:00:00.000Z",
      notes: "Morning bottle",
    });

    assert.equal(payload.feedingType, "formula");
    assert.equal(payload.amountMl, "150.5");
    assert.equal(payload.occurredAt, "2026-09-12T10:00:00.000Z");
    assert.equal(payload.notes, "Morning bottle");
    assert.equal(payload.spitUp, false);
  });

  await t.test("toGrowDeskFeedingCreatePayload: breast mapping with duration", () => {
    const payload = toGrowDeskFeedingCreatePayload({
      babyId: "test-baby-1",
      type: "breast",
      leftMinutes: 10,
      rightMinutes: 5,
      timestamp: "2026-09-12T10:00:00.000Z",
    });

    assert.equal(payload.feedingType, "breast");
    assert.equal(payload.leftMinutes, 10);
    assert.equal(payload.rightMinutes, 5);
    assert.equal(payload.amountMl, null);
  });

  await t.test("toGrowDeskFeedingUpdatePayload: preserves baseVersion and serializes decimal", () => {
    const payload = toGrowDeskFeedingUpdatePayload({
      baseVersion: 3,
      type: "formula",
      amountMl: 50,
      timestamp: "2026-09-12T11:00:00.000Z",
      notes: "Small sip",
    });

    assert.equal(payload.baseVersion, "3");
    assert.equal(payload.feedingType, "formula");
    assert.equal(payload.amountMl, "50");
    assert.equal(payload.occurredAt, "2026-09-12T11:00:00.000Z");
    assert.equal(payload.notes, "Small sip");
  });

  await t.test("fromGrowDeskFeedingRecord: transforms back to Baby Panel frontend shape", () => {
    const mapped = fromGrowDeskFeedingRecord({
      id: "feed-uuid-1",
      babyId: "baby-uuid-1",
      familyId: "family-uuid-1",
      feedingType: "bottle",
      occurredAt: "2026-09-12T08:00:00.000Z",
      amountMl: "120.00",
      leftMinutes: null,
      rightMinutes: null,
      spitUp: false,
      formulaProductId: null,
      notes: "Thawed milk",
      source: "ui_manual",
      sourceAgent: null,
      version: "2",
      createdAt: "2026-09-12T08:00:00.000Z",
      updatedAt: "2026-09-12T08:05:00.000Z",
    });

    assert.equal(mapped.id, "feed-uuid-1");
    assert.equal(mapped.babyId, "baby-uuid-1");
    assert.equal(mapped.type, "bottle_breast");
    assert.equal(mapped.amountMl, 120);
    assert.equal(mapped.notes, "Thawed milk");
    assert.equal(mapped.version, "2");
    assert.equal(mapped.baseVersion, "2");
  });
});

test("SH-05: Web BFF CSRF and Session Security", async (t) => {
  await t.test("hashSessionSecret: deterministic 64-char hex digest", () => {
    const secret = "a".repeat(64);
    const hash1 = hashSessionSecret(secret);
    const hash2 = hashSessionSecret(secret);

    assert.equal(hash1.length, 64);
    assert.equal(hash1, hash2);
    assert.notEqual(hash1, secret);
  });

  await t.test("verifyBffCsrf: blocks missing origin and referer on mutating requests", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/records/feeding", {
      method: "POST",
    });
    const result = verifyBffCsrf(req, { enforceInTest: true });
    assert.ok(result !== null, "Should return an error response");
    assert.equal(result.status, 403);
    const body = await result.json();
    assert.match(body.error, /Missing Origin/);
  });

  await t.test("verifyBffCsrf: blocks mismatched origin", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/records/feeding", {
      method: "POST",
      headers: {
        origin: "https://evil.com",
      },
    });
    const result = verifyBffCsrf(req);
    assert.ok(result !== null, "Should return an error response");
    assert.equal(result.status, 403);
    const body = await result.json();
    assert.match(body.error, /Untrusted request origin/);
  });

  await t.test("verifyBffCsrf: accepts matching origin", () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/records/feeding", {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:3000",
      },
    });
    const result = verifyBffCsrf(req);
    assert.equal(result, null, "Should return null for valid origin");
  });
});

test("SH-05: Feeding Route Handler under BFF Mode", async (t) => {
  const originalEnv = process.env.GROWDESK_ENABLED;

  t.after(() => {
    process.env.GROWDESK_ENABLED = originalEnv;
  });

  await t.test("POST: rejects with 403 when CSRF check fails under BFF mode", async () => {
    process.env.GROWDESK_ENABLED = "true";

    const req = new NextRequest("http://127.0.0.1:3000/api/records/feeding", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.com",
      },
      body: JSON.stringify({ babyId: "baby-1" }),
    });

    const res = await POST(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /Untrusted request origin/);
  });

  await t.test("POST: rejects with 401 when BFF session cookie is missing", async () => {
    process.env.GROWDESK_ENABLED = "true";

    const req = new NextRequest("http://127.0.0.1:3000/api/records/feeding", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({ babyId: "baby-1", type: "formula", amountMl: 100 }),
    });

    const res = await POST(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/);
  });
});

for (const origin of ["https://127.0.0.1:3000", "http://127.0.0.1:3001", "https://attacker.example"]) {
  test(`CSRF rejects a noncanonical origin even with matching Host: ${origin}`, () => {
    const request = new Request("http://127.0.0.1:3000/api/baby", {
      method: "POST", headers: { origin, host: new URL(origin).host },
    });
    assert.equal(verifyBffCsrf(request, { enforceInTest: true })?.status, 403);
  });
}
