import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskCompanionEndpoints } from "@/lib/growdesk/companion-runtime";

export async function POST(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) return growdeskCompanionEndpoints.subscribe(request);

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const rateLimit = checkRateLimit(`push_sub:${user.id || getClientIp(request)}`, 10, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(rateLimit.resetSeconds) } }
      );
    }

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

    if (!/^https:\/\/.+/.test(subscription.endpoint.trim())) {
      return NextResponse.json(
        { error: "endpoint 必须为有效的 HTTPS 推送服务地址" },
        { status: 400 }
      );
    }

    const endpoint = subscription.endpoint.trim();
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    if (existing && existing.userId && existing.userId !== user.id) {
      return NextResponse.json(
        { error: "该推送订阅已归属其他用户" },
        { status: 409 }
      );
    }
    const record = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        keysJson: JSON.stringify(subscription.keys),
        userId: user.id,
      },
      create: {
        endpoint,
        keysJson: JSON.stringify(subscription.keys),
        userId: user.id,
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

export async function DELETE(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) return growdeskCompanionEndpoints.unsubscribe(request);

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const endpoint = body?.endpoint ? String(body.endpoint).trim() : "";
    if (endpoint) {
      await prisma.pushSubscription.deleteMany({
        where: { endpoint, userId: user.id },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/push/subscribe error:", error);
    return NextResponse.json({ error: error?.message || "退订失败" }, { status: 500 });
  }
}
