/**
 * Safely parses a JSON string, returning the fallback value if parsing fails or input is empty.
 */
export function safeJsonParse<T = any>(
  str: string | null | undefined,
  fallback: T = [] as unknown as T
): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
