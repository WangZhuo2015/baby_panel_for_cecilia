import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_TURN_ID_PATTERN,
  isPotentialWriteTool,
  makeChatRetryClaimToolsJson,
  makeChatToolsJson,
  makeChatTurnRequestToolsJson,
  readChatLlmModelInfo,
  readChatTurnReceipt,
  readChatTurnRequest,
  stableChatAssistantMessageId,
  stableChatRetryClaimMessageId,
  stableChatUserMessageId,
  withoutChatMetadata,
  type ChatLlmModelInfo,
  type ChatTurnReceipt,
} from "../../lib/agent/chat-retry";

const turnId = "123e4567-e89b-42d3-a456-426614174000";

test("turn IDs and deterministic message IDs are valid, stable, and owner/session/attempt scoped", () => {
  assert.equal(CHAT_TURN_ID_PATTERN.test(turnId), true);

  const userId = stableChatUserMessageId("test_user_alpha", "test_session_alpha", turnId);
  const assistantAttempt1 = stableChatAssistantMessageId("test_user_alpha", "test_session_alpha", turnId, 1);
  const assistantAttempt2 = stableChatAssistantMessageId("test_user_alpha", "test_session_alpha", turnId, 2);
  const retryClaim = stableChatRetryClaimMessageId("test_user_alpha", "test_session_alpha", turnId, 2);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const id of [userId, assistantAttempt1, assistantAttempt2, retryClaim]) assert.match(id, uuidPattern);
  assert.equal(userId, stableChatUserMessageId("test_user_alpha", "test_session_alpha", turnId));
  assert.notEqual(userId, stableChatUserMessageId("test_user_beta", "test_session_alpha", turnId));
  assert.notEqual(userId, stableChatUserMessageId("test_user_alpha", "test_session_beta", turnId));
  assert.notEqual(assistantAttempt1, assistantAttempt2);
  assert.notEqual(assistantAttempt2, retryClaim);

  assert.throws(() => stableChatUserMessageId("test_user_alpha", "test_session_alpha", "not-a-uuid"));
  assert.throws(() => stableChatAssistantMessageId("test_user_alpha", "test_session_alpha", turnId, 0));
  assert.throws(() => stableChatRetryClaimMessageId("test_user_alpha", "test_session_alpha", turnId, 1));
});

test("turn request and retry claim metadata round-trip with normalized UUIDs", () => {
  const uppercaseTurnId = turnId.toUpperCase();
  const request = JSON.parse(makeChatTurnRequestToolsJson(uppercaseTurnId, "test_fingerprint")) as unknown[];
  assert.deepEqual(readChatTurnRequest(request), { turnId, fingerprint: "test_fingerprint" });
  assert.equal(readChatTurnRequest([{ type: "llm_turn_request", turnId: "not-a-uuid" }]), undefined);
  assert.throws(() => makeChatTurnRequestToolsJson("not-a-uuid"));

  const retryClaim = JSON.parse(makeChatRetryClaimToolsJson(uppercaseTurnId, 2)) as Array<Record<string, unknown>>;
  assert.deepEqual(retryClaim, [{ type: "llm_retry_claim", role: "system", turnId, attempt: 2 }]);
  assert.throws(() => makeChatRetryClaimToolsJson(turnId, 1));
});

test("persisted model and turn metadata round-trip and are stripped from provider tool history", () => {
  const llm: ChatLlmModelInfo = {
    source: "api",
    provider: "test_provider",
    model: "test_actual_model",
    profileId: "test_profile",
  };
  const turn: ChatTurnReceipt = {
    type: "llm_turn",
    turnId,
    status: "failed",
    attempt: 2,
    retryable: true,
    writeToolStarted: false,
    error: "test retryable error",
  };
  const visibleToolTrace = { type: "tool", name: "get_records", status: "end" };
  const encoded = makeChatToolsJson([visibleToolTrace], { llm, turn });
  assert.equal(typeof encoded, "string");
  const parsed = JSON.parse(encoded!) as unknown[];

  assert.deepEqual(readChatLlmModelInfo(parsed), llm);
  assert.deepEqual(readChatTurnReceipt(parsed), turn);
  assert.deepEqual(withoutChatMetadata(parsed), [visibleToolTrace]);
  assert.equal(withoutChatMetadata([null, "test", visibleToolTrace]).at(-1), visibleToolTrace);
  assert.equal(makeChatToolsJson([], {}), null);
});

test("potential write tools are conservatively classified while explicit reads stay replay-safe", () => {
  assert.equal(isPotentialWriteTool("get_records"), false);
  assert.equal(isPotentialWriteTool("search_foods"), false);
  assert.equal(isPotentialWriteTool("list_growth_measurements"), false);
  assert.equal(isPotentialWriteTool("save_medical_report"), true);
  assert.equal(isPotentialWriteTool("record_vaccine"), true);
  assert.equal(isPotentialWriteTool("update_record"), true);
  assert.equal(isPotentialWriteTool("test_unknown_tool"), true);
});
