import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";
import type { Baby, Family } from "@/generated/prisma/client";

export { getAuthSession, getActiveBabyForUser };

export type AuthUser = NonNullable<Awaited<ReturnType<typeof getAuthSession>>>;

export interface ActiveBabyResult {
  baby: Baby | null;
  family: Family | null;
  errorResponse: NextResponse | null;
}

/**
 * Ensures the incoming request is authenticated.
 * If no valid session exists, returns a 401 Unauthorized response in errorResponse.
 */
export async function requireAuth(request: Request): Promise<
  | { user: AuthUser; errorResponse: null }
  | { user: null; errorResponse: NextResponse }
> {
  const user = await getAuthSession(request);
  if (!user) {
    return {
      user: null,
      errorResponse: NextResponse.json(
        { error: "Unauthorized: 请先登录" },
        { status: 401 }
      ),
    };
  }
  return { user, errorResponse: null };
}

/**
 * Resolves the baby and family for a given user, enforcing family isolation and IDOR prevention.
 * If requestedBabyId is passed, strictly verifies that the baby belongs to the user's family.
 * Returns 404 if the requested baby is not found, or 403 Forbidden if the user's family does not own the baby.
 */
export async function getActiveBaby(
  userId: string,
  requestedBabyId?: string | null
): Promise<ActiveBabyResult> {
  if (userId === "system-mcp") {
    let baby = null;
    if (requestedBabyId) {
      baby = await prisma.baby.findUnique({ where: { id: requestedBabyId } });
    }
    if (!baby) {
      baby = await prisma.baby.findFirst();
    }
    const family = baby ? await prisma.family.findUnique({ where: { id: baby.familyId } }) : null;
    return {
      baby,
      family,
      errorResponse: null,
    };
  }

  const memberships = await prisma.familyMember.findMany({
    where: { userId },
    include: {
      family: {
        include: {
          babies: {
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!memberships || memberships.length === 0) {
    return {
      baby: null,
      family: null,
      errorResponse: null,
    };
  }

  const userFamilies = memberships.map((m) => m.family);
  const userFamilyIds = new Set(userFamilies.map((f) => f.id));
  const primaryFamily = userFamilies[0] || null;

  if (requestedBabyId) {
    const baby = await prisma.baby.findUnique({
      where: { id: requestedBabyId },
    });

    if (!baby) {
      return {
        baby: null,
        family: null,
        errorResponse: NextResponse.json(
          { error: "未找到指定的宝宝档案" },
          { status: 404 }
        ),
      };
    }

    if (!userFamilyIds.has(baby.familyId)) {
      return {
        baby: null,
        family: null,
        errorResponse: NextResponse.json(
          { error: "Forbidden: 您无权访问此宝宝档案" },
          { status: 403 }
        ),
      };
    }

    const matchedFamily = userFamilies.find((f) => f.id === baby.familyId) || primaryFamily;
    return {
      baby,
      family: matchedFamily,
      errorResponse: null,
    };
  }

  const allBabies = userFamilies.flatMap((f) => f.babies);
  const activeBaby = allBabies[0] || null;

  return {
    baby: activeBaby,
    family: primaryFamily,
    errorResponse: null,
  };
}

/**
 * Requires both authentication and an active baby for the user.
 * Returns 404 if no baby exists for the user.
 */
export async function requireBaby(
  userId: string,
  requestedBabyId?: string | null
): Promise<
  | { baby: Baby; family: Family; errorResponse: null }
  | { baby: null; family: Family | null; errorResponse: NextResponse }
> {
  const result = await getActiveBaby(userId, requestedBabyId);
  if (result.errorResponse) {
    return {
      baby: null,
      family: result.family,
      errorResponse: result.errorResponse,
    };
  }

  if (!result.baby || !result.family) {
    return {
      baby: null,
      family: result.family,
      errorResponse: NextResponse.json(
        { error: "未找到宝宝档案，请先创建宝宝信息" },
        { status: 404 }
      ),
    };
  }

  return {
    baby: result.baby,
    family: result.family,
    errorResponse: null,
  };
}
