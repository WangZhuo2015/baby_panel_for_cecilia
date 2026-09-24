import test from "node:test";
import assert from "node:assert/strict";
import { verifiedOutboxIdentity } from "../../stores/slices/records";

const complete = {
  user: { id: "test_user" },
  family: { id: "test_family" },
  baby: { id: "test_baby", familyId: "test_family" },
  selectedBabyId: "test_baby",
};

test("offline writes bind all three verified identity scopes", () => {
  assert.deepEqual(verifiedOutboxIdentity(() => complete), {
    userId: "test_user",
    familyId: "test_family",
    babyId: "test_baby",
  });
});

test("offline writes never create an orphan while authenticated identity is absent", () => {
  assert.throws(
    () => verifiedOutboxIdentity(() => ({ ...complete, user: null })),
    /身份尚未加载完成/,
  );
  assert.throws(
    () => verifiedOutboxIdentity(() => ({ ...complete, family: null })),
    /身份尚未加载完成/,
  );
});

test("offline writes reject a family or baby switch in progress", () => {
  assert.throws(
    () => verifiedOutboxIdentity(() => ({ ...complete, selectedBabyId: "test_other_baby" })),
    /宝宝正在切换/,
  );
  assert.throws(
    () => verifiedOutboxIdentity(() => ({ ...complete, baby: { ...complete.baby, familyId: "test_other_family" } })),
    /宝宝所属家庭正在切换/,
  );
});
