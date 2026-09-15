import { growdeskFetch } from "./client";
import { resolveBffSession } from "./session";
import { BridgeError, requireData, bridgeErrorResponse } from "./bridge-protocol";
export async function knowledgeBridge(request: Request, kind: "milestones" | "activities" | "warning-signs" | "feeding-guidelines") {
  try {
    const session = await resolveBffSession(request);
    if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
    const input = new URL(request.url).searchParams;
    const query = new URLSearchParams();
    for (const key of ["month", "category"]) if (input.has(key)) query.set(key, input.get(key)!);
    const path = kind === "feeding-guidelines" ? "/api/v1/knowledge/feeding-guidelines" : `/api/v1/development/${kind}`;
    const result = await growdeskFetch<Record<string, unknown>[]>(`${path}?${query}`, { accessToken: session.accessToken });
    const items = requireData(result).map(item => item.details && typeof item.details === "object" ? item.details : item);
    return Response.json(kind === "milestones" ? { milestones: items, dataRelease: result.dataRelease ?? null } : items);
  } catch (error) { return bridgeErrorResponse(error); }
}
