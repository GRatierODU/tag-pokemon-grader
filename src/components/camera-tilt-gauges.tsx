"use client";

import type { CSSProperties, ReactNode } from "react";

import { angleToPct, useDeviceTilt } from "@/hooks/use-device-tilt";

const BUB = 22;
const BUB_R = BUB / 2;
/** Horizontal track length = vertical track length. */
const TRACK_SPAN = "min(200px, 54vw)";
/** Gap between each slider and the rectangle (same top and left). */
const CARD_SLIDER_GAP = 12;

function clampPct(n: number): number {
  return Math.min(94, Math.max(6, n));
}

/**
 * Horizontal γ directly above the card, vertical β directly left of the card —
 * card stays viewport-centered; sliders use the same offset from the frame.
 */
export function CameraTiltGauges({ card }: { card: ReactNode }) {
  const { beta, gamma, betaOk, gammaOk, perm } = useDeviceTilt();

  const trackBar = "rounded-full bg-black/55 ring-1 ring-white/35";
  const zone = "bg-emerald-400/45";
  const tick = "bg-white/55";

  if (perm === "unsupported") {
    return (
      <div className="pointer-events-none absolute inset-0 z-[8] flex items-center justify-center">
        {card}
      </div>
    );
  }

  const live = perm === "granted" || perm === "denied";
  const gx = live ? clampPct(angleToPct(gamma)) : 50;
  const bx = live ? clampPct(angleToPct(beta)) : 50;
  const gOk = live && gammaOk;
  const bOk = live && betaOk;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4">
      {/* Card stays geometric center of screen; sliders satellite with equal inset */}
      <div className="relative shrink-0">
        {/* γ — centered above frame */}
        <div
          className="pointer-events-none absolute bottom-full left-1/2 h-11 -translate-x-1/2"
          style={
            {
              width: TRACK_SPAN,
              marginBottom: CARD_SLIDER_GAP,
            } satisfies CSSProperties
          }
        >
          <div
            className={`absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 overflow-hidden ${trackBar}`}
          >
            <div
              className={`absolute inset-y-0 left-1/2 w-[12%] -translate-x-1/2 ${zone}`}
              aria-hidden
            />
            <div
              className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 ${tick}`}
              aria-hidden
            />
          </div>
          <div
            className={`pointer-events-none absolute top-1/2 z-[1] rounded-full border-[2.5px] shadow-lg ${
              gOk
                ? "border-emerald-300 bg-emerald-400/65"
                : "border-white bg-white"
            }`}
            style={{
              width: BUB,
              height: BUB,
              left: `calc(${gx}% - ${BUB_R}px)`,
              top: "50%",
              marginTop: -BUB_R,
            }}
            aria-hidden
          />
        </div>

        {/* β — left of frame, vertically aligned with card, same spacing as gap above */}
        <div
          className="pointer-events-none absolute left-0 top-1/2 w-11"
          style={
            {
              height: TRACK_SPAN,
              transform: `translate(calc(-100% - ${CARD_SLIDER_GAP}px), -50%)`,
            } satisfies CSSProperties
          }
        >
          <div
            className={`absolute bottom-0 left-1/2 top-0 w-[6px] -translate-x-1/2 overflow-hidden ${trackBar}`}
          >
            <div
              className={`absolute inset-x-0 top-1/2 h-[12%] w-full -translate-y-1/2 ${zone}`}
              aria-hidden
            />
            <div
              className={`absolute inset-x-0 top-1/2 h-px w-full -translate-y-1/2 ${tick}`}
              aria-hidden
            />
          </div>
          <div
            className={`pointer-events-none absolute left-1/2 z-[1] rounded-full border-[2.5px] shadow-lg ${
              bOk
                ? "border-emerald-300 bg-emerald-400/65"
                : "border-white bg-white"
            }`}
            style={{
              width: BUB,
              height: BUB,
              top: `calc(${bx}% - ${BUB_R}px)`,
              left: "50%",
              marginLeft: -BUB_R,
            }}
            aria-hidden
          />
        </div>

        {card}
      </div>
    </div>
  );
}
