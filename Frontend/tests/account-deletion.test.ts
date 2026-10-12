// MOCKED: (1) the real deletion procedure (Backend/supabase/functions/delete-account/core.ts) against a recording fake admin, and
// (2) the real client flow (src/lib/auth.ts deleteAccount) against the in-memory Supabase fake, whose delete-account route
// runs that same core.ts. This proves ownership scoping, ordering, confirmation, freshness and failure handling.
// NOT VERIFIED here: the Deno entry point (index.ts), the real Edge Function deployment, the real service-role client,
// real storage listing and the real Auth admin API. Those need a live Supabase project.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, photo } from "./fake-supabase";
import {
  DeletionError, TABLES_IN_ORDER, deleteAccount as runDeletion, isFresh, tokenIssuedAt, type Admin,
} from "../../Backend/supabase/functions/delete-account/core";
import type { ClothingItem } from "../src/lib/types";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

/** A fake admin that records every call and holds a pretend bucket. */
function recorder(files: string[], fail: Partial<Record<"list" | "remove" | "rows" | "user", string>> = {}) {
  const calls: string[] = [];
  const bucket = new Set(files);
  const admin: Admin = {
    async listStorage(folder, offset, limit) {
      calls.push(`list ${folder}@${offset}`);
      if (fail.list) throw new Error(fail.list);
      const prefix = folder + "/";
      const names = new Map<string, boolean>();
      for (const p of [...bucket].sort()) if (p.startsWith(prefix)) { const [first, ...more] = p.slice(prefix.length).split("/"); names.set(first, more.length > 0); }
      return [...names].slice(offset, offset + limit).map(([name, isFolder]) => ({ name, isFolder }));
    },
    async removeStorage(paths) {
      calls.push(`remove ${paths.length}`);
      if (fail.remove) throw new Error(fail.remove);
      for (const p of paths) bucket.delete(p);
    },
    async deleteRows(table, userId) {
      calls.push(`rows ${table} ${userId === A ? "A" : userId}`);
      if (fail.rows) throw new Error(fail.rows);
    },
    async deleteUser(userId) {
      calls.push(`user ${userId === A ? "A" : userId}`);
      if (fail.user) throw new Error(fail.user);
    },
  };
  return { admin, calls, bucket };
}

describe("deletion procedure (core.ts, MOCKED admin)", () => {
  test("photos first, then rows child-before-parent, then the auth user, all for this user only", async () => {
    const files = [`${A}/aaaaaaaa/front`, `${A}/aaaaaaaa/front_sm`, `${A}/bbbbbbbb/back`, `${B}/cccccccc/front`];
    const { admin, calls, bucket } = recorder(files);
    const r = await runDeletion(admin, A);
    assert.equal(r.removedFiles, 3);
    assert.deepEqual([...bucket], [`${B}/cccccccc/front`], "another account's photo must survive");
    const order = calls.filter((c) => !c.startsWith("list"));
    assert.deepEqual(order, ["remove 3", ...TABLES_IN_ORDER.map((t) => `rows ${t} A`), "user A"]);
    assert.ok(calls.every((c) => !c.startsWith("list") || c.startsWith(`list ${A}`)), "only the user's own folder is ever listed: " + calls.join(" | "));
    assert.deepEqual([...TABLES_IN_ORDER], ["chat_messages", "chats", "outfits", "items", "profile"]);
  });

  test("a large closet (250 photos across pages) is fully removed in batches", async () => {
    const files = Array.from({ length: 250 }, (_, i) => `${A}/${String(i).padStart(8, "0")}/front`);
    const { admin, bucket, calls } = recorder(files);
    const r = await runDeletion(admin, A);
    assert.equal(r.removedFiles, 250);
    assert.equal(bucket.size, 0);
    assert.ok(calls.filter((c) => c.startsWith("remove")).every((c) => Number(c.split(" ")[1]) <= 100));
  });

  test("a photo failure stops everything: no rows touched, the account is NOT deleted, stage is 'storage'", async () => {
    const { admin, calls } = recorder([`${A}/aaaaaaaa/front`], { remove: "boom" });
    await assert.rejects(runDeletion(admin, A), (e: unknown) => e instanceof DeletionError && e.stage === "storage");
    assert.ok(!calls.some((c) => c.startsWith("rows") || c.startsWith("user")), calls.join(" | "));
  });

  test("a listing failure is also a storage failure", async () => {
    const { admin, calls } = recorder([], { list: "offline" });
    await assert.rejects(runDeletion(admin, A), (e: unknown) => e instanceof DeletionError && e.stage === "storage");
    assert.ok(!calls.some((c) => c.startsWith("user")));
  });

  test("a row failure stops before the auth user: stage 'data'", async () => {
    const { admin, calls } = recorder([], { rows: "locked" });
    await assert.rejects(runDeletion(admin, A), (e: unknown) => e instanceof DeletionError && e.stage === "data");
    assert.ok(!calls.some((c) => c.startsWith("user")));
  });

  test("an auth-user failure after the data is gone reports stage 'account' and says so", async () => {
    const { admin } = recorder([], { user: "admin down" });
    await assert.rejects(runDeletion(admin, A), (e: unknown) => e instanceof DeletionError && e.stage === "account" && /data was removed/.test(e.message));
  });

  test("retrying after a failure finishes the job (every step is idempotent)", async () => {
    const files = [`${A}/aaaaaaaa/front`];
    const first = recorder(files, { rows: "locked" });
    await assert.rejects(runDeletion(first.admin, A));
    const second = recorder([...first.bucket]); // photos already gone
    const r = await runDeletion(second.admin, A);
    assert.equal(r.removedFiles, 0);
    assert.ok(second.calls.includes("user A"));
  });

  test("a storage that keeps reporting files after removal is an error, not an endless loop", async () => {
    const stubborn: Admin = { ...recorder([]).admin, listStorage: async (f, o) => (o === 0 ? [{ name: "x", isFolder: false }] : []), removeStorage: async () => {} };
    await assert.rejects(runDeletion(stubborn, A), (e: unknown) => e instanceof DeletionError && e.stage === "storage");
  });

  test("an id that is not a UUID is refused before anything runs; a path outside the folder is never removed", async () => {
    const { admin, calls } = recorder([]);
    for (const bad of ["", "*", "../x", `${A}/../${B}`, "a'; drop table items;--"]) await assert.rejects(runDeletion(admin, bad), DeletionError);
    assert.equal(calls.length, 0);
    const leaky: Admin = { ...admin, listStorage: async (f, o) => (o === 0 && f === A ? [{ name: "../x", isFolder: false }] : []) };
    await assert.rejects(runDeletion(leaky, A), /outside|storage/i);
  });

  test("freshness: only a token issued in the last 5 minutes may delete", () => {
    const tok = (iat: number) => `h.${Buffer.from(JSON.stringify({ iat })).toString("base64url")}.s`;
    const now = 1_000_000;
    assert.equal(isFresh(tok(now - 60), now), true);
    assert.equal(isFresh(tok(now - 6 * 60), now), false);
    assert.equal(isFresh(tok(now + 3600), now), false, "a token from the future is not fresh");
    assert.equal(isFresh("garbage", now), false);
    assert.equal(tokenIssuedAt("a.b.c"), null);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

const auth = await import("../src/lib/auth");
const db = await import("../src/lib/db");
const fake = new FakeSupabase();
before(() => fake.install());
after(() => fake.uninstall());

const item = (id: string): ClothingItem => ({
  id, type: "tshirt", category: "top", colors: ["black"], description: "", hasBack: false,
  favorite: false, wearCount: 0, lastWorn: null, createdAt: 1000, updatedAt: 1000,
});
async function seed(email: string, ids: string[]) {
  await auth.signUp(email, "correct-horse");
  return populate(ids);
}
async function populate(ids: string[]) {
  const uid = auth.requireUserId();
  await db.mutateItems((cur) => [...ids.map(item), ...cur], { put: ids.map((id) => ({ id, side: "front" as const, blob: photo() })) });
  fake.tables.outfits.push({ user_id: uid, id: ids[0], name: "Look", item_ids: [ids[0]], note: "", created_at: 1, worn_count: 0, last_worn: null });
  fake.tables.chats.push({ user_id: uid, id: ids[0], title: "Chat", created_at: 1, updated_at: 1 });
  fake.tables.chat_messages.push({ user_id: uid, id: "m" + ids[0], chat_id: ids[0], role: "user", content: "hi", created_at: 1 });
  fake.tables.profile.push({ user_id: uid, data: {}, updated_at: 1 });
  return uid;
}
const rowsOf = (uid: string) => Object.values(fake.tables).flat().filter((r) => r.user_id === uid).length;
const filesOf = (uid: string) => [...fake.objects.keys()].filter((p) => p.startsWith(uid + "/")).length;

describe("delete account, client + function (MOCKED Supabase)", () => {
  let aliceId = "";
  let bobId = "";
  before(async () => {
    bobId = await seed("bob@example.com", ["bbbbbbbb"]);
    await auth.signOut();
    aliceId = await seed("alice@example.com", ["aaaaaaaa", "a1a1a1a1"]);
  });

  test("seeded: both accounts have rows and photos", () => {
    assert.ok(rowsOf(aliceId) >= 6 && filesOf(aliceId) >= 2);
    assert.ok(rowsOf(bobId) >= 4 && filesOf(bobId) >= 1);
  });

  test("an empty password is refused locally; a wrong password is refused and nothing is deleted or called", async () => {
    const mark = fake.log.length;
    await assert.rejects(auth.deleteAccount(""), /Enter your password/);
    await assert.rejects(auth.deleteAccount("wrong-password"), (e: Error & { kind?: string }) => e.kind === "password" && /isn't right/.test(e.message));
    assert.ok(!fake.log.slice(mark).some((l) => l.includes("/functions/")), "the function must not be called without a verified password");
    assert.ok(rowsOf(aliceId) > 0 && filesOf(aliceId) > 0);
  });

  const failures: [NonNullable<typeof fake.faults.deleteAccount>, RegExp, string][] = [
    ["not-deployed", /isn't set up on this Supabase project/, "not-deployed"],
    ["network", /can't tell whether the deletion finished/, "network"],
    ["storage", /Couldn.t remove your photos[\s\S]*press Delete again/, "partial"],
    ["data", /Couldn.t remove your items[\s\S]*still exists/, "partial"],
    ["user", /data was removed but the account itself/, "partial"],
  ];
  for (const [fault, message, kind] of failures) {
    test(`function fault '${fault}': a clear message, the right kind, and the session stays signed in`, async () => {
      fake.faults.deleteAccount = fault;
      try {
        await assert.rejects(auth.deleteAccount("correct-horse"), (e: Error & { kind?: string }) => message.test(e.message) && e.kind === kind);
      } finally {
        fake.faults.deleteAccount = undefined;
      }
      assert.ok(auth.hasSession(), "a failed deletion must not sign the user out");
      assert.ok(fake.users.has("alice@example.com"), "the account must still exist");
    });
  }

  test("(the 'user' fault above had already removed her data, as designed: put some back for the next checks)", async () => {
    assert.equal(rowsOf(aliceId), 0, "the partial deletion really did remove the data before the account step failed");
    await populate(["aaaaaaaa", "a1a1a1a1"]);
    assert.ok(rowsOf(aliceId) >= 6 && filesOf(aliceId) >= 2);
  });

  test("a storage failure leaves rows and the account untouched (nothing partially deleted past the failing step)", async () => {
    const before = rowsOf(aliceId);
    fake.faults.deleteAccount = "storage";
    await assert.rejects(auth.deleteAccount("correct-horse"));
    fake.faults.deleteAccount = undefined;
    assert.equal(rowsOf(aliceId), before);
  });

  test("the function itself refuses a missing confirmation and a stale token", async () => {
    const token = (await auth.accessToken())!;
    const call = (body: unknown, t = token) => fetch("https://mock-project.invalid/functions/v1/delete-account", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await call({})).status, 400);
    assert.equal((await call({ confirm: "yes" })).status, 400);
    const anon = await fetch("https://mock-project.invalid/functions/v1/delete-account", { method: "POST", body: JSON.stringify({ confirm: "DELETE" }) });
    assert.equal(anon.status, 401);
    fake.faults.deleteAccount = "stale-token";
    const stale = await call({ confirm: "DELETE" });
    fake.faults.deleteAccount = undefined;
    assert.equal(stale.status, 403);
    assert.equal(((await stale.json()) as { reauthenticate?: boolean }).reauthenticate, true);
    assert.ok(rowsOf(aliceId) > 0);
  });

  test("success: all of Alice's rows and photos and her sign-in are gone, Bob's are untouched, and she is signed out", async () => {
    const bobRows = rowsOf(bobId);
    const bobFiles = filesOf(bobId);
    await auth.deleteAccount("correct-horse");
    assert.equal(rowsOf(aliceId), 0);
    assert.equal(filesOf(aliceId), 0);
    assert.equal(rowsOf(bobId), bobRows, "another account's rows must not be touched");
    assert.equal(filesOf(bobId), bobFiles, "another account's photos must not be touched");
    assert.equal(fake.users.has("alice@example.com"), false);
    assert.equal(auth.hasSession(), false);
    assert.equal(await auth.accessToken(), undefined);
    await assert.rejects(auth.signIn("alice@example.com", "correct-horse"), /don't match/);
    assert.equal(auth.consumeDeletedNotice(), false, "sessionStorage is absent in Node, so no notice (the browser test covers it)");
  });

  test("when nobody is signed in, deletion is refused", async () => {
    await assert.rejects(auth.deleteAccount("correct-horse"), /signed out/i);
  });

  test("the browser bundle never needs a privileged key: the client sends only the anon key and the user's own token", async () => {
    await auth.signIn("bob@example.com", "correct-horse");
    const seen: { apikey: string | null; authz: string | null }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/functions/")) { const h = new Headers(init?.headers); seen.push({ apikey: h.get("apikey"), authz: h.get("authorization") }); }
      return real(input, init);
    }) as typeof fetch;
    try { await auth.deleteAccount("correct-horse"); } finally { globalThis.fetch = real; }
    assert.equal(seen.length, 1);
    assert.equal(seen[0].apikey, "mock-anon-key");
    assert.ok(seen[0].authz?.startsWith("Bearer ") && seen[0].authz !== "Bearer mock-anon-key");
  });
});
