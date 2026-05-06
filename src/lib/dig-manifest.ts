export type DigImageEntry = {
  sourceUrl: string;
  fileName: string;
  kind: "front_main" | "back_main" | "front_sfx" | "back_sfx" | "detail" | "other";
  width?: number;
  height?: number;
};

export type DigManifest = {
  cert_id: string;
  dig_url: string;
  pop_card_url: string;
  grade_cell: string;
  grade_bucket: string;
  year: string;
  images: DigImageEntry[];
  page_text_excerpt: string;
  fetched_at: string;
  error?: string;
};

export function classifyImageUrl(url: string): DigImageEntry["kind"] {
  const lower = url.toLowerCase();
  if (lower.includes("front_main")) return "front_main";
  if (lower.includes("back_main")) return "back_main";
  if (lower.includes("front_sfx")) return "front_sfx";
  if (lower.includes("back_sfx")) return "back_sfx";
  if (/_results\.png$/i.test(lower) || /_(top|bottom|left|right)/i.test(lower))
    return "detail";
  return "other";
}
