import { NextResponse } from "next/server";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskIdentityEndpoints } from "@/lib/growdesk/identity-endpoints";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";
import { generateInviteCode } from "@/lib/auth";
import { isValidDateStr, getLocalDateStr } from "@/lib/date";
import { canUsePendingAvatar } from "@/lib/pending-avatar";

export async function GET(request: Request) {
  if (GROWDESK_CONFIG.enabled) return growdeskIdentityEndpoints.baby(request);
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");

    const active = await getActiveBaby(user.id, requestedBabyId);
    if (active.errorResponse) return active.errorResponse;

    return NextResponse.json(active.baby ?? null);
  } catch (error) {
    console.error("GET /api/baby error:", error);
    return NextResponse.json(
      { error: "Failed to fetch baby record" },
      { status: 500 }
    );
  }
}

function validateBody(body: any): { nickname: string; birthDate: string; gender: string; gestationalAge?: number } | string {
  if (typeof body.nickname !== "string" || body.nickname.trim() === "") {
    return "nickname 必填且不能为空";
  }
  if (typeof body.birthDate !== "string" || !isValidDateStr(body.birthDate.trim())) {
    return "birthDate 必填且必须为有效的 YYYY-MM-DD 日期";
  }
  if (body.birthDate.trim() > getLocalDateStr()) {
    return "birthDate 不能是未来日期";
  }
  const gender = body.gender === "male" ? "male" : "female";
  let gestationalAge: number | undefined;
  if (body.gestationalAge !== undefined && body.gestationalAge !== null && body.gestationalAge !== "") {
    const ga = Number(body.gestationalAge);
    if (Number.isNaN(ga) || ga < 20 || ga > 44) return "gestationalAge 必须在 20-44 周之间";
    gestationalAge = ga;
  }
  if (typeof body.avatarUrl === "string" && body.avatarUrl.trim() !== "" && !/^\/uploads\/(avatars|medical)\/[^/]+\.(jpg|jpeg|png|webp|heic|heif)$/i.test(body.avatarUrl.trim())) {
    return "avatarUrl 仅支持本站 /uploads/ 路径的图片";
  }
  return { nickname: body.nickname.trim(), birthDate: body.birthDate, gender, gestationalAge };
}

export async function POST(request: Request) {
  if (GROWDESK_CONFIG.enabled) return growdeskIdentityEndpoints.baby(request);

  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const validated = validateBody(body);
    if (typeof validated === "string") {
      return NextResponse.json({ error: validated }, { status: 400 });
    }

    const requestedFamilyId = body.familyId;
    if (requestedFamilyId !== undefined && (typeof requestedFamilyId !== "string" || !requestedFamilyId.trim())) {
      return NextResponse.json({ error: "请指定有效的家庭" }, { status: 400 });
    }
    const membership = requestedFamilyId === undefined
      ? user.memberships[0]
      : user.memberships.find(({ familyId }) => familyId === requestedFamilyId);
    if (requestedFamilyId !== undefined && !membership) {
      return NextResponse.json({ error: "无权访问该家庭" }, { status: 403 });
    }
    const families = requestedFamilyId === undefined ? user.memberships : membership ? [membership] : [];
    if (families.some(({ family }) => family.babies.length > 0)) {
      return NextResponse.json({ error: "宝宝信息已存在，请使用 PUT 更新" }, { status: 409 });
    }
    const avatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : "";
    if (avatarUrl && !canUsePendingAvatar(avatarUrl, user.id, membership?.familyId)) {
      return NextResponse.json({ error: "头像与所选家庭不匹配，请重新上传" }, { status: 403 });
    }

    const baby = await prisma.$transaction(async (tx) => {
      let targetFamilyId: string;
      if (membership) {
        targetFamilyId = membership.familyId;
        const family = await tx.family.findFirst({
          where: { id: targetFamilyId, members: { some: { userId: user.id } } },
          select: { _count: { select: { babies: true } } },
        });
        if (!family) return NextResponse.json({ error: "无权访问该家庭" }, { status: 403 });
        if (family._count.babies) {
          return NextResponse.json({ error: "宝宝信息已存在，请使用 PUT 更新" }, { status: 409 });
        }
      } else {
        const inviteCode = generateInviteCode(6);
        const family = await tx.family.create({
          data: {
            name: `${user.displayName}的家`,
            inviteCode,
            members: {
              create: {
                userId: user.id,
                role: "admin",
                relation: "parent",
              },
            },
          },
        });
        targetFamilyId = family.id;
      }

      return tx.baby.create({
        data: {
          familyId: targetFamilyId,
          nickname: validated.nickname,
          birthDate: validated.birthDate,
          gender: validated.gender,
          gestationalAge: validated.gestationalAge,
          ...(avatarUrl ? { avatarUrl } : {}),
        },
      });
    });

    return baby instanceof NextResponse ? baby : NextResponse.json(baby, { status: 201 });

  } catch (error) {
    console.error("POST /api/baby error:", error);
    return NextResponse.json(
      { error: "Failed to create baby record" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  if (GROWDESK_CONFIG.enabled) return growdeskIdentityEndpoints.baby(request);
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const validated = validateBody(body);
    if (typeof validated === "string") {
      return NextResponse.json({ error: validated }, { status: 400 });
    }

    const requestedBabyId = body.babyId || body.id;
    const active = await getActiveBaby(user.id, requestedBabyId);
    if (active.errorResponse) return active.errorResponse;

    const targetBaby = active.baby;
    if (!targetBaby) {
      return NextResponse.json(
        { error: "宝宝信息不存在，请先初始化" },
        { status: 404 }
      );
    }

    const avatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : "";
    if (avatarUrl && avatarUrl !== targetBaby.avatarUrl && !canUsePendingAvatar(avatarUrl, user.id, targetBaby.familyId)) {
      return NextResponse.json({ error: "头像与所选家庭不匹配，请重新上传" }, { status: 403 });
    }

    const baby = await prisma.baby.update({
      where: { id: targetBaby.id },
      data: {
        nickname: validated.nickname,
        birthDate: validated.birthDate,
        gender: validated.gender,
        gestationalAge: validated.gestationalAge,
        ...(avatarUrl ? { avatarUrl } : {}),
      },
    });

    return NextResponse.json(baby);
  } catch (error) {
    console.error("PUT /api/baby error:", error);
    return NextResponse.json(
      { error: "Failed to update baby record" },
      { status: 500 }
    );
  }
}
