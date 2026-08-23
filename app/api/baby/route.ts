import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthSession(request);
    if (user) {
      const active = await getActiveBabyForUser(user.id);
      return NextResponse.json(active?.baby ?? null);
    }

    const baby = await prisma.baby.findFirst();
    return NextResponse.json(baby);
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

export async function POST(request: Request) {
  try {
    const user = await getAuthSession(request);
    const body = await request.json().catch(() => ({}));
    const validated = validateBody(body);
    if (typeof validated === "string") {
      return NextResponse.json({ error: validated }, { status: 400 });
    }

    let familyId: string;

    if (user) {
      const active = await getActiveBabyForUser(user.id);
      if (active?.baby) {
        return NextResponse.json(
          { error: "宝宝信息已存在，请使用 PUT 更新" },
          { status: 409 }
        );
      }
      if (active?.family) {
        familyId = active.family.id;
      } else {
        const family = await prisma.family.create({
          data: {
            name: `${user.displayName}的家`,
            inviteCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
            members: {
              create: {
                userId: user.id,
                role: "admin",
                relation: "parent",
              },
            },
          },
        });
        familyId = family.id;
      }
    } else {
      let defaultFamily = await prisma.family.findFirst();
      if (!defaultFamily) {
        defaultFamily = await prisma.family.create({
          data: {
            name: "默认家庭",
            inviteCode: "BABY88",
          },
        });
      }
      familyId = defaultFamily.id;
    }

    const baby = await prisma.baby.create({
      data: {
        familyId,
        nickname: validated.nickname,
        birthDate: validated.birthDate,
        gender: validated.gender,
        gestationalAge: validated.gestationalAge,
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
    const user = await getAuthSession(request);
    const body = await request.json().catch(() => ({}));
    const validated = validateBody(body);
    if (typeof validated === "string") {
      return NextResponse.json({ error: validated }, { status: 400 });
    }

    let targetBaby = null;
    if (user) {
      const active = await getActiveBabyForUser(user.id);
      targetBaby = active?.baby;
    } else {
      targetBaby = await prisma.baby.findFirst();
    }

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
