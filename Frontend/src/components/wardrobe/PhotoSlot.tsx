"use client";

import { ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { PHOTO_ACCEPT } from "@/lib/image";
import { cn } from "@/lib/utils";
import { onPhotoError } from "@/lib/photos";

/** One photo tile (front or back): tap to choose, or drop an image on it. */
export function PhotoSlot({
  label,
  optional,
  imageUrl,
  busy,
  error,
  invalid,
  onFile,
  onRemove,
}: {
  label: string;
  optional?: boolean;
  imageUrl: string | null;
  busy: boolean;
  error?: string | null;
  invalid?: boolean;
  onFile: (file: File) => void;
  onRemove?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handle(files: FileList | null) {
    const file = files?.[0];
    if (file) onFile(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-sm font-medium text-gray-800">
        {label} {optional && <span className="font-normal text-gray-400">(optional)</span>}
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files);
        }}
        className={cn(
          "relative aspect-[4/5] overflow-hidden rounded-2xl border-2 transition",
          dragging
            ? "border-dashed border-brand-400 bg-brand-50"
            : imageUrl
              ? "border-transparent bg-gray-100"
              : invalid
                ? "border-dashed border-red-300 bg-red-50/40"
                : "border-dashed border-gray-200 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/50"
        )}
      >
        <label
          className={cn(
            "absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1.5 text-center focus-within:ring-2 focus-within:ring-brand-400 focus-within:ring-inset",
            !imageUrl && "px-3"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={PHOTO_ACCEPT}
            className="sr-only"
            aria-label={`${label} photo`}
            disabled={busy}
            onChange={(e) => handle(e.target.files)}
          />
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} onError={onPhotoError} alt={`${label} preview`} className="size-full object-cover" />
          ) : (
            <>
              <span className="flex size-10 items-center justify-center rounded-full bg-surface text-brand-600 shadow-sm ring-1 ring-gray-200">
                <ImagePlus className="size-5" aria-hidden />
              </span>
              <span className="text-sm font-medium text-gray-700">Add photo</span>
              <span className="text-xs text-gray-500">tap, or drop one here</span>
            </>
          )}
        </label>

        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/70 backdrop-blur-[1px]">
            <Loader2 className="size-6 animate-spin text-brand-600" aria-label="Processing photo" />
          </div>
        )}

        {imageUrl && !busy && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 glass-lite rounded-full px-2.5 py-1 text-xs font-medium text-gray-700">
              <RefreshCw className="size-3" aria-hidden /> Replace
            </span>
          </div>
        )}
        {imageUrl && !busy && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label.toLowerCase()} photo`}
            className="absolute top-2 right-2 flex size-8 items-center justify-center glass-lite rounded-full text-gray-600 transition hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
