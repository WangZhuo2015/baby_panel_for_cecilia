"use client";

import { useSmartPolling } from "@/lib/hooks/useSmartPolling";
import { useToast } from "@/components/ui/Toast";

export function SmartPollingHost() {
  const { showToast } = useToast();

  useSmartPolling({
    onFamilyActivity: (notif) => {
      showToast(`${notif.title} · ${notif.detail}`, "info");
    },
  });

  return null;
}
