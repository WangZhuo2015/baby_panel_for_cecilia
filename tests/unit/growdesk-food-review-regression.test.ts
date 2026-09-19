import test from 'node:test';
import assert from 'node:assert/strict';
import { toGrowDeskFoodCreatePayload } from '../../lib/growdesk/food-compat';
import { fetchTimelineDetailMaps } from '../../lib/growdesk/timeline-details';
import { fromGrowDeskTimelineResponse } from '../../lib/growdesk/timeline-compat';

test('F2 saved food observations survive the real timeline detail/conversion pipeline', async () => {
  const saved = { id: 'test_food', babyId: 'test_baby', familyId: 'test_family', version: '1', createdAt: '2026-09-17T12:00:00Z', updatedAt: '2026-09-17T12:00:00Z', ...toGrowDeskFoodCreatePayload({ date: '2026-09-17', time: '20:00', foods: ['test_rice'], acceptance: 1, babyState: 'rejected', hasAbnormal: true, abnormalNotes: 'test_rash', notes: 'test_note' }) };
  const entries = [{ id: 'test_timeline', entityId: saved.id, babyId: saved.babyId, entityType: 'food' as const, occurredAt: saved.occurredAt!, summary: 'test_food', version: '1' }];
  const details = await fetchTimelineDetailMaps(async () => ({ ok: true, status: 200, data: [saved] as any, page: { nextCursor: null } }), 'test_token', saved.babyId, entries);
  const item = fromGrowDeskTimelineResponse(entries, details)[0];
  assert.equal(item.rawRecord.acceptance, 1, 'timeline edit data must retain saved acceptance');
  assert.equal(item.rawRecord.babyState, 'rejected');
  assert.equal(item.rawRecord.hasAbnormal, true);
  assert.equal(item.rawRecord.abnormalNotes, 'test_rash');
  assert.equal(item.rawRecord.notes, 'test_note');
  assert.equal(item.detail?.includes('[growdesk-web-food:v1]'), false, 'internal metadata must not be displayed as human notes');
});
