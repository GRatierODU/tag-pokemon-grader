import { NextResponse } from "next/server";
import { z } from "zod";

import { mergeParallelGradeReports } from "@/lib/gemini-merge";
import { GradeOutputSchema } from "@/lib/grade-schema";

export const runtime = "nodejs";

const BodySchema = z.object({
  card_label: z.string(),
  grader: z.enum(["tag", "psa"]),
  runs: z.array(GradeOutputSchema).min(2).max(5),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { card_label, grader, runs } = parsed.data;
    const merged = await mergeParallelGradeReports({
      cardLabel: card_label,
      graderMode: grader,
      runs,
    });
    return NextResponse.json({ ok: true, merged });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
