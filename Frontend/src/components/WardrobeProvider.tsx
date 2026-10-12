"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isItemList, readCache, writeCache } from "@/lib/cache";
import { categoryOfType } from "@/lib/catalog";
import {
  clearEverything,
  friendlyStorageError,
  importBackup,
  loadItems,
  mutateItems,
  type ImageKey,
  type ImagePut,
  type ImportResult,
} from "@/lib/db";
import type { ClothingItem } from "@/lib/types";
import { newId } from "@/lib/utils";

export type NewItemInput = {
  type: string;
  colors: string[];
  description: string;
  front: Blob;
  back?: Blob;
};

export type ItemPatch = {
  type: string;
  colors: string[];
  description: string;
  /** New front photo, if replaced. */
  front?: Blob;
  /** New back photo, `null` to remove the existing one, undefined to leave it alone. */
  back?: Blob | null;
};

type WardrobeContextValue = {
  items: ClothingItem[];
  ready: boolean;
  storageError: string | null;
  addItem: (input: NewItemInput) => Promise<ClothingItem>;
  updateItem: (id: string, patch: ItemPatch) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  /** Stars or un-stars a piece. */
  setFavorite: (id: string, favorite: boolean) => Promise<void>;
  /** Sets the colours of several pieces at once (e.g. after reviewing AI suggestions). */
  setColors: (changes: { id: string; colors: string[] }[]) => Promise<void>;
  /** Marks pieces as worn (now, or at `when`): bumps their wear count and last-worn date. */
  markWorn: (ids: string[], opts?: { when?: number }) => Promise<void>;
  importFile: (text: string) => Promise<ImportResult>;
  clearAll: () => Promise<void>;
};

const WardrobeContext = createContext<WardrobeContextValue | null>(null);

const SYNC_CHANNEL = "drape-sync";

export function useWardrobe(): WardrobeContextValue {
  const ctx = useContext(WardrobeContext);
  if (!ctx) throw new Error("useWardrobe must be used inside <WardrobeProvider>");
  return ctx;
}

/** Browser storage failures become a friendly message; our own deliberate errors pass through. */
function asUserError(e: unknown): Error {
  if (e instanceof DOMException) return new Error(friendlyStorageError(e));
  return e instanceof Error ? e : new Error("Something went wrong while saving.");
}

export function WardrobeProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Mirrors what's on screen; the database (not this copy) is the source of truth for writes.
  const itemsRef = useRef<ClothingItem[]>([]);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const channelRef = useRef<BroadcastChannel | null>(null);

  const commit = useCallback((next: ClothingItem[]) => {
    itemsRef.current = next;
    setItems(next);
    writeCache("items", next);
  }, []);

  // Writes (and refreshes) run one at a time within this tab.
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(task, task);
    queueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const notifyOtherTabs = useCallback(() => {
    try {
      channelRef.current?.postMessage("items");
    } catch {
      // channel already closed
    }
  }, []);

  /** Re-reads the database — used when another tab changed it or this tab returns to the foreground. */
  const refresh = useCallback(
    () =>
      enqueue(async () => {
        const fresh = await loadItems();
        // Photo URLs are keyed by updatedAt, so changed pieces pick up fresh photos by themselves.
        if (JSON.stringify(fresh) !== JSON.stringify(itemsRef.current)) commit(fresh);
      }).catch(() => undefined),
    [enqueue, commit]
  );

  useEffect(() => {
    let cancelled = false;
    // Paint what we knew last time straight away; the fresh copy below replaces it a moment later.
    const cached = readCache("items", isItemList);
    if (cached) {
      queueMicrotask(() => {
        if (cancelled || itemsRef.current.length > 0) return;
        itemsRef.current = cached;
        setItems(cached);
        setReady(true);
      });
    }
    loadItems()
      .then((list) => {
        if (cancelled) return;
        commit(list);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        if (!cached) setStorageError("Couldn't load your wardrobe. Check your connection and reload.");
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [commit]);

  // Keep several open tabs (or a home-screen app plus a browser tab) in step with each other.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(SYNC_CHANNEL);
      channel.onmessage = (e) => {
        if (e.data === "items") void refresh();
      };
      channelRef.current = channel;
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      channel?.close();
      channelRef.current = null;
    };
  }, [refresh]);

  const addItem = useCallback(
    (input: NewItemInput) =>
      enqueue(async () => {
        const category = categoryOfType(input.type);
        if (!category) throw new Error("Pick a type for this piece.");
        const now = Date.now();
        const item: ClothingItem = {
          id: newId(itemsRef.current.map((i) => i.id)),
          type: input.type,
          category,
          colors: input.colors.slice(0, 2),
          description: input.description.trim().slice(0, 400),
          hasBack: Boolean(input.back),
          favorite: false,
          wearCount: 0,
          lastWorn: null,
          createdAt: now,
          updatedAt: now,
        };
        const puts: ImagePut[] = [{ id: item.id, side: "front", blob: input.front }];
        if (input.back) puts.push({ id: item.id, side: "back", blob: input.back });

        let next: ClothingItem[];
        try {
          next = await mutateItems(
            (current) => {
              if (current.some((i) => i.id === item.id)) throw new Error("Couldn't save that — please try once more.");
              return [item, ...current];
            },
            { put: puts }
          );
        } catch (e) {
          throw asUserError(e);
        }
        commit(next);
        notifyOtherTabs();
        return item;
      }),
    [enqueue, commit, notifyOtherTabs]
  );

  const updateItem = useCallback(
    (id: string, patch: ItemPatch) =>
      enqueue(async () => {
        const category = categoryOfType(patch.type);
        if (!category) throw new Error("Pick a type for this piece.");

        const puts: ImagePut[] = [];
        const dels: ImageKey[] = [];
        if (patch.front) puts.push({ id, side: "front", blob: patch.front });
        if (patch.back instanceof Blob) puts.push({ id, side: "back", blob: patch.back });
        else if (patch.back === null) dels.push({ id, side: "back" });

        let next: ClothingItem[];
        try {
          next = await mutateItems(
            (current) => {
              const existing = current.find((i) => i.id === id);
              // If another tab deleted it meanwhile, nothing is written (the photos aren't orphaned).
              if (!existing) throw new Error("That piece no longer exists.");
              const hasBack = patch.back instanceof Blob ? true : patch.back === null ? false : existing.hasBack;
              const updated: ClothingItem = {
                ...existing,
                type: patch.type,
                category,
                colors: patch.colors.slice(0, 2),
                description: patch.description.trim().slice(0, 400),
                hasBack,
                updatedAt: Date.now(),
              };
              return current.map((i) => (i.id === id ? updated : i));
            },
            { put: puts, del: dels }
          );
        } catch (e) {
          throw asUserError(e);
        }
        commit(next);
        notifyOtherTabs();
      }),
    [enqueue, commit, notifyOtherTabs]
  );

  const removeItem = useCallback(
    (id: string) =>
      enqueue(async () => {
        let next: ClothingItem[];
        try {
          next = await mutateItems((current) => current.filter((i) => i.id !== id), {
            del: [
              { id, side: "front" },
              { id, side: "back" },
            ],
          });
        } catch (e) {
          throw asUserError(e);
        }
        commit(next);
        notifyOtherTabs();
      }),
    [enqueue, commit, notifyOtherTabs]
  );

  const setFavorite = useCallback(
    (id: string, favorite: boolean) =>
      enqueue(async () => {
        let next: ClothingItem[];
        try {
          // updatedAt is left alone on purpose: it keys the photo URLs, and a star doesn't change a photo.
          next = await mutateItems((current) => current.map((i) => (i.id === id ? { ...i, favorite } : i)));
        } catch (e) {
          throw asUserError(e);
        }
        commit(next);
        notifyOtherTabs();
      }),
    [enqueue, commit, notifyOtherTabs]
  );

  const setColors = useCallback(
    (changes: { id: string; colors: string[] }[]) =>
      enqueue(async () => {
        const byId = new Map(changes.map((c) => [c.id, c.colors.slice(0, 2)]));
        let next: ClothingItem[];
        try {
          // Colours don't change a photo, so updatedAt (which keys photo URLs) is left alone.
          next = await mutateItems((current) => current.map((i) => (byId.has(i.id) ? { ...i, colors: byId.get(i.id)! } : i)));
        } catch (e) {
          throw asUserError(e);
        }
        commit(next);
        notifyOtherTabs();
      }),
    [enqueue, commit, notifyOtherTabs]
  );

  const markWorn = useCallback(
    (ids: string[], opts: { when?: number } = {}) =>
      enqueue(async () => {
        const wanted = new Set(ids);
        const when = opts.when ?? Date.now();
        let next: ClothingItem[];
        try {
          next = await mutateItems((current) =>
            current.map((i) => (wanted.has(i.id) ? { ...i, wearCount: i.wearCount + 1, lastWorn: when } : i))
          );
        } catch (e) {
          throw asUserError(e);
        }
        commit(next);
        notifyOtherTabs();
      }),
    [enqueue, commit, notifyOtherTabs]
  );

  const importFile = useCallback(
    (text: string) =>
      enqueue(async () => {
        try {
          const result = await importBackup(
            text,
            itemsRef.current.map((i) => i.id)
          );
          commit(result.items);
          notifyOtherTabs();
          return result;
        } catch (e) {
          throw asUserError(e);
        }
      }),
    [enqueue, commit, notifyOtherTabs]
  );

  const clearAll = useCallback(
    () =>
      enqueue(async () => {
        await clearEverything();
        commit([]);
        notifyOtherTabs();
      }),
    [enqueue, commit, notifyOtherTabs]
  );

  const value = useMemo(
    () => ({ items, ready, storageError, addItem, updateItem, removeItem, setFavorite, setColors, markWorn, importFile, clearAll }),
    [items, ready, storageError, addItem, updateItem, removeItem, setFavorite, setColors, markWorn, importFile, clearAll]
  );

  return <WardrobeContext.Provider value={value}>{children}</WardrobeContext.Provider>;
}
