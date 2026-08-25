import { SignJWT, jwtVerify } from "jose";
import { getJwtSecretBytes } from "@/lib/config";

const TYP = "mcp";
const EXPIRY = "15m";

export interface McpSessionClaims {
  userId: string;
  babyId: string;
  username: string;
}

export async function signMcpSessionToken(claims: McpSessionClaims): Promise<string> {
  return new SignJWT({
    typ: TYP,
    userId: claims.userId,
    babyId: claims.babyId,
    username: claims.username,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getJwtSecretBytes());
}

export async function verifyMcpSessionToken(token: string): Promise<McpSessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    if (
      payload.typ === TYP &&
      typeof payload.userId === "string" &&
      typeof payload.babyId === "string" &&
      typeof payload.username === "string" &&
      payload.userId.length > 0 &&
      payload.babyId.length > 0
    ) {
      return {
        userId: payload.userId,
        babyId: payload.babyId,
        username: payload.username,
      };
    }
    return null;
  } catch {
    return null;
  }
}
