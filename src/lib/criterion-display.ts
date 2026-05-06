import type { GradeOutput, PerCriterionGrade } from "@/lib/grade-schema";

/** Pull a 1–10 style number from strings like "NM-MT(8)" or leading "9.5". */
export function extractNumericFromGradeDisplay(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const paren = t.match(/\((\d+(?:\.\d+)?)\)\s*$/);
  if (paren) {
    const n = Number(paren[1]);
    return Number.isFinite(n) ? n : null;
  }
  const lead = t.match(/^(\d+(?:\.\d+)?)/);
  if (lead) {
    const n = Number(lead[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** Single sub-score 1–10 for the table; ratios-only rows show — with detail in the note. */
export function formatCriterionScore(row: PerCriterionGrade): string {
  if (row.grade_numeric != null && Number.isFinite(row.grade_numeric)) {
    return formatNum(row.grade_numeric);
  }
  const extracted = extractNumericFromGradeDisplay(row.grade_display ?? "");
  if (extracted != null) return formatNum(extracted);
  return "—";
}

function gradeDisplayIsRedundant(row: PerCriterionGrade, shownScore: string): boolean {
  const gd = row.grade_display?.trim() ?? "";
  if (!gd) return true;
  if (gd === shownScore) return true;
  if (row.grade_numeric != null && gd === String(row.grade_numeric)) return true;
  const ex = extractNumericFromGradeDisplay(gd);
  if (ex != null && formatNum(ex) === shownScore) return true;
  return false;
}

/** Measurements, PSA wording, and observations — not the headline number. */
export function formatCriterionNote(row: PerCriterionGrade): string {
  const shown = formatCriterionScore(row);
  const chunks: string[] = [];
  const gd = row.grade_display?.trim() ?? "";
  if (gd && !gradeDisplayIsRedundant(row, shown)) {
    chunks.push(gd);
  }
  const br = row.brief?.trim();
  if (br) chunks.push(br);
  const out = chunks.join(" ").trim();
  return out.length > 0 ? out : "—";
}

/** Split prose into sentences for deduping across parallel runs. */
function sentenceSplit(s: string): string[] {
  const t = s.trim();
  if (!t) return [];
  const rough = t.split(/\s*(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  if (rough.length > 0) return rough;
  return [t];
}

/**
 * Turn independent parallel-run notes into one short narrative (not a dot‑joined list).
 */
export function synthesizeParallelCriterionNotes(notes: string[]): string {
  const parts = notes.map((s) => s.trim()).filter((s) => s && s !== "—");
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0];

  const lower = parts.map((p) => p.toLowerCase());
  const allSame = lower.every((p) => p === lower[0]);
  if (allSame) return parts[0];

  const sorted = [...parts].sort((a, b) => b.length - a.length);
  const primary = sorted[0];
  const primaryLower = primary.toLowerCase();

  const additions: string[] = [];
  for (const p of sorted.slice(1)) {
    for (const sent of sentenceSplit(p)) {
      if (sent.length < 18) continue;
      const sl = sent.toLowerCase();
      const prefixLen = Math.min(48, sl.length);
      if (primaryLower.includes(sl.slice(0, prefixLen))) continue;
      if (
        additions.some((a) =>
          a.toLowerCase().includes(sl.slice(0, Math.min(36, sl.length)))
        )
      ) {
        continue;
      }
      additions.push(sent.endsWith(".") ? sent : `${sent}.`);
      if (additions.length >= 3) break;
    }
    if (additions.length >= 3) break;
  }

  if (additions.length === 0) return primary;

  const lead = primary.trim().replace(/\.\s*$/, "");
  return `Across runs, reviewers largely agree: ${lead}. ${additions.join(" ")}`.replace(
    /\s+/g,
    " "
  );
}

/** Merge criterion rows across parallel grade runs (mean score, summarized detail). */
export function mergePerCriteriaAcrossRuns(
  bundles: { grade: GradeOutput }[]
): PerCriterionGrade[] {
  if (bundles.length === 0) return [];
  if (bundles.length === 1) return bundles[0].grade.per_criteria_grades;

  const names = ["Centering", "Corners", "Edges", "Surfaces"] as const;
  const out: PerCriterionGrade[] = [];

  for (const name of names) {
    const rows: PerCriterionGrade[] = [];
    for (const b of bundles) {
      const row = b.grade.per_criteria_grades.find((r) => r.criterion === name);
      if (row) rows.push(row);
    }
    if (rows.length === 0) continue;

    const parsedNums = rows
      .map((r) => {
        if (r.grade_numeric != null && Number.isFinite(r.grade_numeric)) {
          return r.grade_numeric;
        }
        return extractNumericFromGradeDisplay(r.grade_display ?? "");
      })
      .filter((n): n is number => n != null && Number.isFinite(n));

    let grade_numeric: number | null = null;
    if (parsedNums.length > 0) {
      const avg =
        parsedNums.reduce((a, b) => a + b, 0) / parsedNums.length;
      grade_numeric = Math.min(10, Math.max(1, Math.round(avg * 10) / 10));
    }

    const detailParts = rows
      .map((r) => formatCriterionNote(r))
      .filter((s) => s && s !== "—");
    const brief =
      detailParts.length > 0
        ? synthesizeParallelCriterionNotes(detailParts)
        : undefined;

    out.push({
      criterion: name,
      grade_numeric,
      grade_display: grade_numeric != null ? String(grade_numeric) : "",
      brief,
    });
  }

  return out;
}

export function friendlyConfidenceBand(
  band: GradeOutput["confidence_band"]
): string {
  switch (band) {
    case "low":
      return "Low confidence";
    case "medium":
      return "Medium confidence";
    case "high":
      return "High confidence";
    default:
      return band;
  }
}

/** Map a 0–1 score to low/medium/high for labels (merged consensus). */
export function confidenceBandFromScore(
  score: number
): GradeOutput["confidence_band"] {
  const s = Math.min(1, Math.max(0, score));
  if (s < 0.34) return "low";
  if (s < 0.67) return "medium";
  return "high";
}
