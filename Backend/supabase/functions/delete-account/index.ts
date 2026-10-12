// Supabase Edge Function: permanently deletes the CALLING user's account and everything they own.
//
//   supabase functions deploy delete-account        (JWT verification stays ON: it is the default)
//
// The service-role key never leaves Supabase: it is injected into this function's environment as
// SUPABASE_SERVICE_ROLE_KEY and used only here. The browser sends nothing but the user's own access token, and the id
// that gets deleted is taken from that verified token, never from the request body, so nobody can name someone else.
import { createClient } from "npm:@supabase/supabase-js@2";
import { BUCKET, DeletionError, deleteAccount, isFresh, type Admin } from "./core.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*", // the call is authenticated by the bearer token, not by origin
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "The function isn't configured." });

  const header = req.headers.get("Authorization") ?? "";
  const token = /^Bearer (.+)$/.exec(header)?.[1];
  if (!token) return reply(401, { error: "Sign in first." });

  // Who is calling: asked of Supabase Auth with the caller's own token.
  const caller = createClient(url, anon, { global: { headers: { Authorization: header } }, auth: { persistSession: false } });
  const { data, error } = await caller.auth.getUser(token);
  if (error || !data.user) return reply(401, { error: "Your session has expired. Sign in again." });
  const user = data.user;

  let body: { confirm?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // fall through to the confirmation check
  }
  if (body.confirm !== "DELETE") return reply(400, { error: "Confirmation is missing." });
  if (!isFresh(token)) return reply(403, { error: "Please confirm your password again.", reauthenticate: true });

  const sb = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin: Admin = {
    async listStorage(folder, offset, limit) {
      const { data: list, error: e } = await sb.storage.from(BUCKET).list(folder, { limit, offset, sortBy: { column: "name", order: "asc" } });
      if (e) throw new Error(e.message);
      return (list ?? []).map((o) => ({ name: o.name, isFolder: o.id === null }));
    },
    async removeStorage(paths) {
      const { error: e } = await sb.storage.from(BUCKET).remove(paths);
      if (e) throw new Error(e.message);
    },
    async deleteRows(table, userId) {
      const { error: e } = await sb.from(table).delete().eq("user_id", userId);
      if (e) throw new Error(e.message);
    },
    async deleteUser(userId) {
      const { error: e } = await sb.auth.admin.deleteUser(userId);
      if (e) throw new Error(e.message);
    },
  };

  try {
    const { removedFiles } = await deleteAccount(admin, user.id);
    console.log(`account deleted (${removedFiles} files)`); // no ids, emails or tokens in logs
    return reply(200, { ok: true });
  } catch (e) {
    const stage = e instanceof DeletionError ? e.stage : "account";
    console.error(`account deletion failed at stage: ${stage}`);
    return reply(500, { ok: false, stage, error: e instanceof DeletionError ? e.message : "Something went wrong deleting your account." });
  }
});
