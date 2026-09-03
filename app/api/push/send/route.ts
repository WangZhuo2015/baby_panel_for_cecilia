import { NextResponse } from "next/server";
import webPush from "web-push";
import { prisma } from "@/lib/prisma";
import { PUSH_CONFIG } from "@/lib/config";

export async function POST(request: Request) {
  if (!PUSH_CONFIG.sendToken) {
    return NextResponse.json(
      { error: "Push sending is disabled (PUSH_SEND_TOKEN not configured)" },
      { status: 503 }
    );
  }

  const token = request.headers.get("x-push-token");
  if (token !== PUSH_CONFIG.sendToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { title, body, url } = await request.json();

    const publicKey = PUSH_CONFIG.publicKey;
    const privateKey = PUSH_CONFIG.privateKey;

    if (!publicKey || !privateKey) {
      return NextResponse.json(
        { error: "VAPID keys not configured" },
        { status: 500 }
      );
    }

    webPush.setVapidDetails(
      PUSH_CONFIG.subject,
      publicKey,
      privateKey
    );

    const payload = JSON.stringify({
      title: title || "宝宝成长助手",
      body: body || "您有一条新通知",
      url: url || "/notifications",
    });

    const subscriptions = await prisma.pushSubscription.findMany();
    let success = 0;
    let failed = 0;

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          const subscription: webPush.PushSubscription = {
            endpoint: sub.endpoint,
            keys: JSON.parse(sub.keysJson),
          };
          await webPush.sendNotification(subscription, payload, { urgency: "high" });
          success += 1;
        } catch (error) {
          const statusCode = (error as webPush.WebPushError)?.statusCode;
          const body = (error as webPush.WebPushError)?.body;
          console.error("[PushSend] Push send error:", {
            subId: sub.id,
            endpoint: sub.endpoint.slice(0, 60),
            statusCode,
            body,
            message: (error as any)?.message,
          });
          // 仅 404 (Not Found) 或 410 (Gone) 表明订阅在推送中心已注销，401/403 为服务端鉴权错误切勿误删
          if (statusCode === 404 || statusCode === 410) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          }
          failed += 1;
        }
      })
    );

    return NextResponse.json({ success, failed });
  } catch (error) {
    console.error("POST /api/push/send error:", error);
    return NextResponse.json(
      { error: "Failed to send push notifications" },
      { status: 500 }
    );
  }
}
