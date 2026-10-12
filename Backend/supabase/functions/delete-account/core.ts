/*
 * The account-deletion procedure, free of Deno and Supabase imports so it can be unit-tested in Node with a fake `Admin`.
 * index.ts wires it to the real service-role client. The order matters:
 *
 *   1. photos     every object under "<user id>/" in the private `wardrobe` bucket (listed recursively, removed in batches,
 *                 then listed again to confirm nothing is left)
 *   2. data rows  chat_messages -> chats -> outfits -> items -> profile, each filtered by this user's id
 *   3. auth user  only after 1 and 2 succeeded
 *
 * If a step fails the procedure stops there and reports which one. Nothing later has run, the account still exists and
 * can sign in, and running it again is safe: every step is idempotent and skips what is already gone.
 */

export const BUCKET = "wardrobe";
/** Child-first, so foreign keys (chat_messages -> chats) can never block a delete even without ON DELETE CASCADE. */
export const TABLES_IN_ORDER = ["chat_messages", "chats", "outfits", "items", "profile"] as const;

export type StorageEntry = { name: string; /** Folders come back without an id. */ isFolder: boolean };

export type Admin = {
  listStorage(folder: string, offset: number, limit: number): Promise<StorageEntry[]>;
  removeStorage(paths: string[]): Promise<void>;
  deleteRows(table: string, userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
};

export type Stage = "storage" | "data" | "account";
export class DeletionError extends Error {
  stage: Stage;
  constructor(stage: Stage, message: string) {
    super(message);
    this.name = "DeletionError";
    this.stage = stage;
  }
}

const PAGE = 100;
const MAX_PASSES = 5;
// Ids are UUIDs from Supabase Auth. Refuse anything else so a malformed value can never widen a prefix or a filter.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every file path under one folder, however deeply nested. */
async function listAll(admin: Admin, folder: string): Promise<string[]> {
  const files: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await admin.listStorage(folder, offset, PAGE);
    for (const e of page) {
      if (e.isFolder) files.push(...(await listAll(admin, `${folder}/${e.name}`)));
      else files.push(`${folder}/${e.name}`);
    }
    if (page.length < PAGE) return files;
  }
}

export async function deleteAccount(admin: Admin, userId: string): Promise<{ removedFiles: number }> {
  if (!UUID.test(userId)) throw new DeletionError("account", "That isn't a valid account id.");

  // 1. Photos. The user's own folder is the only prefix ever listed or removed.
  let removed = 0;
  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const paths = await listAll(admin, userId);
      if (paths.length === 0) break;
      if (pass === MAX_PASSES - 1) throw new Error("photos are still there after several attempts");
      for (let i = 0; i < paths.length; i += PAGE) {
        const batch = paths.slice(i, i + PAGE);
        // Defence in depth: nothing outside "<this user>/" can be in a batch, whatever the listing returned.
        if (!batch.every((p) => p.startsWith(`${userId}/`) && !p.split("/").some((part) => part === ".." || part === "." || part === ""))) throw new Error("refusing to remove a path outside the account's folder");
        await admin.removeStorage(batch);
        removed += batch.length;
      }
    }
  } catch (e) {
    throw new DeletionError("storage", `Couldn't remove your photos (${e instanceof Error ? e.message : "unknown error"}).`);
  }

  // 2. Rows, children before parents.
  for (const table of TABLES_IN_ORDER) {
    try {
      await admin.deleteRows(table, userId);
    } catch (e) {
      throw new DeletionError("data", `Couldn't remove your ${table} (${e instanceof Error ? e.message : "unknown error"}).`);
    }
  }

  // 3. The sign-in itself, last.
  try {
    await admin.deleteUser(userId);
  } catch (e) {
    throw new DeletionError("account", `Your data was removed but the account itself couldn't be deleted (${e instanceof Error ? e.message : "unknown error"}).`);
  }
  return { removedFiles: removed };
}

/** Decodes the `iat` (issued-at, seconds) of a JWT without trusting it for anything but a freshness check. */
export function tokenIssuedAt(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { iat?: unknown };
    return typeof payload.iat === "number" ? payload.iat : null;
  } catch {
    return null;
  }
}

/** The caller must have signed in just now: a stolen, long-lived token alone isn't enough to delete an account. */
export const MAX_TOKEN_AGE_SECONDS = 5 * 60;
export function isFresh(token: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const iat = tokenIssuedAt(token);
  return iat !== null && nowSeconds - iat <= MAX_TOKEN_AGE_SECONDS && iat <= nowSeconds + 60;
}
