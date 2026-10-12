"use client";

import { ChevronDown, CircleAlert, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { requireUserId } from "@/lib/auth";
import { CATEGORIES, TYPES_BY_CATEGORY, itemTitle } from "@/lib/catalog";
import { useItemImage } from "@/lib/hooks";
import { prepareImage } from "@/lib/image";
import { sampleBlobColors } from "@/lib/imagecolor";
import { LlmError } from "@/lib/llm";
import { NO_VISION_MESSAGE, RecognitionError, canRecognize, recognizePhoto } from "@/lib/recognize";
import { getConfigChain, useSettings } from "@/lib/settings";
import type { ClothingItem, Side } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useToast } from "../Toaster";
import { Modal } from "../ui/Modal";
import { useWardrobe } from "../WardrobeProvider";
import { ColorPicker } from "./ColorPicker";
import { PhotoSlot } from "./PhotoSlot";
import { RecognitionPanel, type AiState } from "./RecognitionPanel";

type Picked = { blob: Blob; url: string };

const fieldClass =
  "w-full rounded-xl border bg-surface px-3.5 py-2.5 text-base shadow-sm transition placeholder:text-gray-400 focus:ring-4 focus:outline-none sm:text-sm";

function ItemForm({ item, onClose }: { item?: ClothingItem; onClose: () => void }) {
  const { addItem, updateItem, storageError } = useWardrobe();
  const toast = useToast();
  const editing = Boolean(item);

  const [type, setType] = useState(item?.type ?? "");
  const [colors, setColors] = useState<string[]>(item?.colors ?? []);
  const [description, setDescription] = useState(item?.description ?? "");
  const [front, setFront] = useState<Picked | null>(null);
  const [back, setBack] = useState<Picked | null>(null);
  const [removeBack, setRemoveBack] = useState(false);
  const [busy, setBusy] = useState<Record<Side, boolean>>({ front: false, back: false });
  const [slotErrors, setSlotErrors] = useState<Partial<Record<Side, string>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // AI-assisted entry (new pieces only): colours are read locally the moment a photo is chosen; the AI then suggests the
  // type, colours and details. Anything the person has typed or tapped themselves is never overwritten by a suggestion.
  const { settings } = useSettings();
  const chain = useMemo(() => getConfigChain(settings), [settings]);
  const aiAvailable = canRecognize(chain);
  // With no vision-capable key there is nothing to ask, so a new piece opens in manual mode (the AI option stays one tap away).
  const [aiMode, setAiMode] = useState(!item && aiAvailable);
  const [ai, setAi] = useState<AiState>({ status: "idle" });
  const [colorNote, setColorNote] = useState<string | null>(null);
  const touched = useRef({ type: false, colors: false, description: false });
  const run = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });

  const existingFront = useItemImage(item, "front");
  const existingBack = useItemImage(item, "back");

  // Object URLs are tracked in a ref so they can be revoked exactly once, even under StrictMode.
  const picked = useRef<Record<Side, Picked | null>>({ front: null, back: null });
  useEffect(() => {
    const current = picked.current;
    return () => {
      for (const side of ["front", "back"] as Side[]) {
        const p = current[side];
        if (p) URL.revokeObjectURL(p.url);
      }
    };
  }, []);

  useEffect(() => {
    const r = run.current;
    return () => r.controller?.abort();
  }, []);

  function cancelAnalysis() {
    run.current.id++;
    run.current.controller?.abort();
    run.current.controller = null;
  }

  /** One recognition request for this photo. Newer requests (another photo, Retry) supersede older ones; same photo is cached. */
  async function analyze(blob: Blob) {
    cancelAnalysis();
    if (!aiAvailable) {
      setAi({ status: "error", message: NO_VISION_MESSAGE, needsKey: true });
      return;
    }
    const id = run.current.id;
    const controller = new AbortController();
    run.current.controller = controller;
    setAi({ status: "loading" });
    const started = performance.now();
    try {
      const result = await recognizePhoto(blob, { keys: chain, scope: requireUserId(), signal: controller.signal });
      if (run.current.id !== id) return;
      if (!touched.current.type) setType(result.type);
      if (!touched.current.colors && result.colors.length > 0) {
        setColors(result.colors);
        setColorNote("Chosen by the AI from your photo. Change it if it's off.");
      }
      if (!touched.current.description && result.details) setDescription((d) => d || result.details);
      setAi({ status: "done", result, seconds: (performance.now() - started) / 1000 });
    } catch (e) {
      if (run.current.id !== id || (e instanceof LlmError && e.kind === "aborted")) return;
      const message =
        e instanceof RecognitionError
          ? `${e.message} You can retry, or fill it in yourself.`
          : e instanceof LlmError
            ? e.message
            : "Couldn't recognise that photo. Check your connection and try again.";
      setAi({ status: "error", message, needsKey: e instanceof LlmError && e.kind === "auth" && !aiAvailable });
    }
  }

  function chooseMode(useAi: boolean) {
    setAiMode(useAi);
    if (!useAi) {
      cancelAnalysis();
      setAi({ status: "idle" });
    } else if (front) void analyze(front.blob);
    else setAi({ status: "idle" });
  }

  function setPicked(side: Side, blob: Blob | null) {
    const previous = picked.current[side];
    if (previous) URL.revokeObjectURL(previous.url);
    const next = blob ? { blob, url: URL.createObjectURL(blob) } : null;
    picked.current[side] = next;
    (side === "front" ? setFront : setBack)(next);
  }

  async function handleFile(side: Side, file: File) {
    setBusy((b) => ({ ...b, [side]: true }));
    setSlotErrors((e) => ({ ...e, [side]: undefined }));
    try {
      const prepared = await prepareImage(file);
      setPicked(side, prepared);
      if (side === "back") setRemoveBack(false);
      else if (!editing) {
        // Colours first, locally and instantly (no network, a few ms), then the AI if it was asked for.
        if (!touched.current.colors) {
          sampleBlobColors(prepared).then(
            (d) => {
              if (touched.current.colors || d.colors.length === 0) return;
              setColors((cur) => (cur.length ? cur : d.colors));
              setColorNote("Read from your photo. Change it if it's off.");
            },
            () => {} // a browser that can't read pixels just leaves the colours for the person to pick
          );
        }
        if (aiMode) void analyze(prepared);
      }
    } catch (e) {
      setSlotErrors((prev) => ({ ...prev, [side]: e instanceof Error ? e.message : "Couldn't read that photo." }));
    } finally {
      setBusy((b) => ({ ...b, [side]: false }));
    }
  }

  function reset() {
    cancelAnalysis();
    touched.current = { type: false, colors: false, description: false };
    setAi({ status: "idle" });
    setColorNote(null);
    setPicked("front", null);
    setPicked("back", null);
    setType("");
    setColors([]);
    setDescription("");
    setRemoveBack(false);
    setSubmitted(false);
    setSlotErrors({});
    setFormError(null);
  }

  const frontOk = editing || Boolean(front);
  const frontUrl = front?.url ?? existingFront;
  const backUrl = removeBack ? null : (back?.url ?? existingBack);

  async function submit(another: boolean) {
    setSubmitted(true);
    setFormError(null);
    if (ai.status === "loading" && !type) {
      setFormError("The AI is still looking at your photo. Give it a moment, or choose the type yourself.");
      return;
    }
    if (!frontOk || !type || colors.length === 0 || busy.front || busy.back) return;

    setSaving(true);
    try {
      if (item) {
        await updateItem(item.id, {
          type,
          colors,
          description,
          front: front?.blob,
          back: back ? back.blob : removeBack ? null : undefined,
        });
        toast("Changes saved");
        onClose();
      } else {
        const created = await addItem({ type, colors, description, front: front!.blob, back: back?.blob });
        toast(`Added ${itemTitle(created)}`);
        if (another) reset();
        else onClose();
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save that piece.");
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="space-y-5 p-5">
        {storageError && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {storageError}
          </p>
        )}

        {!editing && (
          <RecognitionPanel
            aiMode={aiMode}
            onMode={chooseMode}
            state={ai}
            hasPhoto={Boolean(front)}
            currentType={type}
            onRetry={() => front && void analyze(front.blob)}
            onPickType={(id) => {
              touched.current.type = true;
              setType(id);
            }}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <PhotoSlot
            label="Front"
            imageUrl={frontUrl}
            busy={busy.front}
            error={slotErrors.front ?? (submitted && !frontOk ? "Add a front photo." : null)}
            invalid={submitted && !frontOk}
            onFile={(f) => handleFile("front", f)}
          />
          <PhotoSlot
            label="Back"
            optional
            imageUrl={backUrl}
            busy={busy.back}
            error={slotErrors.back}
            onFile={(f) => handleFile("back", f)}
            onRemove={
              back || (item?.hasBack && !removeBack)
                ? () => {
                    setPicked("back", null);
                    if (item?.hasBack) setRemoveBack(true);
                  }
                : undefined
            }
          />
        </div>

        <div>
          <label htmlFor="item-type" className="mb-1.5 block text-sm font-medium text-gray-800">
            {aiMode && !editing && type ? "Type" : "What is it?"}
            {aiMode && ai.status === "done" && type === ai.result.type && <span className="ml-2 text-xs font-normal text-sage-700">AI suggestion</span>}
          </label>
          <div className="relative">
            <select
              id="item-type"
              value={type}
              onChange={(e) => {
                touched.current.type = true;
                setType(e.target.value);
              }}
              aria-invalid={submitted && !type}
              className={cn(
                fieldClass,
                "appearance-none pr-10",
                submitted && !type
                  ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                  : "border-gray-200 focus:border-brand-400 focus:ring-brand-100",
                !type && "text-gray-400"
              )}
            >
              <option value="" disabled>
                {ai.status === "loading" && aiMode ? "Recognising…" : "Choose a type…"}
              </option>
              {CATEGORIES.map((c) => (
                <optgroup key={c.id} label={c.label}>
                  {TYPES_BY_CATEGORY[c.id].map((t) => (
                    <option key={t.id} value={t.id} className="text-gray-900">
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-gray-400" aria-hidden />
          </div>
          {submitted && !type && <p className="mt-1.5 text-xs text-red-600">Choose what kind of piece this is.</p>}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-gray-800">Colour</p>
          <ColorPicker
            value={colors}
            onChange={(next) => {
              touched.current.colors = true;
              setColorNote(null);
              setColors(next);
            }}
            invalid={submitted && colors.length === 0}
            photo={front?.blob ?? existingFront}
            typeId={type || undefined}
            suggestion={colorNote}
          />
        </div>

        <div>
          <label htmlFor="item-notes" className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-gray-800">
            <span>
              Details <span className="font-normal text-gray-400">(optional)</span>
            </span>
            <span className="text-xs font-normal text-gray-400">{description.length}/400</span>
          </label>
          <textarea
            id="item-notes"
            value={description}
            onChange={(e) => {
              touched.current.description = true;
              setDescription(e.target.value);
            }}
            maxLength={400}
            rows={3}
            placeholder="Fit, fabric, pattern, brand, season, occasion… e.g. “Oversized boxy cotton tee, white with a small black logo — great for summer, casual.”"
            className={cn(fieldClass, "resize-none border-gray-200 focus:border-brand-400 focus:ring-brand-100")}
          />
          <p className="mt-1.5 text-xs text-gray-500">The stylist reads this when matching outfits.</p>
        </div>

        {saving && (
          <p role="status" className="flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-3 text-sm text-brand-800">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            {editing ? "Saving your changes…" : "Uploading your photos and saving this item…"}
          </p>
        )}

        {formError && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {formError}
          </p>
        )}
      </div>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-gray-100 bg-surface/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-5 sm:py-3.5">
        {/* On phones the ✕ in the header already cancels, so the footer keeps just the two save actions. */}
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="hidden rounded-full px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-50 sm:inline-flex"
        >
          Cancel
        </button>
        {!editing && (
          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={saving || busy.front || busy.back}
            className="flex-1 rounded-full px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap text-brand-700 ring-1 ring-brand-200 transition hover:bg-brand-50 disabled:opacity-50 sm:flex-none sm:px-4 sm:text-sm"
          >
            Save &amp; add another
          </button>
        )}
        <button
          type="submit"
          disabled={saving || busy.front || busy.back}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-brand-600 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap text-white shadow-soft transition hover:bg-brand-500 disabled:opacity-60 sm:flex-none sm:px-5 sm:text-sm"
        >
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {saving ? (editing ? "Saving…" : "Uploading…") : editing ? "Save changes" : "Save clothing item"}
        </button>
      </div>
    </form>
  );
}

export function ItemFormModal({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item?: ClothingItem;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={item ? "Edit clothing item" : "Add clothing item"} className="sm:max-w-xl">
      <ItemForm key={item?.id ?? "new"} item={item} onClose={onClose} />
    </Modal>
  );
}
