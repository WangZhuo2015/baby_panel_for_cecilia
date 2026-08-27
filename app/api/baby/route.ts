import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";
import { generateInviteCode } from "@/lib/auth";
import { isValidDateStr, getLocalDateStr } from "@/lib/date";

export async function GET(request: Request) {
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
  if (typeof body.avatarUrl === "string" && body.avatarUrl.trim() !== "" && !/^\/uploads\/(avatars|medical)\/[^/]+\.(jpg|jpeg|png|webp|heic)$/i.test(body.avatarUrl.trim())) {
    return "avatarUrl 仅支持本站 /uploads/ 路径的图片";
  }
  return { nickname: body.nickname.trim(), birthDate: body.birthDate, gender, gestationalAge };
}

export async function POST(request: Request) {

  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const validated = validateBody(body);
    if (typeof validated === "string") {
      return NextResponse.json({ error: validated }, { status: 400 });
    }

    const active = await getActiveBaby(user.id);
    if (active.baby) {
      return NextResponse.json(
        { error: "宝宝信息已存在，请使用 PUT 更新" },
        { status: 409 }
      );
    }

    const baby = await prisma.$transaction(async (tx) => {
      let targetFamilyId: string;
      if (active.family) {
        targetFamilyId = active.family.id;
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
          ...(typeof body.avatarUrl === "string" && body.avatarUrl.trim() !== "" ? { avatarUrl: body.avatarUrl.trim() } : {}),
        },
      });
    });

    return NextResponse.json(baby, { status: 201 });

  } catch (error) {
    console.error("POST /api/baby error:", error);
    return NextResponse.json(
      { error: "Failed to create baby record" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
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

    const baby = await prisma.baby.update({
      where: { id: targetBaby.id },
      data: {
        nickname: validated.nickname,
        birthDate: validated.birthDate,
        gender: validated.gender,
        gestationalAge: validated.gestationalAge,
        ...(typeof body.avatarUrl === "string" && body.avatarUrl.trim() !== "" ? { avatarUrl: body.avatarUrl.trim() } : {}),
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
