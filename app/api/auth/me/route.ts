import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthSession(request);
    if (!user) {
      return NextResponse.json({ user: null, family: null, baby: null }, { status: 200 });
    }


    const primaryMembership =
      user.memberships.find((m) => m.family.babies.length > 0) ||
      user.memberships[0];
    const family = primaryMembership?.family;
    const activeBaby = family?.babies[0] || null;

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
      },
      family: family
        ? {
            id: family.id,
            name: family.name,
            inviteCode: family.inviteCode,
          }
        : null,
      baby: activeBaby,
      membership: primaryMembership
        ? {
            role: primaryMembership.role,
            relation: primaryMembership.relation,
          }
        : null,
    });
  } catch (error) {
    console.error("GET /api/auth/me error:", error);
    return NextResponse.json({ user: null }, { status: 500 });
  }
}
