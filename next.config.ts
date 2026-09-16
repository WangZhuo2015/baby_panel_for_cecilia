import type { NextConfig } from "next";

// CSP 仅在生产启用：next dev 的热更新依赖 eval/inline，启用会破坏开发体验
const isProd = process.env.NODE_ENV === "production";

const securityHeaders: { key: string; value: string }[] = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" },
  // 仅 HTTPS 下生效，对 HTTP 开发无影响
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

if (isProd) {
  securityHeaders.push({
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  });
}

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "baby.zwang.fun" },
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "127.0.0.1" },
    ],
  },
  serverExternalPackages: ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai"],
  allowedDevOrigins: [
    "baby.zwang.fun",
    "localhost:3088",
    "localhost:3000",
    "localhost",
    "127.0.0.1:3088",
    "127.0.0.1:3000",
    "127.0.0.1",
    "*.zwang.fun",
  ],

  async redirects() {
    return [
      { source: "/health", destination: "/health/vaccines", permanent: true },
      { source: "/records", destination: "/records/diaper", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },

      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/offline.html",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
