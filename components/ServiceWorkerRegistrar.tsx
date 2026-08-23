"use client";

import { useEffect } from "react";

/**
 * Registers and automatically updates the service worker globally on app load.
 * Automatically clears stale caches, forces immediate activation of new versions,
 * and seamlessly reloads the app when a new version takes control.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none", // Force browser to bypass HTTP cache for sw.js
        });

        // Actively check for updates immediately on load
        registration.update().catch(() => {});

        // If a new worker is already waiting, trigger it to activate immediately
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        // When a new SW is detected and installing, listen for installation finish
        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.addEventListener("statechange", () => {
              if (
                installingWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                // Notify waiting worker to take over
                installingWorker.postMessage({ type: "SKIP_WAITING" });
              }
            });
          }
        });
      } catch (err) {
        console.warn("SW registration error:", err);
      }
    };

    // If page is already loaded, register immediately; otherwise wait for load
    if (document.readyState === "complete") {
      registerSW();
    } else {
      window.addEventListener("load", registerSW);
    }

    // When the new service worker activates and takes control (via clients.claim()),
    // reload the page once so the user immediately sees the latest CSS and layout
    let isRefreshing = false;
    const handleControllerChange = () => {
      if (isRefreshing) return;
      isRefreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    return () => {
      window.removeEventListener("load", registerSW);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  return null;
}

