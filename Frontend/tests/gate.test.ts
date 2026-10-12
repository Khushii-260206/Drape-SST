// The AuthGate decisions without React: which view shows for each session state, and that cleanup is settled before
// an account's screens can render. Runs the real forget/auth code against a stand-in localStorage and the MOCKED fake.
import { before, after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase } from "./fake-supabase";

const store = new Map<string, string>();
const methods = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as { localStorage?: unknown }).localStorage = new Proxy(methods, {
  ownKeys: () => [...store.keys()],
  getOwnPropertyDescriptor: (_t, k) => (typeof k === "string" && store.has(k) ? { enumerable: true, configurable: true, value: store.get(k) } : undefined),
});

const { accountToken, gateView, isKnownRoute, KNOWN_ROUTES, settleAccount } = await import("../src/lib/gate");
const { LAST_USER_KEY, ACTIVE_CHAT_KEY } = await import("../src/lib/forget");
const auth = await import("../src/lib/auth");

const A = { user: { id: "user-a" } };
const B = { user: { id: "user-b" } };
const view = (session: typeof A | null | undefined, token: string | null, settled: string | null, configured = true) =>
  gateView({ session, configured, token, settled });

describe("gateView: account screens never render before the account period is settled", () => {
  test("while the stored session is being read: loading", () => {
    assert.equal(view(undefined, null, null), "loading");
  });

  test("a signed-in session whose cleanup hasn't run yet is held on loading (no stale-data flash)", () => {
    const t = accountToken(1, "user-a");
    assert.equal(view(A, t, null), "loading");
    assert.equal(view(A, t, "0:user-a"), "loading", "an earlier period of the same account is not enough");
    assert.equal(view(A, t, t), "app");
  });

  test("account switch A -> B: B's period is unsettled until its cleanup ran, even though A was settled", () => {
    const a = accountToken(1, "user-a");
    const b = accountToken(2, "user-b");
    assert.equal(view(A, a, a), "app");
    assert.equal(view(B, b, a), "loading");
    assert.equal(view(B, b, b), "app");
  });

  test("sign-out then sign-in as the same user batched into one render is a new period (epoch differs)", () => {
    const first = accountToken(1, "user-a");
    const second = accountToken(3, "user-a");
    assert.notEqual(first, second);
    assert.equal(view(A, second, first), "loading");
  });

  test("signed out or failed refresh: the sign-in screen, regardless of what was settled before", () => {
    assert.equal(view(null, null, accountToken(1, "user-a")), "signin");
  });

  test("an unconfigured build explains itself instead of showing the app", () => {
    assert.equal(view(null, null, null, false), "unconfigured");
  });
});

describe("settleAccount (the effect body) against the browser's storage", () => {
  beforeEach(() => store.clear());
  const mine = ["drape:cache:v1:items", "drape:photo-urls:v1", "drape:identity", "drape:place:v1", ACTIVE_CHAT_KEY];
  const device = ["drape:theme", "drape:router:v1", "my-wardrobe:settings:v1"];

  test("switching accounts clears A's data before B can read it, and keeps device settings", () => {
    for (const k of [...mine, ...device]) store.set(k, "x");
    store.set(LAST_USER_KEY, "user-a");
    settleAccount("user-b");
    assert.deepEqual([...store.keys()].sort(), [...device, LAST_USER_KEY].sort());
    assert.equal(store.get(LAST_USER_KEY), "user-b");
  });

  test("restoring the same account's session keeps its cache (fast start) and device settings", () => {
    for (const k of [...mine, ...device]) store.set(k, "x");
    store.set(LAST_USER_KEY, "user-a");
    settleAccount("user-a");
    assert.ok([...mine, ...device].every((k) => store.has(k)));
  });

  test("no session (signed out, other tab signed out, or refresh failed) clears the account state and keeps device settings", () => {
    for (const k of [...mine, ...device]) store.set(k, "x");
    store.set(LAST_USER_KEY, "user-a");
    settleAccount(undefined);
    assert.deepEqual([...store.keys()].sort(), [...device].sort());
  });

  test("running twice in a row (React Strict Mode) is the same as running once", () => {
    for (const k of [...mine, ...device]) store.set(k, "x");
    store.set(LAST_USER_KEY, "user-a");
    settleAccount("user-b");
    const once = JSON.stringify([...store].sort());
    settleAccount("user-b");
    assert.equal(JSON.stringify([...store].sort()), once);
  });

  test("a stale cache left by a failed refresh on a previous visit is gone once the signed-out effect runs", () => {
    store.set("drape:cache:v1:items", "[stale]");
    store.set(LAST_USER_KEY, "user-a");
    settleAccount(undefined);
    assert.equal(store.has("drape:cache:v1:items"), false);
  });
});

describe("account epoch (MOCKED Supabase Auth)", () => {
  const fake = new FakeSupabase();
  before(() => fake.install());
  after(() => fake.uninstall());

  test("changes on sign-in, sign-out and account switch", async () => {
    const e0 = auth.currentAccountEpoch();
    await auth.signUp("asha@example.com", "correct-horse");
    const e1 = auth.currentAccountEpoch();
    assert.ok(e1 > e0, "sign-in must start a new period");
    await auth.signOut();
    const e2 = auth.currentAccountEpoch();
    assert.ok(e2 > e1, "sign-out must end the period");
    await auth.signUp("bea@example.com", "correct-horse");
    assert.ok(auth.currentAccountEpoch() > e2, "a different account is a new period");
    await auth.signOut();
  });

  test("the same account's session being re-announced (token refresh) does not start a new period", async () => {
    await auth.signIn("asha@example.com", "correct-horse");
    const e = auth.currentAccountEpoch();
    await auth.signIn("asha@example.com", "correct-horse"); // same user id again
    assert.equal(auth.currentAccountEpoch(), e);
    await auth.signOut();
  });
});

describe("gateView: password reset", () => {
  test("a reset link's temporary session shows the new-password screen, never the app", () => {
    assert.equal(gateView({ session: A, configured: true, token: "1:user-a", settled: "1:user-a", recovery: "ready" }), "reset");
  });
  test("with no reset pending, or an invalid link, the normal views apply", () => {
    assert.equal(gateView({ session: A, configured: true, token: "1:user-a", settled: "1:user-a", recovery: "idle" }), "app");
    assert.equal(gateView({ session: null, configured: true, token: null, settled: null, recovery: "invalid" }), "signin");
    assert.equal(gateView({ session: undefined, configured: true, token: null, settled: null, recovery: "ready" }), "loading");
  });
});

describe("isKnownRoute: signed-out visitors get the not-found page for addresses that aren't pages", () => {
  test("every page folder under src/app is listed, and nothing else", async () => {
    const { readdirSync, existsSync } = await import("node:fs");
    const appDir = new URL("../src/app/", import.meta.url);
    const pages = readdirSync(appDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(new URL(`${e.name}/page.tsx`, appDir)))
      .map((e) => "/" + e.name);
    assert.deepEqual([...KNOWN_ROUTES].sort(), ["/", ...pages].sort());
  });
  test("known pages match with or without a trailing slash; anything else does not", () => {
    for (const r of ["/", "/wardrobe", "/wardrobe/", "/outfits/", "/profile/", "/settings/"]) assert.equal(isKnownRoute(r), true, r);
    for (const r of ["/does-not-exist", "/does-not-exist/", "/wardrobe/x/", "/Wardrobe/", "/index.html"]) assert.equal(isKnownRoute(r), false, r);
  });
});
