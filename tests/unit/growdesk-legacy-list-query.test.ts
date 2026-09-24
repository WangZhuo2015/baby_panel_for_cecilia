import test from "node:test";
import assert from "node:assert/strict";
import { legacyListQuery } from "../../lib/growdesk/legacy-list-query";

test("public list endpoints retain legacy default, cap, and numeric coercion", () => {
  for (const [raw, expected] of [[undefined, "50"], ["500", "100"], ["0", "1"], ["garbage", "50"], ["12rows", "12"], ["3", "3"]]) {
    const query = new URLSearchParams({ babyId: "test_baby", date: "2026-09-19" });
    if (raw !== undefined) query.set("limit", raw);
    const normalized = legacyListQuery(query);
    assert.equal(normalized.get("limit"), expected);
    assert.equal(normalized.get("babyId"), "test_baby");
    assert.equal(normalized.get("date"), "2026-09-19");
    assert.equal(query.get("limit"), raw ?? null, "Do not mutate the caller's query");
  }
});
