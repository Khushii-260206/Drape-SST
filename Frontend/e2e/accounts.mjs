// MOCKED browser tests for accounts: sign-out, account switching, cross-tab sign-out, retained device settings and
// failed/expired sessions. Supabase and AI providers are fakes (see harness.mjs); nothing here reaches a real project.
// What they prove: the UI and the browser's storage never expose one account's private data to the next.
// What they do not prove: that a real Supabase project enforces its policies, or real token-refresh behaviour.
import { writeFileSync } from "node:fs";
import { launch, BASE, sleep, png } from "./harness.mjs";
import { check, ok, text, clickText, go, addItem, signIn, submitCredentials, enterName, uiSignOut, results } from "./helpers.mjs";

const PNG = "/tmp/drape-e2e-accounts-photo.png";
writeFileSync(PNG, png(300, 400, [30, 60, 120]));

const A = { email: "asha@example.com", password: "correct-horse", name: "Asha-Alpha", note: "ALPHA-SECRET-NOTE" };
const B = { email: "bea@example.com", password: "another-horse", name: "Bea-Beta" };
const AI_KEY = "MOCK-KEY-groq-retained";
const PRIVATE_KEYS = /^drape:(identity|active-chat|place|weather|photo-urls|last-user|cache)/;
const SETTINGS_KEY = "my-wardrobe:settings:v1";

// Canned provider replies, so saving an AI key (which tests it) works without any real provider.
const ai = (url) => /generativelanguage|groq\.com|openrouter\.ai/.test(url) ? { body: JSON.stringify({ model: "mock-model", choices: [{ message: { content: "ready" } }] }) } : undefined;
const { browser, open, fake, errors, external, photoFaults } = await launch({ ai });
let page = await open();
// E2E_ONLY=<regex> runs just the matching tests (the first, setup test always runs: the others depend on it).
const test = async (name, fn) => { if (process.env.E2E_ONLY && !name.startsWith("setup") && !new RegExp(process.env.E2E_ONLY, "i").test(name)) return; await page.close().catch(() => {}); page = await open(); await check(name, fn); };

/**
 * From the first frame of every navigation in this tab, records any time the page shows something of the forbidden
 * account: its secret text, its name, or a photo URL under its folder. It only records once armed (sessionStorage, so it
 * survives reloads), so the account's own legitimate sessions are not flagged.
 */
async function watch(p) {
  await p.evaluateOnNewDocument(() => {
    const leaks = () => JSON.parse(sessionStorage.getItem("leaks") || "[]");
    const scan = () => {
      if (sessionStorage.getItem("armed") !== "1") return;
      const { words = [], uid = "" } = JSON.parse(sessionStorage.getItem("forbidden") || "{}");
      const body = document.body?.innerText ?? "";
      const hits = [...words.filter((w) => body.includes(w)), ...[...document.images].filter((im) => uid && im.src.includes(uid)).map(() => "img:" + uid)];
      if (hits.length) sessionStorage.setItem("leaks", JSON.stringify([...leaks(), ...hits]));
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    addEventListener("DOMContentLoaded", scan);
  });
}
const arm = (p, forbidden) => p.evaluate((f) => { sessionStorage.setItem("forbidden", JSON.stringify(f)); sessionStorage.setItem("armed", "1"); sessionStorage.setItem("leaks", "[]"); }, forbidden);
const disarm = (p) => p.evaluate(() => sessionStorage.setItem("armed", "0"));
const leaks = (p) => p.evaluate(() => JSON.parse(sessionStorage.getItem("leaks") || "[]"));
const noLeaks = async (p, what) => { const l = await leaks(p); ok(l.length === 0, `${what}: another account's data was displayed: ${[...new Set(l)].join(", ")}`); };
const dumpStorage = (p) => p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
const privateKeys = (p) => p.evaluate((src) => Object.keys(localStorage).filter((k) => new RegExp(src).test(k)), PRIVATE_KEYS.source);
const stored = (p, k) => p.evaluate((k) => localStorage.getItem(k), k);
// Sign-out forgets the display name by design, so signing back in asks for it again.
const asA = async (p) => { await signIn(p, { email: A.email, password: A.password }); await enterName(p, A.name);
  ok((await stored(p, "drape:last-user")) === uidOf(A.email), "expected account A to be the signed-in account"); };
const uidOf = (email) => fake.users.get(email)?.id;
const setSettings = async (p) => {
  await go(p, "/settings/");
  await clickText(p, /^Groq/); await p.type("#api-key", AI_KEY); await clickText(p, /Save & (test|check)/); await sleep(1200);
  await clickText(p, /^Dark$/);
};

let savedBSession; // B's stored session, captured from the browser to simulate a session replaced behind the app's back

await test("setup: account A signs up and has a name, a piece with a private note and photo, an AI key and the dark theme", async () => {
  await watch(page);
  await signIn(page, { create: true, email: A.email, password: A.password }); await enterName(page, A.name);
  await go(page, "/wardrobe/"); await addItem(page, PNG, { note: A.note });
  ok(fake.tables.items.length === 1 && fake.tables.items[0].user_id === uidOf(A.email), "A's piece not saved under A");
  await go(page, "/wardrobe/");
  ok(/1 piece/.test(await text(page)), "A's piece not shown");
  await setSettings(page);
  ok((await stored(page, SETTINGS_KEY)).includes(AI_KEY), "AI key not saved");
  ok((await privateKeys(page)).length > 0, "expected A's private cache to exist before sign-out (test would prove nothing otherwise)");
});

await test("sign out: the previous account's private state is cleared, device settings stay", async () => {
  await asA(page);
  const settingsBefore = await stored(page, SETTINGS_KEY), themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  ok(themeBefore === "dark", "precondition: dark theme");
  const cache = await privateKeys(page); ok(cache.length > 0, "precondition: A has private keys in the browser");
  await uiSignOut(page);
  ok(await page.$("#auth-email"), "sign-in screen not shown");
  ok((await privateKeys(page)).length === 0, "private keys left after sign-out: " + (await privateKeys(page)).join(", "));
  const dump = await dumpStorage(page);
  ok(!dump.includes(A.note) && !dump.includes(A.name) && !dump.includes(uidOf(A.email)), "A's note, name or id still in browser storage");
  const t = await text(page); ok(!t.includes(A.note) && !t.includes(A.name), "sign-in screen shows A's data");
  ok((await stored(page, SETTINGS_KEY)) === settingsBefore, "sign-out changed the saved AI settings");
  ok((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "theme not retained");
  ok(fake.tables.items.length === 1, "sign-out deleted server data");
});

await test("account switch: user B signs in on the same browser and never sees user A's data; device settings are kept", async () => {
  await watch(page);
  await page.goto(BASE + "/", { waitUntil: "networkidle2" });
  ok(await page.$("#auth-email"), "expected the sign-in screen");
  await arm(page, { words: [A.note, A.name], uid: uidOf(A.email) });
  await submitCredentials(page, { create: true, email: B.email, password: B.password });
  await enterName(page, B.name);
  await go(page, "/wardrobe/"); await sleep(800);
  const t = await text(page);
  ok(/Nothing here yet|0 pieces?/.test(t) || !/1 piece/.test(t), "B sees a piece count of A's wardrobe: " + t.slice(0, 160).replace(/\n/g, " | "));
  ok(t.includes(B.name) || !t.includes(A.name), "unexpected identity");
  await noLeaks(page, "B's session");
  ok(uidOf(B.email) && uidOf(B.email) !== uidOf(A.email), "B must be a different account");
  const dump = await dumpStorage(page);
  ok(!dump.includes(A.note) && !dump.includes(A.name), "A's data is in browser storage for B");
  ok((await stored(page, SETTINGS_KEY)).includes(AI_KEY), "AI-provider key (a device setting) was lost on account switch");
  ok((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "theme lost on account switch");
  savedBSession = await stored(page, "drape:auth"); ok(savedBSession, "no stored session for B to reuse");
  await uiSignOut(page); await disarm(page);
});

await test("stale cache from A with B's session restored on load: A's data is cleared before anything of it can show", async () => {
  // A signs in and caches data; then B's stored session replaces A's behind the app's back (as another tab or a restored profile would).
  await watch(page);
  await asA(page);
  await go(page, "/wardrobe/");
  ok(/1 piece/.test(await text(page)), "precondition: A wardrobe shown: " + (await text(page)).slice(0,250).replace(/\n/g, " | "));
  ok((await dumpStorage(page)).includes(A.note) || (await privateKeys(page)).length > 0, "precondition: A's cache exists");
  await arm(page, { words: [A.note, A.name], uid: uidOf(A.email) });
  await page.evaluate((s) => localStorage.setItem("drape:auth", s), savedBSession);
  await page.goto(BASE + "/wardrobe/", { waitUntil: "networkidle2" }); await sleep(900);
  const t = await text(page);
  ok(!(await page.$("#auth-email")), "B's session was not restored: " + t.slice(0, 120));
  await enterName(page, B.name); // the display name is per-account and was dropped with A's state
  ok(!/1 piece/.test(t), "B sees A's piece count");
  await noLeaks(page, "restoring B over A's cache");
  ok(!(await dumpStorage(page)).includes(A.note), "A's note survived in browser storage");
  ok((await stored(page, "drape:last-user")) === uidOf(B.email), "cache is not recorded as belonging to B");
  await disarm(page);
  await uiSignOut(page);
});

await test("expired session that can't be refreshed: sign-in screen, no stale private data shown, state cleared", async () => {
  await watch(page);
  await asA(page);
  await go(page, "/wardrobe/");
  ok(/1 piece/.test(await text(page)), "precondition: A wardrobe shown: " + (await text(page)).slice(0,250).replace(/\n/g, " | "));
  const cached = await privateKeys(page); ok(cached.length > 0, "precondition: A has private keys");
  await arm(page, { words: [A.note, A.name], uid: uidOf(A.email) });
  // Expire the access token and break the refresh token, as after a revoked or long-idle session.
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("drape:auth")); s.expires_at = 1; s.refresh_token = "revoked"; localStorage.setItem("drape:auth", JSON.stringify(s)); });
  const reqsBefore = fake.log.length;
  await page.goto(BASE + "/wardrobe/", { waitUntil: "networkidle2" }); await sleep(1200);
  ok(await page.$("#auth-email"), "expected the sign-in screen, got: " + (await text(page)).slice(0, 120));
  await noLeaks(page, "expired session");
  ok((await privateKeys(page)).filter((k) => k !== "drape:last-user").length === 0, "private keys left after a failed refresh: " + (await privateKeys(page)).join(", "));
  ok(!(await dumpStorage(page)).includes(A.note), "A's note left in browser storage after a failed refresh");
  ok(fake.log.slice(reqsBefore).every((l) => !/\/rest\/v1|\/storage\/v1/.test(l)), "data requested without a valid session: " + fake.log.slice(reqsBefore).join(" | "));
  ok((await stored(page, SETTINGS_KEY)).includes(AI_KEY), "AI key lost after a failed refresh");
  await disarm(page);
});

await test("signing out in one tab: the other tab drops to the sign-in screen and clears private state", async () => {
  const t1 = page; await watch(t1);
  await asA(t1); await go(t1, "/wardrobe/");
  const t2 = await open(); await watch(t2);
  try {
    await go(t2, "/wardrobe/");
    ok(/1 piece/.test(await text(t2)) && !(await t2.$("#auth-email")), "precondition: the second tab shows A's wardrobe");
    await uiSignOut(t1);
    ok(await t1.$("#auth-email"), "first tab not signed out");
    let signedOut = false;
    for (let i = 0; i < 40 && !signedOut; i++) { signedOut = Boolean(await t2.$("#auth-email")); if (!signedOut) await sleep(250); }
    ok(signedOut, "the other tab still shows the app 10 s after sign-out elsewhere: " + (await text(t2)).slice(0, 120).replace(/\n/g, " | "));
    const t = await text(t2); ok(!t.includes(A.note) && !t.includes(A.name), "the other tab still displays A's data");
    ok((await privateKeys(t2)).length === 0, "private keys left: " + (await privateKeys(t2)).join(", "));
    ok((await stored(t2, SETTINGS_KEY)).includes(AI_KEY), "AI key lost on cross-tab sign-out");
    // The still-open tab must not be able to write the account back (a save or refresh finishing late).
    await sleep(1500); ok((await privateKeys(t2)).length === 0, "the other tab wrote private state back after sign-out");
  } finally { await t2.close().catch(() => {}); }
});

await test("signing in as a different account in one tab: the other tab never shows the first account's data", async () => {
  const t1 = page; await watch(t1);
  await asA(t1); await go(t1, "/wardrobe/");
  const t2 = await open(); await watch(t2);
  try {
    await go(t2, "/wardrobe/");
    ok(/1 piece/.test(await text(t2)), "precondition: second tab shows A");
    await arm(t2, { words: [A.note, A.name], uid: uidOf(A.email) });
    await uiSignOut(t1);
    for (let i = 0; i < 40 && !(await t2.$("#auth-email")); i++) await sleep(250);
    ok(await t2.$("#auth-email"), "second tab did not follow the sign-out");
    await submitCredentials(t1, { email: B.email, password: B.password }); await enterName(t1, B.name);
    await sleep(1500);
    await noLeaks(t2, "second tab while B signed in elsewhere");
    const t = await text(t2); ok(!t.includes(A.note) && !t.includes(A.name), "second tab shows A's data after B signed in");
    await t2.reload({ waitUntil: "networkidle2" }); await sleep(800);
    await noLeaks(t2, "second tab after reload as B");
  } finally { await t2.close().catch(() => {}); }
  await uiSignOut(t1);
});

await test("an expired photo link is replaced by a new one without a reload loop", async () => {
  await asA(page); await go(page, "/wardrobe/");
  const signs = () => fake.log.filter((l) => l.startsWith("POST /storage/v1/object/sign/")).length;
  const decoded = () => page.evaluate(() => [...document.querySelectorAll("main img")].some((i) => i.complete && i.naturalWidth > 0));
  ok(await decoded(), "precondition: photo shown");
  // Refuse the next download, as Supabase does for an expired link. Dropping the remembered links forces a fresh download.
  await page.evaluate(() => localStorage.removeItem("drape:photo-urls:v1"));
  const before = signs(); photoFaults.failNextImages = 1;
  await page.reload({ waitUntil: "networkidle2" });
  let shown = false; for (let i = 0; i < 20 && !shown; i++) { shown = await decoded(); if (!shown) await sleep(250); }
  ok(shown, "the photo never recovered after its link was refused");
  ok(signs() >= before + 2, `expected a second signing request after the failure, saw ${signs() - before}`);
  // A photo that keeps failing is retried once, not endlessly.
  const mid = signs(); photoFaults.failNextImages = 50;
  await page.evaluate(() => localStorage.removeItem("drape:photo-urls:v1"));
  await page.reload({ waitUntil: "networkidle2" }); await sleep(2500);
  ok(signs() - mid <= 3, `signing looped: ${signs() - mid} requests`);
  photoFaults.failNextImages = 0;
  await uiSignOut(page);
});

await test("forgot password: the link is on the sign-in screen, one request is sent, and the success message shows", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" }); await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "/", { waitUntil: "networkidle2" }); await page.reload({ waitUntil: "networkidle2" });
  await clickText(page, /^Forgot password\?/); // throws if the link is missing
  await page.type("#auth-email", A.email);
  const mark = fake.log.length;
  await clickText(page, /Send reset link/); await sleep(600);
  ok(/reset link is on its way/i.test(await text(page)), "no success message");
  ok(fake.log.slice(mark).filter((l) => l.includes("/auth/v1/recover")).length === 1, "expected exactly one reset request");
});

await test("reset link: the new-password form opens, validates, saves, and the new password signs in", async () => {
  await signIn(page, { email: A.email, password: A.password });
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("drape:auth")));
  await page.evaluate(() => localStorage.clear());
  await page.goto("about:blank"); // the link must load as a fresh page, as it does from an email
  const link = `${BASE}/#access_token=${token.access_token}&refresh_token=${token.refresh_token}&type=recovery`;
  await page.goto(link, { waitUntil: "networkidle2" }); await sleep(500);
  ok(await page.$("#reset-password"), "the new-password form did not open");
  ok(!(await page.evaluate(() => location.hash)), "the tokens were left in the address bar");
  await page.type("#reset-password", "brand-new-pass"); await page.type("#reset-confirm", "different-pass");
  await clickText(page, /Save password/); await sleep(400);
  ok(/don't match/.test(await text(page)), "no mismatch message");
  await page.reload({ waitUntil: "networkidle2" }); await sleep(500);
  ok(await page.$("#reset-password"), "a reload during the reset sent the user into the app or lost the form");
  await page.type("#reset-password", "brand-new-pass"); await page.type("#reset-confirm", "brand-new-pass");
  await clickText(page, /Save password/); await sleep(800);
  ok(!(await page.$("#reset-password")), "the form stayed open after a successful save");
  ok(fake.users.get(A.email).password === "brand-new-pass", "the password was not changed");
  fake.users.get(A.email).password = A.password; // restore for the remaining tests
  await uiSignOut(page).catch(() => {});
});

await test("reset link: an expired link says so and offers a new one", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" }); await page.evaluate(() => localStorage.clear());
  await page.goto("about:blank");
  await page.goto(BASE + "/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", { waitUntil: "networkidle2" }); await sleep(500);
  ok(/expired or was already used/.test(await text(page)), "no expired-link message");
  ok(await page.$("#auth-email") && /Send reset link/.test(await text(page)), "no way to request a new link");
});

await test("no uncaught page errors, and nothing left the machine", async () => {
  ok(errors.filter((e) => !/Failed to load resource|net::ERR|\b40[01]\b|Invalid Refresh Token/.test(e)).length === 0, errors.slice(0, 3).join(" || "));
  ok(!external.some((h) => !/generativelanguage|groq|openrouter|BLOCKED/.test(h)), [...new Set(external)].join(","));
});

await browser.close();
const bad = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed (MOCKED Supabase + MOCKED AI providers)`);
process.exit(bad.length ? 1 : 0);
