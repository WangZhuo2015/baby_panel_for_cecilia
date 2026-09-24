if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}
import { GROWDESK_CONFIG } from "@/lib/config";
import {
  fetchGrowDeskTransport,
  type GrowDeskFetchOptions,
  type GrowDeskResponse,
} from "./http-transport";

export type {
  GrowDeskFetchOptions,
  GrowDeskErrorPayload,
  GrowDeskResponse,
} from "./http-transport";

/** One selected backend per request; never retry a mutation on another runtime. */
export async function growdeskFetch<T>(
  pathname: string,
  options: GrowDeskFetchOptions = {},
): Promise<GrowDeskResponse<T>> {
  return fetchGrowDeskTransport<T>(GROWDESK_CONFIG.apiUrl, pathname, options, GROWDESK_CONFIG.timeoutMs);
}
