import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { getJwtSecretBytes } from "@/lib/config";
import { signMcpSessionToken, verifyMcpSessionToken } from "@/lib/mcp-session";

async function main() {
  const claims = {
    userId: "user-a",
    babyId: "baby-a",
    username: "parent-a",
  };
  const token = await signMcpSessionToken(claims);
  const ok = await verifyMcpSessionToken(token);
  assert.deepEqual(ok, claims);

  const loginLike = await new SignJWT({ userId: "user-a", username: "parent-a" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getJwtSecretBytes());
  assert.equal(await verifyMcpSessionToken(loginLike), null);

  const otherBaby = await signMcpSessionToken({ ...claims, babyId: "baby-b" });
  const other = await verifyMcpSessionToken(otherBaby);
  assert.equal(other?.babyId, "baby-b");
  assert.notEqual(other?.babyId, claims.babyId);

  assert.equal(await verifyMcpSessionToken("not-a-jwt"), null);
  console.log("mcp-session tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
