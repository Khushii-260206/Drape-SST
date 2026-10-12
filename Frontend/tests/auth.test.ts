// MOCKED: runs the real sign-in code (src/lib/auth.ts) and data layer against the in-memory fake in fake-supabase.ts,
// which imitates Supabase Auth and the owner-only policies. It shows the app sends the right tokens and paths;
// it does not prove a real Supabase project enforces anything.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, photo } from "./fake-supabase";
import type { ClothingItem } from "../src/lib/types";

const auth = await import("../src/lib/auth");
const db = await import("../src/lib/db");
const { sb } = await import("../src/lib/supabase");
const photosForget = (await import("../src/lib/photos")).forgetPhotos;

const fake = new FakeSupabase();
before(() => fake.install());
after(() => fake.uninstall());

const item = (id: string): ClothingItem => ({
  id, type: "tshirt", category: "top", colors: ["black"], description: "", hasBack: false,
  favorite: false, wearCount: 0, lastWorn: null, createdAt: 1000, updatedAt: 1000,
});
const add = (i: ClothingItem) => db.mutateItems((cur) => [i, ...cur], { put: [{ id: i.id, side: "front", blob: photo() }] });

describe("sign-in (MOCKED Supabase Auth)", () => {
  test("nothing is readable or writable before signing in", async () => {
    await assert.rejects(db.loadItems(), /./);
    await assert.rejects(add(item("aaaaaaaa")), /signed out/i);
    assert.equal(fake.tables.items.length, 0);
    assert.equal(fake.objects.size, 0);
  });

  test("bad input is refused before any request is made", async () => {
    const before = fake.log.length;
    await assert.rejects(auth.signUp("not-an-email", "long-enough-pw"), /valid email/i);
    await assert.rejects(auth.signUp("a@example.com", "short"), /at least 8/);
    await assert.rejects(auth.signIn("a@example.com", ""), /at least 8/);
    assert.equal(fake.log.length, before);
  });

  test("create an account, sign out, and a wrong password says so", async () => {
    const r = await auth.signUp("Asha@Example.com", "correct-horse");
    assert.equal(r.confirmEmail, false);
    assert.ok(auth.requireUserId());
    await auth.signOut();
    assert.throws(() => auth.requireUserId(), /signed out/i);
    assert.ok(fake.log.some((l) => l === "POST /auth/v1/logout?scope=local"), "sign-out must only end this browser's session: " + fake.log.join(" | "));
    await assert.rejects(auth.signIn("asha@example.com", "wrong-password"), /don't match/);
    await auth.signIn("asha@example.com", "correct-horse");
    assert.ok(auth.requireUserId());
    await auth.signOut();
  });

  test("an address that is already registered is reported", async () => {
    await assert.rejects(auth.signUp("asha@example.com", "another-password"), /already an account/);
  });

  test("when the project wants email confirmation, no session starts", async () => {
    fake.faults.confirmEmail = true;
    try {
      const r = await auth.signUp("new@example.com", "correct-horse");
      assert.equal(r.confirmEmail, true);
      assert.throws(() => auth.requireUserId(), /signed out/i);
    } finally {
      fake.faults.confirmEmail = false;
    }
  });
});

describe("sign-up and sign-out edge cases (MOCKED Supabase Auth)", () => {
  test("the confirmation e-mail is told to link back to this site, including its sub-path", async () => {
    const g = globalThis as { location?: unknown };
    g.location = { origin: "https://khushi.github.io" };
    process.env.NEXT_PUBLIC_BASE_PATH = "/wardrobe";
    const mark = fake.log.length;
    try {
      await auth.signUp("redirect@example.com", "correct-horse");
      const call = fake.log.slice(mark).find((l) => l.includes("/auth/v1/signup"));
      assert.ok(call && decodeURIComponent(call).includes("redirect_to=https://khushi.github.io/wardrobe/"), `signup call was: ${call}`);
    } finally {
      delete g.location;
      delete process.env.NEXT_PUBLIC_BASE_PATH;
      await auth.signOut();
    }
  });

  test("a session that ends while a save is in flight doesn't turn a completed save into an error", async () => {
    await auth.signIn("asha@example.com", "correct-horse");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await inner(input, init);
      if (String(input instanceof Request ? input.url : input).includes("/rest/v1/items") && (init?.method ?? "GET") === "POST") await gate;
      return res;
    }) as typeof fetch;
    try {
      const saving = add(item("cccccccc"));
      await new Promise((r) => setTimeout(r, 50));
      await auth.signOut(); // e.g. signed out in another tab
      release();
      const saved = await saving;
      assert.ok(saved.some((i) => i.id === "cccccccc"), "the save should still report what was committed");
      assert.doesNotThrow(() => photosForget("cccccccc"), "forgetting photos while signed out must not throw");
    } finally {
      globalThis.fetch = inner;
    }
    await auth.signIn("asha@example.com", "correct-horse");
    assert.ok((await db.loadItems()).some((i) => i.id === "cccccccc"), "the committed piece is in the database");
    await db.clearEverything(); // leave A's data as the next test expects
    await add(item("aaaaaaaa"));
    await auth.signOut();
  });
});

describe("accounts are separate (MOCKED owner-only policies)", () => {
  test("a second account sees none of the first one's pieces or photos, and cannot write into them", async () => {
    await auth.signIn("asha@example.com", "correct-horse");
    const asha = auth.requireUserId();
    await add(item("aaaaaaaa"));
    await db.saveProfile({ ...(await db.loadProfile()), name: "Asha" });
    assert.ok(fake.objects.has(`${asha}/aaaaaaaa/front`), "photo is stored under the user's own folder");
    assert.equal(fake.tables.items[0].user_id, asha);
    await auth.signOut();

    await auth.signUp("bea@example.com", "correct-horse");
    const bea = auth.requireUserId();
    assert.notEqual(bea, asha);
    assert.deepEqual(await db.loadItems(), []);
    assert.equal((await db.loadProfile()).name, "");

    // B uses the same piece id: it is a different piece, and A's photo is untouched.
    await add(item("aaaaaaaa"));
    assert.ok(fake.objects.has(`${bea}/aaaaaaaa/front`));
    assert.equal(fake.tables.items.length, 2);

    // Writing a row or a photo that claims to be A's is refused.
    const { error } = await sb().from("items").upsert({ ...fake.tables.items[0], user_id: asha, id: "bbbbbbbb" }, { onConflict: "user_id,id" });
    assert.ok(error, "cross-account row write must be refused");
    const up = await sb().storage.from("wardrobe").upload(`${asha}/bbbbbbbb/front`, photo(), { contentType: "image/jpeg" });
    assert.ok(up.error, "cross-account photo write must be refused");

    // B clearing everything leaves A's data alone.
    await db.clearEverything();
    assert.equal(fake.tables.items.length, 1);
    assert.ok(fake.objects.has(`${asha}/aaaaaaaa/front`));
    await auth.signOut();

    await auth.signIn("asha@example.com", "correct-horse");
    assert.deepEqual((await db.loadItems()).map((i) => i.id), ["aaaaaaaa"]);
    assert.equal((await db.loadProfile()).name, "Asha");
  });
});

describe("sign-in error wording", () => {
  test("an email-sending limit says to use the email already sent or wait up to an hour", () => {
    const msg = auth.explain("email rate limit exceeded");
    assert.match(msg, /confirmation emails/);
    assert.match(msg, /up to an hour/);
  });
  test("other rate limits keep the short wait message", () => {
    assert.match(auth.explain("Request rate limit reached"), /Wait a minute/);
  });
});

describe("rate limits and network failures (MOCKED Supabase Auth)", () => {
  test("a 429 from the e-mail limit is explained, and sign-up then pauses instead of retrying", async () => {
    const store = new Map<string, string>();
    const g = globalThis as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    fake.faults.emailRateLimit = true;
    try {
      const mark = fake.log.length;
      await assert.rejects(auth.signUp("limited@example.com", "correct-horse"), /confirmation emails.*up to an hour/);
      await assert.rejects(auth.signUp("limited@example.com", "correct-horse"), /paused.*try again in \d+ min/);
      assert.equal(fake.log.slice(mark).filter((l) => l.includes("/auth/v1/signup")).length, 1, "only the first attempt may reach Supabase");
      await assert.rejects(auth.signIn("asha@example.com", "wrong-password"), /don't match/); // signing in is unaffected
    } finally {
      fake.faults.emailRateLimit = false;
      g.localStorage = prev;
    }
  });
  test("codes and status decide the wording, not just the text", () => {
    assert.match(auth.explain("x", { code: "over_email_send_rate_limit" }), /confirmation emails/);
    assert.match(auth.explain("x", { code: "over_request_rate_limit", status: 429 }), /Wait a minute/);
    assert.match(auth.explain("x", { code: "email_not_confirmed" }), /Confirm your email/);
    assert.match(auth.explain("x", { code: "invalid_credentials" }), /don't match/);
    assert.match(auth.explain("Failed to fetch", { name: "AuthRetryableFetchError", status: 0 }), /reach the server/);
  });
});

describe("password reset (MOCKED Supabase Auth)", () => {
  before(async () => { await auth.signOut(); }); // earlier suites may leave an account signed in
  const withStorage = async (fn: () => Promise<void>) => {
    const store = new Map<string, string>();
    const g = globalThis as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    try { await fn(); } finally { g.localStorage = prev; }
  };
  const calls = (mark: number, what: string) => fake.log.slice(mark).filter((l) => l.includes(what)).length;

  test("requesting a reset validates the address, sends one email, and asks the link to come back to this site", async () => {
    await withStorage(async () => {
      const g = globalThis as { location?: unknown };
      g.location = { origin: "https://khushi.github.io" };
      process.env.NEXT_PUBLIC_BASE_PATH = "/wardrobe";
      const mark = fake.log.length;
      try {
        await assert.rejects(auth.requestPasswordReset("nope"), /valid email/i);
        assert.equal(calls(mark, "/auth/v1/recover"), 0);
        await auth.requestPasswordReset("asha@example.com");
        assert.equal(calls(mark, "/auth/v1/recover"), 1);
        // a second click right away does not send another email
        await assert.rejects(auth.requestPasswordReset("asha@example.com"), /requested recently.*\d+ min/);
        assert.equal(calls(mark, "/auth/v1/recover"), 1);
      } finally {
        delete g.location;
        delete process.env.NEXT_PUBLIC_BASE_PATH;
      }
    });
  });

  test("an unknown address gets the same answer as a known one", async () => {
    await withStorage(async () => { await auth.requestPasswordReset("nobody@example.com"); });
  });

  test("the email rate limit is explained and blocks further requests", async () => {
    await withStorage(async () => {
      fake.faults.emailRateLimit = true;
      try {
        const mark = fake.log.length;
        await assert.rejects(auth.requestPasswordReset("asha@example.com"), /confirmation emails.*up to an hour/);
        await assert.rejects(auth.requestPasswordReset("asha@example.com"), /try again in \d+ min/);
        assert.equal(calls(mark, "/auth/v1/recover"), 1);
      } finally {
        fake.faults.emailRateLimit = false;
      }
    });
  });

  test("link fragments: recovery, errors, and unrelated hashes are told apart", () => {
    assert.deepEqual(auth.parseAuthHash("#access_token=a&refresh_token=r&type=recovery&expires_in=3600"), { kind: "recovery", access_token: "a", refresh_token: "r" });
    const expired = auth.parseAuthHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    assert.equal(expired?.kind, "error");
    assert.match((expired as { message: string }).message, /expired or was already used/);
    assert.equal(auth.parseAuthHash("#/wardrobe"), null);
    assert.equal(auth.parseAuthHash(""), null);
    assert.equal(auth.parseAuthHash("#access_token=a&type=recovery"), null); // no refresh token: not usable
  });

  test("an expired link shows a notice and starts no session", async () => {
    assert.equal(await auth.handleAuthLink("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"), true);
    assert.equal(auth.currentRecovery().kind, "invalid");
    assert.throws(() => auth.requireUserId(), /signed out/i);
    auth.dismissRecovery();
    assert.equal(auth.currentRecovery().kind, "idle");
  });

  test("a garbage token is rejected as an invalid link", async () => {
    await auth.handleAuthLink("#access_token=garbage&refresh_token=garbage&type=recovery");
    assert.equal(auth.currentRecovery().kind, "invalid");
    assert.throws(() => auth.requireUserId(), /signed out/i);
    auth.dismissRecovery();
  });

  test("a valid link opens the reset step; passwords are validated; the new password then works", async () => {
    // What the e-mailed link carries: a session for the account.
    await auth.signIn("asha@example.com", "correct-horse");
    const { accessToken } = auth;
    const access = (await accessToken())!;
    await auth.signOut();
    assert.throws(() => auth.requireUserId(), /signed out/i);

    await auth.handleAuthLink(`#access_token=${access}&refresh_token=refresh-${JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString()).sub}&type=recovery`);
    assert.equal(auth.currentRecovery().kind, "ready");
    assert.ok(auth.requireUserId(), "the link's session is active");

    await assert.rejects(auth.completePasswordReset("short", "short"), /at least 8/);
    await assert.rejects(auth.completePasswordReset("new-password-1", "new-password-2"), /don't match/);
    await assert.rejects(auth.completePasswordReset("correct-horse", "correct-horse"), /haven't used before|differ/);
    assert.equal(auth.currentRecovery().kind, "ready", "a failed attempt keeps the form open");

    await auth.completePasswordReset("brand-new-pass", "brand-new-pass");
    assert.equal(auth.currentRecovery().kind, "idle");
    assert.ok(auth.requireUserId(), "signed in after resetting");

    await auth.signOut();
    await assert.rejects(auth.signIn("asha@example.com", "correct-horse"), /don't match/);
    await auth.signIn("asha@example.com", "brand-new-pass");
    await auth.signOut();
  });

  test("cancelling the reset ends the temporary session", async () => {
    await auth.signIn("asha@example.com", "brand-new-pass");
    const access = (await auth.accessToken())!;
    const sub = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString()).sub;
    await auth.signOut();
    await auth.handleAuthLink(`#access_token=${access}&refresh_token=refresh-${sub}&type=recovery`);
    assert.equal(auth.currentRecovery().kind, "ready");
    await auth.cancelRecovery();
    assert.equal(auth.currentRecovery().kind, "idle");
    assert.throws(() => auth.requireUserId(), /signed out/i);
  });
});

describe("sign-out when the server can't be reached (MOCKED Supabase Auth)", () => {
  for (const fault of ["network", "server-error"] as const) {
    test(`logout request fails (${fault}): this browser is still signed out for good`, async () => {
      await auth.signUp(`out-${fault}@example.com`, "correct-horse");
      assert.ok(await auth.accessToken());
      fake.faults.logout = fault;
      try {
        await auth.signOut().catch(() => {});
      } finally {
        fake.faults.logout = undefined;
      }
      assert.equal(auth.hasSession(), false);
      assert.equal(await auth.accessToken(), undefined, "the stored session must be gone, or a reload would sign the user back in");
    });
  }
});

describe("password policy wording follows the server's reasons", () => {
  test("length, characters and breached-password reasons each get their own advice", () => {
    assert.match(auth.explain("x", { code: "weak_password", reasons: ["length"] }), /at least 8 characters/);
    assert.match(auth.explain("x", { code: "weak_password", reasons: ["characters"] }), /upper- and lower-case/);
    assert.match(auth.explain("x", { code: "weak_password", reasons: ["pwned"] }), /data breach/);
    assert.match(auth.explain("x", { code: "weak_password", reasons: ["length", "characters"] }), /upper.*at least 8/);
    assert.match(auth.explain("Password should be at least 6 characters.", { code: "weak_password" }), /at least 8 characters/);
  });
});
