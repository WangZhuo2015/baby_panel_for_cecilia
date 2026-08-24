import { NextResponse } from "next/server";

/**
 * PWA kill-switch：SW_DISABLED=1 时前端注销全部 Service Worker 并清空缓存。
 * 坏版本无法收敛时的最后自救通道。
 */
export async function GET() {
  return NextResponse.json({
    swDisabled: process.env.SW_DISABLED === "1",
  });
}
