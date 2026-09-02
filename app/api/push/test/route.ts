import { NextResponse } from "next/server";
import webPush from "web-push";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { PUSH_CONFIG } from "@/lib/config";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const publicKey = PUSH_CONFIG.publicKey;
    const privateKey = PUSH_CONFIG.privateKey;

    if (!publicKey || !privateKey) {
      return NextResponse.json(
        { error: "服务端尚未配置 VAPID 密钥，无法发送推送" },
        { status: 500 }
      );
    }

    // 如果客户端携带了当前设备 subscription 对象，自动补全同步
    const body = await request.json().catch(() => ({}));
    if (body?.subscription?.endpoint && body.subscription.keys) {
      const endpoint = String(body.subscription.endpoint).trim();
      await prisma.pushSubscription.upsert({
        where: { endpoint },
        update: {
          keysJson: JSON.stringify(body.subscription.keys),
          userId: user.id,
        },
        create: {
          endpoint,
          keysJson: JSON.stringify(body.subscription.keys),
          userId: user.id,
        },
      });
    }

    // 查找当前用户的推送订阅记录
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: user.id },
    });

    if (subscriptions.length === 0) {
      return NextResponse.json(
        { error: "未找到当前设备的推送订阅记录，请先在当前设备点击「开启推送通知」" },
        { status: 400 }
      );
    }

    webPush.setVapidDetails(
      PUSH_CONFIG.subject,
      publicKey,
      privateKey
    );

    const payload = JSON.stringify({
      title: "🔔 宝宝成长助手 · 测试推送成功！",
      body: `尊敬的 ${user.displayName || user.username}，您的设备推送已成功就绪，家庭成员提交或修改记录时将实时通知您 ✨`,
      url: "/notifications",
    });

    let sent = 0;
    let failed = 0;

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          const pushSub: webPush.PushSubscription = {
            endpoint: sub.endpoint,
            keys: JSON.parse(sub.keysJson),
          };
          const sendPromise = webPush.sendNotification(pushSub, payload);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Push gateway timeout")), 4000)
          );
          await Promise.race([sendPromise, timeoutPromise]);
          sent++;
        } catch (err: any) {
          const statusCode = (err as webPush.WebPushError)?.statusCode;
          if ([401, 403, 404, 410].includes(statusCode)) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          }
          failed++;
        }
      })
    );

    if (sent === 0 && failed > 0) {
      return NextResponse.json(
        { error: "设备推送凭据已失效，已自动清理，请点击「重新绑定设备」" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      sent,
      failed,
      message: "测试通知已发出，请检查系统通知栏",
    });
  } catch (error) {
    console.error("POST /api/push/test error:", error);
    return NextResponse.json(
      { error: "发送测试推送失败" },
      { status: 500 }
    );
  }
}
