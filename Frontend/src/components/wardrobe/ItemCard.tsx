"use client";

import { Heart, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { memo, useState } from "react";
import { colorLabel, itemTitle, typeLabel } from "@/lib/catalog";
import { useItemImage } from "@/lib/hooks";
import type { ClothingItem, Side } from "@/lib/types";
import { useItemViewer } from "../ItemViewer";
import { useToast } from "../Toaster";
import { useWardrobe } from "../WardrobeProvider";
import { ColorDots } from "./ColorDots";
import { onPhotoError } from "@/lib/photos";

const iconButton =
  "glass-lite flex size-9 items-center justify-center rounded-full text-gray-600 transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none sm:size-8";

export const ItemCard = memo(function ItemCard({
  item,
  onEdit,
  onDelete,
}: {
  item: ClothingItem;
  onEdit: (item: ClothingItem) => void;
  onDelete: (item: ClothingItem) => void;
}) {
  const openViewer = useItemViewer();
  const { setFavorite } = useWardrobe();
  const toast = useToast();
  const [side, setSide] = useState<Side>("front");
  const url = useItemImage(item, item.hasBack ? side : "front", "thumb");
  const title = itemTitle(item);

  return (
    <article className="group [contain-intrinsic-size:auto_340px] [content-visibility:auto] overflow-hidden rounded-3xl bg-surface shadow-soft ring-1 ring-gray-200/70 transition duration-300 hover:-translate-y-0.5 hover:shadow-lift">
      <div className="relative aspect-[4/5] bg-gray-100">
        <button
          type="button"
          onClick={() => openViewer(item.id)}
          aria-label={`View ${title}`}
          className="absolute inset-0 block focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none focus-visible:ring-inset"
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} onError={onPhotoError} alt={`${title} (${side})`} loading="lazy" decoding="async" className="size-full object-cover" />
          ) : (
            <span className="block size-full animate-pulse bg-gray-200" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setFavorite(item.id, !item.favorite).catch((e) => toast(e instanceof Error ? e.message : "Couldn't update that.", "error"))}
          aria-label={item.favorite ? `Remove ${title} from favourites` : `Add ${title} to favourites`}
          aria-pressed={item.favorite}
          className={`absolute top-2 left-2 ${iconButton} ${item.favorite ? "text-blush-600" : "text-gray-500 hover:text-blush-600"}`}
        >
          <Heart className={`size-4 ${item.favorite ? "fill-current" : ""}`} aria-hidden />
        </button>

        <div className="absolute top-2 right-2 flex gap-1.5">
          <button type="button" onClick={() => onEdit(item)} aria-label={`Edit ${title}`} className={`${iconButton} hover:text-brand-700`}>
            <Pencil className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            aria-label={`Remove ${title}`}
            className={`${iconButton} hover:bg-red-50 hover:text-red-600`}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>

        {item.hasBack && (
          <button
            type="button"
            onClick={() => setSide((s) => (s === "front" ? "back" : "front"))}
            aria-label={`Showing ${side}. Flip to ${side === "front" ? "back" : "front"}`}
            className="absolute bottom-2 left-2 inline-flex min-h-8 items-center gap-1.5 glass-lite rounded-full px-3 py-1 text-xs font-medium text-gray-700 transition hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
          >
            <RefreshCw className="size-3" aria-hidden />
            {side === "front" ? "Front" : "Back"}
          </button>
        )}
      </div>

      <div className="space-y-0.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-gray-900">{typeLabel(item.type)}</h3>
          <ColorDots colors={item.colors} />
        </div>
        {item.colors.length > 0 && (
          <p className="truncate text-xs text-gray-500">{item.colors.map(colorLabel).join(" + ")}</p>
        )}
        {item.description && <p className="line-clamp-2 pt-0.5 text-xs leading-snug text-gray-500">{item.description}</p>}
        {item.wearCount > 0 && <p className="pt-0.5 text-[11px] font-medium text-brand-600">Worn {item.wearCount}×</p>}
      </div>
    </article>
  );
});
