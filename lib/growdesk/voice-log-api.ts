import {
  BridgeError,
  pathId,
  requireData,
  type BridgeFetch,
} from "./bridge-protocol";
import type { BffVoiceLog } from "./voice-logs";

interface ApiVoiceLog {
  id: string;
  userId: string;
  familyId: string;
  babyId: string;
  prompt: string;
  reply: string;
  isAsync: boolean;
  isFastPath: boolean;
  acknowledged: boolean;
  createdAt: string;
  baby: { id: string; nickname: string; gender: string } | null;
}

function mapVoiceLog(value: unknown): BffVoiceLog {
  if (!value || typeof value !== "object") {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 返回了无效的语音记录");
  }
  const row = value as Partial<ApiVoiceLog>;
  if (
    typeof row.id !== "string" ||
    typeof row.userId !== "string" ||
    typeof row.familyId !== "string" ||
    typeof row.babyId !== "string" ||
    typeof row.prompt !== "string" ||
    typeof row.reply !== "string" ||
    typeof row.isAsync !== "boolean" ||
    typeof row.isFastPath !== "boolean" ||
    typeof row.acknowledged !== "boolean" ||
    typeof row.createdAt !== "string"
  ) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 返回了不完整的语音记录");
  }
  const baby = row.baby;
  if (baby !== null && baby !== undefined && (
    typeof baby !== "object" || typeof baby.id !== "string" ||
    typeof baby.nickname !== "string" || typeof baby.gender !== "string"
  )) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 返回了无效的语音记录宝宝信息");
  }
  return {
    id: row.id,
    userId: row.userId,
    babyId: row.babyId,
    prompt: row.prompt,
    reply: row.reply,
    isAsync: row.isAsync,
    isFastPath: row.isFastPath,
    acknowledged: row.acknowledged,
    createdAt: row.createdAt,
    baby: baby ? { id: baby.id, nickname: baby.nickname, gender: baby.gender } : null,
  };
}

export async function createGrowDeskVoiceLog(
  fetchApi: BridgeFetch,
  accessToken: string,
  input: {
    babyId: string;
    prompt: string;
    reply: string;
    isAsync: boolean;
    isFastPath: boolean;
    acknowledged: boolean;
  },
): Promise<BffVoiceLog> {
  const data = requireData(await fetchApi<ApiVoiceLog>("/api/v1/voice/logs", {
    method: "POST",
    accessToken,
    body: input,
  }));
  return mapVoiceLog(data);
}

export async function listGrowDeskVoiceLogs(
  fetchApi: BridgeFetch,
  accessToken: string,
  options: { limit?: number; unreadAsyncOnly?: boolean } = {},
): Promise<{ logs: BffVoiceLog[]; unreadLog: BffVoiceLog | null }> {
  const params = new URLSearchParams();
  if (options.unreadAsyncOnly) params.set("unreadAsync", "true");
  else params.set("limit", String(Math.min(Math.max(options.limit ?? 20, 1), 50)));
  const suffix = params.toString();
  const data = requireData(await fetchApi<ApiVoiceLog[] | ApiVoiceLog | null>(
    `/api/v1/voice/logs?${suffix}`,
    { accessToken },
  ));
  if (options.unreadAsyncOnly) {
    return { logs: [], unreadLog: data ? mapVoiceLog(data) : null };
  }
  if (!Array.isArray(data)) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 语音记录列表格式错误");
  }
  return { logs: data.map(mapVoiceLog), unreadLog: null };
}

export async function getGrowDeskVoiceLog(
  fetchApi: BridgeFetch,
  accessToken: string,
  id: string,
): Promise<BffVoiceLog> {
  return mapVoiceLog(requireData(await fetchApi<ApiVoiceLog>(`/api/v1/voice/logs/${pathId(id)}`, { accessToken })));
}

export async function acknowledgeGrowDeskVoiceLog(
  fetchApi: BridgeFetch,
  accessToken: string,
  id: string,
  acknowledged: boolean,
): Promise<void> {
  const result = requireData(await fetchApi<{ success: boolean }>(`/api/v1/voice/logs/${pathId(id)}`, {
    method: "PATCH",
    accessToken,
    body: { acknowledged },
  }));
  if (result?.success !== true) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "服务端未确认语音记录状态");
  }
}
