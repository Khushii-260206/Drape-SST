// LIVE two-account isolation check against YOUR new Supabase project.   Run from Frontend/:  npm run verify:accounts
//
// Unlike `verify:project` this signs up two throw-away accounts through the real Auth service, writes one piece and one
// photo as account A, and then tries to read, edit, delete and overwrite them as account B. It needs "Confirm email"
// turned OFF while it runs (otherwise sign-up returns no session). It only uses the public anon key from .env.local,
// prints no URL, key, token or response body, and removes the rows and files it created. The two accounts remain
// (deleting users needs the dashboard: Authentication -> Users); give them no value, they hold no data afterwards.
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { isRetiredUrl, parseEnv } from "./project-guard.mjs";

const here = import.meta.dirname;
const files = [path.resolve(here, "../../.env.local"), path.resolve(here, "../.env.local")].filter(existsSync);
const env = Object.assign({}, ...files.map((f) => parseEnv(readFileSync(f, "utf8"))));
const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
const key = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const die = (m) => { console.log("FAIL  " + m + " Nothing was contacted."); process.exit(1); };
if (!url || !key) die("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.");
if (isRetiredUrl(url)) die("The configured project is the retired old project.");
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) die("The URL is not of the form https://<project>.supabase.co.");
if (key.startsWith("sb_secret_")) die("The key is a SECRET key.");
if (key.split(".").length === 3) {
  let role;
  try { role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role; } catch { die("The key can't be read."); }
  if (role !== "anon") die(`The key has role "${role}", not "anon".`);
}

// Domain of the throw-away test emails. Set VERIFY_EMAIL_DOMAIN (shell or .env.local) to a domain your project accepts.
// The default, example.com, is reserved (RFC 2606) and hosted Supabase Auth may reject it with email_address_invalid.
const emailDomain = (process.env.VERIFY_EMAIL_DOMAIN ?? env.VERIFY_EMAIL_DOMAIN ?? "example.com").trim().toLowerCase();
if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(emailDomain)) {
  die("VERIFY_EMAIL_DOMAIN is not a valid domain name (expected e.g. mail.yourdomain.com, no @ or spaces).");
}
if (emailDomain === "example.com") {
  console.log("WARN  Using the default test email domain example.com; hosted Supabase Auth may reject it (email_address_invalid). Set VERIFY_EMAIL_DOMAIN to override.");
}

const results = [];
const check = (name, pass) => { results.push(pass); console.log(`${pass ? "PASS" : "FAIL"}  ${name}`); };
const api = async (p, { token, ...init } = {}) => {
  const res = await fetch(url + p, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, ...init.headers },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, json };
};
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function signUp(label) {
  const email = `drape-verify-${label}-${randomBytes(5).toString("hex")}@${emailDomain}`;
  const password = randomBytes(16).toString("hex");
  const r = await api("/auth/v1/signup", json({ email, password }));
  const token = r.json?.access_token, id = r.json?.user?.id;
  if (!token || !id) {
    // Only the status and Supabase's short error code/message are shown (emails redacted); never the URL, key or full body.
    const detail = [r.json?.error_code ?? r.json?.error, r.json?.msg ?? r.json?.message ?? r.json?.error_description]
      .filter((v) => typeof v === "string").join(": ").replace(/\S+@\S+/g, "<email>").slice(0, 200);
    console.log(`FAIL  sign-up of account ${label} returned no session (HTTP ${r.status}${detail ? `, ${detail}` : ""}) - is "Confirm email" off? is Email auth enabled?`);
    process.exit(1);
  }
  return { token, id };
}

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const A = await signUp("a"), B = await signUp("b");
check("two separate accounts were created through real Auth", A.id !== B.id);

const pid = randomBytes(4).toString("hex"), file = `${A.id}/${pid}/front`;
const now = Date.now();
const H = (t) => ({ token: t, headers: { "Content-Type": "application/json", Prefer: "return=representation" } });
const rows = (r) => (Array.isArray(r.json) ? r.json : []);

try {
  // --- database ---
  const ins = await api("/rest/v1/items", { ...H(A.token), method: "POST", body: JSON.stringify({ id: pid, type: "top", category: "tops", created_at: now, updated_at: now, description: "A-ONLY" }) });
  check("A can create a piece (owner id filled in by the database)", ins.status === 201 && rows(ins)[0]?.user_id === A.id);
  check("A can read it back", rows(await api(`/rest/v1/items?id=eq.${pid}`, { token: A.token })).length === 1);
  check("B cannot read A's piece", rows(await api(`/rest/v1/items?id=eq.${pid}`, { token: B.token })).length === 0);
  check("B sees no rows at all in items", rows(await api("/rest/v1/items", { token: B.token })).length === 0);
  const upd = await api(`/rest/v1/items?id=eq.${pid}`, { ...H(B.token), method: "PATCH", body: JSON.stringify({ description: "HACKED" }) });
  check("B cannot edit A's piece", rows(upd).length === 0);
  const del = await api(`/rest/v1/items?id=eq.${pid}`, { ...H(B.token), method: "DELETE" });
  check("B cannot delete A's piece", rows(del).length === 0);
  const spoof = await api("/rest/v1/items", { ...H(B.token), method: "POST", body: JSON.stringify({ user_id: A.id, id: randomBytes(4).toString("hex"), type: "top", category: "tops", created_at: now, updated_at: now }) });
  check("B cannot insert a row owned by A", !spoof.ok);
  const mine = rows(await api(`/rest/v1/items?id=eq.${pid}`, { token: A.token }));
  check("A's piece is unchanged after B's attempts", mine.length === 1 && mine[0].description === "A-ONLY");
  check("anon key alone reads nothing from items", !(await api("/rest/v1/items")).ok || rows(await api("/rest/v1/items")).length === 0);

  // --- storage ---
  const put = (t, p, method = "POST") => api(`/storage/v1/object/wardrobe/${p}`, { token: t, method, headers: { "Content-Type": "image/png", "x-upsert": "true" }, body: PNG });
  check("A can upload to its own folder", (await put(A.token, file)).ok);
  check("B cannot upload into A's folder", !(await put(B.token, `${A.id}/${pid}/evil`)).ok);
  check("B cannot overwrite A's photo", !(await put(B.token, file, "PUT")).ok);
  check("B cannot download A's photo", !(await api(`/storage/v1/object/authenticated/wardrobe/${file}`, { token: B.token })).ok);
  check("B cannot sign a URL for A's photo", !(await api(`/storage/v1/object/sign/wardrobe/${file}`, { ...json({ expiresIn: 60 }), token: B.token })).ok);
  await api("/storage/v1/object/wardrobe", { token: B.token, method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [file] }) });
  check("B's delete did not remove A's photo", (await api(`/storage/v1/object/authenticated/wardrobe/${file}`, { token: A.token })).ok);
  check("the bucket is not public (public URL refused)", !(await api(`/storage/v1/object/public/wardrobe/${file}`)).ok);

  const sign = (expiresIn) => api(`/storage/v1/object/sign/wardrobe/${file}`, { ...json({ expiresIn }), token: A.token });
  const s1 = await sign(3);
  const signed = s1.json?.signedURL;
  const fetchSigned = async () => (signed ? (await fetch(url + "/storage/v1" + signed)).status : 0);
  check("A's signed URL works while valid", s1.ok && (await fetchSigned()) === 200);
  await new Promise((r) => setTimeout(r, 4500));
  check("the signed URL stops working after it expires", (await fetchSigned()) !== 200);
  const s2 = await sign(60);
  check("A can mint a fresh signed URL that works (recovery)", s2.ok && (await fetch(url + "/storage/v1" + s2.json?.signedURL)).status === 200);
} finally {
  await api("/storage/v1/object/wardrobe", { token: A.token, method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [file] }) }).catch(() => {});
  await api(`/rest/v1/items?id=eq.${pid}`, { token: A.token, method: "DELETE" }).catch(() => {});
}

const failed = results.filter((r) => !r).length;
console.log(`\nRESULT: ${failed ? `FAIL - ${failed} of ${results.length} checks failed.` : `PASS - ${results.length} of ${results.length} checks passed.`}`);
console.log("Not covered here: the app's own expiry handling in the browser (see Backend/README.md step 7) and the dashboard's bucket setting.");
process.exit(failed ? 1 : 0);
