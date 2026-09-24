"use client";
import { useCallback, useEffect, useMemo } from "react";
import { useBabyStore } from "@/stores/useBabyStore";
import { useToast } from "@/components/ui/Toast";
import { createScopedNutritionRequest, NutritionScopeChanged, sameNutritionScope, type NutritionClientScope } from "@/lib/nutrition/scoped-request";

function currentScope(babyId?: string): NutritionClientScope | null {
  const state = useBabyStore.getState();
  const selected = babyId ?? state.baby?.id;
  if (!state.user?.id || !state.family?.id || !selected || state.baby?.id !== selected ||
      state.baby.familyId !== state.family.id || state.selectedBabyId !== selected) return null;
  return { userId: state.user.id, familyId: state.family.id, babyId: selected };
}

/** A changed account/baby remounts private forms, not their layout or controls. */
export function useNutritionScopeKey(babyId?: string): string {
  return useBabyStore(state => [state.user?.id, state.family?.id, state.baby?.id, state.selectedBabyId, babyId].join(":"));
}

export function useScopedNutritionRequest(babyId?: string) {
  const scopeKey = useNutritionScopeKey(babyId);
  const { showToast } = useToast();
  const client = useMemo(() => createScopedNutritionRequest(currentScope(babyId), () => currentScope(babyId)), [babyId, scopeKey]);
  useEffect(() => {
    client.activate();
    let observed = currentScope(babyId);
    const unsubscribe = useBabyStore.subscribe(() => {
      const next = currentScope(babyId);
      if ((next === null && observed === null) || sameNutritionScope(next, observed)) return;
      observed = next;
      // React can batch A -> B -> A into one render. Advance the request epoch
      // synchronously on each store transition, not only during effect cleanup.
      client.dispose();
      client.activate();
    });
    return () => { unsubscribe(); client.dispose(); };
  }, [client, babyId]);
  return useCallback(async (path: string, init?: RequestInit, allowStatuses?: readonly number[]) => {
    try { return await client.request(path, init, allowStatuses); }
    catch (error) {
      if (!(error instanceof NutritionScopeChanged)) showToast(error instanceof Error ? error.message : "营养数据请求失败", "error");
      throw error;
    }
  }, [client, showToast]);
}
