import assert from 'node:assert/strict';
import test from 'node:test';
import foodData from '../../data/04_foods.json';
import { fromGrowDeskFoodLibraryItem, compareLegacyFoodItems } from '../../lib/growdesk/food-library-compat';

test('every reference food retains its preparation, nutrition and safety knowledge', () => {
  for (const source of foodData.foodItems as Array<Record<string, any>>) {
    const result = fromGrowDeskFoodLibraryItem({ id: source.id, name: source.name, familyStatus: { tried: true } });
    for (const field of ['preparation', 'nutrition', 'textureByAge', 'sourceRefs']) {
      assert.deepEqual(result[field], source[field] ?? [], `${source.id}.${field}`);
      assert.deepEqual(JSON.parse(result[`${field}Json`]), source[field] ?? []);
    }
    assert.equal(result.chokingRisk, source.chokingRisk ?? false);
    assert.equal(result.isCommonAllergen, source.allergen?.isCommonAllergen ?? null);
    assert.equal(result.recommendedFromMonth, source.introduction?.recommendedFromMonth ?? null);
    assert.equal(result.status, 'tried');
  }
});

test('custom food is not assigned another food knowledge and preserves explicit metadata', () => {
  const result = fromGrowDeskFoodLibraryItem({ id: 'test_custom_food', name: 'test_food', recommendedAgeMonths: 9, preparation: ['test_method'] });
  assert.deepEqual(result.preparation, ['test_method']);
  assert.deepEqual(result.nutrition, []);
  assert.equal(result.recommendedFromMonth, 9);
  assert.equal(result.status, 'to_try');
});

test('reference list follows legacy age then seed order regardless of upstream name sorting', () => {
  const expected = foodData.foodItems.map(food => fromGrowDeskFoodLibraryItem({ id: food.id }))
    .sort((a, b) => (a.recommendedFromMonth ?? -1) - (b.recommendedFromMonth ?? -1));
  const actual = [...expected].reverse().sort(compareLegacyFoodItems);
  assert.deepEqual(actual.map(item => item.foodId), expected.map(item => item.foodId));
});
