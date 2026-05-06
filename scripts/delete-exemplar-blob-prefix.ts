/**
 * Delete objects in your Vercel Blob store using the exemplar token (scoped to one store).
 * Does NOT delete the store itself — use Vercel dashboard → Storage → store → Danger zone for that.
 *
 * Requires --confirm so it is never run by accident.
 *
 * Usage:
 *   npx tsx scripts/delete-exemplar-blob-prefix.ts --confirm
 *   npx tsx scripts/delete-exemplar-blob-prefix.ts --confirm --prefix=dig
 *   npx tsx scripts/delete-exemplar-blob-prefix.ts --confirm --all   # every object in this store
 *
 * Token: EXEMPLAR_READ_WRITE_TOKEN | EXEMPLAR_BLOB_READ_WRITE_TOKEN | BLOB_READ_WRITE_TOKEN
 */
import "dotenv/config";

import { del, list } from "@vercel/blob";

function token(): string | null {
  const t =
    process.env.EXEMPLAR_READ_WRITE_TOKEN?.trim() ||
    process.env.EXEMPLAR_BLOB_READ_WRITE_TOKEN?.trim() ||
    process.env.BLOB_READ_WRITE_TOKEN?.trim();
  return t || null;
}

function parseArgs() {
  let confirm = false;
  let allObjects = false;
  let prefix = "dig";
  for (const a of process.argv.slice(2)) {
    if (a === "--confirm") confirm = true;
    if (a === "--all") allObjects = true;
    if (a.startsWith("--prefix="))
      prefix = a.slice("--prefix=".length).trim();
  }
  return { confirm, allObjects, prefix };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function delWithRetry(pathnames: string[], tok: string): Promise<void> {
  for (;;) {
    try {
      await del(pathnames, { token: tok });
      return;
    } catch (e: unknown) {
      const sec =
        e &&
        typeof e === "object" &&
        "retryAfter" in e &&
        typeof (e as { retryAfter?: number }).retryAfter === "number"
          ? (e as { retryAfter: number }).retryAfter
          : 65;
      console.warn(`[delete-blob] rate limited — waiting ${sec}s then retrying batch…`);
      await sleep(sec * 1000 + 500);
    }
  }
}

async function main() {
  const { confirm, allObjects, prefix } = parseArgs();
  const tok = token();

  if (!confirm) {
    console.error(
      "Refusing to run without --confirm. This permanently deletes blob objects in the store tied to your token."
    );
    process.exit(1);
  }
  if (!tok) {
    console.error("Missing read-write token (EXEMPLAR_READ_WRITE_TOKEN, etc.).");
    process.exit(1);
  }

  const listPrefix = allObjects ? undefined : prefix || undefined;
  console.log(
    listPrefix == null
      ? "[delete-blob] deleting ALL objects in this store"
      : `[delete-blob] deleting objects with prefix "${listPrefix}"`
  );

  let cursor: string | undefined;
  let total = 0;
  /** Keep batches small to avoid delete rate limits. */
  const pageSize = 200;
  /** Pause between successful delete batches (ms). */
  const pauseMs = 400;
  for (;;) {
    const res = await list({
      token: tok,
      prefix: listPrefix,
      limit: pageSize,
      cursor,
    });
    const pathnames = res.blobs.map((b) => b.pathname);
    if (pathnames.length > 0) {
      await delWithRetry(pathnames, tok);
      total += pathnames.length;
      console.log(`[delete-blob] batch +${pathnames.length} (total ${total})`);
      await sleep(pauseMs);
    }
    if (!res.hasMore) break;
    cursor = res.cursor;
    if (!cursor) break;
  }

  console.log(`[delete-blob] done. removed ${total} object(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
