import { growdeskFetch } from "./client";
import { resolveBffSession } from "./session";
import { BridgeError, requireData, bridgeErrorResponse } from "./bridge-protocol";

export type KnowledgeKind = "milestones" | "activities" | "warning-signs" | "feeding-guidelines";
type KnowledgeItem = Record<string, unknown>;

function isRecord(value: unknown): value is KnowledgeItem {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapDetails(value: KnowledgeItem): KnowledgeItem {
  return isRecord(value.details) ? value.details : value;
}

function arrayField(item: KnowledgeItem, field: string): unknown[] {
  if (Array.isArray(item[field])) return item[field];
  if (typeof item[field] === "string") {
    try {
      const parsed = JSON.parse(item[field]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function jsonArrayField(item: KnowledgeItem, field: string): string {
  return JSON.stringify(arrayField(item, field));
}

/**
 * Project canonical reference details into the legacy Web response shape.
 *
 * The canonical server owns the source values and stable IDs. This adapter
 * only adds the aliases and JSON-string columns that the old Prisma routes
 * returned; it deliberately does not invent the old database UUIDs.
 */
export function projectLegacyKnowledgeItem(kind: KnowledgeKind, source: KnowledgeItem): KnowledgeItem {
  const item = unwrapDetails(source);
  const sourceRefs = arrayField(item, "sourceRefs");

  if (kind === "milestones") {
    const ageRange = isRecord(item.ageRange) ? item.ageRange : {};
    const criterion = isRecord(item.criterion) ? item.criterion : {};
    return {
      ...item,
      milestoneId: item.milestoneId ?? item.id ?? null,
      assessmentAgeMonths: item.assessmentAgeMonths ?? item.monthAge ?? null,
      ageRangeEarliestMonth: item.ageRangeEarliestMonth ?? ageRange.earliestMonth ?? null,
      ageRangeMedianMonth: item.ageRangeMedianMonth ?? ageRange.medianMonth ?? null,
      ageRangeLatestMonth: item.ageRangeLatestMonth ?? ageRange.latestMonth ?? null,
      criterionType: item.criterionType ?? criterion.type ?? null,
      criterionThreshold: item.criterionThreshold ?? criterion.threshold ?? null,
      criterionDescription: item.criterionDescription ?? criterion.description ?? null,
      sourceRefsJson: JSON.stringify(sourceRefs),
      sourceRefs,
    };
  }

  if (kind === "activities") {
    const categories = arrayField(item, "categories");
    const developmentGoals = arrayField(item, "developmentGoals");
    const materials = arrayField(item, "materials");
    const steps = arrayField(item, "steps");
    const safety = arrayField(item, "safety");
    const stopConditions = arrayField(item, "stopConditions");
    return {
      ...item,
      activityId: item.activityId ?? item.id ?? null,
      categoriesJson: JSON.stringify(categories),
      developmentGoalsJson: JSON.stringify(developmentGoals),
      materialsJson: JSON.stringify(materials),
      stepsJson: JSON.stringify(steps),
      targetMonthMin: item.targetMonthMin ?? item.ageMinMonths ?? null,
      targetMonthMax: item.targetMonthMax ?? item.ageMaxMonths ?? null,
      goal: item.goal ?? null,
      durationMinutes: item.durationMinutes ?? null,
      frequency: item.frequency ?? null,
      difficulty: item.difficulty ?? null,
      supervision: item.supervision ?? null,
      safetyJson: JSON.stringify(safety),
      stopConditionsJson: JSON.stringify(stopConditions),
      medicalTreatment: item.medicalTreatment ?? false,
      notes: item.notes ?? null,
      sourceRefsJson: JSON.stringify(sourceRefs),
      categories,
      developmentGoals,
      materials,
      steps,
      safety,
      stopConditions,
      sourceRefs,
    };
  }

  if (kind === "warning-signs") {
    return {
      ...item,
      warningSignId: item.warningSignId ?? item.id ?? null,
      ageMonths: item.ageMonths ?? item.monthAge ?? null,
      description: item.description ?? item.signText ?? null,
      recommendedAction: item.recommendedAction ?? item.actionAdvice ?? null,
      sourceRefsJson: JSON.stringify(sourceRefs),
      sourceRefs,
    };
  }

  return {
    ...item,
    textureJson: jsonArrayField(item, "texture"),
    foodDiversityJson: jsonArrayField(item, "foodDiversity"),
    responsiveFeedingJson: jsonArrayField(item, "responsiveFeeding"),
    safetyJson: jsonArrayField(item, "safety"),
    sourceRefsJson: JSON.stringify(sourceRefs),
    texture: arrayField(item, "texture"),
    foodDiversity: arrayField(item, "foodDiversity"),
    responsiveFeeding: arrayField(item, "responsiveFeeding"),
    safety: arrayField(item, "safety"),
    sourceRefs,
  };
}

/** Legacy SQLite scans its (assessmentAgeMonths, category) index for this list. */
export function sortLegacyMilestones(items: KnowledgeItem[]): KnowledgeItem[] {
  return [...items].sort((a, b) => {
    const ageA = typeof a.assessmentAgeMonths === "number" ? a.assessmentAgeMonths : Number.POSITIVE_INFINITY;
    const ageB = typeof b.assessmentAgeMonths === "number" ? b.assessmentAgeMonths : Number.POSITIVE_INFINITY;
    const byAge = ageA - ageB;
    if (byAge && Number.isFinite(byAge)) return byAge;
    if (ageA !== ageB) return ageA < ageB ? -1 : 1;
    const categoryA = String(a.category ?? "");
    const categoryB = String(b.category ?? "");
    return categoryA < categoryB ? -1 : categoryA > categoryB ? 1 : 0;
  });
}

export async function knowledgeBridge(request: Request, kind: KnowledgeKind) {
  try {
    const session = await resolveBffSession(request);
    if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
    const input = new URL(request.url).searchParams;
    const query = new URLSearchParams();
    for (const key of ["month", "category"]) if (input.has(key)) query.set(key, input.get(key)!);
    const path = kind === "feeding-guidelines" ? "/api/v1/knowledge/feeding-guidelines" : `/api/v1/development/${kind}`;
    const result = await growdeskFetch<Record<string, unknown>[]>(`${path}?${query}`, { accessToken: session.accessToken });
    const items = requireData(result).map(item => projectLegacyKnowledgeItem(kind, item));
    const orderedItems = kind === "milestones" ? sortLegacyMilestones(items) : items;
    return Response.json(kind === "milestones" ? { milestones: orderedItems, dataRelease: result.dataRelease ?? null } : orderedItems);
  } catch (error) { return bridgeErrorResponse(error); }
}
