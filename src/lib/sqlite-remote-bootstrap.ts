import fs from "fs";
import { tmpdir } from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable, Transform } from "stream";

import { get } from "@vercel/blob";

const TMP_DB = "tag-pokemon-grader-app.db";
export const SQLITE_REMOTE_MAX_BYTES = 400 * 1024 * 1024;

function sizeLimitTransform(maxBytes: number): Transform {
  let received = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      received += buf.length;
      if (received > maxBytes) {
        cb(new Error("SQLite download exceeds size cap"));
        return;
      }
      cb(null, buf);
    },
  });
}

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

    const limit = sizeLimitTransform(SQLITE_REMOTE_MAX_BYTES);
    const nodeIn = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
    await pipeline(nodeIn, limit, fs.createWriteStream(dest));
  } finally {
    clearTimeout(timer);
  }
}

async function streamPrivateBlobToFile(pathname: string, dest: string): Promise<void> {
  const result = await get(pathname, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(
      result == null
        ? "SQLite blob not found"
        : `SQLite blob fetch failed (HTTP ${result.statusCode})`
    );
  }
  if (result.blob.size > SQLITE_REMOTE_MAX_BYTES) {
    throw new Error("SQLite blob size exceeds SQLITE_REMOTE_MAX_BYTES");
  }
  const limit = sizeLimitTransform(SQLITE_REMOTE_MAX_BYTES);
  const nodeIn = Readable.fromWeb(result.stream as import("stream/web").ReadableStream);
  await pipeline(nodeIn, limit, fs.createWriteStream(dest));
}

let remoteInitPromise: Promise<void> | null = null;

function hasRemoteSqliteConfig(): boolean {
  const url = process.env.SQLITE_DB_DOWNLOAD_URL?.trim() ?? "";
  const blobPath = process.env.SQLITE_BLOB_PATHNAME?.trim() ?? "";
  return url.length > 0 || blobPath.length > 0;
}

/**
 * On Vercel: load SQLite from a public HTTPS URL (`SQLITE_DB_DOWNLOAD_URL`) or a private
 * Vercel Blob pathname (`SQLITE_BLOB_PATHNAME` + `BLOB_READ_WRITE_TOKEN`). Writes to `/tmp`
 * and sets `SQLITE_DB_PATH`. Call before `getDb()` in API routes.
 */
export async function initSqliteForServerless(): Promise<void> {
  if (!process.env.VERCEL) return;
  if (!hasRemoteSqliteConfig()) return;

  const blobPath = process.env.SQLITE_BLOB_PATHNAME?.trim();
  const url = process.env.SQLITE_DB_DOWNLOAD_URL?.trim();

  if (blobPath && url) {
    throw new Error("Set only one of SQLITE_BLOB_PATHNAME or SQLITE_DB_DOWNLOAD_URL");
  }
  if (blobPath && !process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    throw new Error("SQLITE_BLOB_PATHNAME requires BLOB_READ_WRITE_TOKEN");
  }
  if (url && !isHttpsUrl(url)) {
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
    if (blobPath) {
      await streamPrivateBlobToFile(blobPath, dest);
    } else {
      await streamDownloadToFile(url!, dest);
    }
    process.env.SQLITE_DB_PATH = dest;
    console.log(
      `[sqlite-remote] ready at ${dest} (${fs.statSync(dest).size} bytes)`
    );
  })();

  await remoteInitPromise;
}
