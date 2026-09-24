export type ReplayIdentity = { userId: string; familyId: string; babyId: string };

type ReplayIdentityState = {
  user?: { id?: string } | null;
  family?: { id?: string } | null;
  baby?: { id?: string; familyId?: string } | null;
  selectedBabyId?: string | null;
  fetchUser: () => Promise<unknown>;
};

/** Revalidate the session when needed, then read a fresh, fully scoped identity. */
export async function resolveReplayIdentity(getState: () => ReplayIdentityState): Promise<ReplayIdentity | null> {
  let state = getState();
  if (!state.user?.id) {
    await state.fetchUser();
    state = getState();
  }
  const userId = state.user?.id;
  const familyId = state.family?.id;
  const babyId = state.baby?.id;
  if (!userId || !familyId || !babyId) return null;
  if (state.baby?.familyId !== familyId || state.selectedBabyId !== babyId) return null;
  return { userId, familyId, babyId };
}

export function matchesReplayIdentity(getState: () => ReplayIdentityState, identity: ReplayIdentity): boolean {
  const state = getState();
  return state.user?.id === identity.userId
    && state.family?.id === identity.familyId
    && state.baby?.id === identity.babyId
    && state.baby?.familyId === identity.familyId
    && state.selectedBabyId === identity.babyId;
}
