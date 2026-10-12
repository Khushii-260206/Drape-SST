"use client";

import { Check, Loader2, Wand2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { detectColors } from "@/lib/aicolor";
import { detectBatch, type Detected } from "@/lib/detect-batch";
import { sampleBlobColors } from "@/lib/imagecolor";
import { colorLabel, itemTitle, typeLabel } from "@/lib/catalog";
import { useItemImage } from "@/lib/hooks";
import { getPhotoUrl } from "@/lib/photos";
import { getConfigChain } from "@/lib/settings";
import type { ClothingItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useToast } from "../Toaster";
import { Modal } from "../ui/Modal";
import { useWardrobe } from "../WardrobeProvider";
import { ColorDots } from "./ColorDots";
import { onPhotoError } from "@/lib/photos";

type Result = Detected;

const sameColors = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i]);

async function loadPhotoBlob(item: ClothingItem): Promise<Blob> {
  const url = await getPhotoUrl(item, "front", "thumb");
  if (!url) throw new Error("No photo");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't load that photo.");
  return res.blob();
}

/** Pre-tick only a clear disagreement: the AI's main colour isn't one you picked. A subset (dropping your second colour) isn't an improvement. */
const disagrees = (current: string[], detected: string[]) => detected.length > 0 && !current.includes(detected[0]);

function Row({ item, detected, source, checked, onToggle }: { item: ClothingItem; detected: string[]; source: "photo" | "ai"; checked: boolean; onToggle: () => void }) {
  const url = useItemImage(item, "front", "thumb");
  const same = sameColors(item.colors, detected);
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 rounded-2xl px-2.5 py-2 transition hover:bg-gray-50", same && "opacity-60")}>
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={same} className="size-4 shrink-0 accent-brand-600" aria-label={`Update ${itemTitle(item)}`} />
      <span className="size-12 shrink-0 overflow-hidden rounded-xl bg-gray-100">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} onError={onPhotoError} alt="" loading="lazy" className="size-full object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900">{typeLabel(item.type)}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          <ColorDots colors={item.colors} />
          <span aria-hidden>→</span>
          <ColorDots colors={detected} />
          <span className="truncate">{same ? "No change" : detected.map(colorLabel).join(" + ")}</span>
          {source === "ai" && <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">AI</span>}
        </span>
      </span>
    </label>
  );
}

/**
 * Reads each piece's colour (on this device first, the AI only for unclear photos), then lets you review and tick which
 * suggestions to keep. Nothing is changed until you press Apply.
 */
export function DetectColorsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Detect colours" className="sm:max-w-xl">
      {open && <Body onClose={onClose} />}
    </Modal>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const { items, setColors } = useWardrobe();
  const toast = useToast();
  const [phase, setPhase] = useState<"intro" | "running" | "review">("intro");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [applying, setApplying] = useState(false);
  const cancelRef = useRef<AbortController | null>(null);

  const keys = getConfigChain();
  const canUseAi = keys.some((c) => c.provider === "gemini" || c.provider === "openrouter");

  const start = useCallback(async () => {
    const controller = new AbortController();
    cancelRef.current = controller;
    setPhase("running");
    setDone(0);
    const chain = getConfigChain();
    const found = await detectBatch(items, {
      loadPhoto: loadPhotoBlob,
      local: sampleBlobColors,
      ai: chain.some((c) => c.provider === "gemini" || c.provider === "openrouter")
        ? (photo, item, signal) => detectColors(photo, item.type, chain, signal)
        : null,
      signal: controller.signal,
      onProgress: setDone,
      onWaiting: setWaiting,
    });
    setWaiting(false);

    setResults({ ...found });
    setChosen(new Set(Object.entries(found).filter(([id, r]) => "colors" in r && disagrees(items.find((i) => i.id === id)?.colors ?? [], r.colors)).map(([id]) => id)));
    setPhase("review");
  }, [items]);

  const rows = useMemo(
    () =>
      items
        .map((item) => ({ item, r: results[item.id] }))
        .filter((x): x is { item: ClothingItem; r: { colors: string[]; source: "photo" | "ai" } } => Boolean(x.r) && "colors" in x.r!),
    [items, results]
  );
  const failed = Object.values(results).filter((r) => "error" in r).length;
  const shown = onlyChanges ? rows.filter((x) => !sameColors(x.item.colors, x.r.colors)) : rows;

  async function apply() {
    setApplying(true);
    try {
      const updates = rows.filter((x) => chosen.has(x.item.id)).map((x) => ({ id: x.item.id, colors: x.r.colors }));
      await setColors(updates);
      toast(`Updated colours on ${updates.length} ${updates.length === 1 ? "piece" : "pieces"}`);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the colours.", "error");
    } finally {
      setApplying(false);
    }
  }

  if (phase === "intro") {
    return (
      <div className="space-y-4 p-5">
        <p className="text-sm leading-relaxed text-gray-600">
          Drape will read the colours from the photo of each of your {items.length} pieces and suggest them. <strong className="font-semibold text-gray-800">
          Nothing changes until you review the suggestions and press Apply.</strong>
        </p>
        <p className="rounded-2xl bg-brand-50 px-4 py-3 text-xs leading-relaxed text-brand-800">
          {canUseAi
            ? "Clear-cut colours are read on your device without sending anything. Only photos that are hard to read (busy backgrounds, several colours) go, as a small copy, to your AI provider: Gemini, or OpenRouter as a backup."
            : "Colours are read on your device and no photo leaves it. This is less reliable on busy backgrounds; add a Gemini or OpenRouter key in Settings for a second opinion on those."}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={start}
            disabled={items.length === 0}
            className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-500 disabled:opacity-50"
          >
            <Wand2 className="size-4" aria-hidden /> Start
          </button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-3 text-sm text-gray-700" role="status">
          <Loader2 className="size-5 animate-spin text-brand-600" aria-hidden />
          {waiting ? "Waiting for the AI's rate limit to clear…" : "Reading your clothes…"} {done} of {items.length}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(done / Math.max(1, items.length)) * 100}%` }} />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => cancelRef.current?.abort()}
            className="btn-secondary rounded-full px-4 py-2.5 text-sm font-medium"
          >
            Stop
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-h-[75dvh] flex-col">
      <div className="space-y-2 border-b border-gray-100 px-5 py-4">
        <p className="text-sm text-gray-700">
          {rows.length === 0
            ? "None of the photos could be read."
            : `${rows.filter((x) => disagrees(x.item.colors, x.r.colors)).length} of ${rows.length} pieces look like a different colour from what's saved. Those are ticked; the rest you can tick yourself.`}
          {failed > 0 && <span className="text-gray-500"> ({failed} couldn&apos;t be checked.)</span>}
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} className="size-4 accent-brand-600" /> Only show pieces that would change
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {shown.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-gray-500">Everything already matches what the photos show. 🎉</p>
        ) : (
          shown.map(({ item, r }) => (
            <Row
              key={item.id}
              item={item}
              detected={r.colors}
              source={r.source}
              checked={chosen.has(item.id)}
              onToggle={() =>
                setChosen((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })
              }
            />
          ))
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3.5">
        <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100">
          Close
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={applying || chosen.size === 0}
          className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-500 disabled:opacity-50"
        >
          {applying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          Apply to {chosen.size} {chosen.size === 1 ? "piece" : "pieces"}
        </button>
      </div>
    </div>
  );
}
