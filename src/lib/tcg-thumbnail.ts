import Database from "better-sqlite3";

import { getDbPath } from "./config";
import { parsePopCardUrl } from "./parse-pop-card-url";
import {
  getThumbnailCached,
  setThumbnailCache,
  type CardRow,
} from "./search-cards";

/** First card number token for API (e.g. "1/102" → "1", not "1102"). */
function cardNumberForApi(collectorNumber: string): string | null {
  const first = collectorNumber.trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  if (first.includes("/")) {
    const left = first.split("/")[0]?.trim();
    return left && /^\d+$/.test(left) ? left : null;
  }
  const digits = first.replace(/[^\d]/g, "");
  return digits || null;
}

async function fetchCardsQuery(
  q: string,
  apiKey: string
): Promise<string | null> {
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=1`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent":
      "tag-pokemon-grader/1.0 (personal tool; +https://api.pokemontcg.io)",
  };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: Array<{ images?: { small?: string; large?: string } }>;
  };
  const img = json.data?.[0]?.images?.small ?? json.data?.[0]?.images?.large;
  return img ?? null;
}

export async function fetchPokemonTcgThumbnail(
  originalPopUrl: string
): Promise<string | null> {
  const parsed = parsePopCardUrl(originalPopUrl);
  if (!parsed?.displayName) return null;
  const apiKey = process.env.POKEMONTCG_API_KEY ?? "";
  const nameEsc = parsed.displayName.replace(/"/g, '\\"');
  const setEsc = parsed.setName?.replace(/"/g, '\\"') ?? "";
  const numToken = cardNumberForApi(parsed.collectorNumber);
  const fullNumSeg =
    parsed.collectorNumber.trim().split(/\s+/)[0]?.replace(/\s+/g, "") ?? "";

  const tries: string[] = [];
  if (parsed.setName && fullNumSeg.includes("/")) {
    tries.push(`name:"${nameEsc}" set.name:"${setEsc}" number:"${fullNumSeg}"`);
  }
  if (parsed.setName && numToken) {
    tries.push(`name:"${nameEsc}" set.name:"${setEsc}" number:${numToken}`);
    tries.push(`name:"${nameEsc}" number:${numToken}`);
  }
  if (parsed.setName) {
    tries.push(`name:"${nameEsc}" set.name:"${setEsc}"`);
  }
  if (numToken) {
    tries.push(`name:"${nameEsc}" number:${numToken}`);
  }
  tries.push(`name:"${nameEsc}"`);

  for (const q of tries) {
    const img = await fetchCardsQuery(q, apiKey);
    if (img) return img;
  }
  return null;
}

export async function resolveThumbnailUrl(
  db: Database.Database,
  row: CardRow
): Promise<string | null> {
  const cached = getThumbnailCached(db, row.pop_card_url_norm);
  if (cached) return cached;
  const fresh = await fetchPokemonTcgThumbnail(row.original_pop_url);
  if (fresh) {
    try {
      setThumbnailCache(getDbPath(), row.pop_card_url_norm, fresh);
    } catch {
      /* ignore */
    }
  }
  return fresh;
}
