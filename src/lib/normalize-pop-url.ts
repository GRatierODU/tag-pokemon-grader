/**
 * Canonical key for matching certs ↔ card picker rows.
 */
export function normalizePopCardUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const entries = [...u.searchParams.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const sp = new URLSearchParams(entries);
    const q = sp.toString();
    const pathname = decodeURIComponent(u.pathname);
    return `${u.origin}${pathname}${q ? `?${q}` : ""}`;
  } catch {
    return raw.trim();
  }
}

/** Broad TAG English filter: drop JP portal rows (see plan). */
export function isEnglishTagPopUrl(url: string): boolean {
  return !url.includes("Pokémon Japanese");
}
