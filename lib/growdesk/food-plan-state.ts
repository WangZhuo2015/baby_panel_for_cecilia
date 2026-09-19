import {
  BridgeError,
  requireData,
  wireVersion,
  type BridgeResult,
} from "./bridge-protocol";

/**
 * The food-plan endpoint is a shared document. Every compatibility writer must
 * read this state first and send the exact version it observed back as
 * `baseVersion`; using an empty object after a failed read would overwrite
 * another feature's state.
 */
export interface GrowDeskFoodPlanState {
  babyId: string;
  id: string | null;
  createdAt: string | null;
  updatedAt: string;
  version: string;
  planData: Record<string, unknown>;
}

function invalid(message: string): never {
  throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", message);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`GrowDesk 返回了无效的${label}`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) invalid(`GrowDesk 返回了无效的${label}`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value) invalid(`GrowDesk 返回了无效的${label}`);
  return value;
}

/**
 * Canonical food plans use version 0 only for an uncreated, empty plan. That
 * initial state can be created with baseVersion 0; every existing plan must
 * use a positive observed version.
 */
export function foodPlanVersion(value: unknown, allowEmpty = false): string {
  if (allowEmpty && value === "0") return "0";
  try {
    return wireVersion(value);
  } catch {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 返回了无效的饮食计划版本");
  }
}

/** Parse and validate the canonical GET response before any compatibility merge. */
export function readGrowDeskFoodPlan(
  response: BridgeResult<unknown>,
  expectedBabyId: string,
): GrowDeskFoodPlanState {
  const value = objectValue(requireData(response), "宝宝饮食计划");
  const babyId = requiredString(value.babyId, "饮食计划宝宝 ID");
  if (babyId !== expectedBabyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他宝宝的饮食计划");
  }

  const id = nullableString(value.id, "饮食计划 ID");
  const planData = objectValue(value.planData, "饮食计划数据");
  const createdAt = nullableString(value.createdAt, "饮食计划创建时间");
  const isEmptyPlan = id === null && createdAt === null && Object.keys(planData).length === 0;
  const version = foodPlanVersion(value.version, isEmptyPlan);

  // A zero version is reserved for the exact empty GET state above. This
  // explicit check keeps a malformed non-empty response from becoming a write.
  if (version === "0" && !isEmptyPlan) {
    invalid("GrowDesk 返回了无效的空饮食计划版本");
  }

  return {
    babyId,
    id,
    createdAt,
    updatedAt: requiredString(value.updatedAt, "饮食计划更新时间"),
    version,
    planData,
  };
}

/** Build the only accepted food-plan write shape, including initial creation. */
export function foodPlanWriteBody(
  state: GrowDeskFoodPlanState,
  planData: Record<string, unknown>,
): { planData: Record<string, unknown>; baseVersion: string } {
  if (state.version === "0" && !(state.id === null && state.createdAt === null && Object.keys(state.planData).length === 0)) {
    throw new BridgeError(428, "BASE_VERSION_REQUIRED", "饮食计划版本无效，请刷新后重试");
  }
  return { planData, baseVersion: state.version === "0" ? "0" : wireVersion(state.version) };
}
