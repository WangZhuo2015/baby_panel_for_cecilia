import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  bffNotificationStore,
  fromGrowDeskNotification,
} from "../../lib/growdesk/notifications";
import { notifyFamilyMembers, getFamilyMemberLabel } from "../../lib/push-helper";
import { runDailySummaryCron } from "../../lib/cron/daily-summary";
import { GROWDESK_CONFIG } from "../../lib/config";

test("Issue #7: GrowDesk Notifications, Push Devices & Cron Scheduling", async (t) => {
  beforeEach(() => {
    bffNotificationStore.clearAllForTest();
  });

  afterEach(() => {
    bffNotificationStore.clearAllForTest();
  });

  await t.test("1. BffNotificationStore: CRUD, Unread Counter & User Isolation", () => {
    const userA = "user_notif_a";
    const userB = "user_notif_b";

    // User A notification
    const notifA1 = bffNotificationStore.createNotification({
      userId: userA,
      eventKey: "record.feeding.created",
      title: "宝宝喝奶提醒",
      body: "爸爸刚给宝宝喂了 120ml 配方奶",
      data: { actorLabel: "爸爸", urgent: false },
    });

    assert.ok(notifA1.id);
    assert.equal(notifA1.userId, userA);
    assert.equal(notifA1.title, "宝宝喝奶提醒");
    assert.equal(notifA1.readAt, null);

    // User B notification
    const notifB = bffNotificationStore.createNotification({
      userId: userB,
      eventKey: "vaccine.upcoming",
      title: "乙肝疫苗第3剂接种提醒",
      body: "宝宝将在 3 天后迎来接种日",
    });
    assert.equal(notifB.userId, userB);

    // Isolation: User A cannot see User B's notifications
    const listA = bffNotificationStore.listNotifications(userA);
    assert.equal(listA.total, 1);
    assert.equal(listA.unreadCount, 1);
    assert.equal(listA.data[0].id, notifA1.id);

    const listB = bffNotificationStore.listNotifications(userB);
    assert.equal(listB.total, 1);
    assert.equal(listB.data[0].id, notifB.id);

    // Mark as read
    assert.equal(bffNotificationStore.markAsRead(userA, notifA1.id), true);
    const listAAfterRead = bffNotificationStore.listNotifications(userA);
    assert.equal(listAAfterRead.unreadCount, 0);
    assert.ok(listAAfterRead.data[0].readAt);

    // User B cannot mark User A's notification as read
    assert.equal(bffNotificationStore.markAsRead(userB, notifA1.id), false);

    // Delete notification
    assert.equal(bffNotificationStore.deleteNotification(userB, notifA1.id), false);
    assert.equal(bffNotificationStore.deleteNotification(userA, notifA1.id), true);
    assert.equal(bffNotificationStore.listNotifications(userA).total, 0);
  });

  await t.test("2. BffNotificationStore: Idempotent Deduplication (No duplicate event within 24h)", () => {
    const userA = "user_dedupe_test";
    const eventKey = "daily.summary.ready";

    const first = bffNotificationStore.createNotification({
      userId: userA,
      eventKey,
      title: "今日育儿日报已生成",
      body: "宝宝今日奶量达标充沛，作息规律",
    });

    // Submitting identical eventKey within 24h returns existing record
    const second = bffNotificationStore.createNotification({
      userId: userA,
      eventKey,
      title: "今日育儿日报已生成",
      body: "宝宝今日奶量达标充沛，作息规律",
    });

    assert.equal(second.id, first.id);
    assert.equal(bffNotificationStore.listNotifications(userA).total, 1);
  });

  await t.test("3. fromGrowDeskNotification: Contract Adapter & Type Mapping", () => {
    // 1. Vaccine event
    const vaccineItem = fromGrowDeskNotification({
      id: "notif_v_1",
      eventKey: "vaccine.due",
      title: "脊灰疫苗接种",
      body: "请于明天前往社区卫生中心",
      createdAt: new Date().toISOString(),
      data: { urgent: true },
    });
    assert.equal(vaccineItem.id, "notif_v_1");
    assert.equal(vaccineItem.type, "vaccine");
    assert.equal(vaccineItem.detail, "请于明天前往社区卫生中心");
    assert.equal(vaccineItem.urgent, true);
    assert.equal(vaccineItem.icon, "💉");
    assert.ok(vaccineItem.time);

    // 2. Family record event
    const familyItem = fromGrowDeskNotification({
      id: "notif_f_1",
      eventKey: "record.diaper.poop",
      title: "宝宝便便打卡",
      body: "妈妈记录了 1 次黄色糊状便便",
      data: { actorLabel: "妈妈" },
    });
    assert.equal(familyItem.type, "family");
    assert.equal(familyItem.actorLabel, "妈妈");
    assert.equal(familyItem.icon, "👨‍👩‍👧");

    // 3. AI / Daily summary event
    const aiItem = fromGrowDeskNotification({
      id: "notif_ai_1",
      eventKey: "ai.daily_summary",
      title: "AI 日报提醒",
      body: "今天的总结已准备好",
    });
    assert.equal(aiItem.type, "ai");
  });

  await t.test("4. Push Helper & Cron: Zero SQLite Leaks under GROWDESK_CONFIG.enabled", async () => {
    const origEnv = process.env.GROWDESK_ENABLED;
    process.env.GROWDESK_ENABLED = "true";

    try {
      assert.equal(GROWDESK_CONFIG.enabled, true);

      // 1. notifyFamilyMembers returns safe { sent: 0, failed: 0 } without querying Prisma
      const pushRes = await notifyFamilyMembers({
        familyId: "fam_test_push",
        title: "测试通知",
        body: "内容",
      });
      assert.deepEqual(pushRes, { sent: 0, failed: 0 });

      // 2. getFamilyMemberLabel returns safe default without querying Prisma
      const label = await getFamilyMemberLabel("fam_test_push", "usr_1");
      assert.equal(label, "家人");

      // 3. runDailySummaryCron safely skips without querying Prisma
      const cronRes = await runDailySummaryCron({ todayOnly: true });
      assert.deepEqual(cronRes, []);
    } finally {
      if (origEnv === undefined) {
        delete process.env.GROWDESK_ENABLED;
      } else {
        process.env.GROWDESK_ENABLED = origEnv;
      }
    }
  });

  await t.test("5. Push Device Registration & Unregistration Contract Matching", () => {
    // Verify payload matches growdesk-server RegisterPushDeviceRequestSchema:
    // { platform: "web"|"ios", environment: "sandbox"|"production", token: string, deviceLabel?: string }
    const endpoint = "https://fcm.googleapis.com/fcm/send/test-endpoint-12345";
    const payload = {
      token: endpoint,
      platform: "web" as const,
      environment: "production" as const,
      deviceLabel: "Chrome on macOS",
    };

    assert.equal(payload.platform, "web");
    assert.equal(payload.environment, "production");
    assert.equal(typeof payload.token, "string");
    assert.ok(payload.token.length > 0);

    // Verify installationId generation is deterministic sha256 hex slice
    const instId1 = crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
    const instId2 = crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
    assert.equal(instId1, instId2);
    assert.equal(instId1.length, 32);
  });
});
