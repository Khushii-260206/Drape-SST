"use client";

import { Bookmark, Check, CalendarCheck, MessageCircle, Pencil, Shirt, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { itemTitle, typeLabel } from "@/lib/catalog";
import { useItemImage } from "@/lib/hooks";
import { ago, daysBetween } from "@/lib/time";
import type { ClothingItem, Outfit } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChat } from "../ChatProvider";
import { useItemViewer } from "../ItemViewer";
import { useOutfits } from "../OutfitsProvider";
import { useToast } from "../Toaster";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useWardrobe } from "../WardrobeProvider";
import { useIdeas, type Idea } from "./useIdeas";
import { onPhotoError } from "@/lib/photos";

function Tile({ item, className }: { item: ClothingItem; className?: string }) {
  const url = useItemImage(item, "front", "thumb");
  const open = useItemViewer();
  return (
    <button
      type="button"
      onClick={() => open(item.id)}
      aria-label={`View ${itemTitle(item)}`}
      className={cn("relative block overflow-hidden bg-gray-100 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none focus-visible:ring-inset", className)}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} onError={onPhotoError} alt={itemTitle(item)} loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <span className="block size-full animate-pulse bg-gray-200" />
      )}
    </button>
  );
}

/** Up to four pieces laid out as a collage. */
function Collage({ items }: { items: ClothingItem[] }) {
  const shown = items.slice(0, 4);
  const extra = items.length - shown.length;
  const layout =
    shown.length === 1
      ? "grid-cols-1"
      : shown.length === 3
        ? "grid-cols-2 grid-rows-2 [&>*:first-child]:row-span-2"
        : shown.length === 2
          ? "grid-cols-2"
          : "grid-cols-2 grid-rows-2";
  return (
    <div className={cn("relative grid aspect-[4/3] gap-0.5 overflow-hidden bg-gray-200", layout)}>
      {shown.map((item) => (
        <Tile key={item.id} item={item} />
      ))}
      {extra > 0 && (
        <span className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
          +{extra}
        </span>
      )}
    </div>
  );
}

function LookCard({ outfit, onDelete }: { outfit: Outfit; onDelete: () => void }) {
  const { items } = useWardrobe();
  const { renameOutfit, wearOutfit } = useOutfits();
  const { send } = useChat();
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(outfit.name);
  const [wearing, setWearing] = useState(false);

  const pieces = useMemo(
    () => outfit.itemIds.map((id) => items.find((i) => i.id === id)).filter((i): i is ClothingItem => Boolean(i)),
    [outfit.itemIds, items]
  );
  const missing = outfit.itemIds.length - pieces.length;
  const wornToday = outfit.lastWorn !== null && daysBetween(outfit.lastWorn) === 0;

  async function saveName(e?: FormEvent) {
    e?.preventDefault();
    setEditing(false);
    try {
      await renameOutfit(outfit.id, draft);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't rename that look.", "error");
    }
  }

  async function wear() {
    setWearing(true);
    try {
      await wearOutfit(outfit.id);
      toast(`Nice — "${outfit.name}" marked as worn today`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't mark that as worn.", "error");
    } finally {
      setWearing(false);
    }
  }

  function remix() {
    const names = pieces.map((p) => `${itemTitle(p)} [[${p.id}]]`).join(", ");
    send(`Give me two fresh variations of this look, swapping one or two pieces: ${names}.`);
    router.push("/");
  }

  return (
    <article className="group overflow-hidden rounded-3xl bg-surface shadow-soft ring-1 ring-gray-200/70 transition duration-300 hover:shadow-lift">
      {pieces.length > 0 ? (
        <Collage items={pieces} />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-gray-100 text-gray-400">
          <Shirt className="size-8" aria-hidden />
        </div>
      )}

      <div className="space-y-3 p-4">
        <div className="min-w-0">
          {editing ? (
            <form onSubmit={saveName} className="flex items-center gap-1.5">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={60}
                aria-label="Look name"
                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-surface px-2.5 py-1.5 text-base text-gray-900 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 focus:outline-none sm:text-sm"
              />
              <button type="submit" aria-label="Save name" className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-white">
                <Check className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => {
                  setEditing(false);
                  setDraft(outfit.name);
                }}
                className="flex size-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
              >
                <X className="size-4" aria-hidden />
              </button>
            </form>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-serif text-xl leading-tight text-gray-900 [overflow-wrap:anywhere]">{outfit.name}</h3>
              <button
                type="button"
                onClick={() => {
                  setDraft(outfit.name);
                  setEditing(true);
                }}
                aria-label={`Rename ${outfit.name}`}
                className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              >
                <Pencil className="size-4" aria-hidden />
              </button>
            </div>
          )}
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            {pieces.map((p) => typeLabel(p.type)).join(" · ") || "These pieces are no longer in your wardrobe"}
            {missing > 0 && pieces.length > 0 ? ` · ${missing} removed` : ""}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {outfit.wornCount > 0 && outfit.lastWorn
              ? `Worn ${outfit.wornCount}× · last ${ago(outfit.lastWorn)}`
              : "Not worn yet"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={wear}
            disabled={wearing || pieces.length === 0}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50",
              wornToday ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100" : "bg-brand-600 text-white shadow-soft hover:bg-brand-500"
            )}
          >
            <CalendarCheck className="size-4" aria-hidden /> {wornToday ? "Worn today ✓" : "Wear today"}
          </button>
          <button
            type="button"
            onClick={remix}
            disabled={pieces.length < 2}
            className="inline-flex items-center gap-1.5 btn-secondary rounded-full px-3.5 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Sparkles className="size-4 text-blush-600" aria-hidden /> Remix
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${outfit.name}`}
            className="ml-auto flex size-9 items-center justify-center rounded-full text-gray-400 transition hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </article>
  );
}

/** An outfit the stylist suggested in a chat. Wear it straight away, save it, or jump back to the conversation. */
function IdeaCard({ idea }: { idea: Idea }) {
  const { items } = useWardrobe();
  const { saveLook, findLook, wearOutfit } = useOutfits();
  const { openChat } = useChat();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"save" | "wear" | null>(null);

  const pieces = useMemo(
    () => idea.itemIds.map((id) => items.find((i) => i.id === id)).filter((i): i is ClothingItem => Boolean(i)),
    [idea.itemIds, items]
  );
  const saved = findLook(idea.itemIds);
  const wornToday = saved?.lastWorn != null && daysBetween(saved.lastWorn) === 0;

  async function save(thenWear: boolean) {
    setBusy(thenWear ? "wear" : "save");
    try {
      const { outfit, existed } = await saveLook({ name: idea.name, itemIds: idea.itemIds });
      if (thenWear) {
        await wearOutfit(outfit.id);
        toast(`Enjoy — “${outfit.name}” marked as worn today`);
      } else {
        toast(existed ? `Already saved as “${outfit.name}”` : `Saved “${outfit.name}”`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't do that.", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="overflow-hidden rounded-3xl bg-surface shadow-soft ring-1 ring-gray-200/70 transition duration-300 hover:shadow-lift">
      <Collage items={pieces} />
      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <h3 className="font-serif text-xl leading-tight text-gray-900 [overflow-wrap:anywhere]">{idea.name}</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">{pieces.map((p) => typeLabel(p.type)).join(" · ")}</p>
          <p className="mt-1 truncate text-xs text-gray-400">
            From “{idea.chatTitle}” · {ago(idea.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null || wornToday}
            onClick={() => void save(true)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition disabled:opacity-60",
              wornToday ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100" : "bg-brand-600 text-white shadow-soft hover:bg-brand-500"
            )}
          >
            <CalendarCheck className="size-4" aria-hidden /> {wornToday ? "Worn today ✓" : "Wear today"}
          </button>
          {saved ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-brand-700">
              <Check className="size-4" aria-hidden /> Saved
            </span>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void save(false)}
              className="inline-flex items-center gap-1.5 btn-secondary rounded-full px-3.5 py-2 text-sm font-medium disabled:opacity-60"
            >
              <Bookmark className="size-4 text-blush-600" aria-hidden /> Save
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void openChat(idea.chatId);
              router.push("/");
            }}
            aria-label={`Open the chat “${idea.chatTitle}”`}
            title="Open the chat this came from"
            className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-800"
          >
            <MessageCircle className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </article>
  );
}

function SkeletonGrid() {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-3xl bg-surface ring-1 ring-gray-200/70">
          <div className="aspect-[4/3] bg-gray-200" />
          <div className="space-y-2 p-4">
            <div className="h-5 w-2/3 rounded-full bg-gray-200" />
            <div className="h-3 w-1/2 rounded-full bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

type Tab = "saved" | "ideas";

export default function OutfitsView() {
  const { items, ready: wardrobeReady } = useWardrobe();
  const { outfits, ready, removeOutfit } = useOutfits();
  const { ideas, loading: ideasLoading, failed: ideasFailed } = useIdeas(items);
  const toast = useToast();
  const [deleting, setDeleting] = useState<Outfit | null>(null);
  const [picked, setPicked] = useState<Tab | null>(null);
  const loading = !ready || !wardrobeReady;

  // Open on saved looks if there are any, otherwise on the ideas waiting in your chats; after that, your choice sticks.
  const tab: Tab = picked ?? (outfits.length > 0 || ideas.length === 0 ? "saved" : "ideas");

  const tabButton = (id: Tab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={tab === id}
      aria-controls="outfits-panel"
      onClick={() => setPicked(id)}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
        tab === id ? "bg-surface text-gray-900 shadow-soft" : "text-gray-500 hover:text-gray-900"
      )}
    >
      {label}
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", tab === id ? "bg-brand-50 text-brand-700" : "bg-gray-200/70 text-gray-600")}>{count}</span>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 2xl:max-w-7xl">
      <div className="hero-surface flex flex-wrap items-end justify-between gap-3 rounded-[28px] px-5 py-5 sm:px-7 sm:py-6">
        <div>
          <h1 className="font-serif text-4xl tracking-tight text-gray-900 sm:text-5xl">Outfits</h1>
          <p className="mt-1 text-sm text-gray-600">Pick what to wear today — saved looks, and every idea your stylist has had.</p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 btn-secondary rounded-full px-4 py-2.5 text-sm font-semibold"
        >
          <MessageCircle className="size-4 text-blush-600" aria-hidden /> Ask for a look
        </Link>
      </div>

      <div role="tablist" aria-label="Outfits" className="mt-5 inline-flex rounded-full bg-gray-100/80 p-1">
        {tabButton("saved", "Saved", outfits.length)}
        {tabButton("ideas", "Ideas from your chats", ideas.length)}
      </div>

      <div id="outfits-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "saved" ? (
          loading ? (
            <SkeletonGrid />
          ) : outfits.length === 0 ? (
            <div className="mt-8 flex flex-col items-center gap-3 rounded-[32px] border-2 border-dashed border-gray-200 bg-surface/60 px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-sage-100 text-sage-700">
                <Sparkles className="size-7" aria-hidden />
              </span>
              <h2 className="font-serif text-3xl text-gray-900">No saved looks yet</h2>
              <p className="max-w-sm text-sm leading-relaxed text-gray-500">
                Tap <strong className="font-semibold text-gray-700">Save</strong> on an idea, or under any suggestion in the chat. Your favourites collect
                here, ready to wear.
              </p>
              {ideas.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPicked("ideas")}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-500"
                >
                  See {ideas.length} {ideas.length === 1 ? "idea" : "ideas"} from your chats
                </button>
              )}
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {outfits.map((o) => (
                <LookCard key={o.id} outfit={o} onDelete={() => setDeleting(o)} />
              ))}
            </div>
          )
        ) : ideasLoading || !wardrobeReady ? (
          <SkeletonGrid />
        ) : ideas.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-[32px] border-2 border-dashed border-gray-200 bg-surface/60 px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-sage-100 text-sage-700">
              <MessageCircle className="size-7" aria-hidden />
            </span>
            <h2 className="font-serif text-3xl text-gray-900">{ideasFailed ? "Couldn't load your chats" : "No ideas yet"}</h2>
            <p className="max-w-sm text-sm leading-relaxed text-gray-500">
              {ideasFailed
                ? "Check your connection and open this tab again."
                : "Ask your stylist for an outfit and every look it suggests lands here — with its photos, ready to wear."}
            </p>
            <Link
              href="/"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-500"
            >
              Ask your stylist
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {ideas.map((idea) => (
              <IdeaCard key={idea.key} idea={idea} />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this look?"
        message={deleting ? `“${deleting.name}” will be removed. The pieces stay in your wardrobe.` : ""}
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const name = deleting.name;
          try {
            await removeOutfit(deleting.id);
            toast(`Deleted “${name}”`);
          } catch (e) {
            toast(e instanceof Error ? e.message : "Couldn't delete that look.", "error");
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}
