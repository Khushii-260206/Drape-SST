import { PostgrestClient } from "@supabase/postgrest-js";
import { StorageClient } from "@supabase/storage-js";
import { accessToken, hasSession, requireUserId } from "./auth";
import { SUPABASE_URL } from "./env";
import { explainSupabaseError, type ErrorArea, type SupabaseErrorLike } from "./supabase-errors";

/*
 * Every request carries the signed-in user's access token (see auth.ts); the policies in
 * Backend/supabase/schema.secure.sql only let that user reach their own rows and photos. The anon key still ships in
 * the site, but on its own it can read nothing. Never put the database password or the service-role key anywhere in
 * this project.
 *
 * Only the two parts of Supabase this app uses are bundled for data — the database (PostgREST) and file storage; login
 * lives in auth.ts.
 */
const URL = SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

type Client = { from: PostgrestClient["from"]; storage: StorageClient };

/** fetch that adds the apikey and the current user's token (looked up per request, so a refreshed token is used). */
const authedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("apikey", ANON_KEY);
  const token = await accessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  else headers.delete("Authorization"); // signed out: the publishable key alone gets no access
  return globalThis.fetch(input, { ...init, headers });
};

let _client: Client | undefined;
export function sb(): Client {
  // Created lazily so static prerendering never touches it.
  if (!_client) {
    if (!URL || !ANON_KEY) {
      throw new Error("Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).");
    }
    const db = new PostgrestClient(`${URL}/rest/v1`, { fetch: authedFetch });
    _client = { from: db.from.bind(db), storage: new StorageClient(`${URL}/storage/v1`, { apikey: ANON_KEY }, authedFetch) };
  }
  return _client;
}

/** Supabase errors are plain objects, not Errors; turn them into something we can show. */
export function fail(
  error: SupabaseErrorLike | null | undefined,
  fallback = "Couldn't reach your wardrobe. Check your connection.",
  area: ErrorArea = "database"
): never {
  if (!hasSession()) requireUserId(); // refused because nobody is signed in: say that, not "run the schema"
  const explained = explainSupabaseError(error, area);
  if (explained) throw new Error(explained);
  throw new Error(error?.message && !/fetch/i.test(error.message) ? error.message : fallback);
}
