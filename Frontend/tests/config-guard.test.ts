// Proves the published build can't carry AI provider keys or a privileged Supabase key. Values are never printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareBuildEnv } from "../build-env";
import { fingerprint, isRetiredUrl } from "../scripts/project-guard.mjs";

const jwt = (role: string) => `h.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.s`;

test("production build keeps the anon key but drops AI provider keys", () => {
  const env: Record<string, string | undefined> = {
    NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"),
    NEXT_PUBLIC_GROQ_API_KEY: "x", NEXT_PUBLIC_GEMINI_API_KEY: "x", NEXT_PUBLIC_OPENROUTER_API_KEY: "x",
  };
  prepareBuildEnv(env);
  assert.ok(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  for (const n of ["GROQ", "GEMINI", "OPENROUTER"]) assert.equal(env[`NEXT_PUBLIC_${n}_API_KEY`], undefined);
});

test("development keeps provider keys (they never leave your machine)", () => {
  const env: Record<string, string | undefined> = { NODE_ENV: "development", NEXT_PUBLIC_GROQ_API_KEY: "x" };
  prepareBuildEnv(env);
  assert.equal(env.NEXT_PUBLIC_GROQ_API_KEY, "x");
});

test("refuses a service_role JWT, a sb_secret_ key, or a secret-named variable", () => {
  for (const extra of [
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abc" },
    { NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "whatever" },
    { NEXT_PUBLIC_DB_PASSWORD: "whatever" },
  ]) {
    assert.throws(() => prepareBuildEnv({ NODE_ENV: "production", ...extra }), /Refusing to build/);
  }
});

test("the refusal names the variable but never prints the value", () => {
  assert.throws(() => prepareBuildEnv({ NODE_ENV: "production", NEXT_PUBLIC_X_SECRET: "super-secret-value" }), (e: Error) =>
    e.message.includes("NEXT_PUBLIC_X_SECRET") && !e.message.includes("super-secret-value"));
});

// A made-up project id stands in for the real retired one (only its fingerprint is stored in the repo).
const RETIRED_REF = "zyxwvutsrqponmlkjihg";
const RETIRED = [fingerprint(RETIRED_REF)];

test("a retired Supabase project is refused in development and production, before anything can contact it", () => {
  for (const NODE_ENV of ["development", "production"]) {
    for (const url of [`https://${RETIRED_REF}.supabase.co`, `https://${RETIRED_REF}.supabase.co/`, `https://${RETIRED_REF.toUpperCase()}.supabase.co/rest/v1`]) {
      assert.throws(() => prepareBuildEnv({ NODE_ENV, NEXT_PUBLIC_SUPABASE_URL: url }, RETIRED), (e: Error) => /retired/.test(e.message) && !e.message.includes(RETIRED_REF));
    }
  }
});

test("other projects, an unset URL and the mock host are not mistaken for the retired one", () => {
  for (const url of ["https://abcdefghijklmnopqrst.supabase.co", "https://mock-project.invalid", "", undefined]) {
    assert.doesNotThrow(() => prepareBuildEnv({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: url }, RETIRED));
    assert.equal(isRetiredUrl(url, RETIRED), false);
  }
  assert.equal(isRetiredUrl(`https://${RETIRED_REF}.supabase.co.evil.example`, RETIRED), false);
});
