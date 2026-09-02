"use client";

import { useEffect, useRef } from "react";
import { useBabyStore } from "@/stores/useBabyStore";

export interface FamilyActivityNotification {
  id: string;
  title: string;
  detail: string;
  time: string;
  icon?: string;
  actorId?: string | null;
  actorLabel?: string | null;
}

export interface SmartPollingOptions {
  /** 轮询间隔时间（毫秒），默认 30 秒 (30_000ms) */
  intervalMs?: number;
  /** 最小前台切回触发间隔（毫秒），防止短时间内反复切屏导致无意义的频繁请求，默认 15 秒 */
  minFocusIntervalMs?: number;
  /** 是否启用轮询，默认在有 baby?.id 且用户登录时生效 */
  enabled?: boolean;
  /** 当检测到其他家庭成员有新提交或修改时触发的回调 */
  onFamilyActivity?: (notification: FamilyActivityNotification) => void;
}

export function useSmartPolling(options: SmartPollingOptions = {}) {
  const {
    intervalMs = 30_000,
    minFocusIntervalMs = 15_000,
    enabled = true,
    onFamilyActivity,
  } = options;

  const user = useBabyStore((s) => s.user);
  const baby = useBabyStore((s) => s.baby);
  const pollActiveData = useBabyStore((s) => s.pollActiveData);

  const lastPollTimeRef = useRef<number>(0);
  const isPollingRef = useRef<boolean>(false);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const isInitialFetchRef = useRef<boolean>(true);
  const onFamilyActivityRef = useRef(onFamilyActivity);

  useEffect(() => {
    onFamilyActivityRef.current = onFamilyActivity;
  }, [onFamilyActivity]);

  useEffect(() => {
    // 仅在已登录且有宝宝档案时启动
    if (!enabled || !user || !baby?.id) {
      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    const executePoll = async () => {
      // 正在执行中 / 离线 / 页面不可见时跳过
      if (
        isPollingRef.current ||
        typeof document === "undefined" ||
        document.visibilityState !== "visible" ||
        (typeof navigator !== "undefined" && !navigator.onLine)
      ) {
        return;
      }

      try {
        isPollingRef.current = true;
        lastPollTimeRef.current = Date.now();
        await pollActiveData();

        // 检查最新家庭成员动态通知
        const currentBabyId = baby?.id;
        const currentUserId = user?.id;
        if (currentBabyId) {
          const res = await fetch(`/api/notifications?babyId=${currentBabyId}`);
          if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list)) {
              const familyList = list.filter((n: any) => n.type === "family");
              if (isInitialFetchRef.current) {
                // 初次加载记录已有 ID，不弹横幅
                for (const item of familyList) seenNotifIdsRef.current.add(item.id);
                isInitialFetchRef.current = false;
              } else {
                // 寻找其他家庭成员产生的新动态
                const newItems = familyList.filter(
                  (item: any) =>
                    !seenNotifIdsRef.current.has(item.id) &&
                    item.actorId &&
                    item.actorId !== currentUserId
                );
                for (const item of familyList) seenNotifIdsRef.current.add(item.id);

                if (newItems.length > 0 && onFamilyActivityRef.current) {
                  // 弹出最新的动态提示
                  onFamilyActivityRef.current(newItems[0]);
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn("[SmartPolling] poll error:", err);
      } finally {
        isPollingRef.current = false;
      }
    };

    const startInterval = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        executePoll();
      }, intervalMs);
    };

    const stopInterval = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    // 页面可见性监听
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (now - lastPollTimeRef.current >= minFocusIntervalMs) {
          executePoll();
        }
        startInterval();
      } else {
        stopInterval();
      }
    };

    // 网络恢复监听
    const handleOnline = () => {
      executePoll();
      startInterval();
    };

    // 初始启动
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      executePoll();
      startInterval();
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
    }

    return () => {
      stopInterval();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
      }
    };
  }, [enabled, user?.id, baby?.id, pollActiveData, intervalMs, minFocusIntervalMs]);
}
