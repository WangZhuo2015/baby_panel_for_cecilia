import test from "node:test";
import assert from "node:assert/strict";
import { matchesReplayIdentity, resolveReplayIdentity } from "../../lib/outbox-replay-identity";

test("online replay revalidates a missing identity and uses the newly verified scopes", async () => {
  let state: any = {
    user: null,
    family: null,
    baby: null,
    selectedBabyId: null,
    fetchUser: async () => {
      state = {
        ...state,
        user: { id: "test_user" },
        family: { id: "test_family" },
        baby: { id: "test_baby", familyId: "test_family" },
        selectedBabyId: "test_baby",
      };
    },
  };
  assert.deepEqual(await resolveReplayIdentity(() => state), {
    userId: "test_user",
    familyId: "test_family",
    babyId: "test_baby",
  });
});

test("online replay rejects incomplete or cross-scope identity after revalidation", async () => {
  const state: any = {
    user: { id: "test_user" },
    family: { id: "test_family" },
    baby: { id: "test_baby", familyId: "test_other_family" },
    selectedBabyId: "test_baby",
    fetchUser: async () => assert.fail("an existing user must not be replaced"),
  };
  assert.equal(await resolveReplayIdentity(() => state), null);
});

test("the replay identity matcher observes account and baby switches", () => {
  const identity = { userId: "test_user", familyId: "test_family", babyId: "test_baby" };
  const state: any = {
    user: { id: "test_user" }, family: { id: "test_family" },
    baby: { id: "test_baby", familyId: "test_family" }, selectedBabyId: "test_baby",
    fetchUser: async () => {},
  };
  assert.equal(matchesReplayIdentity(() => state, identity), true);
  state.selectedBabyId = "test_other_baby";
  assert.equal(matchesReplayIdentity(() => state, identity), false);
});
