import type { NextConfig } from "next";

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
  outputFileTracingIncludes: {
    "/api/cards": ["./data/app.db"],
    "/api/grade": ["./data/app.db"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
