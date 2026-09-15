import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import crypto from "node:crypto";

export async function POST(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const subscription = await request.json().catch(() => ({}));
      const endpoint = subscription?.endpoint ? String(subscription.endpoint).trim() : "";
      if (!endpoint) {
        return NextResponse.json({ error: "请求格式无效:必须提供 endpoint 和 keys" }, { status: 400 });
      }

      const installationId = crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
      const res = await growdeskFetch(`/api/v1/devices/${installationId}/push`, {
        method: "PUT",
        accessToken: bffSession.accessToken,
        body: {
          token: endpoint,
          platform: "web",
          environment: "production",
        },
      });

      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "订阅保存失败" },
          { status: res.status },
        );
      }

      return NextResponse.json({ success: true, id: installationId });
    }

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
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const body = await request.json().catch(() => ({}));
      const endpoint = body?.endpoint ? String(body.endpoint).trim() : "";
      if (endpoint) {
        const installationId = crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
        await growdeskFetch(`/api/v1/devices/${installationId}/push`, {
          method: "DELETE",
          accessToken: bffSession.accessToken,
        });
      }

      return NextResponse.json({ success: true });
    }

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
