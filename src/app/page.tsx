"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  formatCriterionNote,
  formatCriterionScore,
  mergePerCriteriaAcrossRuns,
} from "@/lib/criterion-display";
import { ReportMarkdown } from "@/components/report-markdown";
import { CameraWithLevelOverlay } from "@/components/camera-with-level-overlay";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { requestOrientationPermissionThen } from "@/hooks/use-device-tilt";
import type { MergedGradeOutput } from "@/lib/merge-grade-schema";
import type { GradeOutput } from "@/lib/grade-schema";
import type { GraderMode } from "@/lib/gemini-grade";

type ConfidenceRetryInfo = {
  attempts: number;
  target: number;
  target_met: boolean;
  stopped_reason: "confidence_met" | "max_attempts" | "exhausted_exemplars";
  unique_exemplars_seen: number;
};

type SearchRow = {
  pop_card_url_norm: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  original_pop_url: string;
};

const CONDITIONS = ["NM", "LP", "HP", "DMG"] as const;

const WIZARD_STEPS = [
  { id: 1, label: "Card", hint: "Search and select" },
  { id: 2, label: "Photos", hint: "Front and back" },
  { id: 3, label: "Grade", hint: "Rubric and run" },
  { id: 4, label: "Report", hint: "Results" },
] as const;

/** Panel chrome aligned with report cards */
const shell =
  "rounded-2xl border border-slate-200/95 bg-white shadow-lg shadow-slate-300/35 ring-1 ring-slate-100";
const sectionEyebrow =
  "text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-600";
const fieldLabel = "block text-sm font-medium text-slate-800";
const inputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
const btnPrimary =
  "inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40 touch-manipulation min-h-[44px] sm:min-h-0";
const btnMuted =
  "inline-flex items-center justify-center rounded-xl border border-slate-300 bg-slate-50 px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-40 touch-manipulation min-h-[44px] sm:min-h-0";

const PER_CRITERIA_ORDER = [
  "Centering",
  "Corners",
  "Edges",
  "Surfaces",
] as const;

function orderedPerCriteria(grades: GradeOutput["per_criteria_grades"]) {
  const rank = new Map<string, number>(
    PER_CRITERIA_ORDER.map((c, i) => [c, i])
  );
  return [...grades].sort((a, b) => {
    const ra = rank.get(a.criterion) ?? 999;
    const rb = rank.get(b.criterion) ?? 999;
    if (ra !== rb) return ra - rb;
    return a.criterion.localeCompare(b.criterion);
  });
}

type GradeRunBundle = {
  grade: GradeOutput;
  exemplar_ids: string[];
  /** cert_id → TAG DIG report URL from local index */
  exemplar_dig_urls: Record<string, string>;
  confidence_retry: ConfidenceRetryInfo | null;
  parallelSlot?: number;
};

function parseGradeApiError(data: unknown, res: Response): string {
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const err = o.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      const m = (err as { message?: unknown }).message;
      if (typeof m === "string") return m;
    }
    if (typeof o.message === "string" && !("grade" in o)) return o.message;
  }
  return res.statusText || "Request failed";
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export default function Home() {
  const [step, setStep] = useState(1);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchRow[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SearchRow | null>(null);
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]>("NM");
  const [graderMode, setGraderMode] = useState<GraderMode>("tag");
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [runBundles, setRunBundles] = useState<GradeRunBundle[]>([]);
  const [mergedReport, setMergedReport] = useState<MergedGradeOutput | null>(
    null
  );
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergingReports, setMergingReports] = useState(false);
  const [parallelFailures, setParallelFailures] = useState<
    { slot: number; message: string }[]
  >([]);
  const [parallelRuns, setParallelRuns] = useState(1);
  const [frontPreviewUrl, setFrontPreviewUrl] = useState<string | null>(null);
  const [backPreviewUrl, setBackPreviewUrl] = useState<string | null>(null);
  const [gradeProgress, setGradeProgress] = useState(0);
  const [cameraOpen, setCameraOpen] = useState<null | "front" | "back">(null);

  const frontGalRef = useRef<HTMLInputElement>(null);
  const backGalRef = useRef<HTMLInputElement>(null);

  const isMobile = useIsMobile();

  const mergedHead =
    mergedReport != null && runBundles.length > 1 ? mergedReport : null;

  const displayConfidence = useMemo(() => {
    if (runBundles.length === 0) return 0;
    return mergedHead
      ? mergedHead.consensus_confidence
      : runBundles[0].grade.confidence_score;
  }, [mergedHead, runBundles]);

  const criteriaRows = useMemo(() => {
    if (runBundles.length === 0) return [];
    const firstGrades = runBundles[0].grade.per_criteria_grades ?? [];
    if (runBundles.length === 1) {
      return orderedPerCriteria(firstGrades);
    }
    return mergePerCriteriaAcrossRuns(runBundles);
  }, [runBundles]);

  const exemplarEntries = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const b of runBundles) {
      const urls = b.exemplar_dig_urls ?? {};
      for (const id of b.exemplar_ids) {
        if (!map.has(id)) map.set(id, urls[id]);
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [runBundles]);

  useEffect(() => {
    if (!front) {
      setFrontPreviewUrl(null);
      return;
    }
    const u = URL.createObjectURL(front);
    setFrontPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [front]);

  useEffect(() => {
    if (!back) {
      setBackPreviewUrl(null);
      return;
    }
    const u = URL.createObjectURL(back);
    setBackPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [back]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setLoadingSearch(true);
    setSearchError(null);
    fetch(`/api/cards?q=${encodeURIComponent(debounced)}`)
      .then(async (r) => {
        const data = (await r.json()) as {
          results?: SearchRow[];
          error?: string;
        };
        if (!r.ok) {
          throw new Error(data.error ?? r.statusText ?? "Search failed");
        }
        if (!cancelled) setResults(data.results ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setResults([]);
          setSearchError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSearch(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    if (step !== 2) setCameraOpen(null);
  }, [step]);

  useEffect(() => {
    if (!grading) {
      setGradeProgress(0);
      return;
    }
    setGradeProgress(6);
    const id = setInterval(() => {
      setGradeProgress((p) => {
        if (p >= 94) return p;
        return p + Math.max(0.2, (93 - p) * 0.072);
      });
    }, 110);
    return () => clearInterval(id);
  }, [grading]);

  const canGrade = useMemo(
    () => selected && front && back && !grading,
    [selected, front, back, grading]
  );

  const runGrade = useCallback(async () => {
    if (!selected || !front || !back) return;
    setGrading(true);
    setGradeError(null);
    setRunBundles([]);
    setMergedReport(null);
    setMergeError(null);
    setMergingReports(false);
    setParallelFailures([]);
    const n = Math.min(5, Math.max(1, Math.floor(parallelRuns)));

    const makeBaseFormData = () => {
      const fd = new FormData();
      fd.set("pop_card_url_norm", selected.pop_card_url_norm);
      fd.set("pop_card_url", selected.original_pop_url);
      fd.set("card_label", `${selected.title} — ${selected.subtitle}`);
      fd.set("raw_condition", condition);
      fd.set("grader", graderMode);
      fd.set("front", front);
      fd.set("back", back);
      return fd;
    };

    try {
      const fetchOne = async (
        slotIndexZeroBased: number
      ): Promise<GradeRunBundle> => {
        const fd = makeBaseFormData();
        if (n > 1) {
          fd.set("exemplar_variant", String(slotIndexZeroBased));
          fd.set("parallel_count", String(n));
        }
        const res = await fetch("/api/grade", {
          method: "POST",
          body: fd,
        });
        let data: unknown = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        if (!res.ok) {
          throw new Error(parseGradeApiError(data, res));
        }
        const d = data as Record<string, unknown>;
        return {
          grade: d.grade as GradeOutput,
          exemplar_ids: (d.exemplar_ids ?? []) as string[],
          exemplar_dig_urls:
            (d.exemplar_dig_urls as Record<string, string> | undefined) ?? {},
          confidence_retry:
            d.confidence_retry != null
              ? (d.confidence_retry as ConfidenceRetryInfo)
              : null,
        };
      };

      let bundles: GradeRunBundle[] = [];
      const failures: { slot: number; message: string }[] = [];

      if (n === 1) {
        bundles = [{ ...(await fetchOne(0)), parallelSlot: 1 }];
      } else {
        const settled = await Promise.allSettled(
          Array.from({ length: n }, (_, i) => fetchOne(i))
        );
        settled.forEach((out, i) => {
          const slot = i + 1;
          if (out.status === "fulfilled") {
            bundles.push({ ...out.value, parallelSlot: slot });
          } else {
            const reason = out.reason;
            failures.push({
              slot,
              message:
                reason instanceof Error ? reason.message : String(reason),
            });
          }
        });
        if (bundles.length === 0) {
          setGradeError(
            failures.length === 1
              ? failures[0].message
              : `All ${n} requests failed: ${failures.map((f) => `slot ${f.slot}: ${f.message}`).join("; ")}`
          );
          return;
        }
      }

      if (bundles.length > 1) {
        setMergingReports(true);
        setGradeProgress(96);
        try {
          const mergeRes = await fetch("/api/merge-grade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              card_label: `${selected.title} — ${selected.subtitle}`,
              grader: graderMode,
              runs: bundles.map((b) => b.grade),
            }),
          });
          let mergeData: unknown = null;
          try {
            mergeData = await mergeRes.json();
          } catch {
            mergeData = null;
          }
          if (!mergeRes.ok) {
            throw new Error(parseGradeApiError(mergeData, mergeRes));
          }
          const mo = mergeData as Record<string, unknown>;
          const merged = mo.merged as MergedGradeOutput | undefined;
          if (!merged) {
            throw new Error("Merge response missing merged payload.");
          }
          setMergedReport(merged);
          setMergeError(null);
        } catch (e) {
          setMergedReport(null);
          setMergeError(e instanceof Error ? e.message : String(e));
        } finally {
          setMergingReports(false);
        }
      } else {
        setMergedReport(null);
        setMergeError(null);
      }

      setRunBundles(bundles);
      setParallelFailures(n > 1 ? failures : []);
      setGradeProgress(100);
      await new Promise((r) => setTimeout(r, 280));
      setStep(4);
    } catch (e) {
      setGradeError(e instanceof Error ? e.message : String(e));
    } finally {
      setGrading(false);
    }
  }, [selected, front, back, condition, parallelRuns, graderMode]);

  return (
    <div className="app-backdrop min-h-screen text-slate-800">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10 lg:max-w-4xl">
        <header className={`${shell} space-y-3 p-5 sm:p-8`}>
          <p className={sectionEyebrow}>AI grader</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Gem Mint
          </h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-slate-600">
            Pre-grade your card with AI using over 200,000 graded cards of data.
          </p>
        </header>

        <nav className={`${shell} p-4 sm:p-5`} aria-label="Steps">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {WIZARD_STEPS.map((s) => {
              const done = step > s.id;
              const active = step === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setStep(s.id)}
                    className={`flex w-full flex-col gap-1.5 rounded-xl px-3 py-3 text-left transition ${
                      active
                        ? "bg-blue-50 ring-1 ring-blue-300"
                        : done
                          ? "bg-emerald-50 ring-1 ring-emerald-200 hover:bg-emerald-100/90"
                          : "hover:bg-slate-100"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        active
                          ? "bg-blue-600 text-white shadow-md shadow-blue-900/20"
                          : done
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {done ? "✓" : s.id}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {s.label}
                    </span>
                    <span className="text-[11px] leading-snug text-slate-600">
                      {s.hint}
                    </span>
                  </button>
          </li>
              );
            })}
        </ol>
        </nav>

        {grading && (
          <div
            className={`${shell} px-5 py-4`}
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-blue-700">
                {mergingReports
                  ? "Merging parallel reports…"
                  : parallelRuns > 1
                    ? `${parallelRuns}× parallel run…`
                    : "Grading…"}
              </span>
              <span className="font-mono text-xs text-slate-600">
                {Math.round(gradeProgress)}%
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-800 via-blue-500 to-sky-400 transition-[width] duration-150 ease-out"
                style={{
                  width: `${Math.min(100, Math.max(0, gradeProgress))}%`,
                }}
              />
            </div>
          </div>
        )}

        {gradeError && (
          <div
            className={`${shell} border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900`}
          >
            {gradeError}
          </div>
        )}

        {step === 1 && (
          <section className={`${shell} space-y-5 p-4 sm:p-8`}>
            <div>
              <p className={sectionEyebrow}>Step 1</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                Find your card
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Search for your Pokémon card in our database.
              </p>
            </div>
            <label className={fieldLabel}>
              Search
              <input
                className={inputClass}
                placeholder="e.g. Charizard Base Set Holo"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <p className="text-xs text-slate-600">
              {searchError ? (
                <span className="text-red-600">{searchError}</span>
              ) : loadingSearch ? (
                <span className="text-blue-600">Searching…</span>
              ) : (
                `${results.length} match${results.length === 1 ? "" : "es"}`
              )}
            </p>
            <ul className="custom-scrollbar max-h-[min(420px,48vh)] space-y-2 overflow-y-auto pr-1">
              {results.map((r) => (
                <li key={r.pop_card_url_norm}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(r);
                      setStep(2);
                    }}
                    className={`flex w-full gap-4 rounded-xl border p-4 text-left transition ${
                      selected?.pop_card_url_norm === r.pop_card_url_norm
                        ? "border-blue-400 bg-blue-50/90 ring-1 ring-blue-200"
                        : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex h-[5.25rem] w-[3.75rem] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                      {r.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.thumbnailUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="text-[10px] text-slate-500">No art</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 py-0.5">
                      <div className="font-medium leading-snug text-slate-900">
                        {r.title}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-slate-600">
                        {r.subtitle}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {step === 2 && (
          <section className={`${shell} space-y-5 p-4 sm:space-y-6 sm:p-8`}>
            <div>
              <p className={sectionEyebrow}>Step 2</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                Add photos
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {isMobile
                  ? "Use the in-app camera for a straight-on shot—the tilt guide sits on the preview—or pick from your photos."
                  : "Well-lit, straight-on shots work best. Same style as your final report preview."}
              </p>
            </div>
            <div
              className={`rounded-xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5 ${!selected ? "opacity-60" : ""}`}
            >
              {selected ? (
                <>
                  <div className="font-semibold text-slate-900">
                    {selected.title}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {selected.subtitle}
                  </div>
                </>
              ) : (
                <span className="text-sm text-slate-600">No card selected.</span>
              )}
            </div>

            {isMobile ? (
              <div className="space-y-8">
                <div className="space-y-3">
                  <span className={fieldLabel}>Front photo</span>
                  <input
                    ref={frontGalRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setFront(e.target.files?.[0] ?? null)}
                  />
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      className={`${btnPrimary} w-full justify-center`}
                      onClick={() =>
                        requestOrientationPermissionThen(() =>
                          setCameraOpen("front")
                        )
                      }
                    >
                      Take front photo
                    </button>
                    <button
                      type="button"
                      className={`${btnMuted} w-full justify-center`}
                      onClick={() => frontGalRef.current?.click()}
                    >
                      Choose from gallery (front)
                    </button>
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {front ? front.name : "No front image yet"}
                  </p>
                </div>

                <div className="space-y-3">
                  <span className={fieldLabel}>Back photo</span>
                  <input
                    ref={backGalRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setBack(e.target.files?.[0] ?? null)}
                  />
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      className={`${btnPrimary} w-full justify-center`}
                      onClick={() =>
                        requestOrientationPermissionThen(() =>
                          setCameraOpen("back")
                        )
                      }
                    >
                      Take back photo
                    </button>
                    <button
                      type="button"
                      className={`${btnMuted} w-full justify-center`}
                      onClick={() => backGalRef.current?.click()}
                    >
                      Choose from gallery (back)
                    </button>
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {back ? back.name : "No back image yet"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                <label className={fieldLabel}>
                  Front photo
                  <input
                    type="file"
                    accept="image/*"
                    className={`${inputClass} py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-800`}
                    onChange={(e) => setFront(e.target.files?.[0] ?? null)}
                  />
                </label>
                <label className={fieldLabel}>
                  Back photo
                  <input
                    type="file"
                    accept="image/*"
                    className={`${inputClass} py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-800`}
                    onChange={(e) => setBack(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            )}
            <button
              type="button"
              className={`${btnPrimary} w-full sm:w-auto`}
              disabled={!selected || !front || !back}
              onClick={() => setStep(3)}
            >
              Continue
            </button>
          </section>
        )}

        {step === 3 && (
          <section className={`${shell} space-y-6 p-4 sm:p-8`}>
            <div>
              <p className={sectionEyebrow}>Step 3</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                Rubric and run
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Choose PSA or TAG wording and optional parallel runs for a more
                stable merged report.
              </p>
            </div>
            <label className={fieldLabel}>
              Rubric
              <select
                className={`${inputClass} cursor-pointer`}
                value={graderMode}
                onChange={(e) =>
                  setGraderMode(e.target.value as GraderMode)
                }
              >
                <option value="tag">TAG</option>
                <option value="psa">PSA</option>
              </select>
            </label>
            <label className={fieldLabel}>
              Condition
              <select
                className={`${inputClass} cursor-pointer`}
                value={condition}
                onChange={(e) =>
                  setCondition(e.target.value as (typeof CONDITIONS)[number])
                }
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className={fieldLabel}>
              Parallel runs
              <select
                className={`${inputClass} cursor-pointer`}
                value={parallelRuns}
                onChange={(e) =>
                  setParallelRuns(Math.min(5, Math.max(1, Number(e.target.value))))
                }
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "Single run" : `${n} parallel runs`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={btnPrimary}
              disabled={!canGrade}
              onClick={runGrade}
            >
              {grading
                ? "…"
                : parallelRuns > 1
                  ? `Grade ${parallelRuns}×`
                  : "Run grade"}
            </button>
          </section>
        )}

        {step === 4 && runBundles.length > 0 && (
          <section className="relative space-y-6">
            <div className="space-y-6">
                <div className={`${shell} p-4 sm:p-8`}>
                  <p className={sectionEyebrow}>Step 4</p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                    Your report
                  </h2>
                  <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-slate-600">
                    Summary, criteria, and Markdown narrative use the same panel
                    style as the rest of the flow.
                  </p>
                </div>

            {parallelFailures.length > 0 && (
              <div
                className={`${shell} border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-950`}
              >
                <p className="font-medium text-amber-900">
                  {parallelFailures.length} run{parallelFailures.length === 1 ? "" : "s"}{" "}
                  failed
                </p>
                <ul className="mt-2 list-disc pl-5 text-xs text-amber-900/85">
                  {parallelFailures.map((f) => (
                    <li key={f.slot}>
                      <span className="font-mono text-amber-800">
                        Slot {f.slot}
                      </span>
                      : {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {mergeError && runBundles.length > 1 && (
              <div
                className={`${shell} border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-950`}
              >
                Merged report unavailable: {mergeError}{" "}
                <span className="text-amber-900/85">
                  Showing the first successful run. Expand individual runs below.
                </span>
              </div>
            )}
            <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-white via-blue-50/70 to-slate-50 p-6 shadow-xl shadow-slate-300/35 ring-1 ring-blue-100 sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-wrap items-end gap-6">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="text-5xl font-bold tabular-nums text-blue-600 drop-shadow-sm">
                      {mergedHead
                        ? mergedHead.consensus_grade_numeric
                        : runBundles[0].grade.predicted_grade_numeric}
                    </span>
                    <span
                      className="text-lg font-medium text-slate-800"
                      title={
                        mergedHead
                          ? "Consensus tier after merging parallel estimates."
                          : "Plain text tier name for this estimate."
                      }
                    >
                      {mergedHead
                        ? mergedHead.consensus_label
                        : runBundles[0].grade.predicted_grade_label}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        graderMode === "psa"
                          ? "border-sky-400 text-sky-700"
                          : "border-blue-400 text-blue-700"
                      }`}
                    >
                      {graderMode === "psa" ? "PSA" : "TAG"}
                    </span>
                    {runBundles.length > 1 && mergedHead && (
                      <span className="text-xs font-medium text-emerald-600">
                        · Merged {runBundles.length}×
                      </span>
                    )}
                    {runBundles.length > 1 && !mergedHead && (
                      <span className="text-xs text-slate-600">· Showing run 1</span>
                    )}
                  </div>
                  <div
                    className="flex min-w-[220px] flex-1 flex-col gap-2"
                    aria-label={`Confidence ${displayConfidence.toFixed(2)}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                        Confidence
                      </span>
                      <span className="font-mono text-sm font-semibold tabular-nums text-slate-800">
                        {displayConfidence.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200 ring-1 ring-slate-300">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-800 via-blue-500 to-sky-400"
                        style={{
                          width: `${Math.round(
                            Math.min(1, Math.max(0, displayConfidence)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
        </div>
                <button
                  type="button"
                  className={`${btnMuted} shrink-0`}
                  disabled={!canGrade}
                  onClick={runGrade}
                >
                  Regrade
                </button>
              </div>
            </div>

            {(selected || frontPreviewUrl || backPreviewUrl) && (
              <div className={`${shell} space-y-6 p-4 sm:p-6`}>
                {selected && (
                  <div>
                    <p className={sectionEyebrow}>Listing</p>
                    <p className="font-semibold leading-snug text-slate-900">
                      {selected.title}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">{selected.subtitle}</p>
                  </div>
                )}
                {(frontPreviewUrl || backPreviewUrl) && (
                  <>
                    {selected && (
                      <div className="border-t border-slate-200 pt-6" />
                    )}
                    <div>
                      <p className={sectionEyebrow}>Photos</p>
                      <h2 className="mt-1 text-base font-semibold text-slate-900">
                        Your uploads
                      </h2>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {frontPreviewUrl && (
                        <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white ring-1 ring-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={frontPreviewUrl}
                            alt="Submitted front of card"
                            className="max-h-[min(420px,55vh)] w-full bg-black object-contain"
                          />
                          <figcaption className="border-t border-slate-200 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                            Front
                          </figcaption>
                        </figure>
                      )}
                      {backPreviewUrl && (
                        <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white ring-1 ring-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={backPreviewUrl}
                            alt="Submitted back of card"
                            className="max-h-[min(420px,55vh)] w-full bg-black object-contain"
                          />
                          <figcaption className="border-t border-slate-200 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                            Back
                          </figcaption>
                        </figure>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {runBundles.length > 1 && (
              <div className={`${shell} space-y-4 p-4 sm:p-6`}>
                <div>
                  <p className={sectionEyebrow}>Parallel</p>
                  <h2 className="mt-1 text-base font-semibold text-slate-900">
                    Parallel comparison
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">
                    Each row is an independent draw from the exemplar pool.
                  </p>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Slot</th>
                        <th className="px-4 py-3 font-semibold">Grade</th>
                        <th className="px-4 py-3 font-semibold">Tier</th>
                        <th
                          className="px-4 py-3 font-semibold"
                          title="Confidence"
                        >
                          Conf.
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {runBundles.map((bundle, i) => (
                        <tr key={i} className="bg-white">
                          <td className="px-4 py-3 font-mono text-sm text-blue-700">
                            {bundle.parallelSlot ?? i + 1}
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {bundle.grade.predicted_grade_numeric}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {bundle.grade.predicted_grade_label}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-600">
                            {bundle.grade.confidence_score.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs leading-relaxed text-slate-600">
                  {(() => {
                    const nums = runBundles.map(
                      (b) => b.grade.predicted_grade_numeric
                    );
                    const confs = runBundles.map(
                      (b) => b.grade.confidence_score
                    );
                    return (
                      <>
                        Mean grade {mean(nums).toFixed(2)} (range{" "}
                        {Math.min(...nums)}–{Math.max(...nums)}) · mean
                        confidence{" "}
                        {mean(confs).toFixed(2)} (
                        {Math.min(...confs).toFixed(2)}–
                        {Math.max(...confs).toFixed(2)})
                      </>
                    );
                  })()}
                </p>
              </div>
            )}

            {criteriaRows.length > 0 && (
              <div className={`${shell} space-y-6 p-4 sm:p-6`}>
                <div>
                  <p className={sectionEyebrow}>Breakdown</p>
                  <h2 className="mt-1 text-base font-semibold text-slate-900">
                    Criteria
                  </h2>
                  {runBundles.length > 1 && (
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">
                      Averaged across parallel runs; detail merges and deduplicates
                      what each pass emphasized.
                    </p>
                  )}
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50/80">
                  <table className="w-full min-w-[320px] text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">
                          Criterion
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 font-semibold">
                          Score{" "}
                          <span className="font-normal text-slate-500">
                            (1–10)
                          </span>
                        </th>
                        <th className="px-4 py-3 font-semibold">Detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {criteriaRows.map((row, i) => (
                        <tr
                          key={`${row.criterion}-${i}`}
                          className="bg-white"
                        >
                          <td className="px-4 py-3 text-slate-800">
                            {row.criterion}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-lg font-semibold tabular-nums text-blue-600">
                              {formatCriterionScore(row)}
                            </span>
                          </td>
                          <td className="max-w-md px-4 py-3 text-sm text-slate-600">
                            {formatCriterionNote(row)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {exemplarEntries.length > 0 && (
              <div className={`${shell} space-y-3 px-5 py-6 sm:p-7`}>
                <p className={sectionEyebrow}>POP anchors</p>
                <h2 className="text-base font-semibold text-slate-900">
                  Similar graded cards
                </h2>
                <p className="text-sm leading-relaxed text-slate-600">
                  TAG POP slabs are visual references for this estimate—not an
                  official match to your card.
                </p>
                <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[11px] leading-relaxed">
                  {exemplarEntries.map(([id, url]) => (
                    <li key={id}>
                      {url ? (
                        <a
                          href={url}
          target="_blank"
          rel="noopener noreferrer"
                          className="text-blue-600 underline decoration-blue-300 underline-offset-2 transition hover:text-blue-800"
                        >
                          {id}
                        </a>
                      ) : (
                        <span className="text-slate-600">{id}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className={`${shell} p-4 sm:p-8`}>
              <div className="mb-6 border-b border-slate-200 pb-5">
                <p className={sectionEyebrow}>Write-up</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  {mergedHead && mergedReport
                    ? "Merged narrative"
                    : "Full report"}
                </h2>
              </div>
              <ReportMarkdown className="[&>*:first-child]:mt-0">
                {mergedHead && mergedReport
                  ? mergedReport.merged_report_markdown
                  : runBundles[0].grade.report_markdown}
              </ReportMarkdown>
            </div>

            </div>

            {runBundles.length > 1 && (
              <div className="space-y-3">
                <p className={sectionEyebrow}>
                  {mergedHead ? "Per-run reports" : "Other runs"}
                </p>
                {(mergedHead ? runBundles : runBundles.slice(1)).map(
                  (bundle, idx) => (
                    <details
                      key={`${bundle.parallelSlot ?? idx}-${idx}`}
                      className={`group ${shell} overflow-hidden bg-slate-50/80 open:ring-1 open:ring-blue-200`}
                    >
                      <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-slate-800 marker:hidden [&::-webkit-details-marker]:hidden">
                        <span className="mr-2 inline-block text-slate-600 transition-transform duration-200 group-open:rotate-90">
                          ▸
                        </span>
                        Run {bundle.parallelSlot ?? idx + 1}
                      </summary>
                      <div className="border-t border-slate-200 px-5 pb-6 pt-2">
                        <ReportMarkdown>
                          {bundle.grade.report_markdown}
                        </ReportMarkdown>
                      </div>
                    </details>
                  )
                )}
              </div>
            )}

            <details
              className={`${shell} group px-5 py-4 text-xs text-slate-600 open:bg-slate-50`}
            >
              <summary className="cursor-pointer text-sm font-medium text-slate-600 outline-none marker:hidden [&::-webkit-details-marker]:hidden">
                Raw JSON
              </summary>
              <pre className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-[11px] leading-relaxed text-slate-700">
                {JSON.stringify(
                  mergedReport && runBundles.length > 1
                    ? {
                        merged: mergedReport,
                        runs: runBundles.map((b) => b.grade),
                      }
                    : runBundles.map((b) => b.grade),
                  null,
                  2
                )}
              </pre>
            </details>
            {grading && (
              <div
                className="pointer-events-auto absolute inset-0 z-20 cursor-wait rounded-xl bg-white/75 backdrop-blur-[2px]"
            aria-hidden
              />
            )}
          </section>
        )}
      </div>

      {cameraOpen !== null && (
        <CameraWithLevelOverlay
          open
          side={cameraOpen}
          onClose={() => setCameraOpen(null)}
          onCapture={(file) => {
            if (cameraOpen === "front") setFront(file);
            else setBack(file);
            setCameraOpen(null);
          }}
        />
      )}
    </div>
  );
}
