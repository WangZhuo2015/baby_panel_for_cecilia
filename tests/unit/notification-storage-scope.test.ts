import assert from 'node:assert/strict';
import test from 'node:test';
import { useBabyStore } from '../../stores/useBabyStore';
import { addDismissedNotificationId, getDismissedNotificationIds, getReadNotificationIds, markNotificationRead, getClearedBeforeTime, setClearedBeforeTime } from '../../lib/notifications-storage';

test('local read, dismiss and clear state stays with the authenticated user and baby', () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldState = useBabyStore.getState();
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  } });
  const select = (userId: string, babyId: string) => useBabyStore.setState({ user: { id: userId }, baby: { id: babyId } } as any);
  try {
    select('test_user_a', 'test_baby_a');
    markNotificationRead('daily-feeding');
    addDismissedNotificationId('vaccine-HepB-1');
    setClearedBeforeTime();
    assert.ok(getReadNotificationIds().has('daily-feeding'));
    assert.ok(getDismissedNotificationIds().has('vaccine-HepB-1'));
    assert.ok(getClearedBeforeTime() > 0);
    for (const [userId, babyId] of [['test_user_a', 'test_baby_b'], ['test_user_b', 'test_baby_a']]) {
      select(userId, babyId);
      assert.equal(getReadNotificationIds().size, 0);
      assert.equal(getDismissedNotificationIds().size, 0);
      assert.equal(getClearedBeforeTime(), 0);
    }
    select('test_user_a', 'test_baby_a');
    assert.ok(getReadNotificationIds().has('daily-feeding'));
    useBabyStore.setState({ user: null, baby: null });
    markNotificationRead('anonymous');
    assert.equal(getReadNotificationIds().size, 0);
    assert.ok(![...data.keys()].some(key => key === 'baby_read_notifications'));
  } finally {
    useBabyStore.setState(oldState, true);
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
