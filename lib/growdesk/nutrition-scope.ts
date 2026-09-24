import { BridgeError, type BridgeFetch, pathId } from "./bridge-protocol";
import { loadWebBaby, loadWebIdentity, type LegacyBaby } from "./bridge-identity";

export interface NutritionSelection {
  babyId?: unknown;
  familyId?: unknown;
}
export interface NutritionScope {
  familyId: string;
  baby: LegacyBaby | null;
}

/** An expected actor is a precondition, never a substitute for authentication. */
export function assertExpectedActor(request: Request, authenticatedUserId: string): void {
  const expected = request.headers.get("x-growdesk-expected-user");
  if (expected !== null && expected !== authenticatedUserId) {
    throw new BridgeError(409, "IDENTITY_CHANGED", "账号已变更，请刷新后重试");
  }
}

function selectedId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  pathId(value); // An explicitly empty or malformed choice must not become a default.
  return value as string;
}
function checkedBaby(baby: LegacyBaby, requestedId?: string, familyId?: string): LegacyBaby {
  try { pathId(baby.id); pathId(baby.familyId); } catch {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了无效的宝宝作用域");
  }
  if ((requestedId && baby.id !== requestedId) || (familyId && baby.familyId !== familyId)) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他宝宝或家庭的资料");
  }
  return baby;
}

/** Resolve explicit selection using authorized reads. Infer only an unambiguous selection. */
export async function resolveNutritionScope(
  fetchApi: BridgeFetch,
  token: string,
  selection: NutritionSelection,
): Promise<NutritionScope | null> {
  const babyId = selectedId(selection.babyId);
  const familyId = selectedId(selection.familyId);
  if (babyId) {
    const raw = await loadWebBaby(fetchApi, token, babyId);
    if (!raw) throw new BridgeError(404, "BABY_NOT_FOUND", "未找到指定的宝宝档案");
    const baby = checkedBaby(raw, babyId);
    if (familyId && baby.familyId !== familyId) {
      throw new BridgeError(409, "BABY_SCOPE_MISMATCH", "宝宝与所选家庭不一致，请重新选择");
    }
    return { familyId: baby.familyId, baby };
  }

  const identity = await loadWebIdentity(fetchApi, token);
  const choices = familyId
    ? identity.families.filter(item => item.family.id === familyId)
    : identity.families;
  if (familyId && choices.length === 0) {
    throw new BridgeError(403, "FAMILY_ACCESS_DENIED", "无权访问该家庭");
  }
  if (choices.length === 0) return null;
  if (choices.length !== 1) {
    throw new BridgeError(409, "FAMILY_SELECTION_REQUIRED", "请明确选择家庭或宝宝");
  }
  const selected = choices[0]!;
  try { pathId(selected.family.id); } catch {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了无效的家庭资料");
  }
  // Products may be family-owned, but default-formula updates also mutate the
  // baby's food plan. Never silently choose the first baby for that side effect.
  const babies = selected.babies.map(baby => checkedBaby(baby, undefined, selected.family.id));
  if (babies.length > 1) {
    throw new BridgeError(409, "BABY_SELECTION_REQUIRED", "请明确选择宝宝");
  }
  return { familyId: selected.family.id, baby: babies[0] ?? null };
}

export async function requireNutritionBaby(
  fetchApi: BridgeFetch,
  token: string,
  selection: NutritionSelection,
): Promise<LegacyBaby> {
  const scope = await resolveNutritionScope(fetchApi, token, selection);
  if (!scope?.baby) throw new BridgeError(404, "BABY_NOT_FOUND", "请先选择宝宝档案");
  return scope.baby;
}
