import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createAuthSlice } from "../../stores/slices/auth";
import { createRecordsSlice } from "../../stores/slices/records";
import { invalidateCache } from "../../stores/slices/helpers";
import { createIdentityEndpoints } from "../../lib/growdesk/bridge-endpoints";
import { registerBffSession, loginBffSession } from "../../lib/growdesk/session";
import { uploadAttachment } from "../../lib/growdesk/attachment-bridge";
import { GROWDESK_CONFIG } from "../../lib/config";

const user = { id: "test_user", username: "test_user", displayName: "test_user" };
const families = [{ id: "test_family_a", name: "test_home_a", babies: [] }, { id: "test_family_b", name: "test_home_b", babies: [] }];
const apiBaby = { id: "test_baby", familyId: "test_family_b", name: "test_child", birthDate: "2026-01-02", gender: "girl" };
function store() {
  const state: any = {};
  const set = (update: any) => Object.assign(state, update);
  Object.assign(state, createAuthSlice(set, () => state), createRecordsSlice(set, () => state), { user, families, family: families[0], authLoading: false });
  return state;
}

// Execute the actual UI event-handler body with explicit hook bindings. No DOM,
// service, database, or network is needed to verify its outgoing payload.
function onboardingHandler(name: string, bindings: Record<string, unknown>, page = "onboarding") {
  const source = fs.readFileSync(new URL(`../../app/${page}/page.tsx`, import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, `UI handler ${name} exists`);
  const compiled = ts.transpile(`const handler = ${expression.getText(ast)};`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
  return new Function(...Object.keys(bindings), `${compiled}\nreturn handler;`)(...Object.values(bindings));
}

function mockJoin(t: any) {
  t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/family/join"
    ? Response.json({ family: families[1], families, babies: [], baby: null, message: "已加入家庭。现有宝宝需要家庭成员进一步授权后才可访问。" })
    : Response.json({ family: families[1], members: [{ id: "test_member", userId: user.id, displayName: "test_user" }] }));
}

test("I1 join preserves the logged-in user while clearing invalid baby scope", async (t) => {
  invalidateCache();
  const state = store();
  state.baby = { id: "test_old_baby" };
  state.selectedBabyId = "test_old_baby";
  state.feedingRecords = [{ id: "test_old_record" }];
  mockJoin(t);
  await state.joinFamily("test_invite");
  assert.equal(state.user, user, "joining must retain the current user identity");
  assert.equal(state.family.id, "test_family_b");
  assert.equal(state.baby, null);
  assert.equal(state.selectedBabyId, null);
  assert.deepEqual(state.feedingRecords, []);
  assert.deepEqual(state.babies, []);
  assert.equal(state.families.length, 2);
  assert.equal(state.familyMembers[0].id, "test_member");
});

test("I5 join exposes the baby-authorization message to its caller", async (t) => {
  const state = store();
  mockJoin(t);
  const result = await state.joinFamily("test_invite");
  assert.equal(result?.message, "已加入家庭。现有宝宝需要家庭成员进一步授权后才可访问。", "join must return the authorization guidance");
});

test("I2 mixed-case registration then login uses one lowercase BFF username", async (t) => {
  const accounts = new Map<string, any>();
  const sentNames: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === "/api/v1/auth/register") {
      sentNames.push(body.username);
      const registered = { ...user, username: body.username };
      accounts.set(body.username, registered);
      return Response.json({ data: { accessToken: "test_registration_token", user: registered } });
    }
    if (path === "/api/v1/auth/bff/session") {
      if (init?.method === "DELETE") return Response.json({ data: {} });
      sentNames.push(body.username);
      // Match the upstream case-sensitive account lookup after BFF lowercasing.
      const found = accounts.get(body.username.trim().toLowerCase());
      return found ? Response.json({ data: { accessToken: "test_token", user: found } })
        : Response.json({ error: { code: "INVALID_CREDENTIALS", message: "test username mismatch" } }, { status: 401 });
    }
    if (path === "/api/v1/auth/logout") return Response.json({ data: {} });
    if (path === "/api/v1/families") return Response.json({ data: families });
    if (path.endsWith("/babies")) return Response.json({ data: [] });
    throw new Error(`Unexpected mocked request ${path}`);
  });
  const registered = await registerBffSession({ username: " test_MixedCase ", password: "test_password", displayName: "test_MixedCase" });
  assert.equal(registered.success, true, "mixed-case registration must bind a usable BFF session");
  const loggedIn = await loginBffSession(" test_MIXEDCase ", "test_password");
  assert.equal(loggedIn.success, true);
  assert.equal(loggedIn.user?.id, registered.user?.id);
  assert.equal(loggedIn.user?.username, "test_mixedcase");
  assert.deepEqual(sentNames, ["test_mixedcase", "test_mixedcase", "test_mixedcase"]);
});

for (const familyCount of [1, 2]) test(`I3 onboarding creation derives the family from the real UI initializer (${familyCount} families)`, async (t) => {
  const variantFamilies = familyCount === 1 ? [families[0]] : families;
  // Exercise the actual component initializer: no injected target.
  const targetFamilyId = uiTargetFamilyId({ baby: null, families: variantFamilies, selectedFamilyId: familyCount === 2 ? "test_family_b" : "" });
  const state = store();
  let createdPath = "";
  const endpoints = createIdentityEndpoints({
    resolveSession: async () => ({ accessToken: "test_token", user }), verifyCsrf: () => null,
    fetchApi: (async (path: string, options: any) => {
      if (options?.method === "POST") { createdPath = path; return { ok: true, status: 201, data: { ...apiBaby, familyId: targetFamilyId } }; }
      return { ok: true, status: 200, data: variantFamilies };
    }) as any,
  });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => endpoints.baby(new Request(`https://test.invalid${url}`, init)));
  const errors: string[] = [];
  const save = onboardingHandler("handleSave", {
    nickname: "test_child", birthDate: "2026-01-02", gender: "female", gestationalAge: "", avatarUrl: null,
    baby: null, targetFamilyId,
    saveBaby: state.saveBaby, fetchUser: async () => user,
    setSaving: () => {}, setCreatedBabyName: () => {}, setIsShareModalOpen: () => {},
    showToast: (message: string, kind: string) => { if (kind === "error") errors.push(message); },
  });
  await save();
  assert.deepEqual(errors, [], "selected-family onboarding must not hit FAMILY_SELECTION_REQUIRED");
  assert.equal(createdPath, `/api/v1/families/${targetFamilyId}/babies`);
  assert.equal(state.baby.familyId, targetFamilyId);
});

test("I3 ambiguous two-family onboarding without a selection reports FAMILY_SELECTION_REQUIRED before any request", async (t) => {
  // Genuinely ambiguous: two families, no selection — the initializer yields undefined.
  const targetFamilyId = uiTargetFamilyId({ baby: null, families, selectedFamilyId: "" });
  assert.equal(targetFamilyId, undefined, "two families with no selection must stay ambiguous in the UI initializer");
  const state = store();
  let requested = false;
  const endpoints = createIdentityEndpoints({
    resolveSession: async () => ({ accessToken: "test_token", user }), verifyCsrf: () => null,
    fetchApi: (async () => { requested = true; return { ok: true, status: 200, data: families }; }) as any,
  });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => endpoints.baby(new Request(`https://test.invalid${url}`, init)));
  const errors: string[] = [];
  const save = onboardingHandler("handleSave", {
    nickname: "test_child", birthDate: "2026-01-02", gender: "female", gestationalAge: "", avatarUrl: null,
    baby: null, targetFamilyId,
    saveBaby: state.saveBaby, fetchUser: async () => user,
    setSaving: () => {}, setCreatedBabyName: () => {}, setIsShareModalOpen: () => {},
    showToast: (message: string, kind: string) => { if (kind === "error") errors.push(message); },
  });
  await save();
  assert.deepEqual(errors, ["请选择宝宝所属家庭"], "ambiguous selection must surface the family-selection error");
  assert.equal(requested, false, "no baby creation request may leave the client while ambiguous");
});

// Compile the real targetFamilyId initializer from the onboarding page instead of injecting a value.
function uiTargetFamilyId(bindings: Record<string, unknown>) {
  const source = fs.readFileSync(new URL("../../app/onboarding/page.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "targetFamilyId") expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, "targetFamilyId initializer exists");
  const compiled = ts.transpile(`const target = ${expression.getText(ast)};`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
  return new Function(...Object.keys(bindings), `${compiled}\nreturn target;`)(...Object.values(bindings));
}

for (const familyCount of [1, 2]) test(`I4 onboarding avatar upload scopes creation to the derived family (${familyCount} families)`, async (t) => {
  const variantFamilies = familyCount === 1 ? [families[0]] : families;
  const targetFamilyId = uiTargetFamilyId({ baby: null, families: variantFamilies, selectedFamilyId: familyCount === 2 ? "test_family_b" : "" });
  const calls: { path: string; method?: string; body: any }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/baby/avatar") return uploadAttachment(new Request("https://test.invalid/api/baby/avatar", {
      ...init, headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}` },
    }), "avatar");
    const path = new URL(url).pathname;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, method: init?.method, body });
    if (path === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_token", user } });
    if (path === "/api/v1/families") return Response.json({ data: variantFamilies });
    if (path === "/api/v1/babies/test_baby") return Response.json({ data: apiBaby });
    if (path === "/api/v1/attachments") return Response.json({ data: { id: "test_attachment", uploadUrl: "https://test.invalid/test_upload" } });
    if (path === "/test_upload" || path.endsWith("/complete")) return Response.json({ data: {} });
    throw new Error(`Unexpected mocked request ${path}`);
  });
  const errors: string[] = [];
  let avatar: string | undefined;
  const handler = onboardingHandler("handleCropComplete", {
    baby: null,
    targetFamilyId,
    setIsCropModalOpen: () => {}, setAvatarUploading: () => {}, setAvatarUrl: (value: string) => { avatar = value; },
    useBabyStore: { getState: () => ({ fetchBaby: async () => {} }) },
    showToast: (message: string, kind: string) => { if (kind === "error") errors.push(message); },
  }, "onboarding");
  await handler(new Blob([Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: "image/jpeg" }));
  assert.deepEqual(errors, [], "avatar upload must not hit FAMILY_SELECTION_REQUIRED");
  assert.equal(avatar, "/api/attachments/test_attachment");
  assert.deepEqual(calls.find(c => c.path === "/api/v1/attachments")?.body.ownerScope,
    { familyId: targetFamilyId });
});

test("I4 editing an existing baby patches the explicit baby avatar", async (t) => {
  const calls: { path: string; method?: string; body: any }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/baby/avatar") return uploadAttachment(new Request("https://test.invalid/api/baby/avatar", {
      ...init, headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}` },
    }), "avatar");
    const path = new URL(url).pathname;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, method: init?.method, body });
    if (path === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_token", user } });
    if (path === "/api/v1/families") return Response.json({ data: families });
    if (path === "/api/v1/babies/test_baby") return Response.json({ data: apiBaby });
    if (path === "/api/v1/attachments") return Response.json({ data: { id: "test_attachment", uploadUrl: "https://test.invalid/test_upload" } });
    if (path === "/test_upload" || path.endsWith("/complete")) return Response.json({ data: {} });
    throw new Error(`Unexpected mocked request ${path}`);
  });
  const errors: string[] = [];
  let avatar: string | undefined;
  const handler = onboardingHandler("handleCropComplete", {
    baby: { id: "test_baby", familyId: "test_family_b" },
    targetFamilyId: "test_family_b",
    setIsCropModalOpen: () => {}, setAvatarUploading: () => {}, setAvatarUrl: (value: string) => { avatar = value; },
    useBabyStore: { getState: () => ({ fetchBaby: async () => {} }) },
    showToast: (message: string, kind: string) => { if (kind === "error") errors.push(message); },
  }, "onboarding");
  await handler(new Blob([Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: "image/jpeg" }));
  assert.deepEqual(errors, []);
  assert.equal(avatar, "/api/attachments/test_attachment");
  assert.deepEqual(calls.find(c => c.path === "/api/v1/attachments")?.body.ownerScope,
    { familyId: "test_family_b", babyId: "test_baby" });
  const patches = calls.filter(c => c.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0], { path: "/api/v1/babies/test_baby", method: "PATCH", body: { avatarUrl: "/api/attachments/test_attachment" } });
});

test("I4 switching the creation family after an upload must not submit the previous family's avatar", async (t) => {
  // Reproduces the adversarial-review scenario: upload under family A, then select family B, then save.
  let avatarUrl: string | null = null;
  let uploadedFamily: unknown;
  let submitted: any;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    uploadedFamily = (init?.body as FormData).get("familyId");
    return Response.json({ avatarUrl: "/api/attachments/test_avatar_a" });
  });
  let selectedFamilyId = "test_family_a";
  const crop = onboardingHandler("handleCropComplete", {
    baby: null, targetFamilyId: selectedFamilyId,
    setIsCropModalOpen: () => {}, setAvatarUploading: () => {}, setAvatarUrl: (v: string) => { avatarUrl = v; },
    useBabyStore: { getState: () => ({ fetchBaby: async () => {} }) },
    showToast: () => {},
  });
  await crop(new Blob(["test_image"], { type: "image/jpeg" }));
  assert.equal(uploadedFamily, "test_family_a");
  assert.equal(avatarUrl, "/api/attachments/test_avatar_a");
  // The real selector onChange from the page must drop the out-of-scope avatar.
  const select = onboardingHandler("handleFamilyChange", {
    selectedFamilyId: "test_family_a",
    setSelectedFamilyId: (v: string) => { selectedFamilyId = v; },
    setAvatarUrl: (v: string | null) => { avatarUrl = v; },
  });
  select("test_family_b");
  assert.equal(selectedFamilyId, "test_family_b");
  assert.equal(avatarUrl, null, "changing the creation family must clear an avatar scoped to the previous family");
  const save = onboardingHandler("handleSave", {
    nickname: "test_child", birthDate: "2026-01-02", gender: "female", gestationalAge: "", avatarUrl,
    baby: null, targetFamilyId: selectedFamilyId, saveBaby: async (data: any) => { submitted = data; },
    fetchUser: async () => {}, setSaving: () => {}, setCreatedBabyName: () => {}, setIsShareModalOpen: () => {}, showToast: () => {},
  });
  await save();
  assert.equal(submitted.familyId, "test_family_b");
  assert.equal(submitted.avatarUrl, undefined, "family B creation must not submit an avatar owned by family A");
});

test("I4 an upload completing after the family selection changed must be discarded", async (t) => {
  // Selection changes while the upload is in flight; the stale result must not land in state.
  let avatarUrl: string | null = null;
  let resolveUpload: (response: Response) => void = () => {};
  const uploadPromise = new Promise<Response>((resolve) => { resolveUpload = resolve; });
  t.mock.method(globalThis, "fetch", async () => uploadPromise);
  const selectedFamilyId = "test_family_a";
  const selectedFamilyRef = { current: "test_family_a" };
  const crop = onboardingHandler("handleCropComplete", {
    baby: null, targetFamilyId: selectedFamilyId, selectedFamilyRef,
    setIsCropModalOpen: () => {}, setAvatarUploading: () => {}, setAvatarUrl: (v: string | null) => { avatarUrl = v; },
    useBabyStore: { getState: () => ({ fetchBaby: async () => {} }) },
    showToast: () => {},
  });
  const pending = crop(new Blob(["test_image"], { type: "image/jpeg" }));
  // User switches families while the upload is still in flight.
  selectedFamilyRef.current = "test_family_b";
  resolveUpload(Response.json({ avatarUrl: "/api/attachments/test_avatar_a" }));
  await pending;
  assert.equal(avatarUrl, null, "a stale upload scoped to the previous family must never reach state");
});
