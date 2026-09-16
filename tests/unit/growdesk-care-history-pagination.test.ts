import test from "node:test";
import assert from "node:assert/strict";
import { type BridgeFetch, type BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { fetchLegacyRecordList } from "../../lib/growdesk/record-list";

const BABY = "test_baby_care_history";

for (const kind of ["sleep", "diaper", "food"] as const) {
  function fixture() {
    const rows = Array.from({ length: 401 }, (_, index) => ({
      id: `test_${kind}_${index}`,
      babyId: BABY,
      occurredAt: "2026-09-01T08:00:00.000Z",
      startedAt: "2026-09-01T08:00:00.000Z",
      endedAt: "2026-09-01T09:00:00.000Z",
      recordDate: "2026-09-01",
    }));
    const requestedSizes: number[] = [];
    const fetchApi: BridgeFetch = async <T>(path: string): Promise<BridgeResult<T>> => {
      const url = new URL(path, "http://localhost");
      assert.equal(url.pathname, `/api/v1/babies/${BABY}/records/${kind}`);
      const limit = Number(url.searchParams.get("limit"));
      const offset = Number(url.searchParams.get("cursor") || "0");
      requestedSizes.push(limit);
      // Reproduce the older server repository exactly: it caps the service's
      // internal limit+1 at 200, so a wire page of 200 incorrectly ends history.
      const lookahead = rows.slice(offset, offset + Math.min(limit + 1, 200));
      const nextCursor = lookahead.length > limit ? String(offset + limit) : null;
      return { ok: true, status: 200, data: lookahead.slice(0, limit) as T, page: { nextCursor } };
    };
    return { rows, requestedSizes, fetchApi };
  }

  test(`${kind} history remains complete against a server that caps its internal lookahead at 200`, async () => {
    const h = fixture();
    const result = await fetchLegacyRecordList<(typeof h.rows)[number]>(h.fetchApi, "test_token", BABY, new URLSearchParams(), kind);
    assert.equal(result.length, 401);
    assert.deepEqual(result.map(row => row.id), h.rows.map(row => row.id));
    assert.deepEqual(h.requestedSizes, [100, 100, 100, 100, 100]);
  });

  test(`${kind} explicit legacy result limits are independent of upstream page size`, async () => {
    const h = fixture();
    const result = await fetchLegacyRecordList<(typeof h.rows)[number]>(h.fetchApi, "test_token", BABY,
      new URLSearchParams({ limit: "201" }), kind);
    assert.equal(result.length, 201);
    assert.deepEqual(result.map(row => row.id), h.rows.slice(0, 201).map(row => row.id));
    assert.deepEqual(h.requestedSizes, [100, 100, 100]);
  });
}
