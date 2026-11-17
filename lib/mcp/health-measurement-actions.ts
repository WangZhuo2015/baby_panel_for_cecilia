const MUTATING_ACTION_FIELDS = ["growth", "vaccine", "medicalReport", "deleteAction", "undoAction"] as const;

/** Count the health-measurement write actions that the handler would execute. */
export function countHealthMeasurementMutations(args: unknown): number {
  if (!args || typeof args !== "object" || Array.isArray(args)) return 0;
  const record = args as Record<string, unknown>;
  return MUTATING_ACTION_FIELDS.reduce((count, field) => count + (record[field] ? 1 : 0), 0);
}
