import fs from "fs/promises";
import path from "path";
import readline from "readline";
import Database from "better-sqlite3";

import { applyAppDbSchema } from "../src/lib/app-db-schema";
import {
  getCardUrlsPath,
  getCertIndexPath,
  assertFile,
  getDbPath,
} from "../src/lib/config";
import {
  normalizePopCardUrl,
  isEnglishTagPopUrl,
} from "../src/lib/normalize-pop-url";
import { parsePopCardUrl } from "../src/lib/parse-pop-card-url";

const argv = process.argv.slice(2);
const dbArg = argv.find((a) => a.startsWith("--db="));
const outDb = dbArg?.slice("--db=".length) ?? getDbPath();

async function main() {
  const cardUrlsPath = getCardUrlsPath();
  const certPath = getCertIndexPath();
  assertFile(cardUrlsPath, "CARD_URLS_PATH");
  assertFile(certPath, "CERT_INDEX_PATH");

  await fs.mkdir(path.dirname(outDb), { recursive: true });
  try {
    await fs.unlink(outDb);
  } catch {
    /* missing ok */
  }

  const db = new Database(outDb);
  applyAppDbSchema(db, "WAL");

  const insertCard = db.prepare(`
    INSERT OR REPLACE INTO cards (
      pop_card_url_norm, display_name, collector_number, set_name, variation,
      year, category, original_pop_url
    ) VALUES (@pop_card_url_norm, @display_name, @collector_number, @set_name, @variation,
      @year, @category, @original_pop_url)
  `);

  const insertCert = db.prepare(`
    INSERT INTO certs (
      cert_id, pop_card_url_norm, grade_bucket, grade_cell, dig_url, year, indexed_at_utc
    ) VALUES (@cert_id, @pop_card_url_norm, @grade_bucket, @grade_cell, @dig_url, @year, @indexed_at_utc)
  `);

  const insertFts = db.prepare(`
    INSERT INTO cards_fts (rowid, display_name, set_name, variation, collector_number)
    VALUES (@rowid, @display_name, @set_name, @variation, @collector_number)
  `);
  const insertFtsDoc = db.prepare(`
    INSERT INTO cards_fts_doc (rowid, pop_card_url_norm) VALUES (@rowid, @pop_card_url_norm)
  `);

  let ftsRowId = 1;

  const seenNorm = new Set<string>();

  const fh = await fs.open(cardUrlsPath, "r");
  const rl = readline.createInterface({
    input: fh.createReadStream(),
    crlfDelay: Infinity,
  });
  let cardLines = 0;
  for await (const line of rl) {
    const u = line.trim();
    if (!u.startsWith("http")) continue;
    if (!isEnglishTagPopUrl(u)) continue;
    const norm = normalizePopCardUrl(u);
    if (seenNorm.has(norm)) continue;
    seenNorm.add(norm);
    const parsed = parsePopCardUrl(u);
    if (!parsed) continue;
    insertCard.run({
      pop_card_url_norm: norm,
      display_name: parsed.displayName,
      collector_number: parsed.collectorNumber,
      set_name: parsed.setName ?? "",
      variation: parsed.variation ?? "",
      year: parsed.year ?? "",
      category: parsed.category ?? "",
      original_pop_url: u,
    });
    insertFtsDoc.run({
      rowid: ftsRowId,
      pop_card_url_norm: norm,
    });
    insertFts.run({
      rowid: ftsRowId,
      display_name: parsed.displayName,
      set_name: parsed.setName ?? "",
      variation: parsed.variation ?? "",
      collector_number: parsed.collectorNumber,
    });
    ftsRowId += 1;
    cardLines += 1;
  }
  rl.close();
  await fh.close();

  const certFh = await fs.open(certPath, "r");
  const rl2 = readline.createInterface({
    input: certFh.createReadStream(),
    crlfDelay: Infinity,
  });
  let certLines = 0;
  const selCard = db.prepare(`SELECT 1 FROM cards WHERE pop_card_url_norm = ?`);
  for await (const line of rl2) {
    const lineTrim = line.trim();
    if (!lineTrim) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(lineTrim);
    } catch {
      continue;
    }
    const pop = String(row.pop_card_url ?? "");
    if (!isEnglishTagPopUrl(pop)) continue;
    const norm = normalizePopCardUrl(pop);
    if (!selCard.get(norm)) continue;
    insertCert.run({
      cert_id: String(row.cert_id),
      pop_card_url_norm: norm,
      grade_bucket: String(row.grade_bucket ?? ""),
      grade_cell: String(row.grade_cell ?? ""),
      dig_url: String(row.dig_url ?? ""),
      year: String(row.year ?? ""),
      indexed_at_utc: String(row.indexed_at_utc ?? ""),
    });
    certLines += 1;
  }
  rl2.close();
  await certFh.close();

  db.close();
  console.log(
    `Indexed cards=${cardLines}, english certs linked=${certLines}, db=${outDb}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
