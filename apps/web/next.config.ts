import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Standalone output for Docker optimization: self-contained server at
  // .next/standalone/apps/web/server.js (start with `node`, not `next start`).
  output: "standalone",
  // Disable the X-Powered-By response header for security
  poweredByHeader: false,
  // worker/ and api/ live outside apps/web — allow cross-dir imports + trace from repo root
  outputFileTracingRoot: path.join(__dirname, "../.."),
  serverExternalPackages: [
    "pg",
    "@google/genai",
    "@google-cloud/speech",
    "@google-cloud/pubsub",
    "@google-cloud/storage",
    "google-auth-library",
  ],
  experimental: {
    externalDir: true,
  },
  // Security response headers, applied to every route. CSP is scoped to allow the
  // Google Maps JS SDK (the dashboard map) + self; tighten further if the SPA's asset
  // origins change. frame-ancestors 'none' + X-Frame-Options DENY = anti-clickjacking.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.googleapis.com",
      "worker-src 'self' blob:",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), microphone=(self), camera=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
  // Production serving for the Vite SPA (frontend/dist → apps/web/public in the
  // Docker image): same origin as /api/* so the Auth.js session cookie just works.
  // Fallback rewrites run AFTER filesystem + route handlers, so /api/*, /healthz
  // and static assets always win; any other path serves the SPA shell and React
  // Router takes over client-side (/login, /dashboard, ...).
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [{ source: "/:path*", destination: "/index.html" }],
    };
  },
};

export default nextConfig;
