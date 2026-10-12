"use client";

import { Loader2, Pipette } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { colorLabel } from "@/lib/catalog";
import { nearestColor, rgbToHex, sampleAround, type Rgb } from "@/lib/colorsample";
import { cn } from "@/lib/utils";
import { Modal } from "../ui/Modal";
import { colorBackground } from "./ColorDots";

export type Photo = Blob | string;

async function toBlob(photo: Photo): Promise<Blob> {
  if (photo instanceof Blob) return photo;
  const res = await fetch(photo);
  if (!res.ok) throw new Error("Couldn't load that photo.");
  return res.blob();
}

// ---------------------------------------------------------------- eyedropper

const CANVAS_MAX = 720;
const LOUPE = 104;
const ZOOM_SOURCE = 26; // pixels of the photo shown in the loupe

type Sample = { rgb: Rgb; hex: string; id: string };

/** Tap or drag on the photo to read the colour under your finger; the nearest named colour is offered. */
export function EyedropperModal({
  open,
  photo,
  onClose,
  onPick,
}: {
  open: boolean;
  photo: Photo | null;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Pick a colour from your photo" className="sm:max-w-xl">
      {open && photo && <EyedropperBody photo={photo} onClose={onClose} onPick={onPick} />}
    </Modal>
  );
}

function EyedropperBody({ photo, onClose, onPick }: { photo: Photo; onClose: () => void; onPick: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null); // canvas pixels
  const [sample, setSample] = useState<Sample | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Draw the photo once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bitmap = await createImageBitmap(await toBlob(photo));
        if (cancelled) return bitmap.close();
        const scale = Math.min(1, CANVAS_MAX / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d", { willReadFrequently: true });
        if (!canvas || !ctx) throw new Error("no canvas");
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        setSize({ w, h });
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photo]);

  const read = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    const loupe = loupeRef.current?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = Math.max(0, Math.min(w - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(h - 1, Math.round(y)));
    // Read just the 9×9 patch under the finger, not the whole photo, so dragging stays smooth.
    const x0 = Math.max(0, cx - 4);
    const y0 = Math.max(0, cy - 4);
    const rw = Math.min(w, cx + 5) - x0;
    const rh = Math.min(h, cy + 5) - y0;
    const rgb = sampleAround(ctx.getImageData(x0, y0, rw, rh).data, rw, rh, cx - x0, cy - y0, 4);
    setCursor({ x: cx, y: cy });
    setSample({ rgb, hex: rgbToHex(rgb), id: nearestColor(rgb).id });
    if (loupe) {
      loupe.imageSmoothingEnabled = false;
      loupe.clearRect(0, 0, LOUPE, LOUPE);
      loupe.drawImage(canvas, cx - ZOOM_SOURCE / 2, cy - ZOOM_SOURCE / 2, ZOOM_SOURCE, ZOOM_SOURCE, 0, 0, LOUPE, LOUPE);
    }
  }, []);

  function fromPointer(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const canvas = e.currentTarget;
    read(((e.clientX - rect.left) / rect.width) * canvas.width, ((e.clientY - rect.top) / rect.height) * canvas.height);
  }

  function onKeyDown(e: KeyboardEvent<HTMLCanvasElement>) {
    const step = e.shiftKey ? 20 : 4;
    const base = cursor ?? { x: e.currentTarget.width / 2, y: e.currentTarget.height / 2 };
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      read(base.x + move[0], base.y + move[1]);
    } else if ((e.key === "Enter" || e.key === " ") && sample) {
      e.preventDefault();
      confirmPick();
    }
  }

  function confirmPick() {
    if (!sample) return;
    onPick(sample.id);
    onClose();
  }

  // Where the loupe floats: above the finger, kept inside the photo.
  const { w, h } = size;
  const loupeStyle = useMemo(() => {
    if (!cursor || !w || !h) return { display: "none" } as const;
    const px = (cursor.x / w) * 100;
    const py = (cursor.y / h) * 100;
    return { left: `${px}%`, top: `${py}%`, display: "block" } as const;
  }, [cursor, w, h]);

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <p className="text-sm leading-relaxed text-gray-600">
        Tap (or drag) on the piece itself — not the background. The closest colour name appears below.
      </p>

      <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-2xl bg-gray-100 ring-1 ring-gray-200">
        {status === "loading" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/70">
            <Loader2 className="size-6 animate-spin text-brand-600" aria-label="Loading photo" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label="Your photo. Tap to sample a colour, or use the arrow keys and Enter."
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => e.buttons > 0 && fromPointer(e)}
          onKeyDown={onKeyDown}
          className="block max-h-[52vh] max-w-full cursor-crosshair touch-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
          style={{ width: "auto", height: "auto" }}
        />
        {/* Magnifier: floats above the sampled point, ringed in the colour it reads. */}
        <div className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+18px)]" style={loupeStyle}>
          <canvas
            ref={loupeRef}
            width={LOUPE}
            height={LOUPE}
            className="size-[104px] rounded-full border-[5px] bg-surface shadow-lift"
            style={{ borderColor: sample?.hex ?? "#fff" }}
          />
          <span className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/40" />
        </div>
        {cursor && (
          <span
            className="pointer-events-none absolute z-10 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/50"
            style={{ left: `${(cursor.x / w) * 100}%`, top: `${(cursor.y / h) * 100}%` }}
          />
        )}
      </div>

      {status === "error" && <p className="text-sm text-red-600">Couldn&apos;t read that photo. Try choosing the colour by hand.</p>}

      <div aria-live="polite" className="flex min-h-14 items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3">
        {sample ? (
          <>
            <span className="size-9 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/40" style={{ background: sample.hex }} />
            <span className="min-w-0 text-sm">
              <span className="block font-semibold text-gray-900">{colorLabel(sample.id)}</span>
              <span className="block truncate text-xs text-gray-500">
                Reads as {sample.hex.toUpperCase()}
              </span>
            </span>
            <span className="ml-auto size-9 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/40" style={{ background: colorBackground(sample.id) }} title="Closest named colour" />
          </>
        ) : (
          <span className="text-sm text-gray-500">Nothing picked yet.</span>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100">
          Cancel
        </button>
        <button
          type="button"
          onClick={confirmPick}
          disabled={!sample}
          className={cn(
            "inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-500",
            !sample && "opacity-50"
          )}
        >
          <Pipette className="size-4" aria-hidden /> {sample ? `Use ${colorLabel(sample.id)}` : "Use this colour"}
        </button>
      </div>
    </div>
  );
}
