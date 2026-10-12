/*
 * A tiny read-through cache in localStorage. Each screen paints what it knew last time straight away and then
 * swaps in the fresh data from Supabase, so opening the app feels instant instead of waiting on the network.
 * Every read is validated, so a cache written by an older version of the app (different shape) is ignored.
 */

import { hasSession } from "./auth";

const PREFIX = "drape:cache:v1:";

export function readCache<T>(key: string, guard: (value: unknown) => value is T): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  // A save or refresh that finishes after sign-out must not put the account's data back into this browser.
  if (!hasSession()) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the app just loads from the network as before
  }
}

export function clearCache(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------- shape checks

const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const listOf = <T>(check: (v: Record<string, unknown>) => boolean) => (v: unknown): v is T[] =>
  Array.isArray(v) && v.every((x) => obj(x) && check(x));

export const isItemList = listOf<import("./types").ClothingItem>(
  (i) =>
    typeof i.id === "string" &&
    typeof i.type === "string" &&
    typeof i.category === "string" &&
    Array.isArray(i.colors) &&
    typeof i.favorite === "boolean" &&
    typeof i.wearCount === "number" &&
    typeof i.updatedAt === "number"
);

export const isOutfitList = listOf<import("./types").Outfit>(
  (o) => typeof o.id === "string" && typeof o.name === "string" && Array.isArray(o.itemIds) && typeof o.wornCount === "number"
);

export const isChatList = listOf<import("./types").Chat>((c) => typeof c.id === "string" && typeof c.title === "string" && typeof c.updatedAt === "number");

export const isMessageList = listOf<import("./types").ChatMessage>(
  (m) => typeof m.id === "string" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
);

export const isProfile = (v: unknown): v is import("./types").Profile => obj(v) && typeof v.name === "string" && Array.isArray(v.vibes);
