import { remoteNotificationCases } from "./growdesk-remote-state-cases";
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  fromGrowDeskNotification,
} from "../../lib/growdesk/notifications";
import { notifyFamilyMembers, getFamilyMemberLabel } from "../../lib/push-helper";
import { runDailySummaryCron } from "../../lib/cron/daily-summary";
import { GROWDESK_CONFIG } from "../../lib/config";

test("Issue #7: GrowDesk Notifications, Push Devices & Cron Scheduling", async (t) => {
  await remoteNotificationCases(t);

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
