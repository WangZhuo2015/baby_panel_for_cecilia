import { type BridgeFetch } from "./bridge-protocol";
import { fetchLegacyRecordList } from "./record-list";

export interface DatedFeeding { occurredAt: string }

/**
 * Preserve the legacy date-filtered array API while consuming canonical keyset pages.
 * A safety cap fails explicitly rather than returning a silently truncated history.
 * The API still owns authorization; the BFF only translates list/query semantics.
 */
export async function fetchLegacyFeedingList<T extends DatedFeeding>(
  fetchApi: BridgeFetch, token: string, babyId: string, query: URLSearchParams,
): Promise<T[]> {
  return fetchLegacyRecordList<T>(fetchApi, token, babyId, query, "feeding");
}
