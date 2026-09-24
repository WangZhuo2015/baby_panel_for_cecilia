"use client";

import { useEffect } from "react";
import { useBabyStore } from "@/stores/useBabyStore";

/** Ensure direct record-form routes hydrate the authenticated identity while online. */
export function useRecordIdentityReady(): boolean {
  const fetchUser = useBabyStore((state) => state.fetchUser);
  const userId = useBabyStore((state) => state.user?.id);
  const familyId = useBabyStore((state) => state.family?.id);
  const babyId = useBabyStore((state) => state.baby?.id);
  const authLoading = useBabyStore((state) => state.authLoading);

  useEffect(() => {
    if (!userId) void fetchUser();
  }, [userId, fetchUser]);

  return Boolean(!authLoading && userId && familyId && babyId);
}
