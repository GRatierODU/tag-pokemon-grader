import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import {
  gradeWithGemini,
  stratifiedCertPick,
  type CertMeta,
  type GraderMode,
} from "@/lib/gemini-grade";
import type { GradeOutput } from "@/lib/grade-schema";

export const runtime = "nodejs";

const CONFIDENCE_TARGET = 0.8;
const MAX_ATTEMPTS = 5;

const EXEMPLAR_TIERS = [
  { maxTotal: 12, perBucket: 3 },
  { maxTotal: 18, perBucket: 4 },
  { maxTotal: 24, perBucket: 5 },
  { maxTotal: 28, perBucket: 6 },
] as const;

type StopReason = "confidence_met" | "max_attempts" | "exhausted_exemplars";

/** Stable bucket for splitting the exemplar pool across parallel requests (when enough certs exist). */
function exemplarSlotForCert(certId: string, slotCount: number): number {
  let h = 2166136261;
  for (let i = 0; i < certId.length; i++) {
    h ^= certId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % slotCount;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const popNorm = String(form.get("pop_card_url_norm") ?? "");
    const condition = String(form.get("raw_condition") ?? "NM");
    const cardLabel = String(form.get("card_label") ?? "");
    const popUrl = String(form.get("pop_card_url") ?? "");
    const front = form.get("front");
    const back = form.get("back");

    /** 0-based index from client so parallel runs skew toward different slabs */
    const exemplarVariantRaw = form.get("exemplar_variant");
    const exemplarVariant =
      exemplarVariantRaw != null && String(exemplarVariantRaw).trim() !== ""
        ? Math.max(
            0,
            Math.min(
              31,
              Number.parseInt(String(exemplarVariantRaw), 10) || 0
            )
          )
        : 0;

    /** When >1, optional partition of cert pool by slot (only if enough rows). */
    const parallelCountRaw = form.get("parallel_count");
    const parallelCount =
      parallelCountRaw != null && String(parallelCountRaw).trim() !== ""
        ? Math.max(1, Math.min(5, Number.parseInt(String(parallelCountRaw), 10) || 1))
        : 1;

    const graderRaw = String(form.get("grader") ?? "tag").toLowerCase();
    const graderMode: GraderMode = graderRaw === "psa" ? "psa" : "tag";

    if (!popNorm || !popUrl) {
      return NextResponse.json(
        { error: "Missing card selection." },
        { status: 400 }
      );
    }
    if (!(front instanceof File) || !(back instanceof File)) {
      return NextResponse.json(
        { error: "Front and back images are required." },
        { status: 400 }
      );
    }

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT cert_id, pop_card_url_norm, grade_bucket, grade_cell, dig_url
         FROM certs WHERE pop_card_url_norm = ?`
      )
      .all(popNorm) as CertMeta[];

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No indexed certs for this card in the local database. Re-run build:index or pick another listing.",
        },
        { status: 404 }
      );
    }

    const MIN_ROWS_FOR_PARTITION = parallelCount * 6;
    const MIN_PARTITIONED_CERTS = 8;
    let certPool = rows;
    if (
      parallelCount > 1 &&
      exemplarVariant < parallelCount &&
      rows.length >= MIN_ROWS_FOR_PARTITION
    ) {
      const partitioned = rows.filter(
        (c) => exemplarSlotForCert(c.cert_id, parallelCount) === exemplarVariant
      );
      if (partitioned.length >= MIN_PARTITIONED_CERTS) {
        certPool = partitioned;
      }
    }

    const usedCertIds = new Set<string>();
    let result: GradeOutput | null = null;
    let lastExemplarIds: string[] = [];
    let attemptsRun = 0;
    let stopReason: StopReason = "max_attempts";

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const tier = EXEMPLAR_TIERS[Math.min(attempt, EXEMPLAR_TIERS.length - 1)];
      const exemplars = stratifiedCertPick(certPool, {
        maxTotal: tier.maxTotal,
        perBucket: tier.perBucket,
        excludeCertIds: usedCertIds,
        bucketRotation: attempt * 11 + exemplarVariant * 17,
      });

      if (exemplars.length === 0) {
        if (result) {
          stopReason = "exhausted_exemplars";
        }
        break;
      }

      for (const e of exemplars) {
        usedCertIds.add(e.cert_id);
      }

      result = await gradeWithGemini({
        cardLabel: cardLabel || popUrl,
        rawCondition: condition,
        popCardUrl: popUrl,
        exemplars,
        userFront: front,
        userBack: back,
        graderMode,
      });
      lastExemplarIds = exemplars.map((e) => e.cert_id);
      attemptsRun = attempt + 1;

      if (result.confidence_score >= CONFIDENCE_TARGET) {
        stopReason = "confidence_met";
        break;
      }

      if (usedCertIds.size >= certPool.length) {
        stopReason = "exhausted_exemplars";
        break;
      }
    }

    if (!result) {
      return NextResponse.json(
        { error: "Could not select exemplar slabs for grading." },
        { status: 500 }
      );
    }

    const exemplarDigUrls: Record<string, string> = {};
    for (const id of lastExemplarIds) {
      const hit = rows.find((r) => r.cert_id === id);
      if (hit?.dig_url) exemplarDigUrls[id] = hit.dig_url;
    }

    return NextResponse.json({
      ok: true,
      grade: result,
      exemplar_ids: lastExemplarIds,
      exemplar_dig_urls: exemplarDigUrls,
      confidence_retry: {
        attempts: attemptsRun,
        target: CONFIDENCE_TARGET,
        target_met: result.confidence_score >= CONFIDENCE_TARGET,
        stopped_reason: stopReason,
        unique_exemplars_seen: usedCertIds.size,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
