import foodData from '@/data/04_foods.json';
import { legacyFoodItemId } from './knowledge-legacy-id';

type Row = Record<string, any>;
const references = new Map<string, Row>(foodData.foodItems.map((food) => [food.id, food]));
const sourceOrder = new Map(foodData.foodItems.map((food, index) => [food.id, index]));

/** Reference knowledge is versioned with the Web; family status comes only from the authorized API. */
export function fromGrowDeskFoodLibraryItem(item: Row): Row {
  const foodId = item.foodId ?? item.id;
  const reference = references.get(foodId);
  const knowledge: Row = reference ? {
    icon: reference.icon ?? '🍽️',
    foodGroup: reference.foodGroup ?? null,
    recommendedFromMonth: reference.introduction?.recommendedFromMonth ?? null,
    recommendedToMonth: reference.introduction?.recommendedToMonth ?? null,
    exactMonthEvidence: reference.introduction?.exactMonthEvidence ?? false,
    guidance: reference.introduction?.guidance ?? null,
    isCommonAllergen: reference.allergen?.isCommonAllergen ?? null,
    allergenIntroductionGuidance: reference.allergen?.introductionGuidance ?? null,
    highRiskInfantNeedsMedicalAdvice: reference.allergen?.highRiskInfantNeedsMedicalAdvice ?? null,
    chokingRisk: reference.chokingRisk ?? false,
    chokingNotes: reference.chokingNotes ?? null,
    avoidBeforeMonths: reference.avoidBeforeMonths ?? null,
    notes: reference.notes ?? null,
  } : { recommendedFromMonth: item.recommendedFromMonth ?? item.recommendedAgeMonths ?? 6 };
  const result: Row = {
    ...knowledge, ...item, foodId,
    id: legacyFoodItemId({ ...item, foodId }) ?? item.id,
    status: item.familyStatus ? (item.familyStatus.tried ? 'tried' : 'to_try') : (item.status ?? 'to_try'),
    firstAddedDate: item.firstAddedDate ?? null,
    acceptance: item.acceptance ?? 0,
  };
  // These canonical write fields were never part of the old PWA read shape.
  delete result.allergenRisk;
  delete result.recommendedAgeMonths;
  for (const field of ['preparation', 'nutrition', 'textureByAge', 'sourceRefs']) {
    const values = Array.isArray(item[field]) ? item[field] : reference?.[field] ?? [];
    result[field] = values;
    result[`${field}Json`] = JSON.stringify(values);
  }
  return result;
}

export function compareLegacyFoodItems(a: Row, b: Row): number {
  const age = (item: Row) => item.recommendedFromMonth == null ? -1 : Number(item.recommendedFromMonth);
  return age(a) - age(b)
    || (sourceOrder.get(a.foodId) ?? Number.MAX_SAFE_INTEGER) - (sourceOrder.get(b.foodId) ?? Number.MAX_SAFE_INTEGER);
}
