import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import {
  signAuthToken,
  verifyAuthToken,
  hashPassword,
  verifyPassword,
} from "../../lib/auth";

test("Auth: Password hashing and verification", async () => {
  const password = "Secr3t_Baby_Password!2026";
  const hash = await hashPassword(password);
  assert.ok(typeof hash === "string" && hash.length > 20);

  const isMatch = await verifyPassword(password, hash);
  assert.equal(isMatch, true);

  const isWrongMatch = await verifyPassword("WrongPassword123", hash);
  assert.equal(isWrongMatch, false);
});

test("Auth: JWT signing, verification, and tamper protection", async () => {
  const payload = { userId: "user-12345", username: "daddy_cecilia" };
  const token = await signAuthToken(payload);
  assert.ok(typeof token === "string" && token.split(".").length === 3);

  const verified = await verifyAuthToken(token);
  assert.ok(verified !== null);
  assert.equal(verified?.userId, "user-12345");
  assert.equal(verified?.username, "daddy_cecilia");

  // Tampered token test
  const tamperedToken = token.slice(0, -5) + "abcde";
  const invalidResult = await verifyAuthToken(tamperedToken);
  assert.equal(invalidResult, null);

  // Random invalid string
  const garbageResult = await verifyAuthToken("invalid.token.structure");
  assert.equal(garbageResult, null);
});
