/**
 * Writes an SQLite file with tables but no rows (SEARCH returns empty until build:index inputs exist).
 */
import fs from "fs/promises";
import path from "path";

import Database from "better-sqlite3";

import { applyAppDbSchema } from "../src/lib/app-db-schema";
import { getDbPath } from "../src/lib/config";

async function main() {
  const out = getDbPath();
  await fs.mkdir(path.dirname(out), { recursive: true });
  try {
    await fs.unlink(out);
  } catch {
    /* missing ok */
  }
  const db = new Database(out);
  applyAppDbSchema(db, "DELETE");
  db.close();
  console.log(`ensure-empty-db: wrote schema (no rows) → ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
