"use client";

import { useMemo } from "react";
import { useBabyStore } from "@/stores/useBabyStore";
import { createNutritionFetch, type NutritionIdentity } from "@/lib/nutrition/scoped-fetch";

function currentIdentity(requestedBabyId?: string): NutritionIdentity | null {
  const state = useBabyStore.getState();
  const baby = state.baby;
  if (state.authLoading || !state.user?.id || !state.family?.id || !baby?.id ||
      baby.familyId !== state.family.id || state.selectedBabyId !== baby.id ||
      (requestedBabyId && requestedBabyId !== baby.id)) return null;
  return { userId: state.user.id, familyId: state.family.id, babyId: baby.id };
}

export function useNutritionFetch(requestedBabyId?: string, requireSuccess = false) {
  const userId = useBabyStore(s => s.user?.id);
  const familyId = useBabyStore(s => s.family?.id);
  const babyId = useBabyStore(s => s.baby?.id);
  const babyFamilyId = useBabyStore(s => s.baby?.familyId);
  const selectedBabyId = useBabyStore(s => s.selectedBabyId);
  const authLoading = useBabyStore(s => s.authLoading);
  return useMemo(
    () => createNutritionFetch(currentIdentity(requestedBabyId), () => currentIdentity(requestedBabyId), fetch, requireSuccess),
    [userId, familyId, babyId, babyFamilyId, selectedBabyId, authLoading, requestedBabyId, requireSuccess],
  );
}
