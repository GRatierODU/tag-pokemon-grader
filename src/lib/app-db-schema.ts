import type Database from "better-sqlite3";

/** DDL for `app.db`; keep in sync with `scripts/build-index.ts` output. */
export const APP_DB_CORE_SCHEMA = `
CREATE TABLE cards (
  pop_card_url_norm TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  collector_number TEXT,
  set_name TEXT,
  variation TEXT,
  year TEXT,
  category TEXT,
  original_pop_url TEXT NOT NULL
);
CREATE TABLE certs (
  cert_id TEXT PRIMARY KEY,
  pop_card_url_norm TEXT NOT NULL,
  grade_bucket TEXT,
  grade_cell TEXT,
  dig_url TEXT NOT NULL,
  year TEXT,
  indexed_at_utc TEXT,
  FOREIGN KEY (pop_card_url_norm) REFERENCES cards(pop_card_url_norm)
);
CREATE INDEX idx_certs_pop ON certs(pop_card_url_norm);
CREATE INDEX idx_certs_bucket ON certs(pop_card_url_norm, grade_bucket);
CREATE VIRTUAL TABLE cards_fts USING fts5(
  display_name,
  set_name,
  variation,
  collector_number,
  tokenize = 'unicode61'
);
CREATE TABLE cards_fts_doc (
  rowid INTEGER PRIMARY KEY,
  pop_card_url_norm TEXT UNIQUE NOT NULL
);
CREATE TABLE tcg_thumb_cache (
  pop_card_url_norm TEXT PRIMARY KEY,
  thumbnail_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);`.trim();

export function applyAppDbSchema(
  db: Database.Database,
  journalMode: "WAL" | "DELETE" = "DELETE"
) {
  db.pragma(`journal_mode=${journalMode}`);
  db.exec(APP_DB_CORE_SCHEMA);
}
