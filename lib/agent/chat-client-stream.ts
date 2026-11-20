export interface ChatStreamErrorDetails {
  turnId?: string;
  retryable?: boolean;
  writeToolStarted?: boolean;
  attempt?: number;
  code?: string;
}

export class ChatStreamError extends Error {
  readonly details: ChatStreamErrorDetails;
  readonly uncertain: boolean;

  constructor(message: string, details: ChatStreamErrorDetails = {}, uncertain = false) {
    super(message);
    this.name = "ChatStreamError";
    this.details = details;
    this.uncertain = uncertain;
  }
}

/** Consume JSON SSE frames without swallowing malformed or terminal error frames. */
export async function consumeChatEventStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new ChatStreamError(
      typeof body.error === "string" ? body.error : `AI 请求未完成（HTTP ${response.status}）`,
      { code: typeof body.code === "string" ? body.code : undefined, retryable: body.retryable === true },
    );
  }
  if (!response.body) throw new ChatStreamError("服务器没有返回对话流", {}, true);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  let terminalError: Record<string, unknown> | undefined;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trimStart();
    if (payload === "[DONE]") { sawDone = true; return; }
    let event: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(payload);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SSE event must be an object");
      event = value as Record<string, unknown>;
    } catch (error) {
      throw new ChatStreamError(error instanceof Error ? error.message : "对话事件格式错误", {}, true);
    }
    if (typeof event.error === "string") terminalError = event;
    onEvent(event);
  };

  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        consumeLine(line);
        if (sawDone) break;
      }
    }
    buffer += decoder.decode();
    if (!sawDone && buffer.trim()) consumeLine(buffer);
  } catch (error) {
    if (error instanceof ChatStreamError) throw error;
    throw new ChatStreamError(error instanceof Error ? error.message : "对话连接中断", {}, true);
  } finally {
    reader.releaseLock();
  }

  if (!sawDone) throw new ChatStreamError("对话流意外结束，正在核对后台状态", {}, true);
  if (terminalError) {
    throw new ChatStreamError(
      typeof terminalError.error === "string" ? terminalError.error : "AI 请求未完成",
      {
        turnId: typeof terminalError.turnId === "string" ? terminalError.turnId : undefined,
        retryable: terminalError.retryable === true,
        writeToolStarted: terminalError.writeToolStarted === true,
        attempt: typeof terminalError.attempt === "number" ? terminalError.attempt : undefined,
      },
    );
  }
}
