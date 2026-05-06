/**
 * Upload `data/dig_cache/<cert_id>/*` to a Vercel Blob store (public URLs for grading).
 *
 * Prerequisites:
 * - Create a Blob store (e.g. "exemplar-blob"), set to Public.
 * - Create a read-write token scoped to that store (Vercel dashboard).
 *
 * Usage (PowerShell):
 *   $env:EXEMPLAR_READ_WRITE_TOKEN="vercel_blob_rw_..."
 *   npx tsx scripts/upload-dig-cache-to-vercel-blob.ts
 *
 * Options:
 *   --dry-run           print actions only
 *   --prefix=dig        pathname prefix (default: dig) → …/dig/<certId>/manifest.json
 *   --concurrency=3     parallel uploads
 *   --limit=50          stop after N files (trial)
 *
 * After upload, set on Vercel (and locally if needed):
 *   DIG_EXEMPLAR_BASE_URL=https://<store-id>.public.blob.vercel-storage.com/dig
 *   (replace `dig` if you passed a different --prefix)
 * Leave DIG_EXEMPLAR_FETCH_AUTHORIZATION unset for public blobs.
 */
import fs from "fs";
import fsP from "fs/promises";
import path from "path";

import "dotenv/config";
import { put } from "@vercel/blob";

import { getDigCacheRoot } from "../src/lib/config";

function parseArgs() {
  const argv = process.argv.slice(2);
  let dryRun = false;
  let prefix = "dig";
  let concurrency = 3;
  let limit = Infinity;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    if (a.startsWith("--prefix="))
      prefix = a.slice("--prefix=".length).trim().replace(/^\/+|\/+$/g, "");
    if (a.startsWith("--concurrency="))
      concurrency = Math.max(
        1,
        Number.parseInt(a.slice("--concurrency=".length), 10) || 3
      );
    if (a.startsWith("--limit="))
      limit = Math.max(1, Number.parseInt(a.slice("--limit=".length), 10) || 1);
  }
  return { dryRun, prefix, concurrency, limit };
}

function token(): string | null {
  const t =
    process.env.EXEMPLAR_READ_WRITE_TOKEN?.trim() ||
    process.env.EXEMPLAR_BLOB_READ_WRITE_TOKEN?.trim() ||
    process.env.BLOB_READ_WRITE_TOKEN?.trim();
  return t || null;
}

function contentType(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return undefined;
}

type Task = {
  pathname: string;
  filePath: string;
  multipart: boolean;
};

async function collectTasks(cacheRoot: string, prefix: string): Promise<Task[]> {
  const tasks: Task[] = [];
  const entries = await fsP.readdir(cacheRoot, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".")) continue;
    const dir = path.join(cacheRoot, ent.name);
    const files = await fsP.readdir(dir);
    for (const f of files) {
      if (f.startsWith(".")) continue;
      const fp = path.join(dir, f);
      const st = await fsP.stat(fp);
      if (!st.isFile()) continue;
      const pathname = `${prefix}/${ent.name}/${f.replace(/\\/g, "/")}`;
      tasks.push({
        pathname,
        filePath: fp,
        multipart: st.size > 4 * 1024 * 1024,
      });
    }
  }
  return tasks;
}

async function poolMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    for (;;) {
      const j = i++;
      if (j >= items.length) return;
      out[j] = await fn(items[j]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return out;
}

async function main() {
  const { dryRun, prefix, concurrency, limit } = parseArgs();
  const tok = token();
  if (!tok && !dryRun) {
    console.error(
      "Set EXEMPLAR_READ_WRITE_TOKEN or EXEMPLAR_BLOB_READ_WRITE_TOKEN (read-write token for exemplar-blob store)."
    );
    process.exit(1);
  }

  const cacheRoot = getDigCacheRoot();
  if (!fs.existsSync(cacheRoot)) {
    console.error(`Missing dig cache directory: ${cacheRoot}`);
    process.exit(1);
  }

  let tasks = await collectTasks(cacheRoot, prefix);
  console.log(
    `[upload-dig-blob] ${tasks.length} files under ${cacheRoot} (prefix=${prefix}/<certId>/…)`
  );
  if (tasks.length === 0) {
    console.error("No files to upload. Run ingest-dig first.");
    process.exit(1);
  }
  const truncated = tasks.length > limit;
  tasks = tasks.slice(0, limit);
  if (truncated) {
    console.log(`[upload-dig-blob] --limit=${limit}: uploading first ${tasks.length} files only`);
  }

  let firstUrl: string | null = null;

  await poolMap(tasks, concurrency, async (task) => {
    if (dryRun) {
      console.log(`[dry-run] put ${task.pathname}`);
      return;
    }
    const body = fs.createReadStream(task.filePath);
    const { url } = await put(task.pathname, body, {
      access: "public",
      token: tok!,
      allowOverwrite: true,
      contentType: contentType(path.basename(task.pathname)),
      multipart: task.multipart,
    });
    if (!firstUrl) firstUrl = url;
    console.log(`ok ${task.pathname}`);
  });

  if (dryRun) {
    console.log(
      "\nAfter a real run, set DIG_EXEMPLAR_BASE_URL to:\n" +
        `  https://<store-id>.public.blob.vercel-storage.com/${prefix}\n` +
        "(Use the hostname from any uploaded blob URL in the Blob UI.)"
    );
    return;
  }

  if (firstUrl) {
    const u = new URL(firstUrl);
    const base = `${u.origin}/${prefix}`;
    console.log("\n=== Set this in Vercel (Production + Preview), then redeploy ===");
    console.log(`DIG_EXEMPLAR_BASE_URL=${base}`);
    console.log(
      "(No DIG_EXEMPLAR_FETCH_AUTHORIZATION needed for public blobs. Optional GEMINI_MAX_IMAGES_PER_EXEMPLAR=all separately.)"
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
