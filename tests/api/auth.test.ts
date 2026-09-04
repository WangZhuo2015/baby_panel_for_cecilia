import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { destroyTestTenant } from "../helpers/tenant";

const BASE_URL = process.env.BABY_PANEL_URL || "http://127.0.0.1:3089";

test("API: Authentication Flow (Register, Login, Me, Logout)", async (t) => {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const testUsername = `test_${stamp}_${rand}_auth_user`;
  const testPassword = `Pass#${stamp}_Secure`;
  const testDisplayName = `test_family_${stamp}`;

  let createdUserId: string | undefined;
  let createdFamilyId: string | undefined;

  t.after(async () => {
    if (createdUserId) {
      await prisma.user.deleteMany({ where: { id: createdUserId } }).catch(() => {});
    } else {
      await destroyTestTenant(prisma, testUsername);
    }
    if (createdFamilyId) {
      await prisma.family.deleteMany({ where: { id: createdFamilyId } }).catch(() => {});
    }
  });

  // -------------------------------------------------------------------------
  // 1. Validation Failures on Register
  // -------------------------------------------------------------------------
  console.log("-> Testing Register validation...");
  const resShortPass = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: testUsername,
      password: "123", // too short (< 8)
    }),
  });
  assert.equal(resShortPass.status, 400);
  const jsonShortPass = await resShortPass.json();
  assert.ok(jsonShortPass.error.includes("8 位"));

  const resShortUser = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "ab", // too short (< 3)
      password: testPassword,
    }),
  });
  assert.equal(resShortUser.status, 400);

  // -------------------------------------------------------------------------
  // 2. Successful Registration
  // -------------------------------------------------------------------------
  console.log("-> Testing Register success...");
  const resReg = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: testUsername,
      password: testPassword,
      displayName: testDisplayName,
      relation: "father",
    }),
  });
  assert.equal(resReg.status, 201, "Register should return 201 Created");
  const jsonReg = await resReg.json();
  assert.equal(jsonReg.user.username, testUsername);
  assert.ok(jsonReg.family?.id, "Register should create a primary family");

  createdUserId = jsonReg.user.id;
  createdFamilyId = jsonReg.family?.id;

  // -------------------------------------------------------------------------
  // 3. Duplicate Username Conflict (409)
  // -------------------------------------------------------------------------
  console.log("-> Testing Duplicate Username...");
  const resDup = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: testUsername,
      password: testPassword,
    }),
  });
  assert.equal(resDup.status, 409);

  // -------------------------------------------------------------------------
  // 4. Login with Wrong Password (401)
  // -------------------------------------------------------------------------
  console.log("-> Testing Login with wrong password...");
  const resWrongLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: testUsername,
      password: "WrongPassword_999",
    }),
  });
  assert.equal(resWrongLogin.status, 401);

  // -------------------------------------------------------------------------
  // 5. Login Success
  // -------------------------------------------------------------------------
  console.log("-> Testing Login success...");
  const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: testUsername,
      password: testPassword,
    }),
  });
  assert.equal(resLogin.status, 200);
  const jsonLogin = await resLogin.json();
  assert.equal(jsonLogin.user.username, testUsername);

  const cookieHeader = resLogin.headers.get("set-cookie") || "";
  const match = cookieHeader.match(/baby_auth_token=([^;]+)/);
  const authToken = match ? match[1] : "";
  assert.ok(authToken, "Login should set baby_auth_token cookie");

  const authHeaders = {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };

  // -------------------------------------------------------------------------
  // 6. GET /api/auth/me (Authenticated vs Unauthenticated)
  // -------------------------------------------------------------------------
  console.log("-> Testing GET /api/auth/me...");
  const resMeAuth = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: authHeaders,
  });
  assert.equal(resMeAuth.status, 200);
  const jsonMeAuth = await resMeAuth.json();
  assert.equal(jsonMeAuth.user?.username, testUsername);
  assert.equal(jsonMeAuth.family?.id, createdFamilyId);

  const resMeAnon = await fetch(`${BASE_URL}/api/auth/me`);
  assert.equal(resMeAnon.status, 200);
  const jsonMeAnon = await resMeAnon.json();
  assert.equal(jsonMeAnon.user, null);

  // -------------------------------------------------------------------------
  // 7. POST /api/auth/logout
  // -------------------------------------------------------------------------
  console.log("-> Testing POST /api/auth/logout...");
  const resLogout = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.equal(resLogout.status, 200);
  const jsonLogout = await resLogout.json();
  assert.equal(jsonLogout.success, true);
});
