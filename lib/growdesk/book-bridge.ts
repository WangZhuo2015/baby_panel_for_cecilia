import { growdeskFetch } from "./client";
import { resolveBffSession } from "./session";
import { verifyBffCsrf } from "./csrf";
import { creationFamilyId } from "./bridge-identity";
import { BridgeError, requireData, bridgeErrorResponse, pathId } from "./bridge-protocol";
import { fromGrowDeskBook, compareLegacyBookTitles } from "./book-compat";
import { canonicalBookId } from "./knowledge-legacy-id";
export async function bookBridge(request: Request, id?: string) {
  try {
    const csrf = verifyBffCsrf(request); if (csrf) return csrf;
    const session = await resolveBffSession(request);
    if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
    const query = new URL(request.url).searchParams;
    const body = request.method === "GET" ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;
    const familyId = await creationFamilyId(growdeskFetch, session.accessToken, body.familyId ?? query.get("familyId") ?? undefined);
    if (id) {
      const canonicalId = canonicalBookId(id) ?? id;
      const result = requireData(await growdeskFetch<{ book: { details: Record<string, unknown> } }>(`/api/v1/books/${pathId(canonicalId)}`, { method: "PATCH", accessToken: session.accessToken, body: {
        familyId, ...(body.isFavorite !== undefined ? { isFavorite: body.isFavorite } : {}), ...(body.readCount !== undefined ? { readCount: body.readCount } : {}), ...(body.status !== undefined ? { status: body.status } : {}), ...(body.baseVersion !== undefined ? { baseVersion: String(body.baseVersion) } : {}),
      } }));
      const details = result.book?.details || result.book || {};
      return Response.json(fromGrowDeskBook(details));
    }
    const rawResult = requireData(await growdeskFetch<any>(`/api/v1/books?${new URLSearchParams({ familyId })}`, { accessToken: session.accessToken }));
    const list: Array<{ details?: Record<string, unknown> } & Record<string, unknown>> = Array.isArray(rawResult) ? rawResult : (rawResult?.data || []);
    const books = list.map(fromGrowDeskBook).sort(compareLegacyBookTitles);
    return Response.json(books.filter(book => query.get("tab") === "favorites" ? book.isFavorite : query.get("tab") === "read" ? Number(book.readCount) > 0 : true));
  } catch (error) { return bridgeErrorResponse(error); }
}
