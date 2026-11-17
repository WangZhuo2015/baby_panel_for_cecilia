import { NextResponse } from "next/server";
import webPush from "web-push";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { PUSH_CONFIG, GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { nativePushSubscription } from "@/lib/growdesk/push-bridge";
import { BridgeError, bridgeErrorResponse, requireData } from "@/lib/growdesk/bridge-protocol";
import crypto from "node:crypto";

export async function POST(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrfError = verifyBffCsrf(request, { enforceInTest: true });
      if (csrfError) return csrfError;
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const body = await request.json().catch(() => null);
      const subscription = nativePushSubscription(body?.subscription);
      // A test send is still a server-side request. Only browser push services
      // may receive it; arbitrary client URLs must never become an SSRF target.
      const endpoint = new URL(subscription.endpoint);
      const host = endpoint.hostname.toLowerCase();
      const allowedHost = host === "fcm.googleapis.com" ||
        host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com") ||
        host === "web.push.apple.com" || host.endsWith(".web.push.apple.com") ||
        host.endsWith(".notify.windows.com");
      if (!allowedHost || (endpoint.port && endpoint.port !== "443")) {
        throw new BridgeError(400, "INVALID_PUSH_SUBSCRIPTION", "不支持此推送服务地址，请重新绑定设备");
      }
      const publicKey = PUSH_CONFIG.publicKey;
      const privateKey = PUSH_CONFIG.privateKey;
      if (!publicKey || !privateKey) {
        throw new BridgeError(503, "PUSH_NOT_CONFIGURED", "服务端尚未配置推送密钥，无法发送推送");
      }

      const installationId = crypto.createHash("sha256").update(subscription.endpoint).digest("hex").slice(0, 32);
      const registration = requireData(await growdeskFetch<{ success: boolean }>(`/api/v1/devices/${installationId}/push`, {
        method: "PUT", accessToken: bffSession.accessToken,
        body: {
          token: JSON.stringify(subscription), platform: "web", environment: "production",
          deviceLabel: "Baby Panel Web",
        },
      }));
      if (registration.success !== true) {
        throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "服务端未确认推送订阅，请重试");
      }
      try {
        await webPush.sendNotification(subscription, JSON.stringify({
          title: "宝宝成长助手 · 测试通知", body: "这是一条测试通知，设备推送通道可用。", url: "/notifications",
        }), {
          urgency: "high", timeout: 10_000,
          vapidDetails: { subject: PUSH_CONFIG.subject, publicKey, privateKey },
        });
      } catch (error) {
        const pushError = error as webPush.WebPushError & { code?: string };
        const status = pushError.statusCode;
        if (status === 404 || status === 410) {
          throw new BridgeError(400, "PUSH_SUBSCRIPTION_GONE", "设备推送凭据已失效，请点击「重新绑定设备」");
        }
        if (status === 401 || status === 403) {
          throw new BridgeError(502, "PUSH_AUTH_FAILED", `推送服务鉴权失败(${status})，请检查服务端推送配置`);
        }
        if (pushError.code === "ETIMEDOUT" || /timeout|timed out/i.test(pushError.message || "")) {
          throw new BridgeError(504, "PUSH_GATEWAY_TIMEOUT", "连接推送网关超时，请稍后重试");
        }
        throw new BridgeError(502, "PUSH_DELIVERY_FAILED", "推送服务未接受测试通知，请稍后重试");
      }
      return NextResponse.json({
        success: true, sent: 1, failed: 0,
        message: "推送服务已接受测试通知，请查看系统通知栏",
      }, { headers: { "cache-control": "no-store" } });
    }

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
    if (GROWDESK_CONFIG.enabled) return bridgeErrorResponse(error);
    console.error("POST /api/push/test error:", error);
    return NextResponse.json(
      { error: "发送测试推送失败" },
      { status: 500 }
    );
  }
}
