"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { getPushRegistration, recoverExistingPushSubscription } from "@/lib/push-client";
import { useBabyStore } from "@/stores/useBabyStore";

function pushEnvironment() {
  if (typeof window === "undefined" || !("Notification" in window) ||
    !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { permission: "unsupported", supported: false, standaloneEligible: false };
  }

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    permission: Notification.permission,
    supported: true,
    standaloneEligible: !isIos || isStandalone,
  };
}

/** Quietly restore the server-side binding for a subscription the browser already owns. */
export function PushSubscriptionRecovery() {
  const pathname = usePathname();
  const generation = useRef(0);

  useEffect(() => {
    let mounted = true;
    let runningGeneration: number | null = null;
    let lastUserId = useBabyStore.getState().user?.id ?? null;
    let lastAuthLoading = useBabyStore.getState().authLoading;

    const recover = () => {
      if (!mounted || runningGeneration !== null) return;
      const environment = pushEnvironment();
      if (environment.permission !== "granted" || !environment.supported || !environment.standaloneEligible) return;

      const initialState = useBabyStore.getState();
      const expectedUserId = initialState.user?.id;
      if (initialState.authLoading || !expectedUserId) {
        const attemptGeneration = ++generation.current;
        runningGeneration = attemptGeneration;
        void initialState.fetchUser().catch(() => null).finally(() => {
          if (runningGeneration === attemptGeneration) runningGeneration = null;
          const current = useBabyStore.getState();
          if (mounted && generation.current === attemptGeneration && !current.authLoading && current.user?.id) {
            queueMicrotask(recover);
          }
        });
        return;
      }

      const attemptGeneration = ++generation.current;
      runningGeneration = attemptGeneration;
      const isCurrent = () => {
        if (!mounted || generation.current !== attemptGeneration) return false;
        const current = useBabyStore.getState();
        return current.user?.id === expectedUserId && !current.authLoading;
      };

      void recoverExistingPushSubscription({
        permission: environment.permission,
        pushSupported: environment.supported,
        standaloneEligible: environment.standaloneEligible,
        expectedUserId,
        isCurrent,
        getRegistration: () => getPushRegistration(navigator.serviceWorker, true),
      }).catch(() => {
        // A passive recovery failure is intentionally quiet. Focus, visibility,
        // route changes, or a later page load can retry without a permission prompt.
      }).finally(() => {
        if (runningGeneration === attemptGeneration) runningGeneration = null;
      });
    };

    const unsubscribe = useBabyStore.subscribe((state) => {
      const userId = state.user?.id ?? null;
      if (userId === lastUserId && state.authLoading === lastAuthLoading) return;
      lastUserId = userId;
      lastAuthLoading = state.authLoading;
      generation.current++;
      runningGeneration = null;
      if (!state.authLoading && userId) queueMicrotask(recover);
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") recover();
    };
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", onVisible);
    recover();

    return () => {
      mounted = false;
      generation.current++;
      unsubscribe();
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  return null;
}
