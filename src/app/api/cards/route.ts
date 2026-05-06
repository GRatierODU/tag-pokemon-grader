import { NextResponse } from "next/server";

import { initSqliteForServerless } from "@/lib/sqlite-remote-bootstrap";
import { getDb } from "@/lib/db";
import { parsePopCardUrl } from "@/lib/parse-pop-card-url";
import { searchCards } from "@/lib/search-cards";
import { resolveThumbnailUrl } from "@/lib/tcg-thumbnail";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    await initSqliteForServerless();
    const db = getDb();
    const hits = searchCards(db, q, 50);
    /** Resolve thumbnails one-by-one to avoid pokemontcg.io rate limits from parallel bursts. */
    const results: Array<{
      pop_card_url_norm: string;
      title: string;
      subtitle: string;
      thumbnailUrl: string | null;
      original_pop_url: string;
    }> = [];
    for (const row of hits) {
      const thumbnailUrl = await resolveThumbnailUrl(db, row);
      const parsed = parsePopCardUrl(row.original_pop_url);
      const title =
        row.display_name?.trim() ||
        parsed?.displayName?.trim() ||
        "Unknown card";
      results.push({
        pop_card_url_norm: row.pop_card_url_norm,
        title,
        subtitle: [row.set_name, row.variation, row.collector_number]
          .filter(Boolean)
          .join(" · "),
        thumbnailUrl,
        original_pop_url: row.original_pop_url,
      });
    }
    return NextResponse.json({ results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, results: [] }, { status: 500 });
  }
}
