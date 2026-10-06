import test from "node:test";
import assert from "node:assert/strict";
import {
  BridgeError,
  type BridgeFetch,
  type BridgeResult,
} from "../../lib/growdesk/bridge-protocol";
import { createPassportEndpoints, type PassportEndpointDependencies } from "../../lib/growdesk/passport-endpoints";
import { isBridgedMethod } from "../../lib/growdesk/bridge-policy";

const babyId = "550e8400-e29b-41d4-a716-446655440002";
const familyId = "550e8400-e29b-41d4-a716-446655440001";
const deviceId = "550e8400-e29b-41d4-a716-446655440000";
const pairingId = "550e8400-e29b-41d4-a716-446655440003";
const session = { accessToken: "test_access_token", user: { id: "550e8400-e29b-41d4-a716-446655440004" } };

type FetchCall = { path: string; options?: Parameters<BridgeFetch>[1] };

function request(path: string, method = "GET", body?: string, headers: Record<string, string> = {}) {
  return new Request(`https://test.invalid${path}`, {
    method,
    headers: {
      ...(method === "POST" || method === "DELETE" ? { origin: "https://test.invalid" } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  });
}

function dependencies(options: {
  available?: boolean;
  authenticated?: boolean;
  csrfReject?: boolean;
  baby?: { id: string; familyId?: string | null } | null;
  babyError?: Error;
  upstream?: BridgeResult<unknown>;
} = {}) {
  const calls: FetchCall[] = [];
  const events: string[] = [];
  const fetchApi: BridgeFetch = async <T>(path: string, fetchOptions?: Parameters<BridgeFetch>[1]) => {
    calls.push({ path, options: fetchOptions });
    const result = options.upstream ?? {
      ok: true,
      status: 200,
      data: { pairingId, status: "claimed" },
    };
    return result as BridgeResult<T>;
  };
  const deps: PassportEndpointDependencies = {
    isAvailable: () => options.available ?? true,
    resolveSession: async () => {
      events.push("session");
      return options.authenticated === false ? null : session;
    },
    fetchApi,
    loadBaby: async (_fetch, token, requestedBabyId) => {
      events.push("baby");
      assert.equal(token, session.accessToken);
      assert.equal(requestedBabyId, babyId);
      if (options.babyError) throw options.babyError;
      return options.baby === undefined ? { id: babyId, familyId } : options.baby;
    },
    verifyCsrf: () => {
      events.push("csrf");
      return options.csrfReject
        ? Response.json({ error: "test_csrf_rejected" }, { status: 403 })
        : null;
    },
  };
  return { endpoints: createPassportEndpoints(deps), calls, events };
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

test("Passport BFF is allowlisted only for claim, device list, and UUID revoke", () => {
  assert.equal(isBridgedMethod("/api/passport/pairings/claim", "POST", "go"), true);
  assert.equal(isBridgedMethod("/api/passport/pairings/claim", "GET", "go"), false);
  assert.equal(isBridgedMethod("/api/passport/devices", "GET", "go"), true);
  assert.equal(isBridgedMethod("/api/passport/devices", "POST", "go"), false);
  assert.equal(isBridgedMethod(`/api/passport/devices/${deviceId}`, "DELETE", "go"), true);
  assert.equal(isBridgedMethod(`/api/passport/devices/${deviceId}`, "GET", "go"), false);
  assert.equal(isBridgedMethod("/api/passport/pairings", "POST", "go"), false);
  assert.equal(isBridgedMethod("/api/passport/pairings/anything/poll", "POST", "go"), false);
  assert.equal(isBridgedMethod("/api/passport/auth/token", "POST", "go"), false);
  assert.equal(isBridgedMethod("/api/passport/ws", "GET", "go"), false);
});

test("Passport endpoints return 501 outside enabled Go mode without session or upstream calls", async () => {
  const state = dependencies({ available: false });
  const claim = await state.endpoints.claim(request(
    "/api/passport/pairings/claim", "POST", JSON.stringify({ pairCode: "AB2D-EFGH", babyId }),
  ));
  const list = await state.endpoints.listDevices(request("/api/passport/devices"));
  const revoke = await state.endpoints.revokeDevice(request(`/api/passport/devices/${deviceId}`, "DELETE"), deviceId);
  for (const response of [claim, list, revoke]) {
    assert.equal(response.status, 501);
    assert.equal((await body(response)).code, "PASSPORT_BFF_NOT_AVAILABLE");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(state.events, []);
  assert.deepEqual(state.calls, []);
});

test("unauthenticated claim returns 401 without authorized-baby read or claim fetch", async () => {
  const state = dependencies({ authenticated: false });
  const response = await state.endpoints.claim(request(
    "/api/passport/pairings/claim", "POST", JSON.stringify({ pairCode: "AB2D-EFGH", babyId }),
  ));
  assert.equal(response.status, 401);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.events, ["csrf", "session"]);
});

test("CSRF rejection runs before session exchange or any upstream fetch", async () => {
  const state = dependencies({ csrfReject: true });
  const response = await state.endpoints.claim(request(
    "/api/passport/pairings/claim", "POST", JSON.stringify({ pairCode: "AB2D-EFGH", babyId }),
  ));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.events, ["csrf"]);
});

test("claim uses authorized baby's family, normalizes pair code, and sends the same BFF token", async () => {
  const state = dependencies();
  const response = await state.endpoints.claim(request(
    "/api/passport/pairings/claim",
    "POST",
    JSON.stringify({ pairCode: " ab2d efgh ", babyId, deviceLabel: "Test Passport" }),
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { data: { pairingId, status: "claimed" } });
  assert.deepEqual(state.events, ["csrf", "session", "baby"]);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0]!.path, "/api/v1/passport/pairings/claim");
  assert.equal(state.calls[0]!.options?.method, "POST");
  assert.equal(state.calls[0]!.options?.accessToken, session.accessToken);
  assert.deepEqual(state.calls[0]!.options?.body, {
    pairCode: "AB2D-EFGH",
    familyId,
    babyId,
    deviceLabel: "Test Passport",
  });
});

test("claim rejects an unauthorized baby before calling the claim endpoint", async () => {
  const state = dependencies({ babyError: new BridgeError(403, "BABY_ACCESS_DENIED", "test baby denied") });
  const response = await state.endpoints.claim(request(
    "/api/passport/pairings/claim", "POST", JSON.stringify({ pairCode: "AB2D-EFGH", babyId }),
  ));
  assert.equal(response.status, 403);
  assert.deepEqual(await body(response), { error: "test baby denied", code: "BABY_ACCESS_DENIED" });
  assert.deepEqual(state.events, ["csrf", "session", "baby"]);
  assert.deepEqual(state.calls, []);
});

test("claim preserves a deleted or revoked baby's 404 and never calls the claim endpoint", async () => {
  const state = dependencies({ babyError: new BridgeError(404, "BABY_NOT_FOUND", "test baby not found") });
  const response = await state.endpoints.claim(request(
    "/api/passport/pairings/claim", "POST", JSON.stringify({ pairCode: "AB2D-EFGH", babyId }),
  ));
  assert.equal(response.status, 404);
  assert.deepEqual(await body(response), { error: "test baby not found", code: "BABY_NOT_FOUND" });
  assert.deepEqual(state.events, ["csrf", "session", "baby"]);
  assert.deepEqual(state.calls, []);
});

test("claim rejects malformed JSON, untrusted family input, invalid IDs, and overlong labels before reads/writes", async () => {
  const invalidRequests = [
    request("/api/passport/pairings/claim", "POST", "{"),
    request("/api/passport/pairings/claim", "POST", JSON.stringify({ pairCode: "AB2D-EFGH", babyId, familyId })),
    request("/api/passport/pairings/claim", "POST", JSON.stringify({ pairCode: "AB2D-EFGH", babyId: "not-a-uuid" })),
    request("/api/passport/pairings/claim", "POST", JSON.stringify({ pairCode: "AB2D-EFGH", babyId, deviceLabel: "x".repeat(101) })),
    request("/api/passport/pairings/claim", "POST", JSON.stringify({ pairCode: "AB1D-EFGH", babyId })),
  ];
  for (const invalidRequest of invalidRequests) {
    const state = dependencies();
    const response = await state.endpoints.claim(invalidRequest);
    assert.equal(response.status, 400);
    assert.deepEqual(state.calls, []);
    assert.deepEqual(state.events, ["csrf", "session"]);
  }
});

test("claim preserves upstream status and machine error code", async () => {
  const state = dependencies({ upstream: {
    ok: false,
    status: 409,
    error: { code: "PAIRING_ALREADY_CLAIMED", message: "test already claimed" },
  } });
  const response = await state.endpoints.claim(request(
    "/api/passport/pairings/claim", "POST", JSON.stringify({ pairCode: "AB2D-EFGH", babyId }),
  ));
  assert.equal(response.status, 409);
  assert.deepEqual(await body(response), {
    error: "test already claimed",
    code: "PAIRING_ALREADY_CLAIMED",
  });
  assert.equal(state.calls.length, 1);
});

test("device list retains cursor paging and returns only the allowlisted DTO", async () => {
  const state = dependencies({ upstream: {
    ok: true,
    status: 200,
    data: [{
      id: deviceId,
      ownerUserId: session.user.id,
      familyId,
      babyId,
      deviceLabel: "Test Passport",
      firmwareVersion: "1.2.3",
      hardwareVersion: "ESP32-C3",
      capabilities: { credential: "capability-secret" },
      lastSeenAt: null,
      revokedAt: null,
      createdAt: "2026-10-02T00:00:00Z",
      updatedAt: "2026-10-02T00:00:00Z",
      credential: "device-secret",
      credentialHash: "hash-secret",
      deviceCredential: "one-time-secret",
    }],
    page: { nextCursor: "next+cursor==" },
  } });
  const response = await state.endpoints.listDevices(request(
    "/api/passport/devices?cursor=opaque%2Bcursor%3D%3D&limit=17",
  ));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(state.calls[0]!.path,
    "/api/v1/passport/devices?cursor=opaque%2Bcursor%3D%3D&limit=17");
  assert.equal(state.calls[0]!.options?.accessToken, session.accessToken);
  const result = await body(response);
  assert.deepEqual(result, {
    data: [{
      id: deviceId,
      familyId,
      babyId,
      deviceLabel: "Test Passport",
      firmwareVersion: "1.2.3",
      hardwareVersion: "ESP32-C3",
      lastSeenAt: null,
      revokedAt: null,
      createdAt: "2026-10-02T00:00:00Z",
      updatedAt: "2026-10-02T00:00:00Z",
    }],
    page: { nextCursor: "next+cursor==" },
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(Object.hasOwn((result.data as Record<string, unknown>[])[0]!, "ownerUserId"), false);
});

test("device list maps malformed upstream rows to 502", async () => {
  const state = dependencies({ upstream: { ok: true, status: 200, data: [{ id: deviceId }] } });
  const response = await state.endpoints.listDevices(request("/api/passport/devices"));
  assert.equal(response.status, 502);
  assert.equal((await body(response)).code, "UPSTREAM_INVALID_RESPONSE");
});

test("device revoke preserves backend owner errors and never returns credentials", async () => {
  const state = dependencies({ upstream: {
    ok: false,
    status: 404,
    error: { code: "RECORD_NOT_FOUND", message: "test device not found" },
  } });
  const response = await state.endpoints.revokeDevice(
    request(`/api/passport/devices/${deviceId}`, "DELETE"),
    deviceId,
  );
  assert.equal(response.status, 404);
  const payload = await body(response);
  assert.equal(payload.code, "RECORD_NOT_FOUND");
  assert.equal(JSON.stringify(payload).includes("credential"), false);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0]!.options?.method, "DELETE");
  assert.equal(state.calls[0]!.options?.accessToken, session.accessToken);
});

test("device revoke rejects malformed IDs before session or upstream calls", async () => {
  const state = dependencies();
  const response = await state.endpoints.revokeDevice(
    request("/api/passport/devices/not-a-uuid", "DELETE"),
    "not-a-uuid",
  );
  assert.equal(response.status, 400);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.events, ["csrf"]);
});
