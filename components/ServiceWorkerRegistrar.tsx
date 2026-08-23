"use client";

import { useEffect } from "react";

/**
 * Registers the service worker globally on app load.
 * Placed in the root layout so the SW is always active for PWA / standalone mode,
 * not only when the user visits the notifications page.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      // Register after the page has fully loaded to avoid blocking initial render
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
          console.warn("SW registration failed:", err);
        });
      });
    }
  }, []);

  return null;
}
