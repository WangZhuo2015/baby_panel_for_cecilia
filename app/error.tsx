"use client";

import { useEffect } from "react";
import { CuteButton } from "@/components/ui/CuteButton";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-5xl">🍼</div>
      <h2 className="text-lg font-bold text-text-primary">页面出了一点小问题</h2>
      <p className="max-w-xs text-sm text-text-muted">
        别担心，宝宝的数据都很安全。点击下方按钮重试即可。
      </p>
      <CuteButton onClick={reset}>重试</CuteButton>
    </div>
  );
}
