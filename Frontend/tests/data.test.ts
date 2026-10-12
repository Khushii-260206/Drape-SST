// MOCKED: runs the real data layer (src/lib/db.ts, photos.ts, supabase.ts) against the in-memory fake in fake-supabase.ts.
// It proves the app's logic, not that a real Supabase project is configured correctly.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, photo } from "./fake-supabase";
import type { ClothingItem, Outfit } from "../src/lib/types";

const db = await import("../src/lib/db");
const auth = await import("../src/lib/auth");

const fake = new FakeSupabase();
fake.install();
await auth.signUp("asha@example.com", "correct-horse"); // every test runs as this signed-in user
fake.uninstall();
const U = () => auth.requireUserId();

beforeEach(() => {
  fake.tables = { items: [], outfits: [], chats: [], chat_messages: [], profile: [] };
  fake.objects.clear();
  fake.faults = {};
  fake.log = [];
  fake.install();
});
afterEach(() => fake.uninstall());

const item = (id: string, over: Partial<ClothingItem> = {}): ClothingItem => ({
  id, type: "tshirt", category: "top", colors: ["black"], description: "", hasBack: false,
  favorite: false, wearCount: 0, lastWorn: null, createdAt: 1000, updatedAt: 1000, ...over,
});

async function add(i: ClothingItem) {
  return db.mutateItems((cur) => [i, ...cur], { put: [{ id: i.id, side: "front", blob: photo() }] });
}

describe("clothing items (MOCKED Supabase)", () => {
  test("add uploads the photo and saves the row", async () => {
    const items = await add(item("aaaaaaaa"));
    assert.equal(items.length, 1);
    assert.equal(fake.tables.items.length, 1);
    assert.ok(fake.objects.has(`${U()}/aaaaaaaa/front`));
    assert.equal((await db.loadItems())[0].id, "aaaaaaaa");
  });

  test("edit changes the row, replaces the photo, and leaves other pieces alone", async () => {
    await add(item("aaaaaaaa"));
    await add(item("bbbbbbbb", { type: "jeans", category: "bottom" }));
    await db.mutateItems(
      (cur) => cur.map((i) => (i.id === "aaaaaaaa" ? { ...i, type: "hoodie", colors: ["navy"], description: "Warm", updatedAt: 2000, hasBack: true } : i)),
      { put: [{ id: "aaaaaaaa", side: "back", blob: photo() }] }
    );
    const byId = new Map((await db.loadItems()).map((i) => [i.id, i]));
    assert.equal(byId.get("aaaaaaaa")!.type, "hoodie");
    assert.deepEqual(byId.get("aaaaaaaa")!.colors, ["navy"]);
    assert.equal(byId.get("aaaaaaaa")!.hasBack, true);
    assert.equal(byId.get("bbbbbbbb")!.type, "jeans");
    assert.ok(fake.objects.has(`${U()}/aaaaaaaa/back`));
  });

  test("removing a photo side deletes only that file", async () => {
    await db.mutateItems((cur) => [item("aaaaaaaa", { hasBack: true }), ...cur], {
      put: [{ id: "aaaaaaaa", side: "front", blob: photo() }, { id: "aaaaaaaa", side: "back", blob: photo() }],
    });
    await db.mutateItems((cur) => cur.map((i) => ({ ...i, hasBack: false, updatedAt: 3000 })), { del: [{ id: "aaaaaaaa", side: "back" }] });
    assert.ok(fake.objects.has(`${U()}/aaaaaaaa/front`));
    assert.ok(!fake.objects.has(`${U()}/aaaaaaaa/back`));
  });

  test("delete removes the row and every photo of that piece only", async () => {
    await add(item("aaaaaaaa"));
    await add(item("bbbbbbbb"));
    await db.mutateItems((cur) => cur.filter((i) => i.id !== "aaaaaaaa"));
    assert.deepEqual((await db.loadItems()).map((i) => i.id), ["bbbbbbbb"]);
    assert.ok(![...fake.objects.keys()].some((k) => k.startsWith(`${U()}/aaaaaaaa/`)));
    assert.ok(fake.objects.has(`${U()}/bbbbbbbb/front`));
  });

  test("favourite and mark-worn persist", async () => {
    await add(item("aaaaaaaa"));
    await db.mutateItems((cur) => cur.map((i) => ({ ...i, favorite: true, wearCount: 1, lastWorn: 5000 })));
    const [it] = await db.loadItems();
    assert.equal(it.favorite, true);
    assert.equal(it.wearCount, 1);
    assert.equal(it.lastWorn, 5000);
  });

  test("a throwing edit writes nothing", async () => {
    await add(item("aaaaaaaa"));
    const before = JSON.stringify(fake.tables.items);
    await assert.rejects(db.mutateItems(() => { throw new Error("boom"); }), /boom/);
    assert.equal(JSON.stringify(fake.tables.items), before);
  });

  test("a failed save of a NEW piece cleans up its uploaded photos", async () => {
    fake.faults.missingTable = "items";
    await assert.rejects(add(item("cccccccc")));
    assert.equal([...fake.objects.keys()].filter((k) => k.startsWith(`${U()}/cccccccc/`)).length, 0);
  });

  test("clearEverything empties items, chats, outfits and photos", async () => {
    await add(item("aaaaaaaa"));
    await db.saveOutfit({ id: "0f0f0f0f", name: "x", itemIds: ["aaaaaaaa", "bbbbbbbb"], note: "", createdAt: 1, wornCount: 0, lastWorn: null });
    await db.createChat({ id: "c1c1c1c1", title: "t", createdAt: 1, updatedAt: 1 });
    await db.clearEverything();
    assert.equal(fake.tables.items.length + fake.tables.outfits.length + fake.tables.chats.length, 0);
    assert.equal(fake.objects.size, 0);
  });
});

describe("clearEverything when photos can't be removed (MOCKED Supabase)", () => {
  test("keeps the rows instead of orphaning the photos", async () => {
    await add(item("aaaaaaaa"));
    fake.faults = { storage: "delete-fails" };
    await assert.rejects(db.clearEverything());
    assert.equal(fake.tables.items.length, 1, "rows were deleted although their photos were not");
    assert.equal(fake.objects.size > 0, true);
  });
});

describe("saved outfits (MOCKED Supabase)", () => {
  const outfit = (over: Partial<Outfit> = {}): Outfit => ({ id: "0f0f0f0f", name: "Brunch", itemIds: ["aaaaaaaa", "bbbbbbbb"], note: "light", createdAt: 10, wornCount: 0, lastWorn: null, ...over });

  test("save, rename/edit (upsert), mark worn, delete", async () => {
    await db.saveOutfit(outfit());
    assert.equal((await db.loadOutfits()).length, 1);
    await db.saveOutfit(outfit({ name: "Brunch v2", wornCount: 1, lastWorn: 99 }));
    const list = await db.loadOutfits();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Brunch v2");
    assert.equal(list[0].wornCount, 1);
    assert.deepEqual(list[0].itemIds, ["aaaaaaaa", "bbbbbbbb"]);
    await db.deleteOutfit("0f0f0f0f");
    assert.equal((await db.loadOutfits()).length, 0);
  });

  test("newest first", async () => {
    await db.saveOutfit(outfit({ id: "11111111", createdAt: 1 }));
    await db.saveOutfit(outfit({ id: "22222222", createdAt: 2 }));
    assert.deepEqual((await db.loadOutfits()).map((o) => o.id), ["22222222", "11111111"]);
  });
});

describe("profile (MOCKED Supabase)", () => {
  test("defaults when nothing saved, then round-trips and sanitises", async () => {
    assert.equal((await db.loadProfile()).name, "");
    const { EMPTY_PROFILE } = await import("../src/lib/profile");
    await db.saveProfile({ ...EMPTY_PROFILE, name: "  Asha  Rao ", heightCm: 165, skinTone: "olive", vibes: ["minimal", "not-a-vibe"] });
    const p = await db.loadProfile();
    assert.equal(p.name, "Asha Rao");
    assert.equal(p.heightCm, 165);
    assert.equal(p.skinTone, "olive");
    assert.ok(!p.vibes.includes("not-a-vibe"));
    await db.saveProfile({ ...p, name: "Asha" });
    assert.equal(fake.tables.profile.length, 1); // upsert, never a second row
  });
});

describe("chats (MOCKED Supabase)", () => {
  test("create, save messages, reload, delete cascades", async () => {
    await db.createChat({ id: "c1c1c1c1", title: "Hello", createdAt: 1, updatedAt: 1 });
    await db.saveChat("c1c1c1c1", [
      { id: "m1", role: "user", content: "what to wear", createdAt: 1 },
      { id: "m2", role: "assistant", content: "a tee", createdAt: 2, model: "m" },
    ]);
    assert.deepEqual((await db.loadChat("c1c1c1c1")).map((m) => m.id), ["m1", "m2"]);
    await db.deleteChat("c1c1c1c1");
    assert.equal(fake.tables.chat_messages.length, 0);
  });
});

describe("clear errors when Supabase is not set up (MOCKED failures)", () => {
  test("missing bucket", async () => {
    fake.faults.storage = "no-bucket";
    await assert.rejects(add(item("aaaaaaaa")), /bucket "wardrobe" doesn't exist.*schema\.secure\.sql/);
  });
  test("missing storage policy (RLS)", async () => {
    fake.faults.storage = "rls";
    await assert.rejects(add(item("aaaaaaaa")), /no policy that allows it.*schema\.secure\.sql/);
    assert.equal(fake.tables.items.length, 0, "the row must not be saved without its photo");
  });
  test("photo too large", async () => {
    fake.faults.storage = "too-large";
    await assert.rejects(add(item("aaaaaaaa")), /too large.*10 MB/);
  });
  test("wrong mime type", async () => {
    fake.faults.storage = "bad-mime";
    await assert.rejects(add(item("aaaaaaaa")), /JPEG, PNG or WebP/);
  });
  test("missing table", async () => {
    fake.faults.missingTable = "outfits";
    await assert.rejects(db.loadOutfits(), /table is missing.*schema\.secure\.sql/);
  });
  test("wrong anon key", async () => {
    fake.faults.badKey = true;
    await assert.rejects(db.loadItems(), /rejected the API key/);
  });
});

describe("backup export/import (MOCKED)", () => {
  // Node has no FileReader; this stand-in reads the Blob the same way.
  const g = globalThis as { FileReader?: unknown };
  const realReader = g.FileReader;
  beforeEach(async () => {
    (await import("../src/lib/photos")).forgetAllPhotos(); // earlier tests may have remembered "missing" photos under the same ids
    g.FileReader = class {
      result: string | null = null; onload: (() => void) | null = null; onerror: (() => void) | null = null; error = null;
      readAsDataURL(blob: Blob) { void blob.arrayBuffer().then((b) => { this.result = `data:${blob.type || "image/png"};base64,${Buffer.from(b).toString("base64")}`; this.onload?.(); }); }
    };
  });
  afterEach(() => { g.FileReader = realReader; });

  const seed = async () => {
    const a = item("aaaaaaaa", { colors: ["burgundy", "off-white"], description: "Linen look, long sleeves." });
    const b = item("bbbbbbbb", { type: "camisole", colors: ["rose-gold"], hasBack: false });
    await db.mutateItems((cur) => [a, b, ...cur], { put: [{ id: a.id, side: "front", blob: photo() }, { id: b.id, side: "front", blob: photo() }] });
    (await import("../src/lib/photos")).forgetAllPhotos(); // as after a page reload: photos come from signed links, not from memory
  };

  test("the backup holds pieces and looks only: no keys, tokens, sessions or settings", async () => {
    await seed();
    const { blob, count } = await db.exportBackup();
    assert.equal(count, 2);
    const text = await blob.text();
    const payload = JSON.parse(text) as { items: Record<string, unknown>[]; [k: string]: unknown };
    assert.deepEqual(Object.keys(payload).sort(), ["app", "exportedAt", "items", "outfits", "version"]);
    const allowed = new Set(["id", "type", "category", "colors", "description", "hasBack", "favorite", "wearCount", "lastWorn", "createdAt", "updatedAt", "images"]);
    for (const i of payload.items) for (const k of Object.keys(i)) assert.ok(allowed.has(k), `unexpected field in backup: ${k}`);
    assert.ok(!/api[_-]?key|access_token|refresh_token|authorization|bearer|service_role|MOCK-KEY/i.test(text.replace(/data:image\/[^"]+/g, "")), "something secret-looking is in the backup");
    assert.ok(!text.includes(auth.requireUserId()), "the account id must not be in a backup either");
  });

  test("new palette colours and types survive an export -> import round trip, and unknown colours are dropped", async () => {
    await seed();
    const { blob } = await db.exportBackup();
    const payload = JSON.parse(await blob.text());
    payload.items.push({ ...payload.items[0], id: "cccccccc", colors: ["teal", "not-a-colour", "plum"] });
    fake.tables.items = []; fake.objects.clear();
    const r = await db.importBackup(JSON.stringify(payload));
    assert.equal(r.added, 3);
    const byId = new Map((await db.loadItems()).map((i) => [i.id, i]));
    assert.deepEqual(byId.get("aaaaaaaa")!.colors, ["burgundy", "off-white"]);
    assert.equal(byId.get("bbbbbbbb")!.type, "camisole");
    assert.deepEqual(byId.get("cccccccc")!.colors, ["teal", "plum"]);
  });

  test("export photos are fetched a few at a time and the order of pieces is kept", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => i.toString(16).padStart(8, "0"));
    await db.mutateItems((cur) => [...ids.map((id, i) => item(id, { createdAt: 2000 - i })), ...cur], { put: ids.map((id) => ({ id, side: "front" as const, blob: photo() })) });
    (await import("../src/lib/photos")).forgetAllPhotos();
    const { blob, count } = await db.exportBackup();
    assert.equal(count, 9);
    const got = (JSON.parse(await blob.text()) as { items: { id: string }[] }).items.map((i) => i.id);
    assert.deepEqual(got, ids);
  });
});
