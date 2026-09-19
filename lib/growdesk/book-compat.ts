/** Keep the legacy reading UI's flattened fields alongside canonical metadata. */
export function fromGrowDeskBook(book: Record<string, unknown>): Record<string, unknown> {
  const details = book.details && typeof book.details === 'object'
    ? book.details as Record<string, unknown> : book;
  const rating = details.rating && typeof details.rating === 'object'
    ? details.rating as Record<string, unknown> : {};
  const result: Record<string, unknown> = { ...details };
  for (const field of ['author', 'illustrator', 'translator', 'categories', 'interactionSuggestions', 'sourceRefs']) {
    result[`${field}Json`] = typeof details[`${field}Json`] === 'string'
      ? details[`${field}Json`] : JSON.stringify(details[field] ?? []);
  }
  result.ratingScore = details.ratingScore ?? rating.score ?? null;
  result.ratingCount = details.ratingCount ?? rating.count ?? null;
  result.ratingSource = details.ratingSource ?? rating.source ?? null;
  result.ratingRetrievedDate = details.ratingRetrievedDate ?? rating.retrievedDate ?? null;
  return result;
}

export function compareLegacyBookTitles(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const left = String(a.title ?? '');
  const right = String(b.title ?? '');
  return left < right ? -1 : left > right ? 1 : 0;
}
