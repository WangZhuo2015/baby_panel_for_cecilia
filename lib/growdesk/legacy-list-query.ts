/** Keep the public legacy array limit; internal statistics use complete pagination separately. */
export function legacyListQuery(input: URLSearchParams): URLSearchParams {
  const query = new URLSearchParams(input);
  const value = parseInt(String(input.get("limit") ?? 50), 10);
  query.set("limit", String(Number.isNaN(value) ? 50 : Math.min(100, Math.max(1, value))));
  return query;
}
