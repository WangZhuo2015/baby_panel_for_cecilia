import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth";
import type { Baby, Family } from "@/generated/prisma/client";

export { getAuthSession };

export type AuthUser = NonNullable<Awaited<ReturnType<typeof getAuthSession>>>;

export interface ActiveBabyResult {
  baby: Baby | null;
  family: Family | null;
  errorResponse: NextResponse | null;
}

/**
 * Validates request origin against Host header for state-mutating requests (CSRF protection)
 */
export function validateCsrfOrigin(request: Request): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return null;
  }
  // 浏览器会附带 Sec-Fetch-Site；非同站请求直接拒绝（缺失时走下方 Origin 校验，兼容 curl/MCP）
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return NextResponse.json({ error: "Forbidden: Cross-Site Request Blocked" }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      const cleanHost = host.split(":")[0];
      const cleanOriginHost = originHost.split(":")[0];
      if (cleanOriginHost !== cleanHost && originHost !== host) {
        return NextResponse.json({ error: "Forbidden: Cross-Origin Request Blocked" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Forbidden: Invalid Origin Header" }, { status: 403 });
    }
  }
  return null;
}


/**
 * Ensures the incoming request is authenticated.
 * If no valid session exists, returns a 401 Unauthorized response in errorResponse.
 */
export async function requireAuth(request: Request): Promise<
  | { user: AuthUser; errorResponse: null }
  | { user: null; errorResponse: NextResponse }
> {
  const csrfError = validateCsrfOrigin(request);
  if (csrfError) {
    return { user: null, errorResponse: csrfError };
  }

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
