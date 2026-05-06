import fs from "fs";
import Database from "better-sqlite3";

import { assertFile, getDbPath } from "./config";

let dbSingleton: Database.Database | null = null;
/** Detect rebuild/replace of app.db so we don't keep a stale handle (common on Windows after `build:index`). */
let dbFileSignature = 0;

function currentDbSignature(pathname: string): number {
  const st = fs.statSync(pathname);
  return st.mtimeMs + st.size;
}

export function getDb(): Database.Database {
  const pathname = getDbPath();
  assertFile(pathname, "SQLite DB (run npm run build:index)");
  const sig = currentDbSignature(pathname);
  if (dbSingleton && sig !== dbFileSignature) {
    try {
      dbSingleton.close();
    } catch {
      /* ignore */
    }
    dbSingleton = null;
  }
  if (!dbSingleton) {
    const options = process.env.VERCEL ? { readonly: true } : undefined;
    dbSingleton = new Database(pathname, options);
    dbFileSignature = sig;
  }
  return dbSingleton;
}
