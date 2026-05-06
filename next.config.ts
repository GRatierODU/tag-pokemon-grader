import type { NextConfig } from "next";

/** Bundle SQLite into traced serverless only when no remote source is configured at build time. */
const hasRemoteSqliteAtBuild =
  (process.env.SQLITE_DB_DOWNLOAD_URL?.trim() ?? "") !== "" ||
  (process.env.SQLITE_BLOB_PATHNAME?.trim() ?? "") !== "";
const bundleSqliteInServerless = !hasRemoteSqliteAtBuild;

const apiTracingExcludes = [
  "./node_modules/sharp/**",
  "./node_modules/@img/**",
  /** Built from inbox in CI/Vercel prebuild — never used at `/api/*` runtime. */
  "./data/inbox/**",
  /** Local DIG scrape cache — exemplars loaded from DIG_EXEMPLAR_BASE_URL on serverless. */
  "./data/dig_cache/**",
  ...(bundleSqliteInServerless
    ? []
    : ["./data/app.db", "./data/app.db-wal", "./data/app.db-shm"]),
];

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
    "/api/**/*": apiTracingExcludes,
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
