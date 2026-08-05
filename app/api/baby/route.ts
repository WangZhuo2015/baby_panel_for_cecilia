import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
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

function validateBody(body: any): { nickname: string; birthDate: string; gender: string } | string {
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
  const gender = body.gender === "male" ? "male" : body.gender === "female" ? "female" : "female";
  return { nickname: body.nickname.trim(), birthDate: body.birthDate, gender };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const validated = validateBody(body);
    if (typeof validated === "string") {
      return NextResponse.json({ error: validated }, { status: 400 });
    }

    const existing = await prisma.baby.findFirst();
    if (existing) {
      return NextResponse.json(
        { error: "宝宝信息已存在，请使用 PUT 更新" },
        { status: 409 }
      );
    }

    const baby = await prisma.baby.create({ data: validated });
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
    const body = await request.json().catch(() => ({}));
    const validated = validateBody(body);
    if (typeof validated === "string") {
      return NextResponse.json({ error: validated }, { status: 400 });
    }

    const existing = await prisma.baby.findFirst();
    if (!existing) {
      return NextResponse.json(
        { error: "宝宝信息不存在，请先初始化" },
        { status: 404 }
      );
    }

    const baby = await prisma.baby.update({
      where: { id: existing.id },
      data: validated,
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
