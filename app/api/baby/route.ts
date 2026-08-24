import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";
import { generateInviteCode } from "@/lib/auth";

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
  if (
    typeof body.birthDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.birthDate) ||
    Number.isNaN(new Date(`${body.birthDate}T00:00:00`).getTime())
  ) {
    return "birthDate 必填且格式为 YYYY-MM-DD";
  }
  const gender = body.gender === "male" ? "male" : "female";
  const gestationalAge = typeof body.gestationalAge === "number" ? body.gestationalAge : undefined;
  return { nickname: body.nickname.trim(), birthDate: body.birthDate, gender, gestationalAge };
}

async function createFamilyWithUniqueInviteCode(userId: string, displayName: string) {
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    const inviteCode = generateInviteCode(6);
    try {
      const family = await prisma.family.create({
        data: {
          name: `${displayName}的家`,
          inviteCode,
          members: {
            create: {
              userId,
              role: "admin",
              relation: "parent",
            },
          },
        },
      });
      return family;
    } catch (err: any) {
      if (err.code === "P2002" && i < maxRetries - 1) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to generate unique invite code");
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

    let familyId: string;
    if (active.family) {
      familyId = active.family.id;
    } else {
      const family = await createFamilyWithUniqueInviteCode(user.id, user.displayName);
      familyId = family.id;
    }

    const baby = await prisma.baby.create({
      data: {
        familyId,
        nickname: validated.nickname,
        birthDate: validated.birthDate,
        gender: validated.gender,
        gestationalAge: validated.gestationalAge,
        ...(typeof body.avatarUrl === "string" ? { avatarUrl: body.avatarUrl } : {}),
      },
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
        ...(typeof body.avatarUrl === "string" ? { avatarUrl: body.avatarUrl } : {}),
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
