/**
 * Batch-download TAG DIG slab/card photos via Playwright (tagd.co SPA).
 *
 * Usage:
 *   npx tsx scripts/ingest-dig.ts --limit=50 --resume
 * Env: DIG_CACHE_ROOT, CERT_INDEX_PATH (same as app)
 */
import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import readline from "readline";
import { chromium } from "playwright";
import sharp from "sharp";

import { getCertIndexPath, getDigCacheRoot, assertFile } from "../src/lib/config";
import type { DigManifest } from "../src/lib/dig-manifest";
import { classifyImageUrl } from "../src/lib/dig-manifest";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let limit = Infinity;
  let resume = false;
  let delayMs = 800;
  for (const a of argv) {
    if (a.startsWith("--limit="))
      limit = Math.max(1, parseInt(a.slice("--limit=".length), 10));
    if (a === "--resume") resume = true;
    if (a.startsWith("--delay="))
      delayMs = Math.max(0, parseInt(a.slice("--delay=".length), 10));
  }
  return { limit, resume, delayMs };
}

async function scrapeDigPage(
  page: import("playwright").Page,
  digUrl: string
): Promise<{
  imageUrls: string[];
  excerpt: string;
}> {
  await page.goto(digUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page
    .waitForSelector('img[src*="cloudfront"]', { timeout: 45000 })
    .catch(() => null);
  await sleep(1500);
  const imgs = await page.$$eval("img", (els) =>
    els.map((e) => e.getAttribute("src") ?? "").filter(Boolean)
  );
  const excerpt = await page.evaluate(() =>
    document.body.innerText.slice(0, 4000)
  );
  const abs = imgs.map((src) =>
    src.startsWith("http") ? src : new URL(src, digUrl).href
  );
  const cardUrls = [
    ...new Set(
      abs.filter((u) => u.includes("cloudfront.net/card-images"))
    ),
  ];
  return { imageUrls: cardUrls, excerpt };
}

async function downloadToWebp(
  url: string,
  outPath: string,
  maxDim: number
): Promise<{ width?: number; height?: number }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; TAG-grader-ingest/1.0; personal research)",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  await sharp(buf)
    .resize({
      width: maxDim,
      height: maxDim,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toFile(outPath);
  return { width: meta.width, height: meta.height };
}

async function main() {
  const { limit, resume, delayMs } = parseArgs();
  const indexPath = getCertIndexPath();
  assertFile(indexPath, "CERT_INDEX_PATH");
  const cacheRoot = getDigCacheRoot();
  await fs.mkdir(cacheRoot, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  let processed = 0;
  try {
    const page = await browser.newPage();

    const fh = await fs.open(indexPath, "r");
    const rl = readline.createInterface({
      input: fh.createReadStream(),
      crlfDelay: Infinity,
    });

    const seenCert = new Set<string>();

    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(t);
      } catch {
        continue;
      }
      const certId = String(row.cert_id ?? "");
      const digUrl = String(row.dig_url ?? "");
      if (!certId || !digUrl) continue;
      if (seenCert.has(certId)) continue;
      seenCert.add(certId);

      const dir = path.join(cacheRoot, certId);
      const manifestPath = path.join(dir, "manifest.json");
      if (resume && (await fileExists(manifestPath))) continue;

      if (processed >= limit) break;

      const popCardUrl = String(row.pop_card_url ?? "");
      const images: DigManifest["images"] = [];
      let excerpt = "";
      let err: string | undefined;

      try {
        const scraped = await scrapeDigPage(page, digUrl);
        excerpt = scraped.excerpt;
        await fs.mkdir(dir, { recursive: true });

        let i = 0;
        for (const url of scraped.imageUrls) {
          const kind = classifyImageUrl(url);
          const base = `img_${i}_${kind}.webp`;
          const outFile = path.join(dir, base);
          try {
            const dims = await downloadToWebp(url, outFile, 1536);
            images.push({
              sourceUrl: url,
              fileName: base,
              kind,
              width: dims.width,
              height: dims.height,
            });
            i += 1;
          } catch (e) {
            console.warn(certId, "skip image", url, e);
          }
        }

        if (images.length === 0) {
          err = "no_cloudfront_card_images_found";
        }
      } catch (e) {
        err = String(e);
        await fs.mkdir(dir, { recursive: true });
      }

      const manifest: DigManifest = {
        cert_id: certId,
        dig_url: digUrl,
        pop_card_url: popCardUrl,
        grade_cell: String(row.grade_cell ?? ""),
        grade_bucket: String(row.grade_bucket ?? ""),
        year: String(row.year ?? ""),
        images,
        page_text_excerpt: excerpt,
        fetched_at: new Date().toISOString(),
        error: err,
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      processed += 1;
      console.log(`ok ${processed} ${certId} imgs=${images.length} ${err ?? ""}`);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }

    rl.close();
    await fh.close();
    await page.close();
  } finally {
    await browser.close();
  }
  console.log(`Done. Processed ${processed} certs under ${cacheRoot}`);
}

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
