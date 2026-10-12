"use client";

import { ChartPie, ChevronDown, Wand2, CircleAlert, Heart, Plus, Search, Shirt, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, colorLabel, itemTitle, typeLabel } from "@/lib/catalog";
import type { CategoryId, ClothingItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useToast } from "../Toaster";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useWardrobe } from "../WardrobeProvider";
import { ItemCard } from "./ItemCard";

// These open on demand, so they're fetched on demand too (and warmed up once the page is idle) instead of
// weighing down the first download.
const loadForm = () => import("./ItemFormModal").then((m) => m.ItemFormModal);
const loadDetect = () => import("./DetectColorsDialog").then((m) => m.DetectColorsDialog);
const loadInsights = () => import("./Insights").then((m) => m.Insights);
const ItemFormModal = dynamic(loadForm);
const DetectColorsDialog = dynamic(loadDetect);
const Insights = dynamic(loadInsights);

function matches(item: ClothingItem, query: string): boolean {
  const haystack = [typeLabel(item.type), ...item.colors.map(colorLabel), item.description].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

type SortKey = "newest" | "favorites" | "most-worn" | "least-worn";
const SORTS: { id: SortKey; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "favorites", label: "Favourites first" },
  { id: "most-worn", label: "Most worn" },
  { id: "least-worn", label: "Least worn" },
];

function sortItems(list: ClothingItem[], sort: SortKey): ClothingItem[] {
  const byNewest = (a: ClothingItem, b: ClothingItem) => b.createdAt - a.createdAt;
  const copy = [...list];
  switch (sort) {
    case "favorites":
      return copy.sort((a, b) => Number(b.favorite) - Number(a.favorite) || byNewest(a, b));
    case "most-worn":
      return copy.sort((a, b) => b.wearCount - a.wearCount || byNewest(a, b));
    case "least-worn":
      return copy.sort((a, b) => a.wearCount - b.wearCount || (a.lastWorn ?? 0) - (b.lastWorn ?? 0) || byNewest(a, b));
    default:
      return copy.sort(byNewest);
  }
}

function GridSkeleton() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-2xl border border-gray-100 bg-surface">
          <div className="aspect-[4/5] bg-gray-200" />
          <div className="space-y-2 p-3">
            <div className="h-3.5 w-2/3 rounded-full bg-gray-200" />
            <div className="h-3 w-1/2 rounded-full bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WardrobeView() {
  const { items, ready, storageError, removeItem } = useWardrobe();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    const warm = () => {
      void loadForm();
      void loadDetect();
      void loadInsights();
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(warm, 2000);
    return () => clearTimeout(t);
  }, []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ClothingItem | null>(null);
  const [deleting, setDeleting] = useState<ClothingItem | null>(null);

  const present = useMemo(() => CATEGORIES.filter((c) => items.some((i) => i.category === c.id)), [items]);
  const activeCategory = category === "all" || present.some((c) => c.id === category) ? category : "all";

  const favoriteCount = useMemo(() => items.filter((i) => i.favorite).length, [items]);
  const favoritesOn = onlyFavorites && favoriteCount > 0;

  const visible = useMemo(
    () =>
      sortItems(
        items.filter(
          (i) =>
            (activeCategory === "all" || i.category === activeCategory) &&
            (!favoritesOn || i.favorite) &&
            (!query.trim() || matches(i, query))
        ),
        sort
      ),
    [items, activeCategory, favoritesOn, query, sort]
  );

  const chip = (active: boolean) =>
    cn(
      "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
      active
        ? "bg-brand-600 text-white shadow-soft"
        : "bg-surface text-gray-600 ring-1 ring-gray-200 ring-inset hover:ring-gray-300"
    );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 2xl:max-w-7xl">
      <div className="hero-surface flex flex-wrap items-center justify-between gap-3 rounded-[28px] px-5 py-5 sm:px-7 sm:py-6">
        <div>
          <h1 className="font-serif text-4xl tracking-tight text-gray-900 sm:text-5xl">Wardrobe</h1>
          <p className="mt-1 text-sm text-gray-600">
            {ready ? `${items.length} ${items.length === 1 ? "piece" : "pieces"} · your stylist knows every one` : "Loading…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ready && items.length >= 2 && (
            <button
              type="button"
              onClick={() => setShowInsights((v) => !v)}
              aria-expanded={showInsights}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold whitespace-nowrap ring-1 transition ${
                showInsights ? "bg-brand-50 text-brand-700 ring-brand-100" : "bg-surface text-gray-700 shadow-soft ring-gray-200/70 hover:ring-gray-300"
              }`}
            >
              <ChartPie className="size-4" aria-hidden /> Insights
            </button>
          )}
          {ready && items.length > 0 && (
            <button
              type="button"
              onClick={() => setDetecting(true)}
              title="Let the AI look at your photos and suggest colours"
              className="inline-flex items-center gap-1.5 btn-secondary rounded-full px-4 py-2.5 text-sm font-semibold whitespace-nowrap"
            >
              <Wand2 className="size-4 text-blush-600" aria-hidden /> <span className="hidden sm:inline">Detect colours</span>
              <span className="sm:hidden">Colours</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold whitespace-nowrap text-white shadow-soft transition hover:bg-brand-500 active:scale-[0.98]"
          >
            <Plus className="size-4" aria-hidden /> Add clothing item
          </button>
        </div>
      </div>

      {ready && showInsights && items.length >= 2 && <Insights items={items} />}

      {storageError && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {storageError}
        </p>
      )}

      {!ready ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-[32px] border-2 border-dashed border-gray-200 bg-surface/60 px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-sage-100 text-sage-700">
            <Shirt className="size-7" aria-hidden />
          </span>
          <h2 className="font-serif text-3xl text-gray-900">Nothing here yet</h2>
          <p className="max-w-sm text-sm leading-relaxed text-gray-500">
            Add a front photo (and a back one if you like), say what it is, pick its colour — then ask your stylist for
            outfits.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-500"
          >
            <Plus className="size-4" aria-hidden /> Add your first clothing item
          </button>
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-3">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-gray-400" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by type, colour or details…"
                aria-label="Search your wardrobe"
                className="w-full rounded-full border border-gray-200 bg-surface py-2.5 pr-10 pl-10 text-base shadow-soft transition placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 focus:outline-none sm:text-sm [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
            <div className="relative sm:w-48">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="Sort pieces"
                className="w-full appearance-none rounded-full border border-gray-200 bg-surface py-2.5 pr-9 pl-4 text-base shadow-soft transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100 focus:outline-none sm:text-sm"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-gray-400" aria-hidden />
            </div>
            </div>

            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button type="button" onClick={() => setCategory("all")} className={chip(activeCategory === "all")}>
                All · {items.length}
              </button>
              {favoriteCount > 0 && (
                <button type="button" onClick={() => setOnlyFavorites((v) => !v)} aria-pressed={favoritesOn} className={chip(favoritesOn)}>
                  <Heart className={`mr-1 inline size-3.5 -translate-y-px ${favoritesOn ? "fill-current" : ""}`} aria-hidden />
                  Favourites · {favoriteCount}
                </button>
              )}
              {present.map((c) => (
                <button key={c.id} type="button" onClick={() => setCategory(c.id)} className={chip(activeCategory === c.id)}>
                  {c.label} · {items.filter((i) => i.category === c.id).length}
                </button>
              ))}
            </div>
          </div>

          {visible.length > 0 ? (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {visible.map((item) => (
                <ItemCard key={item.id} item={item} onEdit={setEditing} onDelete={setDeleting} />
              ))}
            </div>
          ) : (
            <div className="mt-10 text-center text-sm text-gray-500">
              <p>Nothing matches that.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                  setOnlyFavorites(false);
                }}
                className="mt-2 font-medium text-blush-700 hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </>
      )}

      {adding && <ItemFormModal open onClose={() => setAdding(false)} />}
      {editing && <ItemFormModal open item={editing} onClose={() => setEditing(null)} />}
      {detecting && <DetectColorsDialog open onClose={() => setDetecting(false)} />}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove this piece?"
        message={
          deleting
            ? `“${itemTitle(deleting)}” and its photos will be deleted for good (unless you have a backup).`
            : ""
        }
        confirmLabel="Remove"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const title = itemTitle(deleting);
          try {
            await removeItem(deleting.id);
            toast(`Removed ${title}`);
          } catch (e) {
            toast(e instanceof Error ? e.message : "Couldn't remove that piece.", "error");
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}
