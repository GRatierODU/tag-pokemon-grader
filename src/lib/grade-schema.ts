import { z } from "zod";

/** TAG-style axis — one estimated sub-grade per criterion (numeric optional when not inferable). */
export const PerCriterionGradeSchema = z.object({
  criterion: z.string(),
  /** TAG-like numeric sub-score when inferable (1–10); interpretation depends on grader (TAG axis vs sparse PSA shorthand). */
  grade_numeric: z.number().min(1).max(10).nullable().optional(),
  /** Legacy/auxiliary; prose belongs in brief. */
  grade_display: z.preprocess(
    (v) => (v == null || v === undefined ? "" : String(v)),
    z.string()
  ),
  brief: z.string().optional(),
});

export const GradeOutputSchema = z.object({
  predicted_grade_numeric: z.number(),
  predicted_grade_bucket: z.string(),
  /** Short human tier line (e.g. Gem Mint). Not CSS. */
  predicted_grade_label: z.string(),
  rationale_by_subcategory: z.record(z.string(), z.string()),
  caveat_list: z.array(z.string()),
  closest_exemplar_cert_ids: z.array(z.string()),
  /** Overall model calibration confidence for this estimate (0 = very uncertain, 1 = highly confident). */
  confidence_score: z.number().min(0).max(1),
  confidence_band: z.enum(["low", "medium", "high"]),
  /** Ordered breakdown — Centering, Corners, Edges, Surfaces (combined front/back). */
  per_criteria_grades: z.array(PerCriterionGradeSchema),
  report_markdown: z.string(),
});

export type GradeOutput = z.infer<typeof GradeOutputSchema>;
export type PerCriterionGrade = z.infer<typeof PerCriterionGradeSchema>;
