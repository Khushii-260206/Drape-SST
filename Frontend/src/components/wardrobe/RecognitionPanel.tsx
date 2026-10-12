"use client";

import { CircleAlert, Loader2, PencilLine, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { CATEGORIES, typeLabel } from "@/lib/catalog";
import type { Recognition } from "@/lib/recognize";
import { cn } from "@/lib/utils";

export type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: Recognition; seconds: number }
  | { status: "error"; message: string; needsKey?: boolean };

const CONFIDENCE: Record<Recognition["confidence"], string> = {
  high: "Pretty sure",
  medium: "Fairly sure",
  low: "Not very sure",
};

/** Mode switch + the live status of photo recognition. Everything the AI fills in stays editable below it. */
export function RecognitionPanel({
  aiMode,
  onMode,
  state,
  hasPhoto,
  currentType,
  onRetry,
  onPickType,
}: {
  aiMode: boolean;
  onMode: (ai: boolean) => void;
  state: AiState;
  hasPhoto: boolean;
  currentType: string;
  onRetry: () => void;
  onPickType: (id: string) => void;
}) {
  const modeBtn = (active: boolean) =>
    cn(
      "flex-1 rounded-full px-3 py-2 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
      active ? "bg-brand-600 text-white shadow-soft" : "text-gray-600 hover:bg-gray-100"
    );

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="How to fill in this piece" className="flex gap-1 rounded-full bg-gray-50 p-1 ring-1 ring-gray-200">
        <button type="button" role="radio" aria-checked={aiMode} onClick={() => onMode(true)} className={modeBtn(aiMode)}>
          <Sparkles className="mr-1.5 inline size-4 align-text-bottom" aria-hidden />
          Fill in with AI
        </button>
        <button type="button" role="radio" aria-checked={!aiMode} onClick={() => onMode(false)} className={modeBtn(!aiMode)}>
          <PencilLine className="mr-1.5 inline size-4 align-text-bottom" aria-hidden />
          Enter manually
        </button>
      </div>

      {aiMode && state.status === "idle" && (
        <p role="status" className="text-xs text-gray-500">
          {hasPhoto ? "Ready." : "Add a front photo and the AI will suggest the type and colours (this one photo is sent to your AI provider)."}
        </p>
      )}

      {aiMode && state.status === "loading" && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-3 text-sm text-brand-800">
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          Looking at your photo… colours from the picture are already filled in.
        </p>
      )}

      {aiMode && state.status === "done" && (
        <div role="status" className="rounded-xl bg-sage-100 px-3.5 py-3 text-sm text-sage-700">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <Sparkles className="size-4 shrink-0 self-center" aria-hidden />
            <span>
              AI suggests <strong className="font-semibold">{state.result.name}</strong>
              <span className="text-sage-700/80"> · {CATEGORIES.find((c) => c.id === state.result.category)?.label}</span>
            </span>
          </p>
          <p className="mt-1 text-xs">
            {CONFIDENCE[state.result.confidence]}. These are suggestions: check them and change anything that&apos;s off.
          </p>
          {state.result.alternatives.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              Could also be:
              {state.result.alternatives.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onPickType(id)}
                  aria-pressed={currentType === id}
                  className={cn(
                    "rounded-full px-2.5 py-1 font-semibold ring-1 transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
                    currentType === id ? "bg-brand-600 text-white ring-brand-600" : "bg-surface text-gray-800 ring-gray-300 hover:bg-gray-50"
                  )}
                >
                  {typeLabel(id)}
                </button>
              ))}
            </p>
          )}
        </div>
      )}

      {aiMode && state.status === "error" && (
        <div role="alert" className="rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
          <p className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {state.message}
              {state.needsKey && (
                <>
                  {" "}
                  <Link href="/settings/" className="font-semibold underline underline-offset-2">
                    Open Settings
                  </Link>
                </>
              )}
            </span>
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {!state.needsKey && (
              <button
                type="button"
                onClick={onRetry}
                disabled={!hasPhoto}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-soft transition hover:bg-brand-500 disabled:opacity-60"
              >
                <RefreshCw className="size-3.5" aria-hidden /> Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => onMode(false)}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-xs font-semibold text-gray-800 ring-1 ring-gray-300 transition hover:bg-gray-50"
            >
              <PencilLine className="size-3.5" aria-hidden /> Enter manually
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
