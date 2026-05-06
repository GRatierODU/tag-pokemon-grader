/**
 * Print distinct card names derived from indexed TAG pop URLs.
 * Usage: npx tsx scripts/list-card-names.ts [--out=data/pokemon_names.txt]
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

import { parsePopCardUrl } from "../src/lib/parse-pop-card-url";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const outFile = outArg?.slice("--out=".length);

const dbPath = path.join(process.cwd(), "data", "app.db");
const db = new Database(dbPath, { readonly: true });

const urls = db
  .prepare(`SELECT DISTINCT original_pop_url AS u FROM cards`)
  .all()
  .map((r) => (r as { u: string }).u);
db.close();

function fallbackNameFromPath(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const rawParts = u.pathname.split("/").filter(Boolean);
    const parts = rawParts.map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
    const idx = parts.indexOf("Pokémon");
    const seg = idx >= 0 && parts[idx + 3] ? parts[idx + 3] : "";
    return seg.trim() || "";
  } catch {
    return "";
  }
}

const set = new Set<string>();
for (const u of urls) {
  const p = parsePopCardUrl(u);
  let n = p?.displayName?.trim() ?? "";
  if (!n) n = fallbackNameFromPath(u);
  if (n) set.add(n);
}

const names = [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

const body = names.join("\n");
const header = `distinct_names_derived_from_urls\t${names.length}\n---\n`;

if (outFile) {
  fs.writeFileSync(outFile, header + body, "utf8");
  console.log(`Wrote ${names.length} names to ${path.resolve(outFile)}`);
} else {
  console.log(header.trim());
  console.log(body);
}
