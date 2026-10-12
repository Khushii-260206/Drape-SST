// What a published build is allowed to contain. Anything NEXT_PUBLIC_ is compiled into the site and readable by every
// visitor, so for a production build this drops the AI provider keys and refuses to continue if a privileged Supabase
// key (service role / secret / database password) is in any public variable. Pure on purpose, so it can be tested.

import { RETIRED_PROJECTS, isRetiredUrl } from "./scripts/project-guard.mjs";

const PROVIDER_KEYS = ["NEXT_PUBLIC_GEMINI_API_KEY", "NEXT_PUBLIC_GROQ_API_KEY", "NEXT_PUBLIC_OPENROUTER_API_KEY"];

function jwtRole(value: string): string | undefined {
  try {
    const part = value.split(".")[1];
    return part ? (JSON.parse(Buffer.from(part, "base64url").toString()) as { role?: string }).role : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Always (dev and production alike) refuses a retired Supabase project, before the browser could ever contact it. For a
 * production build it also drops the AI provider keys. Throws (naming the variable, never its value) if a private key is public.
 */
export function prepareBuildEnv(env: Record<string, string | undefined>, retired: string[] = RETIRED_PROJECTS): void {
  if (isRetiredUrl(env.NEXT_PUBLIC_SUPABASE_URL, retired)) {
    throw new Error("Refusing to start: NEXT_PUBLIC_SUPABASE_URL points at the retired old Supabase project. Create a project of your own and put its URL and key in .env.local (see .env.example).");
  }
  if (env.NODE_ENV !== "production") return;
  for (const name of PROVIDER_KEYS) delete env[name];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("NEXT_PUBLIC_") || !value) continue;
    const role = jwtRole(value);
    if (/SERVICE|SECRET|PASSWORD/i.test(name) || value.startsWith("sb_secret_") || (role && role !== "anon")) {
      throw new Error(`Refusing to build: ${name} looks like a private key, and NEXT_PUBLIC_ values are published with the site. Use only the anon/publishable key.`);
    }
  }
}
