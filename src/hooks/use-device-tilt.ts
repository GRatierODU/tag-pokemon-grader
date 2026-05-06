"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SMOOTH = 0.14;
export const GREEN_DEG = 4;
export const METER_CLAMP = 35;

export type LevelPermission =
  | "unknown"
  | "ios_prompt"
  | "granted"
  | "denied"
  | "unsupported";

let pendingOrientationResolution: "granted" | "denied" | null = null;
/** Survives hook remounts (e.g. React Strict Mode) after the first successful consume. */
let cachedOrientationResolution: "granted" | "denied" | null = null;

export function consumePendingOrientationResolution():
  | "granted"
  | "denied"
  | null {
  const v = pendingOrientationResolution;
  pendingOrientationResolution = null;
  if (v !== null) {
    cachedOrientationResolution = v;
  }
  return v;
}

/**
 * iOS Safari requires motion permission in a user gesture. Call this from the
 * same tap that opens the camera, then run `fn()` in `finally` so tilt is on by default.
 */
export function requestOrientationPermissionThen(fn: () => void): void {
  if (typeof window === "undefined") {
    fn();
    return;
  }

  const DO = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<"granted" | "denied">;
  };

  if (typeof DO.requestPermission !== "function") {
    fn();
    return;
  }

  DO.requestPermission()
    .then((r) => {
      pendingOrientationResolution = r === "granted" ? "granted" : "denied";
    })
    .catch(() => {
      pendingOrientationResolution = "denied";
    })
    .finally(fn);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function angleToPct(angleDeg: number): number {
  const c = clamp(angleDeg, -METER_CLAMP, METER_CLAMP);
  return 50 + (c / METER_CLAMP) * 50;
}

export function useDeviceTilt() {
  const smoothRef = useRef({ beta: 0, gamma: 0 });
  const [beta, setBeta] = useState(0);
  const [gamma, setGamma] = useState(0);
  const [perm, setPerm] = useState<LevelPermission>("unknown");
  const [hasAbsolute, setHasAbsolute] = useState(false);

  const applySmooth = useCallback((rawBeta: number, rawGamma: number) => {
    const s = smoothRef.current;
    s.beta = s.beta * (1 - SMOOTH) + rawBeta * SMOOTH;
    s.gamma = s.gamma * (1 - SMOOTH) + rawGamma * SMOOTH;
    setBeta(s.beta);
    setGamma(s.gamma);
  }, []);

  useEffect(() => {
    if (perm !== "granted") return;

    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      applySmooth(e.beta, e.gamma);
      if (e.absolute != null) setHasAbsolute(e.absolute);
    };

    window.addEventListener("deviceorientation", onOrient, true);
    return () => window.removeEventListener("deviceorientation", onOrient, true);
  }, [perm, applySmooth]);

  useEffect(() => {
    if (perm !== "denied") return;

    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null || g.z == null) return;
      const x = g.x ?? 0;
      const y = g.y ?? 0;
      const z = g.z ?? 0;
      const pitch = Math.atan2(y, Math.sqrt(x * x + z * z)) * (180 / Math.PI);
      const roll = Math.atan2(-x, Math.sqrt(y * y + z * z)) * (180 / Math.PI);
      applySmooth(pitch, roll);
    };

    window.addEventListener("devicemotion", onMotion, true);
    return () => window.removeEventListener("devicemotion", onMotion, true);
  }, [perm, applySmooth]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const pending = consumePendingOrientationResolution();
    if (pending !== null) {
      setPerm(pending);
      return;
    }

    if (cachedOrientationResolution !== null) {
      setPerm(cachedOrientationResolution);
      return;
    }

    const DO = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DO.requestPermission === "function") {
      setPerm("ios_prompt");
    } else if (
      typeof DeviceOrientationEvent !== "undefined" &&
      "ondeviceorientation" in window
    ) {
      cachedOrientationResolution = "granted";
      setPerm("granted");
    } else {
      setPerm("unsupported");
    }
  }, []);

  const requestAccess = useCallback(async () => {
    const DO = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    try {
      if (typeof DO.requestPermission === "function") {
        const r = await DO.requestPermission();
        const next = r === "granted" ? "granted" : "denied";
        cachedOrientationResolution = next;
        setPerm(next);
      } else {
        cachedOrientationResolution = "granted";
        setPerm("granted");
      }
    } catch {
      cachedOrientationResolution = "denied";
      setPerm("denied");
    }
  }, []);

  const betaOk = Math.abs(beta) <= GREEN_DEG;
  const gammaOk = Math.abs(gamma) <= GREEN_DEG;

  return {
    beta,
    gamma,
    betaOk,
    gammaOk,
    perm,
    hasAbsolute,
    requestAccess,
  };
}
