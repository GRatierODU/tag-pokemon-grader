"use strict";

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { pipeline } = require("stream/promises");
const { createWriteStream } = require("fs");
const { Readable, Transform } = require("stream");

const root = process.cwd();

/** @returns {Promise<void>} */
async function maybeDownloadInboxTarGz() {
  const url = (
    process.env.VERCEL_INBOX_TAR_GZ_URL ||
    process.env.VERCEL_INBOX_ARCHIVE_URL ||
    ""
  ).trim();
  if (!url) return;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error(
      "[vercel-prebuild] VERCEL_INBOX_TAR_GZ_URL must be a valid URL"
    );
    process.exit(1);
  }
  if (parsed.protocol !== "https:") {
    console.error("[vercel-prebuild] inbox archive URL must use https:");
    process.exit(1);
  }

  const maxMb = Number(process.env.VERCEL_INBOX_ARCHIVE_MAX_MB ?? "750");
  const maxBytes =
    Number.isFinite(maxMb) && maxMb > 0 ? maxMb * 1024 * 1024 : 750 * 1024 * 1024;

  console.log("[vercel-prebuild] Fetching inbox archive (private URL)…");

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    console.error(
      `[vercel-prebuild] inbox archive fetch failed: HTTP ${res.status}`
    );
    process.exit(1);
  }

  const tmp = path.join(root, ".vercel-prebuild-inbox.tgz");
  const inboxDir = path.join(root, "data", "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });

  let received = 0;
  const limit = new Transform({
    transform(chunk, enc, cb) {
      received += chunk.length;
      if (received > maxBytes) {
        cb(new Error(`inbox archive exceeds ${maxMb} MiB cap`));
        return;
      }
      cb(null, chunk);
    },
  });

  try {
    const body = res.body;
    if (!body) {
      console.error("[vercel-prebuild] empty response body");
      process.exit(1);
    }
    if (typeof Readable.fromWeb === "function") {
      const nodeIn = Readable.fromWeb(body);
      await pipeline(nodeIn, limit, createWriteStream(tmp));
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) {
        throw new Error(`inbox archive exceeds ${maxMb} MiB cap`);
      }
      fs.writeFileSync(tmp, buf);
    }

    const tar = spawnSync(
      "tar",
      ["xzf", tmp, "-C", inboxDir],
      { stdio: "inherit", encoding: "utf8" }
    );
    if (tar.status !== 0) {
      console.error("[vercel-prebuild] tar extract failed (expected .tar.gz)");
      process.exit(1);
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ok */
    }
  }

  console.log("[vercel-prebuild] Inbox archive extracted into data/inbox/");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

(async () => {
  await maybeDownloadInboxTarGz();

  const urls = exists("data/inbox/tag_pop_all_card_urls.txt");
  const certs = exists("data/inbox/tag_pop_cert_index.jsonl");
  const db = exists("data/app.db");

  if (urls && certs) {
    console.log("[vercel-prebuild] Inbox sources present → npm run build:index");
    execSync("npm run build:index", {
      stdio: "inherit",
      cwd: root,
      env: process.env,
    });
    if (!exists("data/app.db")) {
      console.error("[vercel-prebuild] build:index did not create data/app.db");
      process.exit(1);
    }
  } else if (!db) {
    console.log(
      "[vercel-prebuild] No inbox CSV/JSONL and no app.db → empty SQLite schema"
    );
    execSync("npx tsx scripts/ensure-empty-db.ts", {
      stdio: "inherit",
      cwd: root,
      env: process.env,
    });
  } else {
    console.log("[vercel-prebuild] Using committed data/app.db");
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
