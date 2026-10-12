import { hasSession, requireUserId } from "./auth";
import { sb } from "./supabase";
import type { ClothingItem, Side } from "./types";

const signedIn = hasSession;

/*
 * Photo URLs. The bucket is private, so each photo is shown through a signed URL. Signing is batched
 * (one request for a whole wardrobe) and the URLs are remembered for days, also across reloads, so the
 * browser's HTTP cache can do its job and a page of photos appears instantly the second time.
 *
 * A URL is keyed by path + the piece's updatedAt, so an edit made on another device gets a fresh URL
 * (and therefore fresh bytes) as soon as this device sees the new item.
 */

export const BUCKET = "wardrobe";
export type PhotoSize = "full" | "thumb";

/** Photos live under the signed-in user's own folder: <user id>/<piece id>/<front|back>[_sm]. The storage policy checks that folder. */
export const photoPath = (id: string, side: Side, size: PhotoSize = "full") =>
  `${requireUserId()}/${id}/${side}${size === "thumb" ? "_sm" : ""}`;

const TTL_SECONDS = 7 * 24 * 3600;
const REFRESH_MARGIN_MS = 24 * 3600 * 1000;
const STORE_KEY = "drape:photo-urls:v1";
const MAX_REMEMBERED = 3000;

type Entry = { url: string; exp: number }; // exp 0 = a local object URL (never persisted)
type Photo = Pick<ClothingItem, "id" | "updatedAt">;

const urls = new Map<string, Entry>();
// Keys whose link was already replaced after the browser failed to load it (key -> when). One replacement per minute at
// most, so a photo that is genuinely gone can't make a component re-sign in a loop.
const replaced = new Map<string, number>();
const REPLACE_AGAIN_AFTER_MS = 60_000;
let version = 0;
const watchers = new Set<() => void>();
export const subscribePhotos = (l: () => void) => (watchers.add(l), () => void watchers.delete(l));
/** Changes whenever a remembered link is dropped, so components showing it look it up again. */
export const photosVersion = () => version;
const missing = new Set<string>();
let restored = false;

const keyOf = (item: Photo, side: Side, size: PhotoSize) => `${photoPath(item.id, side, size)}@${item.updatedAt}`;

function restore() {
  if (restored || typeof localStorage === "undefined") return;
  restored = true;
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Record<string, Entry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v.url === "string" && typeof v.exp === "number" && v.exp - now > REFRESH_MARGIN_MS) urls.set(k, v);
    }
  } catch {
    // corrupt or blocked storage: start fresh
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
// Bumped whenever the account state is forgotten, so a signing request that was already in flight can't repopulate it.
let epoch = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!signedIn()) return; // never write an ended session's photo links back to storage
    try {
      const entries = [...urls].filter(([, v]) => v.exp > 0).slice(-MAX_REMEMBERED);
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // storage full / blocked: URLs still work for this session
    }
  }, 400);
}

function fresh(entry: Entry | undefined): entry is Entry {
  return Boolean(entry && (entry.exp === 0 || entry.exp - Date.now() > REFRESH_MARGIN_MS));
}

// ---------------------------------------------------------------- batched signing

type Waiter = (url: string | undefined) => void;
let queue = new Map<string, { path: string; waiters: Waiter[] }>();
let scheduled = false;

async function flush() {
  scheduled = false;
  const batch = queue;
  const startedIn = epoch;
  queue = new Map();
  const keys = [...batch.keys()];

  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const paths = chunk.map((k) => batch.get(k)!.path);
    let signed: Map<string, string | null> | null = null;
    try {
      const { data, error } = await sb().storage.from(BUCKET).createSignedUrls(paths, TTL_SECONDS);
      if (!error && data) signed = new Map(data.map((d) => [d.path ?? "", d.error ? null : d.signedUrl]));
    } catch {
      // offline: leave `signed` null so nothing is marked missing
    }
    const exp = Date.now() + TTL_SECONDS * 1000;
    for (const k of chunk) {
      const { path, waiters } = batch.get(k)!;
      const url = signed?.get(path) ?? undefined;
      if (startedIn === epoch) {
        if (url) urls.set(k, { url, exp });
        else if (signed) missing.add(k);
      }
      for (const w of waiters) w(url);
    }
  }
  persist();
}

function sign(key: string, path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const pending = queue.get(key);
    if (pending) pending.waiters.push(resolve);
    else queue.set(key, { path, waiters: [resolve] });
    if (!scheduled) {
      scheduled = true;
      // Collect every photo the page asks for in this tick, then sign them in one request.
      setTimeout(() => void flush(), 0);
    }
  });
}

// ---------------------------------------------------------------- public API

/** A URL that is already known (no network), so photos can render on the very first frame. */
export function peekPhotoUrl(item: Photo, side: Side, size: PhotoSize = "full"): string | undefined {
  restore();
  if (!signedIn()) return undefined; // session ended while a page was open; the sign-in screen takes over
  const hit = urls.get(keyOf(item, side, size));
  if (fresh(hit)) return hit.url;
  if (size === "thumb" && missing.has(keyOf(item, side, "thumb"))) return peekPhotoUrl(item, side, "full");
  return undefined;
}

/** Resolves to a displayable URL, or undefined if the photo doesn't exist. Thumbnails fall back to the full photo. */
export async function getPhotoUrl(item: Photo, side: Side, size: PhotoSize = "full"): Promise<string | undefined> {
  restore();
  if (!signedIn()) return undefined;
  const key = keyOf(item, side, size);
  const hit = urls.get(key);
  if (fresh(hit)) return hit.url;
  if (!missing.has(key)) {
    const url = await sign(key, photoPath(item.id, side, size));
    if (url) return url;
  }
  return size === "thumb" ? getPhotoUrl(item, side, "full") : undefined;
}

/**
 * For an <img onError>: the browser couldn't load a signed link (it expired while the page stayed open, or was revoked).
 * Drops that link so components ask for a fresh one. Local object URLs are left alone, and a link is replaced at most
 * once a minute. Returns whether a new link will be requested.
 */
export function expirePhotoUrl(url: string | null | undefined): boolean {
  if (!url || !signedIn()) return false;
  for (const [k, e] of urls) {
    if (e.url !== url || e.exp === 0) continue;
    if (Date.now() - (replaced.get(k) ?? 0) < REPLACE_AGAIN_AFTER_MS) return false;
    replaced.set(k, Date.now());
    urls.delete(k);
    persist();
    version++;
    watchers.forEach((w) => w());
    return true;
  }
  return false;
}

/** onError for any <img> showing a signed photo link. */
export const onPhotoError = (e: { currentTarget: { src: string } }) => void expirePhotoUrl(e.currentTarget.src);

/** Shows a just-uploaded photo straight from memory, without waiting for the network. */
export function seedPhoto(item: Photo, side: Side, size: PhotoSize, blob: Blob) {
  const key = keyOf(item, side, size);
  missing.delete(key);
  urls.set(key, { url: URL.createObjectURL(blob), exp: 0 });
}

/** Forget everything known about a piece's photos (after they were replaced or deleted). */
export function forgetPhotos(id: string, side?: Side) {
  if (!signedIn()) return; // the session ended mid-save: forgetAllPhotos has already emptied everything
  const prefix = `${requireUserId()}/${id}/${side ?? ""}`;
  for (const k of [...urls.keys()]) {
    if (!k.startsWith(prefix)) continue;
    const e = urls.get(k)!;
    if (e.exp === 0) URL.revokeObjectURL(e.url);
    urls.delete(k);
  }
  for (const k of [...missing]) if (k.startsWith(prefix)) missing.delete(k);
  persist();
}

export function forgetAllPhotos() {
  epoch++;
  clearTimeout(saveTimer);
  for (const e of urls.values()) if (e.exp === 0) URL.revokeObjectURL(e.url);
  urls.clear();
  missing.clear();
  replaced.clear();
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // ignore
  }
}
