import assert from "node:assert/strict";
import test from "node:test";
import {
  makeChatTurnRequestToolsJson,
  readChatRetryContext,
} from "../../lib/agent/chat-retry";

const turnId = "123e4567-e89b-42d3-a456-426614174000";

test("retry context metadata distinguishes absent context from an unavailable oversized context", () => {
  const absent = JSON.parse(makeChatTurnRequestToolsJson(turnId, "test_fingerprint", { contextDetailPresent: false })) as unknown[];
  assert.deepEqual(readChatRetryContext(absent), { available: true });

  const contextDetail = { recordId: "test_record_1", note: "test original context" };
  const persisted = JSON.parse(makeChatTurnRequestToolsJson(turnId, "test_fingerprint", { contextDetailPresent: true, contextDetail })) as unknown[];
  assert.deepEqual(readChatRetryContext(persisted), { available: true, contextDetail });

  const tooLarge = JSON.parse(makeChatTurnRequestToolsJson(turnId, "test_fingerprint", {
    contextDetailPresent: true,
    contextDetail: "x".repeat(129 * 1024),
  })) as unknown[];
  assert.deepEqual(readChatRetryContext(tooLarge), { available: false });
  assert.equal(JSON.stringify(tooLarge).length < 1024, true);
});
