"use client";

import { Heart, Palette, Repeat, Shirt } from "lucide-react";
import { useMemo } from "react";
import { CATEGORIES, colorLabel, itemTitle } from "@/lib/catalog";
import { useItemImage } from "@/lib/hooks";
import { ago } from "@/lib/time";
import type { ClothingItem } from "@/lib/types";
import { useItemViewer } from "../ItemViewer";
import { colorBackground } from "./ColorDots";
import { onPhotoError } from "@/lib/photos";

function Stat({ icon: Icon, value, label }: { icon: typeof Heart; value: string | number; label: string }) {
  return (
    <div className="glass-card flex items-center gap-3 rounded-2xl px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sage-100 text-sage-700">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xl leading-none font-semibold text-gray-900">{value}</span>
        <span className="mt-1 block truncate text-xs text-gray-500">{label}</span>
      </span>
    </div>
  );
}

function Thumb({ item, caption }: { item: ClothingItem; caption: string }) {
  const url = useItemImage(item, "front", "thumb");
  const open = useItemViewer();
  return (
    <button
      type="button"
      onClick={() => open(item.id)}
      className="flex min-w-0 items-center gap-2.5 rounded-xl p-1.5 text-left transition hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
    >
      <span className="size-11 shrink-0 overflow-hidden rounded-lg bg-gray-100">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} onError={onPhotoError} alt="" loading="lazy" className="size-full object-cover" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-gray-900">{itemTitle(item)}</span>
        <span className="block truncate text-xs text-gray-500">{caption}</span>
      </span>
    </button>
  );
}

/** A quick read on the closet: counts, palette, and what's getting worn (or forgotten). */
export function Insights({ items }: { items: ClothingItem[] }) {
  const stats = useMemo(() => {
    const colors = new Map<string, number>();
    for (const i of items) for (const c of i.colors) colors.set(c, (colors.get(c) ?? 0) + 1);
    const palette = Array.from(colors, ([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n);
    const total = palette.reduce((sum, p) => sum + p.n, 0) || 1;

    const byCategory = CATEGORIES.map((c) => ({ ...c, n: items.filter((i) => i.category === c.id).length })).filter((c) => c.n > 0);
    const worn = items.filter((i) => i.wearCount > 0);
    const mostWorn = [...worn].sort((a, b) => b.wearCount - a.wearCount || (b.lastWorn ?? 0) - (a.lastWorn ?? 0)).slice(0, 3);
    const neglected = items
      .filter((i) => i.wearCount === 0)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, 3);
    return {
      palette,
      total,
      byCategory,
      mostWorn,
      neglected,
      neverWorn: items.filter((i) => i.wearCount === 0).length,
      favorites: items.filter((i) => i.favorite).length,
    };
  }, [items]);

  const maxCategory = Math.max(1, ...stats.byCategory.map((c) => c.n));

  return (
    <section aria-label="Wardrobe insights" className="mt-5 space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Shirt} value={items.length} label={items.length === 1 ? "piece" : "pieces"} />
        <Stat icon={Heart} value={stats.favorites} label="favourites" />
        <Stat icon={Palette} value={stats.palette.length} label="colours" />
        <Stat icon={Repeat} value={stats.neverWorn} label="not worn yet" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-3xl bg-surface p-4 shadow-soft ring-1 ring-gray-200/70 sm:p-5">
          <h2 className="text-sm font-semibold text-gray-900">Your palette</h2>
          <div className="mt-3 flex h-3.5 overflow-hidden rounded-full ring-1 ring-black/10 dark:ring-white/25" role="img" aria-label="Colour mix of your wardrobe">
            {stats.palette.map((p) => (
              <span key={p.id} title={`${colorLabel(p.id)} · ${p.n}`} style={{ width: `${(p.n / stats.total) * 100}%`, background: colorBackground(p.id) }} />
            ))}
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-gray-500">
            {stats.palette
              .slice(0, 5)
              .map((p) => `${colorLabel(p.id)} ${Math.round((p.n / stats.total) * 100)}%`)
              .join(" · ") || "Add colours to your pieces to see your palette."}
          </p>

          <div className="mt-4 space-y-1.5">
            {stats.byCategory.map((c) => (
              <div key={c.id} className="flex items-center gap-3 text-xs">
                <span className="w-20 shrink-0 text-gray-600">{c.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(c.n / maxCategory) * 100}%` }} />
                </span>
                <span className="w-5 text-right font-medium text-gray-700">{c.n}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl bg-surface p-4 shadow-soft ring-1 ring-gray-200/70 sm:p-5">
          <h2 className="text-sm font-semibold text-gray-900">On rotation</h2>
          {stats.mostWorn.length > 0 ? (
            <div className="mt-2 space-y-0.5">
              {stats.mostWorn.map((i) => (
                <Thumb key={i.id} item={i} caption={`Worn ${i.wearCount}×${i.lastWorn ? ` · last ${ago(i.lastWorn)}` : ""}`} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-gray-500">
              Tap “I wore this today” on a piece (or “Wear today” on a saved look) and your most-worn favourites show up here.
            </p>
          )}

          {stats.neglected.length > 0 && stats.mostWorn.length > 0 && (
            <>
              <h2 className="mt-4 text-sm font-semibold text-gray-900">Give these a go</h2>
              <div className="mt-2 space-y-0.5">
                {stats.neglected.map((i) => (
                  <Thumb key={i.id} item={i} caption="Not worn yet" />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
