export type ActionCardType =
  | "medical_report"
  | "feeding"
  | "sleep"
  | "diaper"
  | "growth"
  | "food";

export interface ActionCardData {
  type: ActionCardType;
  data: any;
}

const ALLOWED = new Set<ActionCardType>([
  "medical_report",
  "feeding",
  "sleep",
  "diaper",
  "growth",
  "food",
]);

const TYPE_ALIAS: Record<string, ActionCardType> = {
  medical_report: "medical_report",
  medical: "medical_report",
  feeding: "feeding",
  feed: "feeding",
  milk: "feeding",
  sleep: "sleep",
  nap: "sleep",
  diaper: "diaper",
  poop: "diaper",
  pee: "diaper",
  growth: "growth",
  food: "food",
  solid: "food",
};

function asAction(raw: unknown): ActionCardData | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { type?: unknown; data?: unknown };
  const alias = TYPE_ALIAS[String(obj.type || "").trim().toLowerCase()];
  if (!alias || !ALLOWED.has(alias)) return null;
  const data = obj.data && typeof obj.data === "object" ? obj.data : {};
  return { type: alias, data };
}

export function extractActionCards(content: string): ActionCardData[] {
  const actions: ActionCardData[] = [];
  const closedRegex = /```(?:json:action|action)\s*([\s\S]*?)\s*```/g;
  for (const match of content.matchAll(closedRegex)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const one = asAction(parsed);
      if (one) actions.push(one);
    } catch {
      /* skip */
    }
  }
  if (actions.length > 0) return actions.slice(0, 6);

  const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.actions)
        ? parsed.actions
        : [parsed];
    for (const item of list) {
      const one = asAction(item);
      if (one) actions.push(one);
      if (actions.length >= 6) break;
    }
  } catch {
    /* skip */
  }
  return actions;
}
