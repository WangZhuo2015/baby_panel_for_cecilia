import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrowthSlice } from '../../stores/slices/growth';
import { GET } from '../../app/api/food/plans/route';
import { GROWDESK_CONFIG } from '../../lib/config';

test('F5 food-page store reload retrieves the saved recipe for the selected baby', async t => {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = 'true';
  t.after(() => { if (previous === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = previous; });
  const upstreamReads: string[] = [];
  const state: any = { baby: { id: 'test_baby' } };
  const slice = createGrowthSlice((patch: any) => Object.assign(state, patch), () => state);
  Object.assign(state, slice);
  t.mock.method(globalThis, 'fetch', async (url: any) => {
    const path = String(url);
    if (path.startsWith('/api/food/plans')) {
      const response = await GET(new Request(`https://test.invalid${path}`, { headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${'a'.repeat(64)}` } }));
      console.log('actual store URL:', path, 'route status:', response.status);
      return response;
    }
    if (path.endsWith('/api/v1/auth/bff/session')) return Response.json({ data: { accessToken: 'test_token', user: { id: 'test_user' } } });
    const match = path.match(/\/api\/v1\/babies\/(test_baby(?:_second)?)\/food-plan$/);
    if (match) {
      upstreamReads.push(match[1]);
      return Response.json({ data: { id: `test_plan_${match[1]}`, version: "1", createdAt: "2026-09-17T00:00:00Z", babyId: match[1], planData: { date: '2026-09-17', name: `test_recipe_${match[1]}` }, updatedAt: '2026-09-17T00:00:00Z' } });
    }
    throw new Error('unexpected request: ' + path);
  });
  await slice.fetchFoodPlans('2026-09-17', true);
  assert.equal(state.foodPlans.length, 1, 'saved recipe must appear after the real food-page store reload');
  assert.equal(state.foodPlans[0].babyId, 'test_baby');
  state.baby = { id: 'test_baby_second' };
  await slice.fetchFoodPlans('2026-09-17');
  assert.equal(state.foodPlans[0].babyId, 'test_baby_second', 'cache must be scoped to the selected baby');
  assert.deepEqual(upstreamReads, ['test_baby', 'test_baby_second']);
});
