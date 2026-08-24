"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#FFF9FB" }}>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 48 }}>🍼</div>
          <h2 style={{ fontSize: 18, color: "#1f2937" }}>应用出现了问题</h2>
          <p style={{ fontSize: 14, color: "#6b7280", maxWidth: 320 }}>
            别担心，宝宝的数据都很安全。点击按钮重试。
          </p>
          <button
            onClick={reset}
            style={{ padding: "10px 24px", borderRadius: 9999, background: "#ec4899", color: "#fff", border: "none", fontSize: 14, cursor: "pointer" }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
