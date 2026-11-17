import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import { ChatStreamError, consumeChatEventStream } from "../../lib/agent/chat-client-stream";
import { createRetryingModelStreamFn, getRetryAfterMs } from "../../lib/agent/stream-retry";

const model: Model<"openai-completions"> = {
  id: "test_retry_model",
  name: "test_retry_model",
  api: "openai-completions",
  provider: "test_provider",
  baseUrl: "https://test-provider.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 256,
};

function assistantMessage(
  text: string,
  stopReason: "stop" | "error" = "stop",
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: text.length,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1 + text.length,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: 1,
  };
}

function textEvent(text: string): AssistantMessageEvent {
  return {
    type: "text_delta",
    contentIndex: 0,
    delta: text,
    partial: assistantMessage(text),
  };
}

function successfulStream(text: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message = assistantMessage(text);
  stream.push(textEvent(text));
  stream.push({ type: "done", reason: "stop", message });
  return stream;
}

function failedStream(text: string, errorMessage: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message = assistantMessage(text, "error", errorMessage);
  stream.push(textEvent(text));
  stream.push({ type: "error", reason: "error", error: message });
  return stream;
}

function lazyThrowStream(text: string, error: unknown): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const event = textEvent(text);
  stream.push(event);
  // Keep a real Pi event stream but simulate a provider failure during lazy iteration,
  // after a partial delta has already been received.
  Object.defineProperty(stream, Symbol.asyncIterator, {
    configurable: true,
    value: async function* () {
      yield event;
      throw error;
    },
  });
  return stream;
}

async function collect(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function contextWithCompletedTool(): Context {
  return {
    messages: [
      { role: "user", content: "test question", timestamp: 1 },
      {
        role: "toolResult",
        toolCallId: "test_tool_call",
        toolName: "get_records",
        content: [{ type: "text", text: "test existing tool result" }],
        isError: false,
        timestamp: 2,
      },
    ],
  };
}

test("lazy 429 retries after Retry-After, drops partial output, and reuses completed tool context", async () => {
  const context = contextWithCompletedTool();
  const originalMessages = structuredClone(context.messages);
  const seenContexts: Context[] = [];
  const waits: number[] = [];
  let calls = 0;
  const retryAfter = Object.assign(new Error("Too many requests"), {
    status: 429,
    headers: new Headers({ "Retry-After": "1.5" }),
  });

  const retrying = createRetryingModelStreamFn(async (_candidate, receivedContext) => {
    calls += 1;
    seenContexts.push(receivedContext);
    if (calls === 1) return lazyThrowStream("test partial discarded", retryAfter);
    return successfulStream("test accepted reply");
  }, {
    maxRetries: 1,
    wait: async (ms) => { waits.push(ms); },
  });

  const output = await retrying(model, context);
  const final = await output.result();
  const events = await collect(output);

  assert.equal(calls, 2);
  assert.deepEqual(waits, [1500]);
  assert.equal(final.stopReason, "stop");
  assert.deepEqual(events.filter((event) => event.type === "text_delta").map((event) => event.type === "text_delta" ? event.delta : ""), ["test accepted reply"]);
  assert.equal(seenContexts[0], context);
  assert.equal(seenContexts[1], context);
  assert.deepEqual(context.messages, originalMessages);
  assert.equal(context.messages.filter((message) => message.role === "toolResult").length, 1);
});

test("401 lazy stream failure is not retried", async () => {
  let calls = 0;
  const waits: number[] = [];
  const unauthorized = Object.assign(new Error("Unauthorized"), { status: 401 });
  const retrying = createRetryingModelStreamFn(async () => {
    calls += 1;
    return lazyThrowStream("test partial", unauthorized);
  }, { maxRetries: 2, wait: async (ms) => { waits.push(ms); } });

  const output = await retrying(model, contextWithCompletedTool());
  const final = await output.result();
  const events = await collect(output);

  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
  assert.equal(final.stopReason, "error");
  assert.match(final.errorMessage || "", /Unauthorized/);
  assert.equal(events.filter((event) => event.type === "error").length, 1);
});

test("Retry-After parses seconds, HTTP dates, and case-insensitive header containers", () => {
  assert.equal(getRetryAfterMs({ headers: { "Retry-After": "2.25" } }), 2250);
  assert.equal(getRetryAfterMs({ response: { headers: new Headers({ "retry-after": "3" }) } }), 3000);
  assert.equal(getRetryAfterMs({ headers: { "retry-after": new Date(Date.now() + 5000).toUTCString() } })! > 0, true);
  assert.equal(getRetryAfterMs({ headers: { "retry-after": "not a date" } }), null);
});

test("a long Retry-After does not trigger an immediate retry", async () => {
  let calls = 0;
  const waits: number[] = [];
  const delayed = Object.assign(new Error("Too many requests"), {
    status: 429,
    headers: new Headers({ "Retry-After": "31" }),
  });
  const retrying = createRetryingModelStreamFn(async () => {
    calls += 1;
    return lazyThrowStream("test partial", delayed);
  }, { maxRetries: 2, wait: async (ms) => { waits.push(ms); } });

  const output = await retrying(model, contextWithCompletedTool());
  const final = await output.result();
  await collect(output);

  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
  assert.equal(final.stopReason, "error");
});

test("terminal chat SSE error exposes known retry metadata and truncated stream is uncertain", async () => {
  const received: Record<string, unknown>[] = [];
  const payload = {
    error: "test provider failed",
    turnId: "123e4567-e89b-42d3-a456-426614174000",
    retryable: true,
    writeToolStarted: false,
    attempt: 2,
  };
  const response = new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });

  await assert.rejects(consumeChatEventStream(response, (event) => received.push(event)), (error: unknown) => {
    assert(error instanceof ChatStreamError);
    assert.equal(error.message, "test provider failed");
    assert.equal(error.uncertain, false);
    assert.deepEqual(error.details, {
      turnId: payload.turnId,
      retryable: true,
      writeToolStarted: false,
      attempt: 2,
    });
    return true;
  });
  assert.deepEqual(received, [payload]);

  const truncated = new Response('data: {"text":"test partial"}\n\n', {
    headers: { "Content-Type": "text/event-stream" },
  });
  await assert.rejects(consumeChatEventStream(truncated, () => undefined), (error: unknown) => {
    assert(error instanceof ChatStreamError);
    assert.equal(error.uncertain, true);
    return true;
  });
});
