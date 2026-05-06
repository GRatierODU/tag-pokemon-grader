"use client";

import {
  angleToPct,
  GREEN_DEG,
  METER_CLAMP,
  useDeviceTilt,
} from "@/hooks/use-device-tilt";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function PhoneLevelMeters({
  variant = "card",
}: {
  variant?: "card" | "overlay";
}) {
  const {
    beta,
    gamma,
    betaOk,
    gammaOk,
    perm,
    hasAbsolute,
    requestAccess,
  } = useDeviceTilt();

  const bothOk = betaOk && gammaOk;

  if (perm === "unsupported") {
    const unsupportedCls =
      variant === "overlay"
        ? "rounded-xl border border-white/20 bg-black/50 px-4 py-3 text-xs text-white/80"
        : "rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600";
    return (
      <p className={unsupportedCls}>
        Tilt guide isn&apos;t available in this browser. Use a phone with motion
        sensors, or align by eye.
      </p>
    );
  }

  const wrapCls =
    variant === "overlay"
      ? "rounded-xl border border-white/15 bg-black/50 px-3 py-3 shadow-lg ring-1 ring-white/10 backdrop-blur-md"
      : "rounded-xl border border-blue-200 bg-gradient-to-b from-blue-50/90 to-white px-4 py-4 shadow-sm ring-1 ring-blue-100";

  const eyebrowCls =
    variant === "overlay"
      ? "text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200"
      : "text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700";

  const bodyCls =
    variant === "overlay"
      ? "mt-1 text-xs leading-relaxed text-white/75"
      : "mt-1 text-xs leading-relaxed text-slate-600";

  const meterTheme = variant === "overlay" ? "dark" : "light";

  return (
    <div className={wrapCls}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={eyebrowCls}>Straight shot guide</p>
          <p className={bodyCls}>
            {variant === "overlay"
              ? "Keep the card centered; bubbles in the green bands mean level."
              : "Hold your phone parallel to the card. Center both bubbles in the green bands before you capture."}
          </p>
        </div>
        {perm === "ios_prompt" && (
          <button
            type="button"
            onClick={requestAccess}
            className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 min-h-[44px] touch-manipulation"
          >
            Enable tilt sensors
          </button>
        )}
      </div>

      {(perm === "granted" || perm === "denied") && (
        <>
          {perm === "denied" && (
            <p
              className={
                variant === "overlay"
                  ? "mt-3 text-[11px] text-amber-100/95"
                  : "mt-3 text-[11px] text-amber-800"
              }
            >
              Orientation blocked — showing rough tilt from motion only. Enable
              sensors for accuracy, or allow motion access in site settings.
            </p>
          )}
          <div className={variant === "overlay" ? "mt-3 space-y-3" : "mt-4 space-y-5"}>
            <LevelMeter
              label="Front ↔ back tilt"
              degrees={beta}
              pct={angleToPct(beta)}
              ok={betaOk}
              theme={meterTheme}
            />
            <LevelMeter
              label="Side ↔ side tilt"
              degrees={gamma}
              pct={angleToPct(gamma)}
              ok={gammaOk}
              theme={meterTheme}
            />
          </div>
          <div
            className={
              variant === "overlay"
                ? "mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs"
                : "mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs"
            }
          >
            <span
              className={
                variant === "overlay"
                  ? "font-mono tabular-nums text-white/85"
                  : "font-mono tabular-nums text-slate-700"
              }
            >
              β {beta.toFixed(1)}° · γ {gamma.toFixed(1)}°
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                bothOk
                  ? variant === "overlay"
                    ? "bg-emerald-500/30 text-emerald-100"
                    : "bg-emerald-100 text-emerald-800"
                  : variant === "overlay"
                    ? "bg-white/15 text-white/80"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {bothOk ? "Aligned" : "Adjust angle"}
            </span>
          </div>
          {hasAbsolute && (
            <p
              className={
                variant === "overlay"
                  ? "mt-2 text-[10px] text-white/40"
                  : "mt-2 text-[10px] text-slate-400"
              }
            >
              Compass-assisted orientation may drift indoors — rely on the bubble.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function LevelMeter({
  label,
  degrees,
  pct,
  ok,
  theme = "light",
}: {
  label: string;
  degrees: number;
  pct: number;
  ok: boolean;
  theme?: "light" | "dark";
}) {
  const dark = theme === "dark";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className={
            dark ? "text-[11px] font-medium text-white/85" : "text-[11px] font-medium text-slate-700"
          }
        >
          {label}
        </span>
        <span
          className={`font-mono text-[11px] tabular-nums ${
            ok
              ? dark
                ? "text-emerald-300"
                : "text-emerald-700"
              : dark
                ? "text-white/75"
                : "text-slate-600"
          }`}
        >
          {degrees >= 0 ? "+" : ""}
          {degrees.toFixed(1)}°
        </span>
      </div>
      <div
        className={
          dark
            ? "relative h-10 overflow-hidden rounded-full bg-white/15 shadow-inner ring-1 ring-white/25"
            : "relative h-11 overflow-hidden rounded-full bg-slate-200 shadow-inner ring-1 ring-slate-300/80"
        }
      >
        <div
          className={
            dark
              ? "absolute inset-y-0 left-1/2 w-[22%] -translate-x-1/2 bg-emerald-400/30"
              : "absolute inset-y-0 left-1/2 w-[22%] -translate-x-1/2 bg-emerald-400/35"
          }
          aria-hidden
        />
        <div
          className={
            dark
              ? "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/50"
              : "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-500/60"
          }
        />
        <div
          className={`absolute top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-md transition-[left] duration-75 ease-out sm:h-9 sm:w-9 ${
            ok
              ? dark
                ? "border-emerald-300 bg-emerald-400/40"
                : "border-emerald-600 bg-emerald-100"
              : dark
                ? "border-white bg-white/90"
                : "border-blue-600 bg-white"
          }`}
          style={{ left: `${clamp(pct, 8, 92)}%` }}
        />
      </div>
      <div
        className={
          dark
            ? "mt-1 flex justify-between text-[10px] text-white/45"
            : "mt-1 flex justify-between text-[10px] text-slate-400"
        }
      >
        <span>−{METER_CLAMP}°</span>
        <span>Level</span>
        <span>+{METER_CLAMP}°</span>
      </div>
    </div>
  );
}
