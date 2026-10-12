"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isOutfitList, readCache, writeCache } from "@/lib/cache";
import { deleteOutfit, friendlyStorageError, loadOutfits, saveOutfit } from "@/lib/db";
import type { Outfit } from "@/lib/types";
import { newId } from "@/lib/utils";
import { useWardrobe } from "./WardrobeProvider";

type OutfitsContextValue = {
  outfits: Outfit[];
  ready: boolean;
  /** Saves a look (or returns the one already saved with exactly these pieces). */
  saveLook: (input: { name: string; itemIds: string[]; note?: string }) => Promise<{ outfit: Outfit; existed: boolean }>;
  /** The saved look made of exactly these pieces, if any. */
  findLook: (itemIds: string[]) => Outfit | undefined;
  renameOutfit: (id: string, name: string) => Promise<void>;
  removeOutfit: (id: string) => Promise<void>;
  /** Marks a look as worn today: bumps the look and every piece in it. */
  wearOutfit: (id: string) => Promise<void>;
  /** Re-reads saved looks (e.g. after a backup import). */
  refresh: () => Promise<void>;
};

const OutfitsContext = createContext<OutfitsContextValue | null>(null);
const SYNC_CHANNEL = "drape-outfits-sync";

export function useOutfits(): OutfitsContextValue {
  const ctx = useContext(OutfitsContext);
  if (!ctx) throw new Error("useOutfits must be used inside <OutfitsProvider>");
  return ctx;
}

const keyOf = (ids: string[]) => [...new Set(ids)].sort().join(",");

function asError(e: unknown): Error {
  return new Error(friendlyStorageError(e));
}

export function OutfitsProvider({ children }: { children: ReactNode }) {
  const { markWorn } = useWardrobe();
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [ready, setReady] = useState(false);
  const ref = useRef<Outfit[]>([]);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const commit = useCallback((next: Outfit[]) => {
    ref.current = next;
    setOutfits(next);
    writeCache("outfits", next);
  }, []);

  const tell = useCallback(() => {
    try {
      channelRef.current?.postMessage("outfits");
    } catch {
      // channel closed
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const fresh = await loadOutfits();
      if (JSON.stringify(fresh) !== JSON.stringify(ref.current)) commit(fresh);
    } catch {
      // offline: keep what we have
    }
  }, [commit]);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache("outfits", isOutfitList);
    if (cached) {
      queueMicrotask(() => {
        if (cancelled || ref.current.length > 0) return;
        ref.current = cached;
        setOutfits(cached);
        setReady(true);
      });
    }
    loadOutfits()
      .then((list) => {
        if (cancelled) return;
        commit(list);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [commit]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(SYNC_CHANNEL);
      channel.onmessage = () => void refresh();
      channelRef.current = channel;
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      channel?.close();
      channelRef.current = null;
    };
  }, [refresh]);

  const findLook = useCallback((itemIds: string[]) => {
    const key = keyOf(itemIds);
    return ref.current.find((o) => keyOf(o.itemIds) === key);
  }, []);

  const saveLook = useCallback<OutfitsContextValue["saveLook"]>(
    async ({ name, itemIds, note = "" }) => {
      const ids = [...new Set(itemIds)];
      if (ids.length < 2) throw new Error("A look needs at least two pieces.");
      const existing = ref.current.find((o) => keyOf(o.itemIds) === keyOf(ids));
      if (existing) return { outfit: existing, existed: true };
      const outfit: Outfit = {
        id: newId(ref.current.map((o) => o.id)),
        name: name.trim().slice(0, 60) || "Untitled look",
        itemIds: ids,
        note: note.trim().slice(0, 400),
        createdAt: Date.now(),
        wornCount: 0,
        lastWorn: null,
      };
      try {
        await saveOutfit(outfit);
      } catch (e) {
        throw asError(e);
      }
      commit([outfit, ...ref.current]);
      tell();
      return { outfit, existed: false };
    },
    [commit, tell]
  );

  const renameOutfit = useCallback(
    async (id: string, name: string) => {
      const current = ref.current.find((o) => o.id === id);
      const clean = name.trim().slice(0, 60);
      if (!current || !clean || clean === current.name) return;
      const next = { ...current, name: clean };
      try {
        await saveOutfit(next);
      } catch (e) {
        throw asError(e);
      }
      commit(ref.current.map((o) => (o.id === id ? next : o)));
      tell();
    },
    [commit, tell]
  );

  const removeOutfit = useCallback(
    async (id: string) => {
      try {
        await deleteOutfit(id);
      } catch (e) {
        throw asError(e);
      }
      commit(ref.current.filter((o) => o.id !== id));
      tell();
    },
    [commit, tell]
  );

  const wearOutfit = useCallback(
    async (id: string) => {
      const current = ref.current.find((o) => o.id === id);
      if (!current) return;
      const now = Date.now();
      const next = { ...current, wornCount: current.wornCount + 1, lastWorn: now };
      try {
        await saveOutfit(next);
        await markWorn(current.itemIds, { when: now });
      } catch (e) {
        throw asError(e);
      }
      commit(ref.current.map((o) => (o.id === id ? next : o)));
      tell();
    },
    [commit, tell, markWorn]
  );

  const value = useMemo(
    () => ({ outfits, ready, saveLook, findLook, renameOutfit, removeOutfit, wearOutfit, refresh }),
    [outfits, ready, saveLook, findLook, renameOutfit, removeOutfit, wearOutfit, refresh]
  );

  return <OutfitsContext.Provider value={value}>{children}</OutfitsContext.Provider>;
}
