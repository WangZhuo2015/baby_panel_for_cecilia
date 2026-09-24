"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBabyStore } from "@/stores/useBabyStore";
import { currentNotificationIdentity } from "@/lib/notification-client";
import {
  acknowledgeNotifications, isNotificationRead, notificationHeaders,
  parseNotificationItems, sameNotificationIdentity,
  type NotificationIdentity, type NotificationViewItem,
} from "@/lib/notification-actions";
import {
  addDismissedNotificationId, filterVisibleNotifications,
  getReadNotificationIds, markAllNotificationsRead,
} from "@/lib/notifications-storage";

function identityKey(value: NotificationIdentity | null): string {
  return value ? JSON.stringify([value.userId, value.familyId, value.babyId]) : "";
}
const ignoreError = (_message: string) => {};

/** Shared by the page and badges: only the page acknowledges visible entries. */
export function useNotificationInbox(autoRead = false, onError: (message: string) => void = ignoreError) {
  const userId = useBabyStore(s => s.user?.id);
  const babyId = useBabyStore(s => s.baby?.id);
  const familyId = useBabyStore(s => s.family?.id);
  const selectedBabyId = useBabyStore(s => s.selectedBabyId);
  const babyFamilyId = useBabyStore(s => s.baby?.familyId);
  const authLoading = useBabyStore(s => s.authLoading);
  const fetchUser = useBabyStore(s => s.fetchUser);
  const key = userId && babyId && familyId && selectedBabyId === babyId && babyFamilyId === familyId
    ? JSON.stringify([userId, familyId, babyId]) : "";
  const [identityRevision, setIdentityRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; items: NotificationViewItem[]; loading: boolean }>({ key: "", items: [], loading: false });
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const control = useRef({ epoch: 0, generation: 0, controllers: new Set<AbortController>(), readController: null as AbortController | null });
  const errorHandler = useRef(onError);
  useEffect(() => { errorHandler.current = onError; }, [onError]);

  const invalidate = useCallback(() => {
    control.current.epoch += 1;
    control.current.generation += 1;
    for (const controller of control.current.controllers) controller.abort();
    control.current.controllers.clear();
    control.current.readController = null;
    setFailure(null);
  }, []);

  useEffect(() => {
    let observed = identityKey(currentNotificationIdentity());
    const unsubscribe = useBabyStore.subscribe(() => {
      const next = identityKey(currentNotificationIdentity());
      if (next !== observed) {
        observed = next;
        // Runs synchronously on every transition, including A -> B -> A before
        // React renders. Comparing the final identity alone misses that race.
        invalidate();
        setSnapshot({ key: next, items: [], loading: Boolean(next) });
        // Even when the final key is unchanged, launch a new load after aborting
        // the old one; otherwise a batched round trip can leave an empty spinner.
        setIdentityRevision(value => value + 1);
      }
    });
    return () => { unsubscribe(); invalidate(); };
  }, [invalidate]);

  // /notifications is outside the main layout. A hard reload creates an empty
  // store; bootstrap from the real session, never from a cached private record.
  // fetchUser already deduplicates concurrent layout/badge requests.
  useEffect(() => { void fetchUser(); }, [fetchUser]);

  const acknowledge = useCallback(async (
    items: readonly NotificationViewItem[],
    captured: NotificationIdentity,
    active: () => boolean,
    signal?: AbortSignal,
  ) => {
    const result = await acknowledgeNotifications(items, captured,
      () => active() ? currentNotificationIdentity() : null, fetch, signal);
    if (result.stale || !active()) return null;
    const ids = new Set(result.acknowledged);
    // Persist only derived reminders locally. Persisted notifications use the
    // server's readAt, even if an older client has a conflicting local read ID.
    markAllNotificationsRead(items.filter(item => ids.has(item.id) && item.serverNotificationId === undefined).map(item => item.id));
    if (ids.size) {
      const now = new Date().toISOString();
      setSnapshot(previous => previous.key !== identityKey(captured) ? previous : {
        ...previous,
        items: previous.items.map(item => ids.has(item.id) && item.serverNotificationId !== undefined
          ? { ...item, readAt: item.readAt ?? now } : item),
      });
      window.dispatchEvent(new CustomEvent("notifications-read"));
    }
    if (result.failed.length) errorHandler.current("部分通知已读状态未保存，请重试；未将失败结果标记为成功");
    return result;
  }, []);

  const reload = useCallback(async () => {
    const captured = currentNotificationIdentity();
    if (!captured || identityKey(captured) !== key) {
      await fetchUser();
      return;
    }
    const epoch = control.current.epoch;
    const generation = ++control.current.generation;
    control.current.readController?.abort();
    const controller = new AbortController();
    control.current.readController = controller;
    setFailure(null);
    control.current.controllers.add(controller);
    const active = () => !controller.signal.aborted && epoch === control.current.epoch &&
      generation === control.current.generation && sameNotificationIdentity(captured, currentNotificationIdentity());
    setSnapshot(previous => ({ key, items: previous.key === key ? previous.items : [], loading: true }));
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const query = new URLSearchParams({ babyId: captured.babyId, familyId: captured.familyId });
      const response = await fetch(`/api/notifications?${query}`, {
        headers: notificationHeaders(captured), cache: "no-store", signal: controller.signal,
      });
      const data: unknown = await response.json();
      if (!active()) return;
      if (!response.ok) throw new Error("通知加载失败，请重试");
      const items = filterVisibleNotifications(parseNotificationItems(data));
      setSnapshot({ key, items, loading: false });
      clearTimeout(timer);
      if (autoRead) await acknowledge(items, captured, active, controller.signal);
    } catch (error) {
      if (epoch === control.current.epoch && generation === control.current.generation &&
          sameNotificationIdentity(captured, currentNotificationIdentity())) {
        const message = error instanceof Error && error.name !== "AbortError" ? error.message : "通知请求超时，请重试";
        setFailure({ key, message });
        errorHandler.current(message);
      }
    } finally {
      clearTimeout(timer);
      control.current.controllers.delete(controller);
      if (epoch === control.current.epoch && generation === control.current.generation) {
        setSnapshot(previous => previous.key === key ? { ...previous, loading: false } : previous);
      }
    }
  }, [key, identityRevision, autoRead, acknowledge, fetchUser]);

  useEffect(() => {
    void reload();
    const refresh = () => { void reload(); };
    const focus = () => { if (document.visibilityState === "visible") refresh(); };
    if (!autoRead) window.addEventListener("notifications-read", refresh);
    window.addEventListener("baby:data-polled", refresh);
    document.addEventListener("visibilitychange", focus);
    return () => {
      if (!autoRead) window.removeEventListener("notifications-read", refresh);
      window.removeEventListener("baby:data-polled", refresh);
      document.removeEventListener("visibilitychange", focus);
      invalidate();
    };
  }, [reload, autoRead, invalidate]);

  const items = snapshot.key === key ? snapshot.items : [];
  const act = useCallback(async (ids: readonly string[], dismiss: boolean): Promise<boolean> => {
    const captured = currentNotificationIdentity();
    if (!captured || identityKey(captured) !== key || snapshot.key !== key) return false;
    const epoch = control.current.epoch;
    const controller = new AbortController();
    control.current.controllers.add(controller);
    const active = () => !controller.signal.aborted && epoch === control.current.epoch &&
      sameNotificationIdentity(captured, currentNotificationIdentity());
    const wanted = new Set(ids);
    const selected = snapshot.items.filter(item => wanted.has(item.id));
    try {
      const result = await acknowledge(selected, captured, active, controller.signal);
      if (!result || !active()) return false;
      if (dismiss) {
        const confirmed = new Set(result.acknowledged);
        for (const id of confirmed) addDismissedNotificationId(id);
        setSnapshot(previous => previous.key === key
          ? { ...previous, items: previous.items.filter(item => !confirmed.has(item.id)) } : previous);
        window.dispatchEvent(new CustomEvent("notifications-read"));
      }
      return result.failed.length === 0 && selected.length === wanted.size;
    } catch (error) {
      if (active()) errorHandler.current(error instanceof Error ? error.message : "通知操作失败，请重试");
      return false;
    } finally { control.current.controllers.delete(controller); }
  }, [key, snapshot, acknowledge]);

  const localRead = getReadNotificationIds();
  const readIds = new Set(items.filter(item => isNotificationRead(item, localRead)).map(item => item.id));
  return {
    notifications: items,
    error: failure?.key === key ? failure.message : !authLoading && !key
      ? userId ? "请先选择有效的家庭和宝宝后加载通知" : "请先登录后加载通知"
      : null,
    loading: authLoading || (Boolean(key) && (snapshot.key !== key || snapshot.loading)),
    readIds,
    unreadCount: items.length - readIds.size,
    reload,
    markRead: (id: string) => act([id], false),
    dismiss: (id: string) => act([id], true),
    clearAll: () => act(items.map(item => item.id), true),
  };
}
