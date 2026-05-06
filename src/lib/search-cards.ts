import Database from "better-sqlite3";

/**
 * Strip characters that act as wildcards in SQLite LIKE (%, _).
 */
function sanitizeToken(t: string): string {
  return t.replace(/%/g, "").replace(/_/g, "").trim();
}

export type SearchHit = CardRow & { rank?: number };

export type CardRow = {
  pop_card_url_norm: string;
  display_name: string;
  collector_number: string;
  set_name: string;
  variation: string;
  year: string;
  category: string;
  original_pop_url: string;
};

/** All text we match against so URL-only rows (empty display_name) still show up. */
function searchBlobSql(): string {
  return `(
    COALESCE(display_name, '') || ' ' ||
    COALESCE(set_name, '') || ' ' ||
    COALESCE(variation, '') || ' ' ||
    COALESCE(collector_number, '') || ' ' ||
    COALESCE(category, '') || ' ' ||
    COALESCE(original_pop_url, '')
  )`;
}

/**
 * Substring search across every indexed text field (including raw TAG URL).
 * SQLite LIKE is case-insensitive for ASCII by default (PRAGMA case_sensitive_like=OFF).
 * Multi-word queries require each token to appear somewhere in that combined blob (AND).
 */
export function searchCards(
  db: Database.Database,
  rawQuery: string,
  limit = 50
): SearchHit[] {
  const tokens = rawQuery
    .split(/\s+/)
    .map(sanitizeToken)
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const blob = searchBlobSql();
  const whereParts = tokens.map(() => `${blob} LIKE ? ESCAPE '\\'`);
  const whereSql = whereParts.join(" AND ");

  const patterns = tokens.map((t) => `%${escapeLike(t)}%`);
  const orderedPatterns = [...patterns, patterns[0], limit];

  const stmt = db.prepare(`
    SELECT pop_card_url_norm, display_name, collector_number, set_name, variation,
           year, category, original_pop_url
    FROM cards
    WHERE ${whereSql}
    ORDER BY
      CASE WHEN COALESCE(display_name,'') LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
      LENGTH(COALESCE(display_name,'')) ASC,
      COALESCE(display_name,'') COLLATE NOCASE
    LIMIT ?
  `);

  return stmt.all(...orderedPatterns) as SearchHit[];
}

/** Escape LIKE wildcards after sanitizeToken removed literal % and _. */
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function getThumbnailCached(
  db: Database.Database,
  popNorm: string
): string | null {
  const row = db
    .prepare(
      `SELECT thumbnail_url FROM tcg_thumb_cache WHERE pop_card_url_norm = ?`
    )
    .get(popNorm) as { thumbnail_url: string } | undefined;
  return row?.thumbnail_url ?? null;
}

export function setThumbnailCache(
  dbPath: string,
  popNorm: string,
  thumbnailUrl: string
): void {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT OR REPLACE INTO tcg_thumb_cache (pop_card_url_norm, thumbnail_url, fetched_at)
     VALUES (?, ?, datetime('now'))`
  ).run(popNorm, thumbnailUrl);
  db.close();
}
