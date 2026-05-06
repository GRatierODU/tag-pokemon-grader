import fs from "fs";
import { tmpdir } from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable, Transform } from "stream";

const TMP_DB = "tag-pokemon-grader-app.db";
export const SQLITE_REMOTE_MAX_BYTES = 400 * 1024 * 1024;

function isHttpsUrl(url: string) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

async function streamDownloadToFile(url: string, dest: string): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal });
    if (!res.ok || !res.body) {
      throw new Error(`SQLite download failed: HTTP ${res.status}`);
    }
    const len = res.headers.get("content-length");
    if (len && Number(len) > SQLITE_REMOTE_MAX_BYTES) {
      throw new Error("SQLite Content-Length exceeds SQLITE_REMOTE_MAX_BYTES");
    }

    let received = 0;
    const limit = new Transform({
      transform(chunk, _enc, cb) {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        received += buf.length;
        if (received > SQLITE_REMOTE_MAX_BYTES) {
          cb(new Error("SQLite download exceeds size cap"));
          return;
        }
        cb(null, buf);
      },
    });

    const nodeIn = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
    await pipeline(nodeIn, limit, fs.createWriteStream(dest));
  } finally {
    clearTimeout(timer);
  }
}

let remoteInitPromise: Promise<void> | null = null;

/**
 * When `SQLITE_DB_DOWNLOAD_URL` + `VERCEL` are set, downloads `app.db` to temp and sets `SQLITE_DB_PATH`.
 * Keeps huge SQLite files out of the serverless artifact (250 MB limit). Call once per request before `getDb()`.
 */
export async function initSqliteForServerless(): Promise<void> {
  const url = process.env.SQLITE_DB_DOWNLOAD_URL?.trim();
  if (!url || !process.env.VERCEL) return;

  if (!isHttpsUrl(url)) {
    throw new Error("SQLITE_DB_DOWNLOAD_URL must be an https:// URL");
  }

  if (remoteInitPromise) {
    await remoteInitPromise;
    return;
  }

  remoteInitPromise = (async () => {
    const dest = path.join(tmpdir(), TMP_DB);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 4096) {
      process.env.SQLITE_DB_PATH = dest;
      console.log(`[sqlite-remote] using cached ${dest} (${fs.statSync(dest).size} bytes)`);
      return;
    }

    try {
      fs.unlinkSync(dest);
    } catch {
      /* ok */
    }

    console.log("[sqlite-remote] downloading SQLite…");
    await streamDownloadToFile(url, dest);
    process.env.SQLITE_DB_PATH = dest;
    console.log(
      `[sqlite-remote] ready at ${dest} (${fs.statSync(dest).size} bytes)`
    );
  })();

  await remoteInitPromise;
}
