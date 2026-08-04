import { NextResponse } from "next/server";
import webPush from "web-push";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  if (!process.env.PUSH_SEND_TOKEN) {
    return NextResponse.json(
      { error: "Push sending is disabled (PUSH_SEND_TOKEN not configured)" },
      { status: 503 }
    );
  }

  const token = request.headers.get("x-push-token");
  if (token !== process.env.PUSH_SEND_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { title, body, url } = await request.json();

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!publicKey || !privateKey) {
      return NextResponse.json(
        { error: "VAPID keys not configured" },
        { status: 500 }
      );
    }

    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:cecilia@baby-app.local",
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
          await webPush.sendNotification(subscription, payload);
          success += 1;
        } catch (error) {
          const statusCode = (error as webPush.WebPushError)?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } });
          } else {
            console.error("Push send error:", error);
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
