// Shared by check-env.mjs, verify-project.mjs and build-env.ts, so the list of retired projects and the way .env files
// are read can't drift apart. Pure: no file or network access, and nothing here ever prints a value.
import { createHash } from "node:crypto";

/** sha256 fingerprints (first 8 hex chars) of Supabase project ids that must never be contacted or built against again. */
export const RETIRED_PROJECTS = ["f8ffcfef"];

export const fingerprint = (ref) => createHash("sha256").update(ref).digest("hex").slice(0, 8);

/** The project id inside a Supabase URL (https://<20 letters/digits>.supabase.co), or undefined. */
export const projectRef = (url) => /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec((url ?? "").trim())?.[1];

/** True when the URL points at a retired project. Deliberately lenient about the URL's path, so extra segments can't dodge it. */
export function isRetiredUrl(url, retired = RETIRED_PROJECTS) {
  const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co(?:[/?#]|$)/i.exec((url ?? "").trim())?.[1]?.toLowerCase();
  return Boolean(ref && retired.includes(fingerprint(ref)));
}

export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
