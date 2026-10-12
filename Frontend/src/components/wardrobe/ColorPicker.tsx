"use client";

import { Check, Loader2, Pipette, Wand2, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { detectColors } from "@/lib/aicolor";
import { COLORS, COLOR_GROUPS, colorHex, colorLabel } from "@/lib/catalog";
import { getConfigChain } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { colorBackground } from "./ColorDots";
import { EyedropperModal, type Photo } from "./PhotoColors";

/** Light swatches get a dark tick, dark ones a white tick, so the selected state reads on every colour. */
function tickClass(id: string): string {
  if (id === "multicolor") return "text-white drop-shadow";
  const n = parseInt(colorHex(id).slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.6 ? "text-gray-900" : "text-white";
}

/**
 * Pick up to two colours; the first one is treated as the piece's main colour. With a photo you can tap the
 * picture itself to read a colour (eyedropper), or let the AI look at it and choose.
 */
export function ColorPicker({
  value,
  onChange,
  invalid,
  photo = null,
  typeId,
  suggestion,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  invalid?: boolean;
  photo?: Photo | null;
  typeId?: string;
  /** Where the current selection came from ("Read from your photo"), shown until the user changes it. */
  suggestion?: string | null;
}) {
  const paletteRef = useRef<HTMLDivElement>(null);
  const [dropper, setDropper] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  /** Arrow keys move between swatches (Tab would otherwise step through every one of them). */
  function onPaletteKey(e: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = keys[e.key];
    if (!step && e.key !== "Home" && e.key !== "End") return;
    const buttons = Array.from(paletteRef.current?.querySelectorAll<HTMLButtonElement>("button[data-swatch]") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (at + step + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((c) => c !== id));
    else if (value.length < 2) onChange([...value, id]);
    else onChange([value[0], id]);
  }

  /** Adds a colour from the photo (never removes one the user already chose). */
  function add(id: string) {
    if (!value.includes(id)) toggle(id);
  }

  async function detect() {
    if (!photo) return;
    setDetecting(true);
    setNote(null);
    try {
      const colors = await detectColors(photo, typeId, getConfigChain());
      onChange(colors);
      setNote({ text: `AI chose ${colors.map(colorLabel).join(" + ")} — adjust it if you like.` });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : "Couldn't detect the colour.", error: true });
    } finally {
      setDetecting(false);
    }
  }

  return (
    <div>
      <div aria-live="polite" className="flex min-h-9 flex-wrap items-center gap-2">
        {value.length === 0 ? (
          <span className={cn("text-xs", invalid ? "text-red-600" : "text-gray-500")}>
            {invalid ? "Pick at least one colour so I can match outfits properly." : "Nothing picked yet: choose up to 2 below. The first is the main colour."}
          </span>
        ) : (
          value.map((id, i) => (
            <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-surface py-1 pr-1 pl-1.5 text-xs font-semibold text-gray-800 shadow-sm ring-1 ring-gray-200">
              <span className="size-4 rounded-full ring-1 ring-black/20 dark:ring-white/40" style={{ background: colorBackground(id) }} aria-hidden />
              <span className="font-normal text-gray-500">{i === 0 ? "Main" : "Second"}</span> {colorLabel(id)}
              <button
                type="button"
                onClick={() => onChange(value.filter((c) => c !== id))}
                aria-label={`Remove ${colorLabel(id)}`}
                className="flex size-5 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))
        )}
      </div>

      <div ref={paletteRef} onKeyDown={onPaletteKey} role="group" aria-label="Colours" className="mt-1.5 max-h-60 space-y-2.5 overflow-y-auto rounded-2xl bg-gray-50 p-2.5">
        {COLOR_GROUPS.map((g) => {
          const colors = COLORS.filter((c) => c.group === g.id);
          return (
            <div key={g.id} role="group" aria-label={g.label}>
              <p className="mb-1 px-0.5 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">{g.label}</p>
              <div className="flex flex-wrap gap-2 p-0.5">
                {colors.map((c) => {
                  const index = value.indexOf(c.id);
                  const selected = index >= 0;
                  return (
                    <button
                      key={c.id}
                      data-swatch
                      type="button"
                      onClick={() => toggle(c.id)}
                      aria-pressed={selected}
                      aria-label={selected ? `${c.label}, ${index === 0 ? "main" : "second"} colour` : c.label}
                      title={c.label}
                      className={cn(
                        "relative flex size-9 items-center justify-center rounded-full ring-offset-2 transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
                        selected ? "scale-105 ring-2 ring-brand-600" : "ring-1 ring-black/10 hover:scale-105 dark:ring-white/30"
                      )}
                      style={{ background: colorBackground(c.id) }}
                    >
                      {selected && <Check className={cn("size-4", tickClass(c.id))} strokeWidth={3} aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-2xl bg-brand-50 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDropper(true)}
            disabled={!photo}
            className="inline-flex items-center gap-1.5 btn-secondary rounded-full px-3.5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none disabled:opacity-50"
          >
            <Pipette className="size-4 text-blush-600" aria-hidden /> Pick from photo
          </button>
          <button
            type="button"
            onClick={detect}
            disabled={!photo || detecting}
            title="Sends this one photo to your AI provider"
            className="inline-flex items-center gap-1.5 btn-secondary rounded-full px-3.5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none disabled:opacity-50"
          >
            {detecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wand2 className="size-4 text-blush-600" aria-hidden />}
            {detecting ? "Looking…" : "Detect with AI"}
          </button>
        </div>
        <p role="status" className={cn("mt-2 text-xs", note?.error ? "text-red-600" : "text-gray-500")}>
          {note?.text ??
            (photo
              ? "Tap the picture to read a colour yourself, or let the AI look at it (sends this photo to your AI provider)."
              : "Add a front photo to pick its colour straight from the picture.")}
        </p>
      </div>

      {suggestion && value.length > 0 && <p className="mt-1.5 text-xs text-gray-500">{suggestion}</p>}

      <EyedropperModal open={dropper} photo={photo} onClose={() => setDropper(false)} onPick={add} />
    </div>
  );
}
