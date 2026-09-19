import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runDatabaseBackup } from "@/lib/cron/backup";

export const maxDuration = 180;

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  const url = new URL(request.url);
  const keepParam = url.searchParams.get("keep");
  const keep = keepParam ? parseInt(keepParam, 10) : undefined;

  const result = await runDatabaseBackup({
    keep: Number.isFinite(keep) && (keep as number) > 0 ? keep : undefined,
  });

  if (!result.success) {
    return NextResponse.json(
      {
        error: "Database backup failed",
        details: result.error,
        output: result.output,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    timestamp: result.timestamp,
    backupFile: result.backupFile,
    sizeBytes: result.sizeBytes,
    output: result.output,
  });
}

export async function POST(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  let keep: number | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.keep === "number" && body.keep > 0) {
      keep = body.keep;
    }
  } catch {
    // Ignore JSON parse errors
  }

  const result = await runDatabaseBackup({ keep });

  if (!result.success) {
    return NextResponse.json(
      {
        error: "Database backup failed",
        details: result.error,
        output: result.output,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    timestamp: result.timestamp,
    backupFile: result.backupFile,
    sizeBytes: result.sizeBytes,
    output: result.output,
  });
}
