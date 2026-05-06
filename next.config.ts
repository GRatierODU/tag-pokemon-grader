import type { NextConfig } from "next";

/** Bundle SQLite into traced serverless files only when not downloaded at runtime (see `src/instrumentation.ts`). */
const bundleSqliteInServerless =
  process.env.SQLITE_DB_DOWNLOAD_URL == null ||
  process.env.SQLITE_DB_DOWNLOAD_URL.trim() === "";

const nextConfig: NextConfig = {
  // So iOS can open the app via HTTPS tunnels (localtunnel, ngrok, cloudflared) in dev
  allowedDevOrigins: [
    "*.loca.lt",
    "*.trycloudflare.com",
    "*.ngrok.io",
    "*.ngrok-free.app",
    "*.ngrok.app",
  ],
  serverExternalPackages: ["better-sqlite3"],
  /** API routes don't use sharp; traced sharp adds tens of MB. */
  outputFileTracingExcludes: {
    "/api/**/*": ["./node_modules/sharp/**", "./node_modules/@img/**"],
  },
  ...(bundleSqliteInServerless
    ? {
        outputFileTracingIncludes: {
          "/api/cards": ["./data/app.db"],
          "/api/grade": ["./data/app.db"],
        },
      }
    : {}),
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
