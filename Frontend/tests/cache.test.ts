// MOCKED Supabase Auth, real cache code: a save that finishes after sign-out must not write the account's data back
// into the browser once it has been forgotten.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase } from "./fake-supabase";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = new Proxy(
  {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
  {
    ownKeys: () => [...store.keys()],
    getOwnPropertyDescriptor: (_t, k) => (typeof k === "string" && store.has(k) ? { enumerable: true, configurable: true, value: store.get(k) } : undefined),
  }
);

const auth = await import("../src/lib/auth");
const { readCache, writeCache, clearCache, isProfile } = await import("../src/lib/cache");
const { forgetAccountState } = await import("../src/lib/forget");

const fake = new FakeSupabase();
before(() => fake.install());
after(() => fake.uninstall());

const profile = { name: "Asha", vibes: [] };

describe("cache writes follow the session (MOCKED Supabase Auth)", () => {
  test("while signed in the cache is written and read back", async () => {
    await auth.signUp("cache@example.com", "correct-horse");
    writeCache("profile", profile);
    assert.deepEqual(readCache("profile", isProfile), profile);
  });

  test("after sign-out a late write is ignored, so forgetting the account really leaves nothing behind", async () => {
    await auth.signOut();
    forgetAccountState();
    writeCache("items", [{ id: "aaaaaaaa" }]); // e.g. a save that was still in flight when the session ended
    writeCache("profile", profile);
    assert.deepEqual([...store.keys()].filter((k) => k.startsWith("drape:cache:")), []);
  });

  test("clearing still works while signed out", () => {
    store.set("drape:cache:v1:items", "[]");
    clearCache();
    assert.equal(store.size, 0);
  });
});
