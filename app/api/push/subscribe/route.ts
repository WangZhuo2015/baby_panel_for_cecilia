import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const user = await getAuthSession(request);
    const subscription = await request.json();

    if (
      !subscription ||
      typeof subscription.endpoint !== "string" ||
      subscription.endpoint.trim() === "" ||
      !subscription.keys ||
      typeof subscription.keys !== "object" ||
      Array.isArray(subscription.keys)
    ) {
      return NextResponse.json(
        { error: "请求格式无效:必须提供 endpoint 和 keys" },
        { status: 400 }
      );
    }

    const record = await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        keysJson: JSON.stringify(subscription.keys),
        userId: user?.id ?? null,
      },
      create: {
        endpoint: subscription.endpoint,
        keysJson: JSON.stringify(subscription.keys),
        userId: user?.id ?? null,
      },
    });

    return NextResponse.json({ success: true, id: record.id });
  } catch (error) {
    console.error("POST /api/push/subscribe error:", error);
    return NextResponse.json(
      { error: "订阅保存失败" },
      { status: 500 }
    );
  }
}
