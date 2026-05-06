import { GoogleGenAI } from "@google/genai";

import type { GradeOutput } from "./grade-schema";
import type { GraderMode } from "./gemini-grade";
import { MergedGradeOutputSchema, type MergedGradeOutput } from "./merge-grade-schema";

function stripGradeForMerge(g: GradeOutput, slot: number) {
  return {
    slot,
    predicted_grade_numeric: g.predicted_grade_numeric,
    predicted_grade_label: g.predicted_grade_label,
    predicted_grade_bucket: g.predicted_grade_bucket,
    confidence_score: g.confidence_score,
    confidence_band: g.confidence_band,
    per_criteria_grades: g.per_criteria_grades,
    caveat_list: g.caveat_list,
    closest_exemplar_cert_ids: g.closest_exemplar_cert_ids,
    report_markdown: g.report_markdown,
    rationale_by_subcategory: g.rationale_by_subcategory,
  };
}

export async function mergeParallelGradeReports(params: {
  cardLabel: string;
  graderMode: GraderMode;
  runs: GradeOutput[];
}): Promise<MergedGradeOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey });

  const { cardLabel, graderMode, runs } = params;
  if (runs.length < 2) {
    throw new Error("mergeParallelGradeReports requires at least 2 runs");
  }

  const payload = runs.map((g, i) => stripGradeForMerge(g, i + 1));

  const prompt = `Unofficial TCG grade estimate — **merge parallel runs**.

Context: the same user photos were graded ${runs.length} times with **different TAG DIG exemplar draws** (blind variation). Rubric language: **${graderMode === "psa" ? "PSA-oriented" : "TAG-oriented"}**.

Card: ${cardLabel}

Runs (JSON — each includes prior narrative report_markdown + scores):
${JSON.stringify(payload, null, 2)}

Tasks:
1) Write **one** cohesive markdown report for the user: synthesize findings, call out where runs agreed vs diverged, and explain spread (centering vs corners vs noise).
2) Give a **consensus** integer grade (same scale as inputs, typically 1–10) and a short **consensus_label** (tier phrase).
3) Set **consensus_confidence** 0–1 reflecting how stable the conclusion is across runs (lower if estimates diverge widely).

Footer: brief reminder this is unofficial / not PSA or TAG.

Return **JSON only**, no markdown fences:
{
  "merged_report_markdown": string,
  "consensus_grade_numeric": number,
  "consensus_label": string,
  "consensus_confidence": number,
  "agreement_note": string
}`;

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const text = response.text ?? "";
  let jsonStr = text.trim();
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();

  const parsed = JSON.parse(jsonStr);
  const check = MergedGradeOutputSchema.safeParse(parsed);
  if (!check.success) {
    throw new Error(`Merge JSON failed validation: ${check.error.message}`);
  }
  return check.data;
}
