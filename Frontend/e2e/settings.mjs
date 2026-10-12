// MOCKED browser tests for Settings: the simplified AI connection card, key masking, and the delete-account flow.
// Supabase (including a stand-in for the delete-account Edge Function that runs the real core.ts) and the AI providers are fakes.
// Proves the UI wiring and messages. Does NOT prove the real Edge Function is deployed or that real Supabase deletes anything.
import { writeFileSync } from "node:fs";
import { launch, BASE, sleep, png } from "./harness.mjs";
import { check, ok, text, clickText, signIn, enterName, go, addItem, results } from "./helpers.mjs";

const PNG = "/tmp/drape-e2e-settings-photo.png";
writeFileSync(PNG, png(300, 400, [30, 60, 120]));
const EMAIL = "dana@example.com", PASSWORD = "correct-horse";
const SECRET = "MOCK-SECRET-KEY-1234567890";

let aiCalls = 0;
const ai = (url) => (/generativelanguage|groq\.com|openrouter\.ai/.test(url) ? (aiCalls++, { body: JSON.stringify({ model: "mock-model", choices: [{ message: { content: "ready" } }] }) }) : undefined);
const { browser, open, fake, errors, external } = await launch({ ai });
let page = await open();
const test = async (name, fn, viewport) => { await page.close().catch(() => {}); page = await open(viewport); await check(name, fn); };
const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(120); } return false; };
const userId = () => fake.users.get(EMAIL)?.id;
const rows = () => Object.values(fake.tables).flat().filter((r) => r.user_id === userId()).length;

await signIn(page, { create: true, email: EMAIL, password: PASSWORD }); await enterName(page, "Dana");
await go(page, "/wardrobe/"); await addItem(page, PNG, { note: "Navy tee" });

await test("settings: plain 'AI connection' status, no provider hosts or health internals, key optional and local", async () => {
  await go(page, "/settings/");
  const t = await text(page);
  ok(/AI isn't set up yet/.test(t), "no plain status line");
  ok(/optional/i.test(t) && /only in this browser/i.test(t), "key privacy / optional wording missing");
  ok(!/aistudio\.google\.com|console\.groq\.com|In rotation|Rotate between providers/.test(t), "implementation details still shown by default");
  const open = await page.evaluate(() => document.querySelector("details")?.open);
  ok(open === false, "Advanced should start collapsed");
});

await test("settings: a saved key reads 'not tested', nothing is sent to providers until the user presses Check, and only then does it say successful", async () => {
  await page.evaluateOnNewDocument(() => { if (!localStorage.getItem("my-wardrobe:settings:v1")) localStorage.setItem("my-wardrobe:settings:v1", JSON.stringify({ provider: "groq", rolling: true, keys: { groq: "MOCK-SAVED-KEY-0001" }, models: {} })); });
  const before = aiCalls;
  await go(page, "/settings/"); await sleep(1200);
  const t = await text(page);
  ok(/Key saved — not tested/.test(t), "saved key not labelled as untested: " + t.slice(0, 300));
  ok(!/Connection successful|AI is connected/.test(t), "claims success before any test");
  ok(/Not tested yet/.test(t), "banner does not say untested");
  ok(aiCalls === before, "page load contacted an AI provider");
  ok(!t.includes("MOCK-SAVED-KEY"), "saved key rendered");
  await clickText(page, /Check connection/); await sleep(900);
  ok(aiCalls === before + 1, "expected exactly one provider request, got " + (aiCalls - before));
  ok(/Connection successful/.test(await text(page)), "no success after a real reply");
  await page.reload(); await sleep(1200);
  ok(/Key saved — not tested/.test(await text(page)), "stale 'connected' survived a reload");
});

await test("settings: the key is masked, can be revealed and hidden, is saved locally only, and never leaves for anything but its provider", async () => {
  await go(page, "/settings/");
  ok((await page.$eval("#api-key", (e) => e.type)) === "password", "key field not masked by default");
  await page.type("#api-key", SECRET);
  await clickText(page, /Show key/); ok((await page.$eval("#api-key", (e) => e.type)) === "text", "reveal did nothing");
  await clickText(page, /Hide key/); ok((await page.$eval("#api-key", (e) => e.type)) === "password", "hide did nothing");
  await clickText(page, /Save & check/); await sleep(900);
  ok(/Connection successful/.test(await text(page)), "status did not turn verified after a real (mocked) reply");
  ok(!(await text(page)).includes(SECRET), "the key is printed on the page");
  ok(!(await page.evaluate(() => location.href)).includes("MOCK-SECRET"), "the key is in the URL");
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([, v]) => v.includes("MOCK-SECRET")).map(([k]) => k));
  ok(stored.length === 1 && stored[0] === "my-wardrobe:settings:v1", "key stored somewhere unexpected: " + stored);
  const sent = await page.evaluate(() => JSON.stringify(performance.getEntriesByType("resource").map((r) => r.name)));
  ok(!sent.includes("MOCK-SECRET"), "key appeared in a request URL");
  ok(!fake.log.some((l) => l.includes("MOCK-SECRET")), "key reached Supabase");
  ok(!JSON.stringify(fake.tables).includes("MOCK-SECRET"), "key was written to the database");
});

await test("settings: Advanced holds rotation and model; backup, appearance and account sections are all present", async () => {
  await go(page, "/settings/");
  await clickText(page, /^Advanced$/, "summary");
  const t = await text(page);
  ok(/Share the load between my keys/.test(t) && /model/i.test(t), "advanced options missing");
  for (const s of ["Appearance", "Account", "Your data", "Export backup", "Import backup", "Sign out", "Delete account"]) ok(t.includes(s), "missing: " + s);
});

await test("settings: light and dark both render the AI card and the danger zone legibly (no overflow), phone to desktop", async () => {
  for (const [w, h] of [[390, 800], [820, 1000], [1440, 900]]) {
    await page.setViewport({ width: w, height: h });
    for (const theme of ["Light", "Dark"]) {
      await go(page, "/settings/"); await clickText(page, new RegExp(`^${theme}$`)).catch(() => {});
      const o = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      ok(!o, `horizontal overflow at ${w}px in ${theme}`);
    }
  }
  await page.setViewport({ width: 1280, height: 900 });
});

await test("delete account: dialog explains consequences and the button stays disabled until password + DELETE are entered", async () => {
  await go(page, "/settings/"); await clickText(page, /Delete account/);
  const d = await page.evaluate(() => document.querySelector("[role=dialog]")?.innerText ?? "");
  ok(/permanently deletes/.test(d) && /photos/.test(d) && /no undo/i.test(d) && /export a backup/i.test(d), "consequences not explained: " + d.slice(0, 200));
  const disabled = () => page.$eval('[role=dialog] button[type=submit]', (b) => b.disabled);
  ok(await disabled(), "enabled with nothing entered");
  await page.type("#delete-password", PASSWORD); ok(await disabled(), "enabled without typing DELETE");
  await page.type("#delete-confirm", "delete"); ok(!(await disabled()), "not enabled after both fields");
});

await test("delete account: a wrong password is refused and nothing is deleted", async () => {
  await go(page, "/settings/"); await clickText(page, /Delete account/);
  await page.type("#delete-password", "not-my-password"); await page.type("#delete-confirm", "DELETE");
  const before = rows();
  await page.click('[role=dialog] button[type=submit]');
  ok(await waitFor(async () => /isn't right/.test(await text(page))), "no wrong-password message");
  ok(rows() === before && before > 0, "data changed after a wrong password");
  ok(fake.log.every((l) => !l.includes("/functions/")), "the function was called without a verified password");
});

await test("delete account: function not deployed -> clear message, account untouched, still signed in", async () => {
  await go(page, "/settings/"); await clickText(page, /Delete account/);
  await page.type("#delete-password", PASSWORD); await page.type("#delete-confirm", "DELETE");
  fake.faults.deleteAccount = "not-deployed";
  await page.click('[role=dialog] button[type=submit]');
  ok(await waitFor(async () => /isn't set up on this Supabase project/.test(await text(page))), "no not-deployed message: " + (await text(page)).slice(-300));
  fake.faults.deleteAccount = undefined;
  ok(fake.users.has(EMAIL) && rows() > 0, "data/account changed on failure");
  ok(!(await page.$("#auth-email")), "user was signed out by a failed deletion");
});

await test("delete account: partial failure is reported, can be retried, then succeeds -> sign-in screen with confirmation, data and account gone", async () => {
  await go(page, "/settings/"); await clickText(page, /Delete account/);
  await page.type("#delete-password", PASSWORD); await page.type("#delete-confirm", "DELETE");
  fake.faults.deleteAccount = "storage";
  await page.click('[role=dialog] button[type=submit]');
  ok(await waitFor(async () => /Couldn't remove your photos/.test(await text(page))), "no storage failure message");
  ok(/press Delete again to retry/.test(await text(page)), "no retry guidance");
  ok(fake.users.has(EMAIL), "account deleted despite storage failure");
  fake.faults.deleteAccount = undefined;
  const uid = userId();
  await page.click('[role=dialog] button[type=submit]');
  ok(await waitFor(async () => !!(await page.$("#auth-email"))), "did not return to the sign-in screen: " + (await text(page)).slice(0, 200));
  ok(/account and everything in it were deleted/.test(await text(page)), "no confirmation on the sign-in screen");
  ok(rows() === 0 && ![...fake.objects.keys()].some((p) => p.startsWith(uid + "/")), "rows or photos left behind");
  ok(!fake.users.has(EMAIL), "the auth user still exists");
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^drape:(identity|cache|photo-urls)/.test(k)));
  ok(left.length === 0, "private state left in the browser: " + left);
});

await test("after deletion the old credentials no longer sign in", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" });
  await page.type("#auth-email", EMAIL); await page.type("#auth-password", PASSWORD);
  await page.click("form button[type=submit]"); await sleep(700);
  ok(/don't match/.test(await text(page)), "deleted account could still sign in");
});

await test("sign out from Settings: signs out even when the server can't be told, and says what happened", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" });
  await clickText(page, /^Create an account$/); await page.type("#auth-email", "eli@example.com"); await page.type("#auth-password", PASSWORD);
  await page.click("form button[type=submit]"); await sleep(1200); await enterName(page, "Eli");
  await go(page, "/settings/"); fake.faults.logout = "network";
  await clickText(page, /Sign out/); await clickText(page, /^Sign out$/, "[role=dialog] button");
  ok(await waitFor(async () => !!(await page.$("#auth-email"))), "still in the app after sign-out with the server down");
  fake.faults.logout = undefined;
  await page.reload({ waitUntil: "networkidle2" }); await sleep(600);
  ok(await page.$("#auth-email"), "a reload signed the user back in");
});

await test("no uncaught page errors, and nothing left the machine except mocked providers", async () => {
  ok(errors.filter((e) => !/Failed to load resource|net::ERR|\b40[0134]\b|\b50\d\b|Invalid Refresh Token/.test(e)).length === 0, errors.slice(0, 3).join(" || "));
  ok(!external.some((h) => !/generativelanguage|groq|openrouter|BLOCKED/.test(h)), [...new Set(external)].join(","));
});

await browser.close();
const bad = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed (MOCKED Supabase + MOCKED AI providers)`);
process.exit(bad.length ? 1 : 0);
