import { growdeskFetch } from "./client";
import { resolveBffSession } from "./session";
import { verifyBffCsrf } from "./csrf";
import { BridgeError, requireData, bridgeErrorResponse, pathId, wireVersion } from "./bridge-protocol";
import { fromGrowDeskMedicalRecord, toGrowDeskMedicalUpdatePayload, type GrowDeskMedicalReport } from "./medical-compat";
export async function medicalDetailBridge(request: Request, id: string) {
  try {
    const csrf = verifyBffCsrf(request); if (csrf) return csrf;
    const session = await resolveBffSession(request);
    if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
    const query = new URL(request.url).searchParams;
    const body = request.method === "GET" ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;
    const babyId = pathId(body.babyId ?? query.get("babyId"));
    const path = `/api/v1/babies/${babyId}/medical-reports/${pathId(id)}`;
    if (request.method === "DELETE") {
      requireData(await growdeskFetch(path, { method: "DELETE", accessToken: session.accessToken, body: { baseVersion: wireVersion(body.baseVersion ?? query.get("baseVersion")) } }));
      return Response.json({ success: true, id });
    }
    const result = requireData(await growdeskFetch<GrowDeskMedicalReport>(path, { accessToken: session.accessToken, method: request.method === "GET" ? "GET" : "PATCH", ...(request.method === "GET" ? {} : { body: toGrowDeskMedicalUpdatePayload(body) }) }));
    return Response.json(fromGrowDeskMedicalRecord(result));
  } catch (error) { return bridgeErrorResponse(error); }
}
