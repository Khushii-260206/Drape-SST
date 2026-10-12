// MOCKED: the real photo-link code (src/lib/photos.ts) against the in-memory fake in fake-supabase.ts. Regression tests for
// signed photo links reappearing in this browser after the account's state was forgotten or the session ended.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase } from "./fake-supabase";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

const auth = await import("../src/lib/auth");
const photos = await import("../src/lib/photos");

const STORE_KEY = "drape:photo-urls:v1";
const PERSIST_WAIT_MS = 700; // photos.ts saves 400 ms after the last change
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const savedLinks = () => Object.keys(JSON.parse(store.get(STORE_KEY) ?? "{}") as Record<string, unknown>).length;
const piece = { id: "aaaaaaaa", updatedAt: 1000 };

const fake = new FakeSupabase();
before(async () => {
  fake.install();
  await auth.signUp("asha@example.com", "correct-horse");
});
after(() => fake.uninstall());

/** Seeds the piece's photo as the signed-in user, so signing it succeeds. */
function seedObject() {
  fake.objects.set(photos.photoPath(piece.id, "front", "full"), 1);
}

describe("photo links after the account state is forgotten (MOCKED Supabase)", () => {
  beforeEach(async () => {
    if (!auth.hasSession()) await auth.signIn("asha@example.com", "correct-horse");
    photos.forgetAllPhotos();
    store.clear();
    fake.objects.clear();
  });

  test("a signing request already in flight can't repopulate the links once they were forgotten", async () => {
    seedObject();
    // Hold the signing response back so forgetAllPhotos() runs while the request is still outstanding.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await inner(input, init);
      if (String(input instanceof Request ? input.url : input).includes("/object/sign/")) await gate;
      return res;
    }) as typeof fetch;
    try {
      const pending = photos.getPhotoUrl(piece, "front", "full");
      await sleep(30); // let the batch go out
      photos.forgetAllPhotos(); // e.g. the user signed out, or another account took over
      release();
      await pending;
      await sleep(PERSIST_WAIT_MS);
      assert.equal(photos.peekPhotoUrl(piece, "front", "full"), undefined, "forgotten link came back into memory");
      assert.equal(savedLinks(), 0, "forgotten link was written back to localStorage");
    } finally {
      globalThis.fetch = inner;
    }
  });

  test("a save that was already scheduled is cancelled when the links are forgotten", async () => {
    seedObject();
    assert.ok(await photos.getPhotoUrl(piece, "front", "full"), "photo was not signed");
    photos.forgetAllPhotos(); // the 400 ms save is still pending here
    await sleep(PERSIST_WAIT_MS);
    assert.equal(savedLinks(), 0, "pending save wrote links after forgetting them");
  });

  test("nothing is saved once the session has ended, even if the links were never forgotten", async () => {
    seedObject();
    assert.ok(await photos.getPhotoUrl(piece, "front", "full"), "photo was not signed");
    await auth.signOut(); // no forgetAllPhotos(): the save timer alone must not write for an ended session
    await sleep(PERSIST_WAIT_MS);
    assert.equal(savedLinks(), 0, "links were saved after sign-out");
  });

  test("control: while signed in, signed links are saved", async () => {
    seedObject();
    assert.ok(await photos.getPhotoUrl(piece, "front", "full"), "photo was not signed");
    await sleep(PERSIST_WAIT_MS);
    assert.equal(savedLinks(), 1, "the signed link was not saved");
  });
});


// ---------------------------------------------------------------- authorization and expiry
// MOCKED only: these show what the CLIENT asks for and how it reacts to the fake's imitation of the owner-only storage
// policy. They do not prove the real "wardrobe" bucket is private or that its policy is installed (see the README).
const { sb } = await import("../src/lib/supabase");
const signCalls = () => fake.log.filter((l) => l.startsWith("POST /storage/v1/object/sign/")).length;

describe("who can get a signed photo link (MOCKED owner-only storage policy)", () => {
  beforeEach(async () => {
    if (auth.hasSession()) await auth.signOut();
    photos.forgetAllPhotos();
    store.clear();
    fake.objects.clear();
  });

  test("paths are always inside the signed-in user's own folder, whatever id is supplied", async () => {
    await auth.signIn("asha@example.com", "correct-horse");
    const asha = auth.requireUserId();
    assert.equal(photos.photoPath("aaaaaaaa", "front"), `${asha}/aaaaaaaa/front`);
    assert.equal(photos.photoPath("aaaaaaaa", "back", "thumb"), `${asha}/aaaaaaaa/back_sm`);
    await auth.signOut();
    await auth.signUp("bea@example.com", "correct-horse");
    const bea = auth.requireUserId();
    // Supplying Asha's folder as part of the "record id" only nests it under Bea's own folder.
    const p = photos.photoPath(`${asha}/aaaaaaaa`, "front");
    assert.ok(p.startsWith(`${bea}/`), p);
    assert.notEqual(p.split("/")[0], asha);
    await auth.signOut();
  });

  test("another user supplying the same record id gets nothing, and the other user's path is refused by the storage policy", async () => {
    await auth.signIn("asha@example.com", "correct-horse");
    const asha = auth.requireUserId();
    seedObject();
    assert.ok(await photos.getPhotoUrl(piece, "front", "full"), "owner can sign her own photo");
    const ashaPath = `${asha}/${piece.id}/front`;
    await auth.signOut();
    photos.forgetAllPhotos();

    await auth.signUp("bea2@example.com", "correct-horse");
    assert.equal(await photos.getPhotoUrl(piece, "front", "full"), undefined, "same record id must not reach the other account's photo");
    const direct = await sb().storage.from(photos.BUCKET).createSignedUrls([ashaPath], 60);
    assert.ok(direct.data?.every((d) => !d.signedUrl && d.error), "a hand-written path of another account must not be signed");
    await auth.signOut();
  });

  test("while signed out nothing is looked up or signed", async () => {
    const before = signCalls();
    assert.equal(photos.peekPhotoUrl(piece, "front", "full"), undefined);
    assert.equal(await photos.getPhotoUrl(piece, "front", "full"), undefined);
    assert.equal(signCalls(), before, "a signing request was made without a session");
  });

  test("links signed for one account are not shown to the next, even before the forget step runs", async () => {
    await auth.signIn("asha@example.com", "correct-horse");
    seedObject();
    assert.ok(await photos.getPhotoUrl(piece, "front", "full"));
    assert.ok(photos.peekPhotoUrl(piece, "front", "full"));
    await auth.signOut();
    assert.equal(photos.peekPhotoUrl(piece, "front", "full"), undefined, "signed-out peek returned a link");
    await auth.signUp("bea3@example.com", "correct-horse");
    assert.equal(photos.peekPhotoUrl(piece, "front", "full"), undefined, "next account saw the previous account's link (no forget yet)");
    await auth.signOut();
  });

  test("forgetAllPhotos empties memory and storage for the next account", async () => {
    await auth.signIn("asha@example.com", "correct-horse");
    seedObject();
    assert.ok(await photos.getPhotoUrl(piece, "front", "full"));
    await sleep(PERSIST_WAIT_MS);
    assert.equal(savedLinks(), 1);
    photos.forgetAllPhotos();
    assert.equal(savedLinks(), 0);
    assert.equal(photos.peekPhotoUrl(piece, "front", "full"), undefined);
    await auth.signOut();
  });
});

describe("expiring links recover (MOCKED clock and storage)", () => {
  const realNow = Date.now;
  beforeEach(async () => {
    Date.now = realNow;
    if (!auth.hasSession()) await auth.signIn("asha@example.com", "correct-horse");
    photos.forgetAllPhotos();
    store.clear();
    fake.objects.clear();
  });
  after(async () => {
    Date.now = realNow;
    if (auth.hasSession()) await auth.signOut();
  });

  test("a link inside its last day is not reused: it is signed again", async () => {
    seedObject();
    const first = await photos.getPhotoUrl(piece, "front", "full");
    assert.ok(first);
    assert.equal(photos.peekPhotoUrl(piece, "front", "full"), first, "fresh link is reused without a request");
    const calls = signCalls();
    await photos.getPhotoUrl(piece, "front", "full");
    assert.equal(signCalls(), calls, "a fresh link must not be re-signed");

    const t = realNow() + 6.5 * 24 * 3600 * 1000; // 12 h left of the 7 days
    Date.now = () => t;
    assert.equal(photos.peekPhotoUrl(piece, "front", "full"), undefined, "a nearly expired link was still shown");
    assert.ok(await photos.getPhotoUrl(piece, "front", "full"), "no replacement link was issued");
    assert.equal(signCalls(), calls + 1, "expected exactly one new signing request");
  });

  test("a photo deleted in the meantime resolves to undefined (no crash), and is not asked for again", async () => {
    seedObject();
    assert.ok(await photos.getPhotoUrl(piece, "front", "full"));
    fake.objects.clear();
    photos.forgetPhotos(piece.id, "front");
    assert.equal(await photos.getPhotoUrl(piece, "front", "full"), undefined);
    const calls = signCalls();
    assert.equal(await photos.getPhotoUrl(piece, "front", "full"), undefined);
    assert.equal(signCalls(), calls, "a known-missing photo was requested again");
  });

  test("a failed signing request (offline) leaves the photo retryable rather than marked missing", async () => {
    seedObject();
    const inner = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError("offline"); }) as typeof fetch;
    try {
      assert.equal(await photos.getPhotoUrl(piece, "front", "full"), undefined);
    } finally {
      globalThis.fetch = inner;
    }
    assert.ok(await photos.getPhotoUrl(piece, "front", "full"), "photo stayed unavailable after the network came back");
  });

  test("replacing a photo bumps updatedAt, which yields a fresh link (cache key includes it)", async () => {
    seedObject();
    const a = await photos.getPhotoUrl(piece, "front", "full");
    const calls = signCalls();
    const b = await photos.getPhotoUrl({ ...piece, updatedAt: 2000 }, "front", "full");
    assert.ok(a && b);
    assert.equal(signCalls(), calls + 1);
  });
});

describe("a link the browser can't load is replaced (img onError, MOCKED storage)", () => {
  beforeEach(async () => {
    if (!auth.hasSession()) await auth.signIn("asha@example.com", "correct-horse");
    photos.forgetAllPhotos();
    store.clear();
    fake.objects.clear();
  });
  after(async () => { if (auth.hasSession()) await auth.signOut(); });

  test("the broken link is dropped, watchers are told, and the next lookup signs a new one", async () => {
    seedObject();
    const url = await photos.getPhotoUrl(piece, "front", "full");
    assert.ok(url);
    const v = photos.photosVersion();
    let told = 0;
    const off = photos.subscribePhotos(() => told++);
    const calls = signCalls();
    photos.onPhotoError({ currentTarget: { src: url } });
    off();
    assert.equal(told, 1);
    assert.equal(photos.photosVersion(), v + 1);
    assert.equal(photos.peekPhotoUrl(piece, "front", "full"), undefined, "the broken link is still offered");
    assert.ok(await photos.getPhotoUrl(piece, "front", "full"));
    assert.equal(signCalls(), calls + 1);
  });

  test("a photo that keeps failing is replaced once, not in a loop", async () => {
    seedObject();
    const url = (await photos.getPhotoUrl(piece, "front", "full"))!;
    assert.equal(photos.expirePhotoUrl(url), true);
    const again = (await photos.getPhotoUrl(piece, "front", "full"))!;
    assert.equal(photos.expirePhotoUrl(again), false, "second failure inside a minute must not re-sign");
  });

  test("local previews, unknown URLs and signed-out state are ignored", async () => {
    assert.equal(photos.expirePhotoUrl("blob:nothing"), false);
    assert.equal(photos.expirePhotoUrl(undefined), false);
    seedObject();
    const url = (await photos.getPhotoUrl(piece, "front", "full"))!;
    await auth.signOut();
    assert.equal(photos.expirePhotoUrl(url), false);
  });
});
