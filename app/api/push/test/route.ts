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
    let hadExpiredSub = false;
    type PushErrorRecord = { statusCode?: number; body?: string; message?: string };
    let lastError: PushErrorRecord | null = null;

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          const pushSub: webPush.PushSubscription = {
            endpoint: sub.endpoint,
            keys: JSON.parse(sub.keysJson),
          };
          const sendPromise = webPush.sendNotification(pushSub, payload, {
            urgency: "high",
          });
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Push gateway timeout")), 10000)
          );
          await Promise.race([sendPromise, timeoutPromise]);
          sent++;
        } catch (err: any) {
          const statusCode = (err as webPush.WebPushError)?.statusCode;
          const body = (err as webPush.WebPushError)?.body;
          console.error("[PushTest] Failed to send push:", {
            subId: sub.id,
            endpoint: sub.endpoint.slice(0, 60),
            statusCode,
            body,
            message: err?.message,
          });

          // 仅 404 (Not Found) 或 410 (Gone) 表明该设备订阅凭据在推送中心已被注销或永久失效
          // 401/403 属于服务端 VAPID 配置或授权问题，切勿误删合法的客户端订阅
          if (statusCode === 404 || statusCode === 410) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            hadExpiredSub = true;
          }
          failed++;
          lastError = {
            statusCode,
            body,
            message: err?.message || String(err),
          };
        }
      })
    );

    if (sent === 0 && failed > 0) {
      const errInfo: PushErrorRecord = lastError || {};
      if (hadExpiredSub) {
        return NextResponse.json(
          { error: "设备推送凭据已在推送服务中失效，已自动清理，请点击「重新绑定设备」" },
          { status: 400 }
        );
      }
      if (errInfo.statusCode === 401 || errInfo.statusCode === 403) {
        return NextResponse.json(
          { error: `推送服务鉴权失败(${errInfo.statusCode})，请检查服务端 VAPID 配置` },
          { status: 502 }
        );
      }
      if (errInfo.message?.includes("timeout") || errInfo.message?.includes("Timeout")) {
        return NextResponse.json(
          { error: "连接推送网关超时，请稍后重试" },
          { status: 504 }
        );
      }
      return NextResponse.json(
        { error: `发送测试推送失败: ${errInfo.message || "未知错误"}` },
        { status: 500 }
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
