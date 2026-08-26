export type VaccineSelectionState = {
  selected?: boolean;
  completed?: boolean;
};

export type VaccineScheduleGroupEntry = {
  vaccineId: string;
  selectionGroup?: string | null;
};

export type VaccineGroupSource = {
  optionsJson?: unknown;
  type?: string | null;
  vaccineIdsJson?: unknown;
  vaccineIds?: unknown;
};

export type VaccineComponentMetadata = {
  vaccineId: string;
  name?: string | null;
  substitutionRules?: unknown;
};

type Group = {
  ids: string[];
  order: number;
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stringList(value: unknown): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function addUnique(group: Group, ids: string[]): void {
  for (const id of ids) {
    if (id && !group.ids.includes(id)) group.ids.push(id);
  }
}

/**
 * Build mutually-exclusive vaccine product families from the schedule data.
 *
 * `selectionGroup` is the primary source. Strategy templates and engine rules
 * are also accepted because some products are represented in a strategy
 * template rather than on every schedule row. Groups sharing a product are
 * merged into one connected component, so adding a new strategy group does
 * not require adding another hard-coded product list in the UI.
 */
export function buildExclusiveVaccineGroups(
  entries: VaccineScheduleGroupEntry[],
  strategyGroups: VaccineGroupSource[] = [],
  engineRules: VaccineGroupSource[] = [],
  metadata: VaccineComponentMetadata[] = [],
): string[][] {
  const entryIds = new Set(entries.map((entry) => entry.vaccineId).filter(Boolean));
  const groups = new Map<string, Group>();
  let order = 0;

  const addGroup = (key: string, ids: string[]) => {
    const filtered = ids.filter((id) => entryIds.has(id));
    if (filtered.length === 0) return;
    const group = groups.get(key) ?? { ids: [], order: order++ };
    addUnique(group, filtered);
    groups.set(key, group);
  };

  // Explicit schedule groups are authoritative and preserve their first-seen order.
  for (const entry of entries) {
    const groupName = typeof entry.selectionGroup === "string" ? entry.selectionGroup.trim() : "";
    if (groupName) addGroup(`selection:${groupName}`, [entry.vaccineId]);
  }

  // Strategy templates store options as [{ group, options: [...] }].
  for (const [sourceIndex, source] of strategyGroups.entries()) {
    const options = stringList(source.optionsJson);
    const parsedOptions = parseJson(source.optionsJson);
    if (!Array.isArray(parsedOptions)) continue;
    for (const [optionIndex, option] of parsedOptions.entries()) {
      if (!option || typeof option !== "object") continue;
      const record = option as { group?: unknown; options?: unknown };
      const ids = stringList(record.options);
      if (ids.length > 0) {
        const groupName = typeof record.group === "string" && record.group.trim()
          ? record.group.trim()
          : `strategy-${sourceIndex}-${optionIndex}`;
        addGroup(`strategy:${groupName}`, ids);
      }
    }
    // Keep this branch for callers that provide a simple string array source.
    if (options.length > 1) addGroup(`strategy:${sourceIndex}`, options);
  }

  // Exclusive/product-specific engine rules can define a family independently
  // of the UI schedule rows.
  for (const [ruleIndex, rule] of engineRules.entries()) {
    const ruleType = typeof rule.type === "string" ? rule.type : "";
    if (!/mutually_exclusive|product_specific/i.test(ruleType)) continue;
    const ids = stringList(rule.vaccineIdsJson ?? rule.vaccineIds);
    if (ids.length > 1) addGroup(`rule:${ruleIndex}`, ids);
  }

  // Some component strategies have two explicit selectionGroup names (for
  // example standalone Hib vs. a DTaP/Hib or five-in-one product). The data
  // has no structured component field yet, so derive a family from the
  // product metadata instead of hard-coding those group names. This remains
  // extensible for metadata that uses either "Hib" or its Chinese name.
  const componentMarkers = [/\bhib\b/i, /嗜血杆菌/];
  for (const marker of componentMarkers) {
    const ids = metadata
      .filter((item) => {
        const rules = parseJson(item.substitutionRules);
        const ruleText = Array.isArray(rules) ? rules.join(" ") : String(rules ?? "");
        return marker.test(`${item.name ?? ""} ${ruleText}`);
      })
      .map((item) => item.vaccineId)
      .filter((id) => entryIds.has(id));
    if (ids.length > 1) addGroup(`component:${marker.source}`, ids);
  }

  const allIds = [...entryIds];
  const parent = new Map(allIds.map((id) => [id, id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (const group of groups.values()) {
    for (let index = 1; index < group.ids.length; index += 1) {
      union(group.ids[0], group.ids[index]);
    }
  }

  const merged = new Map<string, { ids: string[]; order: number }>();
  for (const group of [...groups.values()].sort((a, b) => a.order - b.order)) {
    const root = find(group.ids[0]);
    const target = merged.get(root) ?? { ids: [], order: group.order };
    target.order = Math.min(target.order, group.order);
    addUnique(target, group.ids);
    merged.set(root, target);
  }

  return [...merged.values()]
    .filter((group) => group.ids.length > 1)
    .sort((a, b) => a.order - b.order)
    .map((group) => group.ids);
}

/** Pick a product after honoring completed/selected choices, then data order. */
export function chooseActiveVaccineId(
  group: string[],
  selections: Record<string, VaccineSelectionState>,
): string | undefined {
  const hasState = (vaccineId: string, field: "completed" | "selected") =>
    Object.entries(selections).some(
      ([key, state]) => key.startsWith(`${vaccineId}-`) && state?.[field] === true,
    );

  return group.find((id) => hasState(id, "completed"))
    ?? group.find((id) => hasState(id, "selected"))
    ?? group[0];
}

export function activeVaccineIds(
  groups: string[][],
  selections: Record<string, VaccineSelectionState>,
): Set<string> {
  const active = new Set<string>();
  for (const group of groups) {
    const chosen = chooseActiveVaccineId(group, selections);
    if (chosen) active.add(chosen);
  }
  return active;
}
