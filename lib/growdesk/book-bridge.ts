import { growdeskFetch } from "./client";
import { resolveBffSession } from "./session";
import { verifyBffCsrf } from "./csrf";
import { creationFamilyId } from "./bridge-identity";
import { BridgeError, requireData, bridgeErrorResponse, pathId } from "./bridge-protocol";
export async function bookBridge(request: Request, id?: string) {
  try {
    const csrf = verifyBffCsrf(request); if (csrf) return csrf;
    const session = await resolveBffSession(request);
    if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
    const query = new URL(request.url).searchParams;
    const body = request.method === "GET" ? {} : await request.json() as Record<string, unknown>;
    const familyId = await creationFamilyId(growdeskFetch, session.accessToken, body.familyId ?? query.get("familyId") ?? undefined);
    if (id) {
      const result = requireData(await growdeskFetch<{ book: { details: Record<string, unknown> } }>(`/api/v1/books/${pathId(id)}`, { method: "PATCH", accessToken: session.accessToken, body: {
        familyId, ...(body.isFavorite !== undefined ? { isFavorite: body.isFavorite } : {}), ...(body.readCount !== undefined ? { readCount: body.readCount } : {}), ...(body.status !== undefined ? { status: body.status } : {}), ...(body.baseVersion !== undefined ? { baseVersion: String(body.baseVersion) } : {}),
      } }));
      return Response.json(result.book.details);
    }
    const list = requireData(await growdeskFetch<{ details: Record<string, unknown> }[]>(`/api/v1/books?${new URLSearchParams({ familyId })}`, { accessToken: session.accessToken }));
    const books = list.map(book => book.details);
    return Response.json(books.filter(book => query.get("tab") === "favorites" ? book.isFavorite : query.get("tab") === "read" ? Number(book.readCount) > 0 : true));
  } catch (error) { return bridgeErrorResponse(error); }
}
