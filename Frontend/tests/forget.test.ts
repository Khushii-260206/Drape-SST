// Runs the real forgetAccountState() against a stand-in localStorage: what the account left in the browser goes,
// device settings (theme, pasted AI keys) stay.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

const store = new Map<string, string>();
const methods = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
// clearCache() enumerates with Object.keys(localStorage), so expose the entries as properties too.
(globalThis as { localStorage?: unknown }).localStorage = new Proxy(methods, {
  ownKeys: () => [...store.keys()],
  getOwnPropertyDescriptor: (_t, k) => (typeof k === "string" && store.has(k) ? { enumerable: true, configurable: true, value: store.get(k) } : undefined),
});

const { forgetAccountState, forgetPreviousAccount, ACTIVE_CHAT_KEY, LAST_USER_KEY } = await import("../src/lib/forget");

describe("forgetAccountState", () => {
  beforeEach(() => store.clear());

  test("removes everything the account left behind", () => {
    for (const k of ["drape:cache:v1:items", "drape:cache:v1:profile", "drape:photo-urls:v1", "drape:identity", "drape:place:v1", "drape:weather:v1", ACTIVE_CHAT_KEY, LAST_USER_KEY]) store.set(k, "x");
    forgetAccountState();
    assert.deepEqual([...store.keys()], []);
  });

  test("keeps device settings: theme, provider cooldowns and pasted AI keys", () => {
    for (const k of ["drape:theme", "drape:router:v1", "my-wardrobe:settings:v1"]) store.set(k, "x");
    forgetAccountState();
    assert.deepEqual([...store.keys()].sort(), ["drape:router:v1", "drape:theme", "my-wardrobe:settings:v1"]);
  });
});

describe("forgetPreviousAccount", () => {
  beforeEach(() => store.clear());
  const leftovers = () => ["drape:cache:v1:items", "drape:photo-urls:v1", "drape:identity", "drape:place:v1", ACTIVE_CHAT_KEY];

  test("a different account than last time clears everything the old one left, and records the new one", () => {
    for (const k of leftovers()) store.set(k, "x");
    store.set(LAST_USER_KEY, "user-a");
    store.set("drape:theme", "dark");
    forgetPreviousAccount("user-b");
    assert.deepEqual([...store.keys()].sort(), [LAST_USER_KEY, "drape:theme"].sort());
    assert.equal(store.get(LAST_USER_KEY), "user-b");
  });

  test("the same account again changes nothing (so React Strict Mode's repeated effect is safe)", () => {
    store.set(LAST_USER_KEY, "user-a");
    for (const k of leftovers()) store.set(k, "x");
    forgetPreviousAccount("user-a");
    forgetPreviousAccount("user-a");
    assert.ok(leftovers().every((k) => store.has(k)));
  });

  test("the first sign-in on a browser drops cached data but keeps the display name and city", () => {
    for (const k of leftovers()) store.set(k, "x");
    forgetPreviousAccount("user-a");
    assert.ok(store.has("drape:identity") && store.has("drape:place:v1") && store.has(ACTIVE_CHAT_KEY));
    assert.ok(!store.has("drape:cache:v1:items") && !store.has("drape:photo-urls:v1"));
    assert.equal(store.get(LAST_USER_KEY), "user-a");
  });

  test("forgetAccountState is idempotent", () => {
    for (const k of leftovers()) store.set(k, "x");
    forgetAccountState();
    forgetAccountState();
    assert.deepEqual([...store.keys()], []);
  });
});
