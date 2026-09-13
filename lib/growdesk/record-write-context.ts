/** Browser-only request enrichment; versions must come from records already read, never a fresh pre-delete read. */
export function recordWriteContext(state: Record<string, unknown>, type: string, id?: string) {
  const baby = state.baby as { id?: string } | null | undefined;
  const lists: Record<string, string> = { feeding: "feedingRecords", sleep: "sleepRecords", diaper: "diaperRecords", food: "foodLogRecords", growth: "growthMeasurements" };
  const records = state[lists[type] || ""] as Array<Record<string, unknown>> | undefined;
  const timeline = state.timeline as Array<Record<string, unknown>> | undefined;
  const record = records?.find(r => r.id === id);
  const entry = timeline?.find(r => r.id === id && r.type === type);
  const version = record?.version ?? record?.baseVersion ?? entry?.version ?? entry?.baseVersion;
  return { ...(baby?.id ? { babyId: baby.id } : {}), ...(version !== undefined && version !== null ? { baseVersion: version } : {}) };
}
