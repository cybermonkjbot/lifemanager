import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:",
      "connect-src 'self' https: wss: ws:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join("; "),
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  reactCompiler: true,
  serverExternalPackages: ["baileys"],
  outputFileTracingExcludes: {
    "/api/system/self-improvement/conversation-quality/run": [
      "./*.json",
      "./*.lock",
      "./*.md",
      "./*.png",
      "./*.tsbuildinfo",
      "./*.yml",
      "./.agents/**/*",
      "./.next/cache/**/*",
      "./.slm/**/*",
      "./convex/**/*",
      "./coverage/**/*",
      "./data/**/*",
      "./dist/**/*",
      "./docs/**/*",
      "./eslint.config.mjs",
      "./LICENSE",
      "./next.config.ts",
      "./NOTICE",
      "./postcss.config.mjs",
      "./proxy.ts",
      "./public/**/*",
      "./scripts/**/*",
      "./shared/**/*",
      "./src/**/*",
    ],
    "/*": [
      "./.agents/**/*",
      "./.next/cache/**/*",
      "./.slm/**/*",
      "./coverage/**/*",
      "./dist/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
