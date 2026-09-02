import assert from "node:assert/strict";
import test from "node:test";
import { notifyFamilyMembers, getFamilyMemberLabel } from "@/lib/push-helper";

test("Family Push: notifyFamilyMembers gracefully handles unconfigured VAPID keys", async () => {
  const result = await notifyFamilyMembers({
    familyId: "non-existent-family",
    title: "测试通知",
    body: "这是一条测试消息",
  });
  assert.strictEqual(typeof result.sent, "number");
  assert.strictEqual(typeof result.failed, "number");
});

test("Family Member: getFamilyMemberLabel falls back safely", async () => {
  const label = await getFamilyMemberLabel("test_fam_1", "test_user_1");
  assert.strictEqual(typeof label, "string");
  assert.ok(label.length > 0, "should return a valid string label");
});

test("Notifications Route: exports GET and NotificationItem types", async () => {
  const mod = await import("@/app/api/notifications/route");
  assert.strictEqual(typeof mod.GET, "function", "GET handler should be exported");
});

test("Push Test Route: exports POST handler", async () => {
  const mod = await import("@/app/api/push/test/route");
  assert.strictEqual(typeof mod.POST, "function", "POST handler should be exported");
});

test("Notifications Storage: exports persistence and calculation helpers", async () => {
  const storage = await import("@/lib/notifications-storage");
  assert.strictEqual(typeof storage.getReadNotificationIds, "function");
  assert.strictEqual(typeof storage.getClearedNotificationIds, "function");
  assert.strictEqual(typeof storage.filterVisibleNotifications, "function");
  assert.strictEqual(typeof storage.calculateUnreadCount, "function");
  const filtered = storage.filterVisibleNotifications([{ id: "1" }, { id: "2" }]);
  assert.strictEqual(filtered.length, 2);
});


