"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { CameraTiltGauges } from "@/components/camera-tilt-gauges";

type Side = "front" | "back";

/** Standard TCG card proportion (63×88 mm). */
const CARD_ASPECT = "63 / 88";

function CardFitFrame({ narrow }: { narrow?: boolean }) {
  return (
    <div
      className={`pointer-events-none rounded-[10px] border-[3px] border-white/95 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)] ring-2 ring-black/25 ${narrow ? "w-[min(72vw,240px)]" : "w-[min(78vw,300px)]"}`}
      style={{ aspectRatio: CARD_ASPECT }}
      aria-hidden
    />
  );
}

function CloseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function CameraShutterIcon() {
  return (
    <svg
      width="30"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 9h2l1.5-2h5L14 9h6a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1v-8a1 1 0 011-1z" />
      <circle cx="12" cy="14" r="3.5" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 15l-5-5L8 17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Live camera preview only exists in a secure context with MediaDevices. */
function resolveGetUserMedia(): typeof navigator.mediaDevices.getUserMedia | null {
  if (typeof navigator === "undefined") return null;

  const nav = navigator as Navigator & {
    webkitGetUserMedia?: (
      c: MediaStreamConstraints,
      ok: (s: MediaStream) => void,
      err: (e: Error) => void
    ) => void;
    mozGetUserMedia?: (
      c: MediaStreamConstraints,
      ok: (s: MediaStream) => void,
      err: (e: Error) => void
    ) => void;
  };

  if (
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  ) {
    return navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  }

  const legacy =
    nav.webkitGetUserMedia ??
    nav.mozGetUserMedia ??
    (
      nav as Navigator & {
        msGetUserMedia?: typeof nav.webkitGetUserMedia;
      }
    ).msGetUserMedia;

  if (!legacy) return null;

  return (constraints: MediaStreamConstraints) =>
    new Promise<MediaStream>((resolve, reject) => {
      legacy.call(navigator, constraints, resolve, reject);
    });
}

export function CameraWithLevelOverlay({
  open,
  side,
  onClose,
  onCapture,
}: {
  open: boolean;
  side: Side;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileCamRef = useRef<HTMLInputElement>(null);
  const fileGalRef = useRef<HTMLInputElement>(null);

  const [camError, setCamError] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [fallbackOnly, setFallbackOnly] = useState(false);

  useEffect(() => {
    if (!open) {
      setCamError(null);
      setVideoReady(false);
      setFallbackOnly(false);
      return;
    }

    const getUserMedia = resolveGetUserMedia();
    if (!getUserMedia) {
      setFallbackOnly(true);
      setCamError(null);
      setVideoReady(false);
      return;
    }

    let cancelled = false;

    const stopStream = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const el = videoRef.current;
      if (el) el.srcObject = null;
    };

    const start = async () => {
      setCamError(null);
      setVideoReady(false);
      setFallbackOnly(false);
      stopStream();

      try {
        const stream = await getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const el = videoRef.current;
        if (!el) return;
        el.srcObject = stream;
        await el.play().catch(() => {});
      } catch (e) {
        if (!cancelled) {
          setCamError(
            e instanceof Error ? e.message : "Could not open the camera."
          );
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const name = `${side}-photo-${Date.now()}.jpg`;
        const file = new File([blob], name, { type: "image/jpeg" });
        onCapture(file);
      },
      "image/jpeg",
      0.92
    );
  }, [onCapture, side]);

  const onFileChosen = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (f) onCapture(f);
    },
    [onCapture]
  );

  if (!open) return null;

  const chromeBtn =
    "pointer-events-auto flex size-12 items-center justify-center rounded-full bg-black/50 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-sm touch-manipulation active:bg-black/65 min-h-[48px] min-w-[48px]";

  return (
    <div
      className="fixed inset-0 z-[100] bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Camera"
    >
      <input
        ref={fileCamRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFileChosen}
      />
      <input
        ref={fileGalRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChosen}
      />

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={`${chromeBtn} absolute right-[max(10px,env(safe-area-inset-right))] top-[max(10px,env(safe-area-inset-top))] z-40`}
      >
        <CloseIcon />
      </button>

      <div className="relative h-[100dvh] min-h-0 w-full">
        {fallbackOnly ? (
          <div className="relative flex h-full min-h-0 w-full flex-col bg-gradient-to-b from-slate-950 via-black to-black">
            <CameraTiltGauges card={<CardFitFrame narrow />} />
            <div className="pointer-events-auto absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex items-center justify-center gap-10 pb-2">
              <button
                type="button"
                aria-label="Open camera app"
                className={chromeBtn}
                onClick={() => fileCamRef.current?.click()}
              >
                <CameraShutterIcon />
              </button>
              <button
                type="button"
                aria-label="Choose from gallery"
                className={chromeBtn}
                onClick={() => fileGalRef.current?.click()}
              >
                <GalleryIcon />
              </button>
            </div>
          </div>
        ) : camError ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
            <p className="max-w-sm text-center text-sm text-red-200/95">
              {camError}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                aria-label="Open camera app"
                className={chromeBtn}
                onClick={() => fileCamRef.current?.click()}
              >
                <CameraShutterIcon />
              </button>
              <button
                type="button"
                aria-label="Choose from gallery"
                className={chromeBtn}
                onClick={() => fileGalRef.current?.click()}
              >
                <GalleryIcon />
              </button>
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              muted
              autoPlay
              onLoadedData={() => setVideoReady(true)}
            />
            <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_70px_rgba(0,0,0,0.2)]" />

            <CameraTiltGauges card={<CardFitFrame />} />

            <button
              type="button"
              onClick={capture}
              disabled={!videoReady}
              aria-label={videoReady ? "Capture photo" : "Camera starting"}
              className="pointer-events-auto absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex size-[72px] -translate-x-1/2 items-center justify-center rounded-full border-[4px] border-white bg-white/20 text-white shadow-xl backdrop-blur-[2px] touch-manipulation disabled:cursor-not-allowed disabled:opacity-35 active:bg-white/30 min-h-[72px] min-w-[72px]"
            >
              <CameraShutterIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
