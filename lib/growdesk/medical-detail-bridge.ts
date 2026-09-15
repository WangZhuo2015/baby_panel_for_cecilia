import { growdeskFetch } from "./client";
import { resolveBffSession } from "./session";
import { verifyBffCsrf } from "./csrf";
import { loadWebBaby } from "./bridge-identity";
import { BridgeError, requireData, bridgeErrorResponse, pathId, wireVersion } from "./bridge-protocol";
import { fromGrowDeskMedicalRecord, toGrowDeskMedicalUpdatePayload, type GrowDeskMedicalReport } from "./medical-compat";

export async function medicalDetailBridge(request: Request, id: string) {
  try {
    const csrf = verifyBffCsrf(request); if (csrf) return csrf;
    const session = await resolveBffSession(request);
    if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
    const query = new URL(request.url).searchParams;
    const body = request.method === "GET" ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;

    let rawBabyId: string | null | undefined = (body.babyId as string | undefined) ?? query.get("babyId");
    if (!rawBabyId) {
      const baby = await loadWebBaby(growdeskFetch, session.accessToken);
      rawBabyId = baby?.id;
    }
    if (!rawBabyId) throw new BridgeError(400, "BABY_REQUIRED", "请先选择宝宝");
    const babyId = pathId(rawBabyId);
    const path = `/api/v1/babies/${babyId}/medical-reports/${pathId(id)}`;

    if (request.method === "DELETE") {
      let rawBaseVersion = body.baseVersion ?? query.get("baseVersion");
      if (!rawBaseVersion) {
        try {
          const current = await growdeskFetch<GrowDeskMedicalReport>(path, { accessToken: session.accessToken });
          if (current.ok && current.data) {
            rawBaseVersion = current.data.version;
          }
        } catch {
          // ignore
        }
      }
      requireData(await growdeskFetch(path, {
        method: "DELETE",
        accessToken: session.accessToken,
        body: { baseVersion: wireVersion(rawBaseVersion || "1") },
      }));
      return Response.json({ success: true, id });
    }

    const result = requireData(await growdeskFetch<GrowDeskMedicalReport>(path, {
      accessToken: session.accessToken,
      method: request.method === "GET" ? "GET" : "PATCH",
      ...(request.method === "GET" ? {} : { body: toGrowDeskMedicalUpdatePayload(body) }),
    }));
    return Response.json(fromGrowDeskMedicalRecord(result));
  } catch (error) { return bridgeErrorResponse(error); }
}
