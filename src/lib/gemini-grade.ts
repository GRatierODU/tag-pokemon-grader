import { GoogleGenAI } from "@google/genai";

import { loadManifestImagesForGemini } from "./dig-exemplar-loader";
export { loadManifestImagesForGemini };
import { extractNumericFromGradeDisplay } from "./criterion-display";
import { GradeOutputSchema, type GradeOutput } from "./grade-schema";

export type CertMeta = {
  cert_id: string;
  pop_card_url_norm: string;
  grade_bucket: string;
  grade_cell: string;
  dig_url: string;
};

/** Which third-party rubric language to emulate (exemplars remain TAG POP/DIG slabs). */
export type GraderMode = "tag" | "psa";

export type { GradeOutput };

function sortBucketsNumeric(a: string, b: string): number {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;
  return b.localeCompare(a);
}

function rotateList<T>(items: T[], offset: number): T[] {
  if (items.length === 0) return items;
  const o = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(o), ...items.slice(0, o)];
}

export type StratifiedPickOptions = {
  maxTotal: number;
  perBucket: number;
  /** Certs already used in a previous Gemini attempt — omitted so retries see other slabs. */
  excludeCertIds?: ReadonlySet<string>;
  /** Rotate within each grade bucket so retries prefer different DIG reports. */
  bucketRotation?: number;
};

/** Pick diverse slab exemplars across grade buckets (round-robin per bucket). */
export function stratifiedCertPick(
  certs: CertMeta[],
  options: StratifiedPickOptions
): CertMeta[] {
  const exclude = options.excludeCertIds;
  const byBucket = new Map<string, CertMeta[]>();
  for (const c of certs) {
    if (exclude?.has(c.cert_id)) continue;
    const k = c.grade_bucket || "?";
    const arr = byBucket.get(k) ?? [];
    arr.push(c);
    byBucket.set(k, arr);
  }
  const buckets = [...byBucket.keys()].sort(sortBucketsNumeric);
  const rot = options.bucketRotation ?? 0;
  const capped = buckets.map((b, bi) => {
    const full = byBucket.get(b) ?? [];
    const rotated = rotateList(full, rot + bi * 3);
    return rotated.slice(0, options.perBucket);
  });
  const out: CertMeta[] = [];
  let round = 0;
  while (out.length < options.maxTotal) {
    let addedRound = false;
    for (let i = 0; i < buckets.length; i++) {
      const row = capped[i];
      if (row[round]) {
        out.push(row[round]);
        addedRound = true;
        if (out.length >= options.maxTotal) break;
      }
    }
    if (!addedRound) break;
    round += 1;
  }
  return out;
}

/** Fewer images per exemplar when the slab set is large (context limits). */
export function maxImagesPerExemplarForCount(exemplarCount: number): number {
  if (exemplarCount <= 12) return 4;
  if (exemplarCount <= 18) return 3;
  return 2;
}

/**
 * Slab images per exemplar cert: env `GEMINI_MAX_IMAGES_PER_EXEMPLAR` overrides scaling.
 * Use `all` / `unlimited` / `0` to send every listed image from each DIG manifest (watch token/size limits).
 */
export function slabImagesCapForRequest(
  exemplarCount: number,
  explicit?: number
): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const raw = process.env.GEMINI_MAX_IMAGES_PER_EXEMPLAR?.trim().toLowerCase();
  if (raw != null && raw !== "") {
    if (raw === "all" || raw === "unlimited" || raw === "0") {
      return Number.POSITIVE_INFINITY;
    }
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return maxImagesPerExemplarForCount(exemplarCount);
}

async function fileToBase64Part(file: File): Promise<{
  mimeType: string;
  base64: string;
}> {
  const buf = Buffer.from(await file.arrayBuffer());
  let mime = file.type || "image/jpeg";
  if (!mime.startsWith("image/")) mime = "image/jpeg";
  return { mimeType: mime, base64: buf.toString("base64") };
}

function graderPromptSection(mode: GraderMode): string {
  if (mode === "psa") {
    return `RUBRIC: **PSA-oriented (unofficial)**. Exemplars are **TAG DIG slabs** — visual anchors only; use PSA hobby terms. Never imply exemplars are PSA.

Per criterion: \`grade_numeric\` = single **1–10** sub-score (centering: approximate alignment score). Put border ratios (e.g. 55/45 L/R), NM-MT/Gem wording, and observations in \`brief\` only — not in \`grade_display\`. Corners/Edges/Surfaces: numeric sub-score + detail in \`brief\`. Overall \`predicted_grade_numeric\` is PSA-like 1–10.`;
  }
  return `RUBRIC: **TAG-oriented (unofficial)**. Per criterion: \`grade_numeric\` = **1–10** axis score; put explanations in \`brief\`; keep \`grade_display\` empty or repeat the number only if needed.`;
}

function looksLikeInlineCss(s: string): boolean {
  return /color\s*:|#[0-9a-fA-F]{3,8}\b|font-weight\s*:/i.test(s);
}

/** Legacy field names / shapes from older prompts. */
function coerceGradeOutputJson(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };

  const legacyCell = o.predicted_grade_cell_style;
  if (typeof o.predicted_grade_label !== "string" || !o.predicted_grade_label.trim()) {
    if (typeof legacyCell === "string" && legacyCell.trim()) {
      o.predicted_grade_label = looksLikeInlineCss(legacyCell)
        ? String(o.predicted_grade_bucket ?? "Estimate")
        : legacyCell.trim();
    } else {
      o.predicted_grade_label = String(o.predicted_grade_bucket ?? "");
    }
  }
  delete o.predicted_grade_cell_style;

  const rows = o.per_criteria_grades;
  if (Array.isArray(rows)) {
    o.per_criteria_grades = rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const r = { ...(row as Record<string, unknown>) };
      const gn = r.grade_numeric;
      const missingGn =
        gn === null ||
        gn === undefined ||
        (typeof gn === "number" && Number.isNaN(gn));
      if (missingGn && typeof r.grade_display === "string") {
        const n = extractNumericFromGradeDisplay(r.grade_display);
        if (n != null) {
          r.grade_numeric = Math.min(10, Math.max(1, n));
        }
      }
      return r;
    });
  }

  return o;
}

export async function gradeWithGemini(params: {
  cardLabel: string;
  rawCondition: string;
  popCardUrl: string;
  exemplars: CertMeta[];
  userFront: File;
  userBack: File;
  /** Override slab images per cert (default scales down when many exemplars). */
  maxImagesPerExemplar?: number;
  /** TAG vs PSA grading language; exemplars remain TAG DIG slabs either way. */
  graderMode?: GraderMode;
}): Promise<GradeOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const model =
    process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

  const ai = new GoogleGenAI({ apiKey });

  const slabImagesCap = slabImagesCapForRequest(
    params.exemplars.length,
    params.maxImagesPerExemplar
  );

  const graderMode = params.graderMode ?? "tag";

  const userPhotos = await Promise.all([
    fileToBase64Part(params.userFront),
    fileToBase64Part(params.userBack),
  ]);

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  parts.push({
    text: `Unofficial TCG condition estimate.

${graderPromptSection(graderMode)}

Footer disclaimers (short): not PSA/TAG official; exemplars are TAG DIG slabs for calibration only.

Card:
- URL: ${params.popCardUrl}
- Label: ${params.cardLabel}
- Raw bucket: ${params.rawCondition}

Inputs: USER front → USER back → TAG DIG exemplar images (TAG grade labels on certs).

Tasks:
1) Narrative per RUBRIC: centering, corners, edges, surfaces (holos if visible).
2) Overall grade using exemplars as anchors; express in chosen rubric (${graderMode === "psa" ? "PSA" : "TAG"}).
3) per_criteria_grades: exactly 4 rows — "Centering", "Corners", "Edges", "Surfaces". Each row: **grade_numeric** 1–10 (required when inferable). Put ratios, NM-MT/Gem text, and observations in **brief** only. **grade_display**: omit, or repeat the same number as a string — never put long prose there.
4) confidence_score 0–1; confidence_band low|medium|high.
5) predicted_grade_label: short tier words for humans (e.g. Gem Mint, NM-MT). **Never** CSS, colors, or "font-weight".

JSON keys only, no markdown fences:
{
  "predicted_grade_numeric": number,
  "predicted_grade_bucket": string,
  "predicted_grade_label": string,
  "rationale_by_subcategory": Record<string, string>,
  "caveat_list": string[],
  "closest_exemplar_cert_ids": string[],
  "confidence_score": number,
  "confidence_band": "low" | "medium" | "high",
  "per_criteria_grades": Array<{
    "criterion": string,
    "grade_numeric": number | null,
    "grade_display"?: string,
    "brief"?: string
  }>,
  "report_markdown": string
}

report_markdown: headings/bullets matching RUBRIC (${graderMode === "psa" ? "PSA terms; ratios if inferable" : "TAG-style"}).`,
  });

  parts.push({
    text: "USER — front:",
  });
  parts.push({
    inlineData: {
      mimeType: userPhotos[0].mimeType,
      data: userPhotos[0].base64,
    },
  });
  parts.push({
    text: "USER — back:",
  });
  parts.push({
    inlineData: {
      mimeType: userPhotos[1].mimeType,
      data: userPhotos[1].base64,
    },
  });

  for (const ex of params.exemplars) {
    parts.push({
      text: `EXEMPLAR cert_id=${ex.cert_id} bucket=${ex.grade_bucket} cell=${ex.grade_cell}`,
    });
    try {
      const imgs = await loadManifestImagesForGemini(
        ex.cert_id,
        slabImagesCap
      );
      for (const im of imgs) {
        parts.push({ text: `Image ${im.label}` });
        parts.push({
          inlineData: { mimeType: im.mimeType, data: im.base64 },
        });
      }
    } catch {
      parts.push({
        text: `(manifest images missing for ${ex.cert_id} — metadata-only exemplar)`,
      });
    }
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
  });

  const text = response.text ?? "";

  let jsonStr = text.trim();
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();

  const parsed = JSON.parse(jsonStr);
  const check = GradeOutputSchema.safeParse(coerceGradeOutputJson(parsed));
  if (!check.success) {
    throw new Error(`Model JSON failed validation: ${check.error.message}`);
  }
  return check.data;
}
