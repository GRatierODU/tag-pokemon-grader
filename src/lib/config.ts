import fs from "fs";
import path from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(process.cwd(), ".env.local") });
loadEnv({ path: path.join(process.cwd(), ".env") });

export function getDataRoot(): string {
  const root = process.env.DATA_ROOT;
  if (root) return path.resolve(root);
  return path.join(process.cwd(), "data");
}

export function getDigCacheRoot(): string {
  const d = process.env.DIG_CACHE_ROOT;
  if (d) return path.resolve(d);
  return path.join(getDataRoot(), "dig_cache");
}

/** When set (https only), DIG exemplars load from `{base}/{prefix?}/{certId}/manifest.json` and image files instead of disk. */
export function getDigExemplarRemoteBaseUrl(): string | null {
  const raw = process.env.DIG_EXEMPLAR_BASE_URL?.trim();
  if (!raw) return null;
  if (!/^https:\/\//i.test(raw)) {
    throw new Error(
      "DIG_EXEMPLAR_BASE_URL must start with https:// (see DEPLOY_VERCEL.md)"
    );
  }
  return raw.replace(/\/+$/, "");
}

/** Extra path under base before cert folders: e.g. `en`, `ja`, `datasets/2026-01`. */
export function getDigExemplarPathPrefix(): string {
  return (process.env.DIG_EXEMPLAR_PATH_PREFIX ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

/** Authorization header for private object storage (`Bearer …` or vendor-specific). */
export function digExemplarFetchHeaders(): HeadersInit {
  const auth = process.env.DIG_EXEMPLAR_FETCH_AUTHORIZATION?.trim();
  if (!auth) return {};
  return { Authorization: auth };
}

export function getDbPath(): string {
  const d = process.env.SQLITE_DB_PATH;
  if (d) return path.resolve(d);
  return path.join(getDataRoot(), "app.db");
}

export function getCertIndexPath(): string {
  const p = process.env.CERT_INDEX_PATH;
  if (p) return path.resolve(p);
  return path.join(getDataRoot(), "inbox", "tag_pop_cert_index.jsonl");
}

export function getCardUrlsPath(): string {
  const p = process.env.CARD_URLS_PATH;
  if (p) return path.resolve(p);
  return path.join(getDataRoot(), "inbox", "tag_pop_all_card_urls.txt");
}

export function assertFile(pathname: string, label: string) {
  if (!fs.existsSync(pathname)) {
    throw new Error(
      `Missing ${label} at ${pathname}. Set env or copy files into data/inbox/.`
    );
  }
}
