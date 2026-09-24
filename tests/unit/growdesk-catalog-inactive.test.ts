import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../app/api/nutrition/products/route";
import { GROWDESK_CONFIG } from "../../lib/config";

const familyId = "test_catalog_family";
const babyId = "test_catalog_baby";
const timestamp = "2026-01-01T00:00:00.000Z";

for (const backend of ["go", "typescript"] as const) {
  for (const kind of ["formula", "supplement"] as const) {
    test(`${backend} ${kind} catalog forwards explicit inactive filtering on every page`, async t => {
      const previousEnabled = process.env.GROWDESK_ENABLED;
      const previousBackend = process.env.GROWDESK_BACKEND;
      process.env.GROWDESK_ENABLED = "1";
      process.env.GROWDESK_BACKEND = backend;
      t.after(() => {
        if (previousEnabled === undefined) delete process.env.GROWDESK_ENABLED;
        else process.env.GROWDESK_ENABLED = previousEnabled;
        if (previousBackend === undefined) delete process.env.GROWDESK_BACKEND;
        else process.env.GROWDESK_BACKEND = previousBackend;
      });
      const baby = { id: babyId, familyId, name: "test baby", birthDate: "2026-01-01", gender: "girl", avatarUrl: null, gestationalWeeks: 38, gestationalDays: 0 };
      const active = {
        id: "test_active", familyId, name: "test product", brand: "test brand", stage: "1",
        scoopGrams: "4.3", waterMlPerScoop: "30", reconstitutionRatio: "0.135", servingSizeUnit: "per_100g",
        dosageForm: "drops", unitName: "滴", defaultDose: "1.5", nutrientsJson: {}, notes: null,
        isArchived: false, isActive: true, version: 1, createdAt: timestamp, updatedAt: timestamp,
      };
      const archived = { ...active, id: "test_archived", isArchived: true, isActive: false };
      const suffix = kind === "formula" ? "products" : "supplement-products";
      const calls: URL[] = [];
      t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname === "/api/v1/auth/bff/session") {
          return Response.json({ data: { accessToken: "test_catalog_token", user: { id: "test_user", username: "test_user", displayName: "test user" } } });
        }
        assert.equal(init?.method ?? "GET", "GET", "catalog loading is read-only");
        if (url.pathname === "/api/v1/families") return Response.json({ data: [{ id: familyId, name: "test family" }] });
        if (url.pathname === `/api/v1/families/${familyId}/babies`) return Response.json({ data: [baby] });
        if (url.pathname === `/api/v1/babies/${babyId}`) return Response.json({ data: baby });
        if (url.pathname === `/api/v1/babies/${babyId}/food-plan`) {
          assert.equal(kind, "formula", "canonical supplements must not read food-plan");
          return Response.json({ data: { id: null, babyId, planData: {}, version: "0", createdAt: null, updatedAt: timestamp } });
        }
        assert.equal(url.pathname, `/api/v1/families/${familyId}/nutrition/${suffix}`);
        calls.push(url);
        const withArchived = url.searchParams.get("includeArchived") === "true";
        if (url.searchParams.has("cursor")) {
          assert.equal(withArchived, true, "pagination must retain the archived filter");
          assert.equal(url.searchParams.get("cursor"), "test_next");
          return Response.json({ data: [archived], page: { nextCursor: null } });
        }
        return Response.json({ data: [active], page: { nextCursor: withArchived ? "test_next" : null } });
      });
      const bucket = kind === "formula" ? "formulas" : "supplements";
      for (const includeInactive of [false, true]) {
        calls.length = 0;
        const request = new Request(`https://test.invalid/api/nutrition/products?babyId=${babyId}&type=${kind}&includeInactive=${includeInactive}`, {
          headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"b".repeat(64)}` },
        });
        const response = await GET(request);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(body[bucket].map((row: { id: string }) => row.id), includeInactive ? [active.id, archived.id] : [active.id]);
        assert.equal(calls.length, includeInactive ? 2 : 1);
        if (includeInactive) {
          assert.equal(body[bucket][1].isActive, false, "archived products must not become active choices");
          for (const call of calls) assert.equal(call.searchParams.get("includeArchived"), "true");
        }
      }
    });
  }
}
