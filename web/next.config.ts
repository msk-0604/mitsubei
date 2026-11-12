import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

// 画面と API で共通の計算ロジック（../shared）を読み込むため、リポジトリ全体をルートにする
const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // PDF 生成で使う日本語フォントをサーバー関数に含める
  outputFileTracingIncludes: {
    "/api/estimates/[id]/pdf": ["./assets/fonts/*.ttf"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Service Worker は常に最新を取りに行く
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
