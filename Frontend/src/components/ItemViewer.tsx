"use client";

import { CalendarCheck, Heart, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { colorLabel, itemTitle, typeLabel } from "@/lib/catalog";
import { useItemImage } from "@/lib/hooks";
import type { ClothingItem, Side } from "@/lib/types";
import { ago, daysBetween } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useChat } from "./ChatProvider";
import { useToast } from "./Toaster";
import { ColorDots } from "./wardrobe/ColorDots";
import { useWardrobe } from "./WardrobeProvider";
import { Modal } from "./ui/Modal";
import { onPhotoError } from "@/lib/photos";

const ViewerContext = createContext<(id: string) => void>(() => {});

/** Opens the full-size photo viewer for a piece, from anywhere (chat chips, wardrobe cards). */
export function useItemViewer() {
  return useContext(ViewerContext);
}

export function ItemViewerProvider({ children }: { children: ReactNode }) {
  const { items } = useWardrobe();
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const item = openId ? items.find((i) => i.id === openId) : undefined;
  const open = useMemo(() => (id: string) => setOpenId(id), []);

  return (
    <ViewerContext.Provider value={open}>
      {children}
      <Modal open={Boolean(item)} onClose={close} title={item ? itemTitle(item) : "Piece"}>
        {item && <ViewerBody key={item.id} item={item} onClose={close} />}
      </Modal>
    </ViewerContext.Provider>
  );
}

function ViewerBody({ item, onClose }: { item: ClothingItem; onClose: () => void }) {
  const [side, setSide] = useState<Side>("front");
  const url = useItemImage(item, side);
  const { setFavorite, markWorn } = useWardrobe();
  const { send } = useChat();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const wornToday = item.lastWorn !== null && daysBetween(item.lastWorn) === 0;

  async function run(task: () => Promise<void>, done?: string) {
    setBusy(true);
    try {
      await task();
      if (done) toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong.", "error");
    } finally {
      setBusy(false);
    }
  }

  function styleThis() {
    send(`Build me three different outfits around my ${itemTitle(item)} [[${item.id}]].`);
    onClose();
    router.push("/");
  }

  return (
    <div className="p-4 sm:p-5">
      <div className="relative mx-auto aspect-[4/5] w-full max-w-sm overflow-hidden rounded-2xl bg-gray-100">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} onError={onPhotoError} alt={`${itemTitle(item)} — ${side}`} className="size-full object-contain" />
        ) : (
          <div className="size-full animate-pulse bg-gray-200" />
        )}
      </div>

      {item.hasBack && (
        <div className="mx-auto mt-3 flex w-fit rounded-full bg-gray-100 p-1" role="tablist" aria-label="Photo side">
          {(["front", "back"] as Side[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={side === s}
              onClick={() => setSide(s)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium capitalize transition",
                side === s ? "bg-surface text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => markWorn([item.id]), `Marked ${itemTitle(item)} as worn today`)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2.5 text-sm font-semibold transition disabled:opacity-60",
            wornToday ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100" : "bg-brand-600 text-white shadow-soft hover:bg-brand-500"
          )}
        >
          <CalendarCheck className="size-4" aria-hidden /> {wornToday ? "Worn today ✓" : "I wore this today"}
        </button>
        <button
          type="button"
          onClick={styleThis}
          className="inline-flex items-center justify-center gap-1.5 btn-secondary rounded-full px-3 py-2.5 text-sm font-semibold"
        >
          <Sparkles className="size-4 text-blush-600" aria-hidden /> Style this piece
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={item.favorite}
          onClick={() => run(() => setFavorite(item.id, !item.favorite))}
          className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-60"
        >
          <Heart className={cn("size-4", item.favorite && "fill-current text-blush-600")} aria-hidden />
          {item.favorite ? "In your favourites" : "Add to favourites"}
        </button>
      </div>

      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-gray-500">Type</dt>
          <dd className="font-medium text-gray-900">{typeLabel(item.type)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-gray-500">Colour</dt>
          <dd className="flex items-center gap-2 font-medium text-gray-900">
            <ColorDots colors={item.colors} />
            {item.colors.length ? item.colors.map(colorLabel).join(" + ") : "Not set"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-gray-500">Worn</dt>
          <dd className="font-medium text-gray-900">
            {item.wearCount > 0 && item.lastWorn ? `${item.wearCount}× · last ${ago(item.lastWorn)}` : "Not yet"}
          </dd>
        </div>
        {item.description && (
          <div>
            <dt className="text-gray-500">Details</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-gray-800">{item.description}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
