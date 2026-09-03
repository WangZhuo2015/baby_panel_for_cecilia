import webPush from "web-push";
import { prisma } from "@/lib/prisma";
import { PUSH_CONFIG } from "@/lib/config";

export interface NotifyFamilyOptions {
  familyId: string;
  excludeUserId?: string;
  title: string;
  body: string;
  url?: string;
}

const RELATION_NAMES: Record<string, string> = {
  mother: "妈妈",
  father: "爸爸",
  grandparent: "长辈",
  caregiver: "月嫂/阿姨",
  parent: "家长",
  other: "家人",
};

/**
 * 获取家庭成员在当前家庭中的称谓
 */
export async function getFamilyMemberLabel(familyId: string, userId: string): Promise<string> {
  try {
    const member = await prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId, userId } },
      include: { user: { select: { displayName: true, username: true } } },
    });
    if (!member) return "家人";
    const rel = RELATION_NAMES[member.relation] || "家人";
    const name = member.user?.displayName || member.user?.username;
    return name ? `${rel} (${name})` : rel;
  } catch {
    return "家人";
  }
}

/**
 * 给家庭中其他成员发送 Web Push 推送通知（后台异步执行，不阻塞业务主流程）
 */
export async function notifyFamilyMembers(options: NotifyFamilyOptions): Promise<{ sent: number; failed: number }> {
  const { familyId, excludeUserId, title, body, url = "/notifications" } = options;

  if (!PUSH_CONFIG.publicKey || !PUSH_CONFIG.privateKey) {
    return { sent: 0, failed: 0 };
  }

  try {
    const members = await prisma.familyMember.findMany({
      where: {
        familyId,
        ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      },
      select: { userId: true },
    });

    const userIds = members.map((m) => m.userId);
    if (userIds.length === 0) return { sent: 0, failed: 0 };

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
    });

    if (subscriptions.length === 0) return { sent: 0, failed: 0 };

    webPush.setVapidDetails(
      PUSH_CONFIG.subject,
      PUSH_CONFIG.publicKey,
      PUSH_CONFIG.privateKey
    );

    const payload = JSON.stringify({
      title,
      body,
      url,
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
          await webPush.sendNotification(pushSub, payload, { urgency: "high" });
          sent++;
        } catch (err) {
          const statusCode = (err as webPush.WebPushError)?.statusCode;
          const body = (err as webPush.WebPushError)?.body;
          console.error("[PushHelper] notifyFamilyMembers error for sub:", {
            subId: sub.id,
            endpoint: sub.endpoint.slice(0, 60),
            statusCode,
            body,
            message: (err as any)?.message,
          });
          // 仅 404 (Not Found) 或 410 (Gone) 表明客户端订阅失效，401/403 为服务端鉴权错误切勿误删
          if (statusCode === 404 || statusCode === 410) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          }
          failed++;
        }
      })
    );

    return { sent, failed };
  } catch (error) {
    console.error("[PushHelper] notifyFamilyMembers error:", error);
    return { sent: 0, failed: 0 };
  }
}
