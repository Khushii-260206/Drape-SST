// Checks the Supabase settings in .env.local (repository root, then Frontend/) WITHOUT printing any value. Run: npm run check:env
// It only reads the file; it never modifies it and never contacts Supabase.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RETIRED_PROJECTS, fingerprint, isRetiredUrl, parseEnv } from "./project-guard.mjs";

const files = [path.resolve(import.meta.dirname, "../../.env.local"), path.resolve(import.meta.dirname, "../.env.local")]; // repo root, then Frontend/ (which wins, as in the app and verify:project)
const found = files.filter((f) => existsSync(f));
const out = [];
const ok = (m) => out.push(`PASS  ${m}`);
const bad = (m) => out.push(`FAIL  ${m}`);

if (found.length === 0) {
  console.log("FAIL  .env.local not found in the repository root or in Frontend/. Copy .env.example to .env.local first.");
  process.exit(1);
}
const env = Object.assign({}, ...found.map((f) => parseEnv(readFileSync(f, "utf8"))));

const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const placeholder = (v) => !v || /your-|<|example/i.test(v);

if (placeholder(url)) bad("NEXT_PUBLIC_SUPABASE_URL is missing or still the placeholder");
else if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url)) bad("NEXT_PUBLIC_SUPABASE_URL should look like https://<20 letters/digits>.supabase.co (no /rest/v1, no extra path)");
else ok("NEXT_PUBLIC_SUPABASE_URL has the right shape");

if (placeholder(key)) bad("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or still the placeholder");
else if (key.startsWith("sb_secret_")) bad("NEXT_PUBLIC_SUPABASE_ANON_KEY holds a SECRET key. Remove it now and rotate that key in the dashboard.");
else if (key.startsWith("sb_publishable_")) ok("NEXT_PUBLIC_SUPABASE_ANON_KEY is a publishable key");
else if (key.split(".").length === 3) {
  try {
    const role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role;
    if (role === "anon") ok("NEXT_PUBLIC_SUPABASE_ANON_KEY is a legacy anon key");
    else bad(`NEXT_PUBLIC_SUPABASE_ANON_KEY is a JWT with role "${role}", not "anon". Use the anon / publishable key only.`);
  } catch {
    bad("NEXT_PUBLIC_SUPABASE_ANON_KEY looks like a JWT but can't be read; re-copy it");
  }
} else bad("NEXT_PUBLIC_SUPABASE_ANON_KEY isn't a recognised key format; re-copy it");

for (const name of Object.keys(env)) {
  if (name.startsWith("NEXT_PUBLIC_") && /SERVICE|SECRET|PASSWORD/i.test(name)) bad(`${name} must not exist: NEXT_PUBLIC_ values are published with the site`);
}
const ai = ["GEMINI", "GROQ", "OPENROUTER"].filter((n) => env[`NEXT_PUBLIC_${n}_API_KEY`]);
out.push(`INFO  AI keys present (dev only, never published): ${ai.length ? ai.join(", ") : "none"}`);

// A short fingerprint of the project id lets you confirm the value CHANGED when you switch projects, without showing it.
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(url)?.[1];
if (ref) out.push(`INFO  project fingerprint: ${fingerprint(ref)}`);
// The project id that used to be hardcoded as the default in src/lib/env.ts (visible in git history), so it is public.
if (isRetiredUrl(url, RETIRED_PROJECTS)) bad("NEXT_PUBLIC_SUPABASE_URL points at the old shared project (its id is in git history). Create a new Supabase project of your own and use its URL and key.");
console.log(out.join("\n"));
process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
