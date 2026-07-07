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
};

export default nextConfig;
