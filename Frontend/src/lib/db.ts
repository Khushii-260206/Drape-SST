import { CATEGORIES, categoryOfType, isKnownColor, isKnownType } from "./catalog";
import { makeThumbnail } from "./image";
import { BUCKET, forgetAllPhotos, forgetPhotos, getPhotoUrl, photoPath, seedPhoto, type PhotoSize } from "./photos";
import { hasSession, requireUserId } from "./auth";
import { fail, sb } from "./supabase";
import { clearCache } from "./cache";
import { cleanProfile } from "./profile";
import type { Chat, ChatMessage, ClothingItem, Outfit, Profile, Side } from "./types";
import { newId } from "./utils";

/*
 * Everything lives in your Supabase project (see Backend/supabase/schema.secure.sql):
 *   table items          -> one row per piece (metadata)
 *   table chats          -> one row per conversation
 *   table chat_messages  -> the messages in them
 *   table outfits, profile -> saved looks, and the person's profile
 *   bucket "wardrobe"    -> photos at <user id>/<piece id>/<front|back>, plus 480px thumbnails at <...>_sm
 * Every row has a user_id and policies let a signed-in user see only their own (the database enforces it, not this code).
 * Photos are shown through signed URLs — see photos.ts.
 */

const MAX_CHAT_MESSAGES = 200;
const ALL_PHOTOS = (id: string) =>
  (["front", "back"] as Side[]).flatMap((side) => (["full", "thumb"] as PhotoSize[]).map((size) => photoPath(id, side, size)));

export function friendlyStorageError(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Couldn't save. Check your connection and try again.";
}

// ---------------------------------------------------------------- photos

/** The photo's bytes (used by backup export). */
async function getImageBlob(item: ClothingItem, side: Side): Promise<Blob | undefined> {
  const url = await getPhotoUrl(item, side, "full");
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    return res.ok ? await res.blob() : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- items

type ItemRow = {
  id: string;
  type: string;
  category: string;
  colors: string[] | null;
  description: string | null;
  has_back: boolean;
  favorite: boolean | null;
  wear_count: number | null;
  last_worn: number | null;
  created_at: number;
  updated_at: number;
};

function fromRow(r: ItemRow): ClothingItem | null {
  // A type id we no longer recognise keeps its piece (shown as "Clothing") rather than hiding it.
  const category = categoryOfType(r.type) ?? CATEGORIES.find((c) => c.id === r.category)?.id;
  if (!category) return null;
  return {
    id: r.id,
    type: r.type,
    category,
    colors: (r.colors ?? []).slice(0, 2),
    description: r.description ?? "",
    hasBack: r.has_back,
    favorite: r.favorite === true,
    wearCount: Number(r.wear_count ?? 0),
    lastWorn: r.last_worn == null ? null : Number(r.last_worn),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

const toRow = (i: ClothingItem) => ({
  user_id: requireUserId(),
  id: i.id,
  type: i.type,
  category: i.category,
  colors: i.colors,
  description: i.description,
  has_back: i.hasBack,
  favorite: i.favorite,
  wear_count: i.wearCount,
  last_worn: i.lastWorn,
  created_at: i.createdAt,
  updated_at: i.updatedAt,
});

export async function loadItems(): Promise<ClothingItem[]> {
  const { data, error } = await sb().from("items").select("*").order("created_at", { ascending: false });
  if (error) fail(error);
  return (data as ItemRow[]).map(fromRow).filter((i): i is ClothingItem => i !== null);
}

export type ImagePut = { id: string; side: Side; blob: Blob };
export type ImageKey = { id: string; side: Side };

// Paths are versioned through the signed URL (path + updatedAt), so the CDN copy can be kept a week.
const CACHE_SECONDS = String(7 * 24 * 3600);

async function upload(path: string, blob: Blob) {
  const { error } = await sb()
    .storage.from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg", cacheControl: CACHE_SECONDS });
  if (error) fail(error, "Couldn't upload the photo. Check your connection and try again.", "storage");
}

/** Deleting a file that isn't there is not an error. `strict` turns a refused or failed removal into a thrown error. */
async function removePaths(paths: string[], strict = false) {
  if (paths.length === 0) return;
  const { error } = await sb().storage.from(BUCKET).remove(paths);
  if (error && strict) fail(error, "Couldn't delete the photos. Check your connection and try again.", "storage");
}

const pathsFor = (keys: ImageKey[]) =>
  keys.flatMap((k) => [photoPath(k.id, k.side, "full"), photoPath(k.id, k.side, "thumb")]);

/**
 * Changes the wardrobe: reads the CURRENT items from the database, applies `mutate`, then saves the
 * difference plus any photo changes. If `mutate` throws, nothing is written. Photos go up first, so a
 * failed upload never leaves a piece without its picture. Returns the list that was committed.
 */
export async function mutateItems(
  mutate: (current: ClothingItem[]) => ClothingItem[],
  changes: { put?: ImagePut[]; del?: ImageKey[] } = {}
): Promise<ClothingItem[]> {
  const puts = changes.put ?? [];
  const dels = changes.del ?? [];
  // The read of the current items and the on-device thumbnail work don't depend on each other, so they overlap: a save pays
  // for the slower of the two, not both one after the other.
  const [current, uploads] = await Promise.all([
    loadItems(),
    // Thumbnails are made on this device (no paid image service needed) and uploaded alongside.
    Promise.all(puts.map(async (p) => ({ ...p, thumb: await makeThumbnail(p.blob).catch(() => null) }))),
  ]);
  const next = mutate(current);

  const before = new Map(current.map((i) => [i.id, JSON.stringify(i)]));
  const nextIds = new Set(next.map((i) => i.id));
  const changed = next.filter((i) => before.get(i.id) !== JSON.stringify(i));
  const removed = current.filter((i) => !nextIds.has(i.id));
  const fresh = next.filter((i) => !before.has(i.id));

  try {
    await Promise.all(
      uploads.flatMap((u) => [
        upload(photoPath(u.id, u.side, "full"), u.blob),
        u.thumb ? upload(photoPath(u.id, u.side, "thumb"), u.thumb) : removePaths([photoPath(u.id, u.side, "thumb")]),
      ])
    );
    if (changed.length) {
      const { error } = await sb().from("items").upsert(changed.map(toRow), { onConflict: "user_id,id" });
      if (error) fail(error);
    }
  } catch (e) {
    // Don't leave photos behind for pieces that were never saved.
    await removePaths(fresh.flatMap((i) => ALL_PHOTOS(i.id))).catch(() => {});
    throw e;
  }

  if (removed.length) {
    const { error } = await sb()
      .from("items")
      .delete()
      .in("id", removed.map((i) => i.id));
    if (error) fail(error);
  }
  await removePaths([...pathsFor(dels), ...removed.flatMap((i) => ALL_PHOTOS(i.id))]).catch(() => {});

  // Show new photos instantly from memory instead of waiting for them to come back from the network.
  // If the session ended while saving, the data is safe in the database and there is no account left to show it to.
  if (!hasSession()) return next;
  const byId = new Map(next.map((i) => [i.id, i]));
  for (const u of uploads) {
    forgetPhotos(u.id, u.side);
    const item = byId.get(u.id);
    if (!item) continue;
    seedPhoto(item, u.side, "full", u.blob);
    if (u.thumb) seedPhoto(item, u.side, "thumb", u.thumb);
  }
  for (const d of dels) forgetPhotos(d.id, d.side);
  for (const i of removed) forgetPhotos(i.id);
  return next;
}

/** Deletes every piece, photo and chat message (settings are kept). */
export async function clearEverything(): Promise<void> {
  const items = await loadItems();
  // Photos first and strictly: if they can't be removed, keep the rows so nothing is left behind unreachable.
  await removePaths(items.flatMap((i) => ALL_PHOTOS(i.id)), true);
  const a = await sb().from("items").delete().neq("id", "");
  if (a.error) fail(a.error);
  const b = await sb().from("chats").delete().neq("id", ""); // takes its messages with it
  if (b.error) fail(b.error);
  const b2 = await sb().from("chat_messages").delete().neq("id", ""); // any stragglers
  if (b2.error) fail(b2.error);
  const c = await sb().from("outfits").delete().neq("id", "");
  if (c.error) fail(c.error);
  resetChatSync();
  forgetAllPhotos();
  clearCache();
}

// ---------------------------------------------------------------- chats

type ChatRow = { id: string; title: string; created_at: number; updated_at: number };
type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
  error: string | null;
  error_kind: string | null;
  model: string | null;
};

const chatFromRow = (r: ChatRow): Chat => ({
  id: r.id,
  title: r.title,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

/** Every conversation, most recently active first. */
export async function loadChats(): Promise<Chat[]> {
  const { data, error } = await sb().from("chats").select("*").order("updated_at", { ascending: false });
  if (error) fail(error);
  return (data as ChatRow[]).map(chatFromRow);
}

export async function createChat(chat: Chat): Promise<void> {
  const { error } = await sb()
    .from("chats")
    .insert({ user_id: requireUserId(), id: chat.id, title: chat.title, created_at: chat.createdAt, updated_at: chat.updatedAt });
  if (error) fail(error);
}

/** Bumps a conversation to the top of the list (and optionally retitles it). */
export async function touchChat(id: string, patch: { title?: string } = {}): Promise<void> {
  const { error } = await sb()
    .from("chats")
    .update({ updated_at: Date.now(), ...(patch.title ? { title: patch.title } : {}) })
    .eq("id", id);
  if (error) fail(error);
}

export async function renameChat(id: string, title: string): Promise<void> {
  const { error } = await sb().from("chats").update({ title }).eq("id", id);
  if (error) fail(error);
}

/** Deletes a conversation and all its messages. */
export async function deleteChat(id: string): Promise<void> {
  const { error } = await sb().from("chats").delete().eq("id", id);
  if (error) fail(error);
  if (savedChatId === id) {
    savedChat.clear();
    savedChatId = null;
  }
}

/** What the database already holds for the open conversation (id -> content signature), so a save only sends what changed. */
const savedChat = new Map<string, string>();
let savedChatId: string | null = null;
/** Forgets which messages are known to be saved (called when the account changes). */
export function resetChatSync() {
  savedChat.clear();
  savedChatId = null;
}
const sig = (m: ChatMessage) => `${m.content}\u0000${m.error ?? ""}\u0000${m.errorKind ?? ""}\u0000${m.model ?? ""}`;

export async function loadChat(chatId: string): Promise<ChatMessage[]> {
  const { data, error } = await sb()
    .from("chat_messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(MAX_CHAT_MESSAGES);
  if (error) fail(error);
  const list = (data as MessageRow[]).reverse().map(
    (r): ChatMessage => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: Number(r.created_at),
      ...(r.error ? { error: r.error } : {}),
      ...(r.error_kind ? { errorKind: r.error_kind as ChatMessage["errorKind"] } : {}),
      ...(r.model ? { model: r.model } : {}),
    })
  );
  savedChat.clear();
  savedChatId = chatId;
  for (const m of list) savedChat.set(m.id, sig(m));
  return list;
}

export async function saveChat(chatId: string, messages: ChatMessage[]): Promise<void> {
  if (savedChatId !== chatId) {
    savedChat.clear();
    savedChatId = chatId;
  }
  const clean = messages.filter((m) => !m.pending).slice(-MAX_CHAT_MESSAGES);
  const keep = new Set(clean.map((m) => m.id));
  const gone = [...savedChat.keys()].filter((id) => !keep.has(id));
  const changed = clean.filter((m) => savedChat.get(m.id) !== sig(m));

  if (changed.length) {
    const { error } = await sb()
      .from("chat_messages")
      .upsert(
        changed.map((m) => ({
          user_id: requireUserId(),
          id: m.id,
          chat_id: chatId,
          role: m.role,
          content: m.content,
          created_at: m.createdAt,
          error: m.error ?? null,
          error_kind: m.errorKind ?? null,
          model: m.model ?? null,
        })),
        { onConflict: "user_id,id" }
      );
    if (error) fail(error);
    for (const m of changed) savedChat.set(m.id, sig(m));
  }
  if (gone.length) {
    const { error } = await sb().from("chat_messages").delete().in("id", gone);
    if (error) fail(error);
    for (const id of gone) savedChat.delete(id);
  }
}

export type SuggestedReply = { id: string; chatId: string; content: string; createdAt: number };

/** The stylist's successful replies across every conversation, newest first (the source of the "Ideas" feed). */
export async function loadAssistantReplies(limit = 300): Promise<SuggestedReply[]> {
  const { data, error } = await sb()
    .from("chat_messages")
    .select("id, chat_id, content, created_at")
    .eq("role", "assistant")
    .is("error", null)
    .not("chat_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail(error);
  return (data as { id: string; chat_id: string; content: string; created_at: number }[]).map((r) => ({
    id: r.id,
    chatId: r.chat_id,
    content: r.content,
    createdAt: Number(r.created_at),
  }));
}

// ---------------------------------------------------------------- outfits

type OutfitRow = {
  id: string;
  name: string;
  item_ids: string[] | null;
  note: string | null;
  created_at: number;
  worn_count: number | null;
  last_worn: number | null;
};

const outfitFromRow = (r: OutfitRow): Outfit => ({
  id: r.id,
  name: r.name,
  itemIds: r.item_ids ?? [],
  note: r.note ?? "",
  createdAt: Number(r.created_at),
  wornCount: Number(r.worn_count ?? 0),
  lastWorn: r.last_worn == null ? null : Number(r.last_worn),
});

const outfitToRow = (o: Outfit) => ({
  user_id: requireUserId(),
  id: o.id,
  name: o.name,
  item_ids: o.itemIds,
  note: o.note,
  created_at: o.createdAt,
  worn_count: o.wornCount,
  last_worn: o.lastWorn,
});

export async function loadOutfits(): Promise<Outfit[]> {
  const { data, error } = await sb().from("outfits").select("*").order("created_at", { ascending: false });
  if (error) fail(error);
  return (data as OutfitRow[]).map(outfitFromRow);
}

export async function saveOutfit(outfit: Outfit): Promise<void> {
  const { error } = await sb().from("outfits").upsert(outfitToRow(outfit), { onConflict: "user_id,id" });
  if (error) fail(error);
}

export async function deleteOutfit(id: string): Promise<void> {
  const { error } = await sb().from("outfits").delete().eq("id", id);
  if (error) fail(error);
}

// ---------------------------------------------------------------- profile

export async function loadProfile(): Promise<Profile> {
  const { data, error } = await sb().from("profile").select("data").eq("user_id", requireUserId()).maybeSingle();
  if (error) fail(error);
  return cleanProfile(data?.data);
}

export async function saveProfile(profile: Profile): Promise<void> {
  const { error } = await sb()
    .from("profile")
    .upsert({ user_id: requireUserId(), data: cleanProfile(profile), updated_at: Date.now() }, { onConflict: "user_id" });
  if (error) fail(error);
}

// ---------------------------------------------------------------- backup / restore

type BackupItem = ClothingItem & { images: { front: string; back?: string } };

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const EXPORT_CONCURRENCY = 4;

/** Builds a backup of what is in the database right now. `skipped` counts pieces whose photo was missing. */
export async function exportBackup(): Promise<{ blob: Blob; count: number; skipped: number }> {
  const [items, outfits] = await Promise.all([loadItems(), loadOutfits().catch(() => [] as Outfit[])]);
  // A few pieces at a time (front and back together) instead of one photo after another; order is kept.
  const built: (BackupItem | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(EXPORT_CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length) {
        const at = cursor++;
        const item = items[at];
        const [front, back] = await Promise.all([getImageBlob(item, "front"), item.hasBack ? getImageBlob(item, "back") : undefined]);
        if (!front) continue;
        built[at] = {
          ...item,
          hasBack: Boolean(back),
          images: { front: await blobToDataUrl(front), ...(back ? { back: await blobToDataUrl(back) } : {}) },
        };
      }
    })
  );
  const out = built.filter((b): b is BackupItem => b !== null);
  const skipped = items.length - out.length;
  const payload = { app: "drape", version: 2, exportedAt: new Date().toISOString(), items: out, outfits };
  return { blob: new Blob([JSON.stringify(payload)], { type: "application/json" }), count: out.length, skipped };
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BACKUP_IMAGE_BYTES = 10 * 1024 * 1024;

/** Any malformed data URL (bad base64, wrong type, too big) just yields null — it must never abort the import. */
async function dataUrlToBlob(dataUrl: unknown): Promise<Blob | null> {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (!ALLOWED_IMAGE_TYPES.has(blob.type) || blob.size > MAX_BACKUP_IMAGE_BYTES) return null;
    return blob;
  } catch {
    return null;
  }
}

export type ImportResult = { items: ClothingItem[]; added: number; updated: number; skipped: number; outfits: number };

type Prepared = { item: ClothingItem; front: Blob; back: Blob | null };

/** Merges a backup file into the current wardrobe (same id = overwritten). Treats the file as untrusted input. */
export async function importBackup(text: string, knownIds: Iterable<string> = []): Promise<ImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Couldn't read that file — it isn't a valid backup.");
  }
  const file = data as { app?: unknown; items?: unknown };
  const appOk = file.app === "drape" || file.app === "my-wardrobe"; // older backups used the old name
  if (typeof data !== "object" || data === null || !appOk || !Array.isArray(file.items)) {
    throw new Error("That doesn't look like a Drape backup file.");
  }

  const usedIds = new Set(knownIds);
  const prepared: Prepared[] = [];
  let skipped = 0;

  for (const raw of file.items) {
    const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const images = (typeof r.images === "object" && r.images !== null ? r.images : {}) as Record<string, unknown>;
    const type = typeof r.type === "string" && isKnownType(r.type) ? r.type : null;
    const front = type ? await dataUrlToBlob(images.front) : null;
    if (!type || !front) {
      skipped++;
      continue;
    }
    const back = await dataUrlToBlob(images.back);

    // Ids must look like the ones the app generates (8 hex chars) so the chat's [[id]] chips can find them.
    const idOk = typeof r.id === "string" && /^[0-9a-f]{8}$/i.test(r.id);
    const id = idOk ? (r.id as string).toLowerCase() : newId(usedIds);
    usedIds.add(id);
    const now = Date.now();
    prepared.push({
      front,
      back,
      item: {
        id,
        type,
        category: categoryOfType(type)!,
        colors: Array.isArray(r.colors)
          ? r.colors.filter((c): c is string => typeof c === "string" && isKnownColor(c)).slice(0, 2)
          : [],
        description: typeof r.description === "string" ? r.description.trim().slice(0, 600) : "",
        hasBack: Boolean(back),
        favorite: r.favorite === true,
        wearCount: typeof r.wearCount === "number" && r.wearCount >= 0 ? Math.min(100000, Math.floor(r.wearCount)) : 0,
        lastWorn: typeof r.lastWorn === "number" ? r.lastWorn : null,
        createdAt: typeof r.createdAt === "number" ? r.createdAt : now,
        updatedAt: now,
      },
    });
  }

  const puts: ImagePut[] = [];
  const dels: ImageKey[] = [];
  for (const p of prepared) {
    puts.push({ id: p.item.id, side: "front", blob: p.front });
    if (p.back) puts.push({ id: p.item.id, side: "back", blob: p.back });
    else dels.push({ id: p.item.id, side: "back" });
  }

  let added = 0;
  let updated = 0;
  const items = await mutateItems(
    (current) => {
      const byId = new Map(current.map((i) => [i.id, i]));
      for (const p of prepared) {
        if (byId.has(p.item.id)) updated++;
        else added++;
        byId.set(p.item.id, p.item);
      }
      return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
    },
    { put: puts, del: dels }
  );

  // Saved looks: keep the ones that still point at two or more pieces we now have.
  const have = new Set(items.map((i) => i.id));
  const rawOutfits = Array.isArray((data as { outfits?: unknown }).outfits) ? ((data as { outfits: unknown[] }).outfits) : [];
  let outfits = 0;
  for (const raw of rawOutfits.slice(0, 500)) {
    const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const ids = Array.isArray(o.itemIds) ? o.itemIds.filter((x): x is string => typeof x === "string" && have.has(x)) : [];
    if (typeof o.id !== "string" || !/^[0-9a-f]{8}$/i.test(o.id) || typeof o.name !== "string" || new Set(ids).size < 2) continue;
    try {
      await saveOutfit({
        id: o.id.toLowerCase(),
        name: o.name.trim().slice(0, 60) || "Untitled look",
        itemIds: [...new Set(ids)],
        note: typeof o.note === "string" ? o.note.trim().slice(0, 400) : "",
        createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
        wornCount: typeof o.wornCount === "number" && o.wornCount >= 0 ? Math.min(100000, Math.floor(o.wornCount)) : 0,
        lastWorn: typeof o.lastWorn === "number" ? o.lastWorn : null,
      });
      outfits++;
    } catch {
      // one bad look never aborts the import
    }
  }

  return { items, added, updated, skipped, outfits };
}
