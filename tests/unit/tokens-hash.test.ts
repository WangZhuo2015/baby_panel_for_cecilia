import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import {
  TOKEN_PREFIX,
  hashPersonalAccessToken,
  buildTokenHint,
  verifyPersonalAccessToken,
} from "../../lib/tokens";

test("PAT hashing: sha256 hex, deterministic, no raw leakage", () => {
  const raw = `${TOKEN_PREFIX}abc123def456`;
  const h1 = hashPersonalAccessToken(raw);
  const h2 = hashPersonalAccessToken(raw);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.ok(!h1.includes("abc123"), "hash must not contain raw token material");
  assert.notEqual(hashPersonalAccessToken(`${TOKEN_PREFIX}other`), h1);
});

test("PAT hint: prefix + suffix, no full token", () => {
  const raw = `${TOKEN_PREFIX}0123456789abcdef`;
  const hint = buildTokenHint(raw);
  assert.equal(hint, `${raw.slice(0, 10)}…${raw.slice(-4)}`);
  assert.ok(!hint.includes(raw.slice(10, -4)), "hint must not leak middle of token");
});

test("PAT verify: rejects non-prefixed input without DB", async () => {
  assert.equal(await verifyPersonalAccessToken(""), null);
  assert.equal(await verifyPersonalAccessToken("random-string"), null);
  assert.equal(await verifyPersonalAccessToken("Bearer abc"), null);
});
