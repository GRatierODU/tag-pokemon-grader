/**
 * Waits for Next.js on localhost, then opens an HTTPS tunnel so iOS Safari
 * can use getUserMedia (secure context). Uses Cloudflare Quick Tunnels by default
 * (reliable). Run alongside: npm run dev:host
 *
 * Fallback: set TUNNEL_BACKEND=localtunnel (often flaky / 503).
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const port = Number(process.env.TUNNEL_PORT || process.env.PORT || 3000);
const waitMs = Number(process.env.TUNNEL_WAIT_MS || 120_000);
const backend =
  process.env.TUNNEL_BACKEND || "cloudflared";

const TRYCF = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

function resolveCloudflaredExecutable() {
  if (
    process.env.CLOUDFLARED_PATH &&
    fs.existsSync(process.env.CLOUDFLARED_PATH)
  ) {
    return process.env.CLOUDFLARED_PATH;
  }

  const pf = process.env.PROGRAMFILES ?? "";
  const pf86 = process.env["PROGRAMFILES(X86)"] ?? "";

  const candidates =
    process.platform === "win32"
      ? [
          path.join(pf, "cloudflared", "cloudflared.exe"),
          path.join(pf86, "cloudflared", "cloudflared.exe"),
          path.join(pf, "Cloudflare", "cloudflared.exe"),
          path.join(pf, "Cloudflare", "cloudflared", "cloudflared.exe"),
        ]
      : [
          "/opt/homebrew/bin/cloudflared",
          "/usr/local/bin/cloudflared",
        ];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }

  return "cloudflared";
}

function waitForPort(p, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryOnce() {
      const socket = net.connect({ port: p, host: "127.0.0.1" }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error(
              `Timed out waiting for http://127.0.0.1:${p} — is Next.js running?`
            )
          );
        } else {
          setTimeout(tryOnce, 350);
        }
      });
    }
    tryOnce();
  });
}

function printBanner(url) {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  iPhone → Safari → open this HTTPS URL (camera API works):");
  console.log("");
  console.log("  ", url);
  console.log("");
  console.log("  First load can take a few seconds while the tunnel connects.");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
}

function startCloudflared(p) {
  return new Promise((resolve, reject) => {
    const exe = resolveCloudflaredExecutable();
    const child = spawn(exe, ["tunnel", "--url", `http://127.0.0.1:${p}`], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: exe === "cloudflared",
      windowsHide: true,
    });

    let buf = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            "cloudflared did not print a trycloudflare.com URL within 45s."
          )
        );
      }
    }, 45_000);

    function onChunk(chunk) {
      buf += chunk.toString();
      const m = buf.match(TRYCF);
      if (m && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ url: m[0], child });
      }
    }

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    child.on("exit", (code) => {
      if (!settled && code !== 0 && code !== null) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code}`));
      }
    });
  });
}

async function main() {
  await waitForPort(port, waitMs);

  if (backend === "localtunnel") {
    const { default: localtunnel } = await import("localtunnel");
    const tunnel = await localtunnel({ port });
    printBanner(tunnel.url);
    tunnel.on("close", () => process.exit(0));
    return;
  }

  try {
    const { url, child } = await startCloudflared(port);
    printBanner(url);
    child.on("exit", () => process.exit(0));
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
    if (code === "ENOENT") {
      console.error("");
      console.error(
        "  cloudflared was not found (needed for a stable HTTPS tunnel; loca.lt often 503)."
      );
      console.error("");
      console.error("  Install (pick one):");
      console.error("    Windows:  winget install Cloudflare.cloudflared");
      console.error(
        "              (then open a new terminal, or set CLOUDFLARED_PATH to cloudflared.exe)"
      );
      console.error(
        "    macOS:    brew install cloudflare/cloudflare/cloudflared"
      );
      console.error(
        "    Docs:     https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
      );
      console.error("");
      console.error(
        "  Optional fallback (often returns 503): TUNNEL_BACKEND=localtunnel npm run dev:ios"
      );
      console.error("");
      process.exit(1);
    }
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

await main();
