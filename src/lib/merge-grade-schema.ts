import { z } from "zod";

/** Result of synthesizing multiple parallel GradeOutput objects into one narrative. */
export const MergedGradeOutputSchema = z.object({
  merged_report_markdown: z.string(),
  consensus_grade_numeric: z.number(),
  consensus_label: z.string(),
  /** Model-estimated confidence after reconciling runs (0–1). */
  consensus_confidence: z.number().min(0).max(1),
  /** Short note on agreement vs spread across runs. */
  agreement_note: z.string().optional(),
});

export type MergedGradeOutput = z.infer<typeof MergedGradeOutputSchema>;
