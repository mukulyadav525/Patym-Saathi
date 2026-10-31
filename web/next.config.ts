import path from "node:path";

import type { NextConfig } from "next";

// Where the browser sends API calls: this site (forwarded below) unless NEXT_PUBLIC_API_BASE_URL says otherwise.
const publicApi = process.env.NEXT_PUBLIC_API_BASE_URL;
// Where this server forwards /api/v1 (server-side only, so it may be http://localhost).
const apiOrigin = (process.env.API_ORIGIN ?? "http://localhost:8000").replace(/\/$/, "");
const isProd = process.env.NODE_ENV === "production";

// Security headers. CSP only in production builds (dev needs eval + HMR websockets).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), screen-wake-lock=(self)" },
  ...(isProd
    ? [
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            `connect-src 'self'${publicApi ? ` ${new URL(publicApi).origin}` : ""}`,
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "media-src 'self' data: blob:",
            "font-src 'self' data:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; "),
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${apiOrigin}/api/v1/:path*` },
      { source: "/health", destination: `${apiOrigin}/health` },
    ];
  },
  experimental: { proxyTimeout: 60_000 }, // live feed long-polls for up to 25 s; voice calls wait on Sarvam
  // Client-rendered dashboard (session lives in the browser); all data comes from the FastAPI API.
  turbopack: {
    root: path.join(__dirname, ".."), // monorepo: shared/api-types.ts lives one level up
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
