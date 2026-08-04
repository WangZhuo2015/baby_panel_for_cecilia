import { NextResponse } from "next/server";

// Milestone status is tracked client-side (localStorage/zustand persist)
// This route exists for backward compatibility but doesn't modify the database
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    // Status is client-side only: "已做到" / "还没有" / "不确定"
    // Return the status back to confirm
    return NextResponse.json({ id, status });
  } catch (error) {
    console.error("PUT /api/development/milestones/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update milestone status" },
      { status: 500 }
    );
  }
}
