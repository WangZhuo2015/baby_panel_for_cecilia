import { parseDoseNumber } from "./vaccine-record-fields";

interface RecordedVaccine {
  id: string;
  name: string;
  vaccineId?: string | null;
  dose?: string | null;
  doseNumber?: number | null;
  isCompleted: boolean;
  completedDate?: string | null;
}
interface CatalogVaccine { id: string; vaccineId: string; name: string; shortName?: string | null }

/** A choice in a reference programme never constitutes evidence of an injection. */
export function completedVaccineFacts(records: RecordedVaccine[], catalog: CatalogVaccine[]): Map<string, string> {
  const facts = new Map<string, string>();
  for (const record of records) {
    if (!record.isCompleted || !record.completedDate) continue;
    const dose = record.doseNumber ?? parseDoseNumber(record.dose);
    if (dose === null) continue;
    const selected = record.vaccineId
      ? catalog.find(vaccine => vaccine.vaccineId === record.vaccineId || vaccine.id === record.vaccineId)
      : catalog.find(vaccine => vaccine.name === record.name || vaccine.shortName === record.name);
    const vaccineId = selected?.vaccineId ?? record.vaccineId;
    if (vaccineId) facts.set(`${vaccineId}-${dose}`, record.id);
  }
  return facts;
}
