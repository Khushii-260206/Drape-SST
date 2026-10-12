"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getPhotoUrl, peekPhotoUrl, photosVersion, subscribePhotos, type PhotoSize } from "./photos";
import type { ClothingItem, Side } from "./types";

const noopSubscribe = () => () => {};

/** False during server render and hydration, true afterwards — avoids hydration mismatches. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

type PhotoItem = Pick<ClothingItem, "id" | "updatedAt" | "hasBack">;

/**
 * A displayable URL for one of an item's photos. Null while it's being looked up, or if the piece has
 * no such photo. Already-known URLs come back on the very first render, so cached photos never flash.
 */
export function useItemImage(item: PhotoItem | undefined, side: Side, size: PhotoSize = "full"): string | null {
  const available = Boolean(item) && (side === "front" || item?.hasBack === true);
  const key = item && available ? `${item.id}:${side}:${size}:${item.updatedAt}` : null;
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);
  const links = useSyncExternalStore(subscribePhotos, photosVersion, () => 0); // a dropped (expired) link triggers a new lookup
  const known = item && key ? peekPhotoUrl(item, side, size) : undefined;

  useEffect(() => {
    if (!item || !key || known) return;
    let cancelled = false;
    getPhotoUrl(item, side, size)
      .then((url) => {
        if (!cancelled) setLoaded({ key, url: url ?? null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // `item` is represented by `key` (id + updatedAt); depending on the object would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, known, side, size, links]);

  if (!key) return null;
  return known ?? (loaded?.key === key ? loaded.url : null);
}
