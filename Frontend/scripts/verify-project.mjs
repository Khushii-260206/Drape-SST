// READ-ONLY check that the public (anon) key of YOUR new Supabase project can't reach the app's data.
//   Run from Frontend/:  npm run verify:project
//
// It sends a few GET requests (and one storage *listing* query, which changes nothing) using only the public key from
// .env.local. It never signs in or up, never writes, uploads, deletes or runs SQL, and never prints the URL, a key, a
// token or any response body: only a status word and a fixed sentence per check.
//
// !! A pass here does NOT prove your data is private between accounts. It only shows that someone with nothing but the
// !! public key gets nothing. Ownership isolation must still be tested with two separate accounts (Backend/README.md).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RETIRED_PROJECTS, fingerprint, isRetiredUrl, parseEnv } from "./project-guard.mjs";

export { fingerprint, parseEnv };

/** The tables schema.secure.sql actually creates, so the check can't drift from the schema. */
export function tablesFromSchema(sql) {
  return [...sql.matchAll(/create table if not exists public\.(\w+)/gi)].map((m) => m[1]);
}

const PASS = "PASS", FAIL = "FAIL", NV = "NOT VERIFIED";

/**
 * Returns [{ status: "PASS" | "FAIL" | "NOT VERIFIED", check, message }]. Injectable so tests never touch a network.
 * options: { fetch, tables, retired }
 */
export async function verify(env, { fetch: fetchImpl = fetch, tables = [], retired = RETIRED_PROJECTS } = {}) {
  const out = [];
  const add = (status, check, message) => out.push({ status, check, message });
  const stop = (message) => { add(FAIL, "configuration", `${message} Nothing was contacted.`); return out; };

  // 1. Decide whether we may contact the project at all. No request is made until all of this passes.
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const key = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url) return stop("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (isRetiredUrl(url, retired)) return stop("The configured project is the retired old project. Use your own new project.");
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) return stop("NEXT_PUBLIC_SUPABASE_URL is not of the form https://<project>.supabase.co.");
  if (!key) return stop("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.");
  if (key.startsWith("sb_secret_")) return stop("The key is a SECRET key. Remove it from the env file and rotate it in the dashboard.");
  if (key.split(".").length === 3) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role; } catch { return stop("The key looks like a JWT but can't be read."); }
    if (role !== "anon") return stop(`The key is a JWT with role "${role}", not "anon". Use only the anon / publishable key.`);
  }
  if (tables.length === 0) return stop("No tables were found in Backend/supabase/schema.secure.sql, so there is nothing to check.");
  add(PASS, "configuration", "The URL has the right shape, it is not the retired project, and the key is an anon/publishable key.");

  const headers = key.startsWith("sb_publishable_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
  // Returns { status, json } and never exposes the body further than this function.
  const call = async (p, init = {}) => {
    try {
      const res = await fetchImpl(url + p, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(15000) });
      const text = await res.text().catch(() => "");
      let json;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, json };
    } catch {
      return { status: 0 };
    }
  };
  const said = (r) => `${r.json?.message ?? ""} ${r.json?.error ?? ""} ${r.json?.msg ?? ""} ${r.json?.hint ?? ""}`.toLowerCase();

  // 2. Reachable, and the project accepts this key. Auth settings are public, so this also tells us if sign-up is possible.
  const s = await call("/auth/v1/settings");
  if (s.status === 0) { add(FAIL, "reachable", "The project could not be reached (no network, or the URL is wrong)."); return out; }
  if (s.status === 401 || s.status === 403) { add(FAIL, "reachable", `The project answered but rejected the key (HTTP ${s.status}). Re-copy the anon/publishable key from the same project.`); return out; }
  if (s.status !== 200) { add(FAIL, "reachable", `The project answered with an unexpected status (HTTP ${s.status}).`); return out; }
  add(PASS, "reachable", "The project is reachable and accepts the key.");
  if (s.json?.external?.email === true && s.json?.disable_signup !== true) add(PASS, "email sign-in", "Email sign-in is enabled and sign-ups are open.");
  else if (s.json?.external?.email === false) add(FAIL, "email sign-in", "Email sign-in is disabled. Enable it under Authentication -> Providers -> Email.");
  else if (s.json?.disable_signup === true) add(FAIL, "email sign-in", "New sign-ups are disabled, so nobody can create an account.");
  else add(NV, "email sign-in", "The settings answer was not in the expected shape.");

  // 3. Each protected table: the public key must be refused. A refusal only counts if it is a permission refusal.
  for (const t of tables) {
    const r = await call(`/rest/v1/${encodeURIComponent(t)}?select=*&limit=1`);
    const check = `table ${t}`;
    const msg = said(r);
    if (r.status === 0) add(NV, check, "No answer (network problem), so this table was not checked.");
    else if (r.json?.code === "PGRST205" || r.json?.code === "42P01" || (r.status === 404 && /could not find the table|does not exist/.test(msg))) add(FAIL, check, "The table does not exist in this project. Run Backend/supabase/schema.secure.sql.");
    else if (r.json?.code === "42501" || /permission denied|row-level security/.test(msg)) add(PASS, check, `The public key is refused by a permission rule (HTTP ${r.status}).`);
    else if ((r.status === 401 || r.status === 403) && /api key|jwt/.test(msg)) add(NV, check, `Refused because of the key itself (HTTP ${r.status}), which says nothing about the table's policies.`);
    else if (r.status === 200 && Array.isArray(r.json) && r.json.length > 0) add(FAIL, check, "The public key can READ rows. The project is open: run Backend/supabase/lockdown.sql, then schema.secure.sql.");
    else if (r.status === 200) add(NV, check, "The public key is allowed to query this table and got no rows. That could be a policy or just an empty table, so it is not proof; schema.secure.sql gives the public key no access at all, so re-run it.");
    else add(NV, check, `Unexpected answer (HTTP ${r.status}); this table was not verified.`);
  }

  // 4. The photo bucket. Listing must show nothing; and a request through the *public* route tells public buckets apart.
  const list = await call("/storage/v1/object/list/wardrobe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefix: "", limit: 1 }) });
  if (list.status === 200 && Array.isArray(list.json) && list.json.length > 0) add(FAIL, "photo listing", "The public key can LIST photos. The storage policy is open.");
  else if (list.status === 200) add(NV, "photo listing", "The public key can run a listing and got nothing. That is not proof: the bucket may simply be empty.");
  else if (list.status === 401 || list.status === 403) add(PASS, "photo listing", `Listing with the public key is refused (HTTP ${list.status}).`);
  else add(NV, "photo listing", `Unexpected answer (HTTP ${list.status}); not verified.`);

  // Through the public route, a PUBLIC bucket answers "object not found" (or serves the file); a private or missing bucket
  // answers "bucket not found". The probe path is not a real file, so nothing is read.
  const pub = await call("/storage/v1/object/public/wardrobe/__verify__/probe");
  const pm = said(pub);
  if (pub.status === 200 || (pub.status === 404 && /object not found|not_found/.test(pm) && !/bucket/.test(pm))) add(FAIL, "bucket privacy", "The wardrobe bucket looks PUBLIC: it serves files without a sign-in. Set it to private (schema.secure.sql does).");
  else if (/bucket not found/.test(pm)) add(NV, "bucket privacy", "The public route says 'bucket not found'. A private bucket gives this answer, but so does a missing one, so privacy is NOT VERIFIED. Check Storage -> wardrobe in the dashboard: it must say Private.");
  else add(NV, "bucket privacy", `Could not tell (HTTP ${pub.status}). Check Storage -> wardrobe in the dashboard: it must say Private.`);

  return out;
}

export const WARNING = "WARNING: passing these checks only shows that the public key alone gets nothing. It does NOT show that one signed-in\n" +
  "user can't read another's data. Test that with two separate accounts (Backend/README.md, steps 5-6).";

/** 1 if anything failed, 2 if nothing failed but something is not verified, else 0. */
export const exitCode = (results) => (results.some((r) => r.status === FAIL) ? 1 : results.some((r) => r.status === NV) ? 2 : 0);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = import.meta.dirname;
  const files = [path.resolve(here, "../../.env.local"), path.resolve(here, "../.env.local")]; // repo root, then Frontend/ (which wins, as in the app)
  const found = files.filter((f) => existsSync(f));
  if (found.length === 0) {
    console.log("FAIL  No .env.local found (looked in the repository root and in Frontend/). Copy .env.example to .env.local first.");
    process.exit(1);
  }
  const env = Object.assign({}, ...found.map((f) => parseEnv(readFileSync(f, "utf8"))));
  const schema = path.resolve(here, "../../Backend/supabase/schema.secure.sql");
  const tables = existsSync(schema) ? tablesFromSchema(readFileSync(schema, "utf8")) : [];
  const results = await verify(env, { tables });
  for (const r of results) console.log(`${r.status.padEnd(12)} ${r.check.padEnd(14)} ${r.message}`);
  const code = exitCode(results);
  console.log("\n" + (code === 1 ? "RESULT: FAIL - fix the FAIL lines above." : code === 2 ? "RESULT: nothing failed, but some checks are NOT VERIFIED (see above)." : "RESULT: PASS."));
  console.log(WARNING);
  process.exit(code);
}
