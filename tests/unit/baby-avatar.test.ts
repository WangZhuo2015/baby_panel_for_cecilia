import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { POST as uploadAvatar } from "@/app/api/baby/avatar/route";
import { POST as createBaby, PUT as updateBaby } from "@/app/api/baby/route";
import { prisma } from "@/lib/prisma";
import { createTestTenant, destroyTestTenant, type TestTenant } from "../helpers/tenant";

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2foAAAAASUVORK5CYII=", "base64");
const babyDetails = { nickname: "test_baby_new", gender: "female", birthDate: "2025-06-01" };

async function tenant(t: TestContext, tag: string) {
  const data = await createTestTenant(prisma, tag);
  t.after(() => destroyTestTenant(prisma, data.username));
  return data;
}

async function avatarDirectory(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "baby-avatar-test-"));
  t.mock.method(process, "cwd", () => directory);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "public", "uploads", "avatars");
}

function upload(tenant: TestTenant, scope: Record<string, string> = {}) {
  const body = new FormData();
  body.set("file", new Blob([image], { type: "image/png" }), "test_avatar.png");
  for (const [key, value] of Object.entries(scope)) body.set(key, value);
  return uploadAvatar(new Request("http://localhost/api/baby/avatar", {
    method: "POST", headers: { Authorization: tenant.headers.Authorization }, body,
  }));
}

function create(tenant: TestTenant, familyId: string, avatarUrl: string) {
  return createBaby(new Request("http://localhost/api/baby", {
    method: "POST", headers: tenant.headers, body: JSON.stringify({ ...babyDetails, familyId, avatarUrl }),
  }));
}

test("local avatar upload updates the requested baby and keeps legacy single-baby uploads working", async (t) => {
  const owner = await tenant(t, "avatar_edit");
  const foreign = await tenant(t, "avatar_foreign");
  const directory = await avatarDirectory(t);

  const legacy = await upload(owner);
  assert.equal(legacy.status, 200);
  const { avatarUrl: originalAvatar } = await legacy.json();

  const sibling = await prisma.baby.create({ data: { ...babyDetails, familyId: owner.familyId } });
  const targeted = await upload(owner, { babyId: sibling.id });
  assert.equal(targeted.status, 200);
  const { avatarUrl } = await targeted.json();
  assert.deepEqual(await readFile(path.join(directory, path.basename(avatarUrl))), image);

  const denied = await upload(owner, { babyId: foreign.babyId });
  assert.equal(denied.status, 403);
  const missing = await upload(owner, { babyId: randomUUID() });
  assert.equal(missing.status, 404);
  const ambiguous = await upload(owner);
  assert.equal(ambiguous.status, 409);
  assert.equal((await readdir(directory)).length, 2);

  const saved = await prisma.baby.findMany({ where: { id: { in: [owner.babyId, sibling.id, foreign.babyId] } } });
  assert.equal(saved.find(({ id }) => id === owner.babyId)?.avatarUrl, originalAvatar);
  assert.equal(saved.find(({ id }) => id === sibling.id)?.avatarUrl, avatarUrl);
  assert.equal(saved.find(({ id }) => id === foreign.babyId)?.avatarUrl, null);
});

test("local creation avatars bind to the authenticated uploader and the selected family", async (t) => {
  const owner = await tenant(t, "avatar_creation");
  const other = await tenant(t, "avatar_other");
  const [selected, alternative] = await Promise.all(["selected", "alternative"].map((label) => prisma.family.create({
    data: {
      name: `test_family_avatar_${label}`, inviteCode: randomUUID(),
      members: { create: [owner, other].map(({ userId }) => ({ userId, role: "admin" })) },
    },
  })));
  const directory = await avatarDirectory(t);

  assert.equal((await upload(owner, { familyId: other.familyId })).status, 403);
  const response = await upload(owner, { familyId: selected.id });
  assert.equal(response.status, 200);
  const { avatarUrl } = await response.json();
  assert.deepEqual(await readFile(path.join(directory, path.basename(avatarUrl))), image);
  const original = await prisma.baby.findUniqueOrThrow({ where: { id: owner.babyId } });
  assert.equal(original.avatarUrl, null);

  assert.equal((await create(owner, alternative.id, avatarUrl)).status, 403);
  assert.equal((await create(other, selected.id, avatarUrl)).status, 403);
  assert.equal((await create(owner, selected.id, avatarUrl.replace("pending_", "%70ending_"))).status, 403);
  assert.equal((await create(owner, selected.id, "/uploads/medical/existing.png")).status, 403);
  const created = await create(owner, selected.id, avatarUrl);
  assert.equal(created.status, 201);
  const baby = await created.json();
  assert.equal(baby.familyId, selected.id);
  assert.equal(baby.avatarUrl, avatarUrl);
  assert.equal((await create(owner, selected.id, avatarUrl)).status, 409);
});

test("an existing baby can keep an older avatar when updating its profile", async (t) => {
  const owner = await tenant(t, "avatar_profile");
  const avatarUrl = "/uploads/avatars/test_older_avatar.jpg";
  await prisma.baby.update({ where: { id: owner.babyId }, data: { avatarUrl } });
  const updated = await updateBaby(new Request("http://localhost/api/baby", {
    method: "PUT", headers: owner.headers, body: JSON.stringify({ ...babyDetails, babyId: owner.babyId, avatarUrl }),
  }));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).avatarUrl, avatarUrl);
});
