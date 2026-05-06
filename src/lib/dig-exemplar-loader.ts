import fs from "fs/promises";
import path from "path";

import {
  digExemplarFetchHeaders,
  getDigCacheRoot,
  getDigExemplarPathPrefix,
  getDigExemplarRemoteBaseUrl,
} from "./config";
import type { DigManifest } from "./dig-manifest";

const PRIORITY_KINDS: DigManifest["images"][number]["kind"][] = [
  "front_main",
  "back_main",
  "front_sfx",
  "back_sfx",
  "detail",
  "other",
];

/** Max payload per slab image bytes (remote or local sanity cap). */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

function slashBase(base: string) {
  return base.endsWith("/") ? base : `${base}/`;
}

/** Build HTTPS URL under `DIG_EXEMPLAR_BASE_URL`, optional `DIG_EXEMPLAR_PATH_PREFIX`. */
function remoteAssetUrl(certId: string, fileName: string): string {
  const rawBase = getDigExemplarRemoteBaseUrl();
  if (!rawBase) throw new Error("DIG_EXEMPLAR_BASE_URL not configured");
  const prefix = getDigExemplarPathPrefix();
  const rel = [prefix, certId, fileName].filter((s) => s.length > 0).join("/");
  return new URL(rel, slashBase(rawBase)).toString();
}

function remoteManifestUrl(certId: string): string {
  return remoteAssetUrl(certId, "manifest.json");
}

function mimeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/webp";
}

function pickImageMime(ct: string | null, fileName: string): string {
  const t = ct?.split(";")[0]?.trim()?.toLowerCase() ?? "";
  if (t.startsWith("image/")) return t;
  return mimeFromFileName(fileName);
}

async function fetchWithLimit(
  url: string,
  maxBytes: number
): Promise<{ buf: Buffer; contentType: string | null }> {
  const headers = digExemplarFetchHeaders();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`${url}: HTTP ${res.status}`);
    }
    const ct = res.headers.get("content-type");
    const cl = res.headers.get("content-length");
    if (cl && Number(cl) > maxBytes) {
      throw new Error(`${url}: content-length exceeds cap`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error(`${url}: body exceeds cap`);
    }
    return { buf, contentType: ct };
  } finally {
    clearTimeout(timer);
  }
}

async function loadManifestLocal(certId: string): Promise<DigManifest> {
  const root = getDigCacheRoot();
  const manifestPath = path.join(root, certId, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as DigManifest;
}

async function loadManifestRemote(certId: string): Promise<DigManifest> {
  const url = remoteManifestUrl(certId);
  const { buf } = await fetchWithLimit(url, MAX_MANIFEST_BYTES);
  return JSON.parse(buf.toString("utf8")) as DigManifest;
}

async function readImageLocal(
  certId: string,
  fileName: string
): Promise<Buffer | null> {
  const root = getDigCacheRoot();
  const fp = path.join(root, certId, fileName);
  try {
    const buf = await fs.readFile(fp);
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

async function readImageRemote(
  certId: string,
  fileName: string
): Promise<{ buf: Buffer; mimeType: string } | null> {
  try {
    const url = remoteAssetUrl(certId, fileName);
    const { buf, contentType } = await fetchWithLimit(url, MAX_IMAGE_BYTES);
    const mimeType = pickImageMime(contentType, fileName);
    return { buf, mimeType };
  } catch {
    return null;
  }
}

/**
 * Load TAG DIG slab images for Gemini — remote HTTPS tree or local `dig_cache`.
 * @param maxImages Cap after priority sort; use `Infinity` (via env `GEMINI_MAX_IMAGES_PER_EXEMPLAR=all`) for every manifest image.
 */
export async function loadManifestImagesForGemini(
  certId: string,
  maxImages = 4
): Promise<{ mimeType: string; base64: string; label: string }[]> {
  const remoteConfigured = !!getDigExemplarRemoteBaseUrl();

  const manifest = remoteConfigured
    ? await loadManifestRemote(certId)
    : await loadManifestLocal(certId);

  const sorted = [...manifest.images].sort(
    (a, b) =>
      PRIORITY_KINDS.indexOf(a.kind) - PRIORITY_KINDS.indexOf(b.kind)
  );

  const parts: { mimeType: string; base64: string; label: string }[] = [];

  for (const img of sorted) {
    if (Number.isFinite(maxImages) && parts.length >= maxImages) break;

    if (remoteConfigured) {
      const got = await readImageRemote(certId, img.fileName);
      if (got) {
        parts.push({
          mimeType: got.mimeType,
          base64: got.buf.toString("base64"),
          label: `${certId}_${img.kind}`,
        });
      }
      continue;
    }

    const buf = await readImageLocal(certId, img.fileName);
    if (!buf) continue;
    parts.push({
      mimeType: mimeFromFileName(img.fileName),
      base64: buf.toString("base64"),
      label: `${certId}_${img.kind}`,
    });
  }

  return parts;
}
