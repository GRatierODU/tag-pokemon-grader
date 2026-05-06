export type ParsedPopCard = {
  /** Last ASCII/Latin name segment before /number */
  displayName: string;
  collectorNumber: string;
  setName: string | null;
  variation: string | null;
  year: string | null;
  category: string | null;
};

/**
 * Path pattern:
 * /pop-report/Pokémon/{year}/{category}/{Card Name}/{collectorNo}?setName=&variation=
 */
export function parsePopCardUrl(urlStr: string): ParsedPopCard | null {
  try {
    const u = new URL(urlStr.trim());
    const rawParts = u.pathname.split("/").filter(Boolean);
    const parts = rawParts.map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
    const idx = parts.indexOf("Pokémon");
    const year = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
    const category =
      idx >= 0 && parts[idx + 2]
        ? decodeURIComponent(parts[idx + 2])
        : null;
    const nameSeg =
      idx >= 0 && parts[idx + 3]
        ? decodeURIComponent(parts[idx + 3])
        : "";
    const numSeg =
      idx >= 0 && parts[idx + 4]
        ? decodeURIComponent(parts[idx + 4])
        : "";

    const displayName = extractEnglishName(nameSeg);
    const collectorNumber = numSeg.replace(/\//g, " / ");

    return {
      displayName,
      collectorNumber,
      setName: u.searchParams.get("setName"),
      variation: u.searchParams.get("variation"),
      year,
      category,
    };
  } catch {
    return null;
  }
}

/** Prefer substring after last stretch of non-Latin characters (e.g. Japanese + space + English). */
function extractEnglishName(segment: string): string {
  const trimmed = segment.trim();
  const latin = trimmed.match(/[A-Za-z][A-Za-z\s'\-\d]+$/);
  if (latin) return latin[0].trim();
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] ?? trimmed;
}
