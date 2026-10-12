// MOCKED browser tests for AI-assisted entry, the colour palette and manual entry. The vision model is a canned fake
// (counted, so double calls are caught); Supabase is the in-memory fake. Nothing reaches a real AI provider.
// Proves: the real form wires photo -> preview -> local colours -> AI suggestion -> editable fields -> saved row, and that
// failure states offer Retry / Manual entry. Does NOT prove a real model recognises real clothing.
import { writeFileSync } from "node:fs";
import { launch, sleep, png } from "./harness.mjs";
import { check, ok, clickText, welcome, go, results } from "./helpers.mjs";

const PNG = "/tmp/drape-e2e-recognize-photo.png";
writeFileSync(PNG, png(300, 400, [30, 60, 120]));
const PNG2 = "/tmp/drape-e2e-recognize-photo2.png";
writeFileSync(PNG2, png(300, 400, [240, 240, 236]));
const SETTINGS_KEY = "my-wardrobe:settings:v1";

let mode = "ok"; // ok | 429 | garbage | slow
let visionCalls = 0;
const answer = { type: "button-down", colors: ["white"], pattern: "solid", material: "linen-look", sleeve: "long", neckline: "collared", fit: "relaxed", confidence: "high", alternatives: [] };
const ai = (url, body) => {
  if (!/generativelanguage|groq\.com|openrouter\.ai/.test(url)) return undefined;
  const isVision = /image_url/.test(body || "");
  if (!isVision) return { body: JSON.stringify({ model: "mock-model", choices: [{ message: { content: "ready" } }] }) };
  visionCalls++;
  if (mode === "429") return { status: 429, body: JSON.stringify({ error: { message: "rate limited" } }) };
  if (mode === "garbage") return { body: JSON.stringify({ model: "mock-vision", choices: [{ message: { content: "What a lovely shirt!" } }] }) };
  return { body: JSON.stringify({ model: "mock-vision", choices: [{ message: { content: "```json\n" + JSON.stringify(answer) + "\n```" } }] }) };
};

const { browser, open, fake, errors, external } = await launch({ ai });
let page = await open();
const test = async (name, fn) => { await page.close().catch(() => {}); page = await open(); await check(name, fn); };
const setKey = (p, on) => p.evaluateOnNewDocument((k, on) => {
  if (on) localStorage.setItem(k, JSON.stringify({ provider: "gemini", rolling: true, keys: { gemini: "MOCK-KEY-gemini" }, models: {} }));
  else localStorage.removeItem(k);
}, SETTINGS_KEY, on);

const openForm = async () => { await go(page, "/wardrobe/"); await clickText(page, /Add clothing item|Add your first clothing item/); await sleep(300); };
const upload = async (file) => { const input = await page.$("[role=dialog] input[type=file]"); await input.uploadFile(file); };
const dialogText = () => page.evaluate(() => document.querySelector("[role=dialog]")?.innerText ?? "");
const selected = () => page.evaluate(() => [...document.querySelectorAll("[role=dialog] [aria-pressed=true][data-swatch]")].map((b) => b.getAttribute("aria-label")));
const typeValue = () => page.evaluate(() => document.querySelector("[role=dialog] select")?.value);
const save = async () => { await page.evaluate(() => document.querySelector("[role=dialog] button[type=submit]").click()); await sleep(1500); };
const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(120); } return false; };

await setKey(page, true);
await welcome(page, "Asha", { create: true });

await test("AI entry: photo preview, ONE vision call, type + colours + details prefilled and editable, saved as chosen", async () => {
  await setKey(page, true); visionCalls = 0; mode = "ok";
  await openForm();
  ok(/Fill in with AI/.test(await dialogText()), "no AI mode switch");
  ok(await page.$('[role=dialog] [role=radio][aria-checked=true]'), "no mode selected");
  await upload(PNG);
  ok(await waitFor(async () => (await page.$$("[role=dialog] img")).length > 0, 3000), "no preview after choosing a photo");
  ok(await waitFor(async () => (await typeValue()) === "button-down"), "type was not prefilled from the AI: " + (await typeValue()));
  const t = await dialogText();
  ok(/AI suggests/.test(t) && /White linen-look button-down shirt/.test(t), "no AI suggestion line: " + t.slice(0, 400));
  ok((await selected()).some((s) => /^White/.test(s)), "white not selected: " + (await selected()));
  const details = await page.$eval("[role=dialog] textarea", (e) => e.value);
  ok(/linen look/.test(details) && /long sleeves/.test(details), "details not prefilled: " + details);
  ok(visionCalls === 1, `expected exactly 1 vision call, got ${visionCalls}`);
  // The person edits the suggestion before saving.
  await page.select("[role=dialog] select", "shirt");
  await save();
  const row = fake.tables.items.at(-1);
  ok(row.type === "shirt" && row.category === "top" && JSON.stringify(row.colors) === '["white"]', `saved ${row.type}/${row.category}/${row.colors}`);
  ok(/linen look/.test(row.description), "details not saved");
  ok(visionCalls === 1, "saving made another AI call");
});

await test("the same photo again costs no second AI call (in-memory cache)", async () => {
  await setKey(page, true); visionCalls = 0;
  await openForm(); await upload(PNG); ok(await waitFor(async () => (await typeValue()) === "button-down"), "no suggestion"); ok(visionCalls === 1, "first: " + visionCalls);
  // Switch to manual and back: the cached answer is reused.
  await clickText(page, /Enter manually/); await clickText(page, /Fill in with AI/);
  await sleep(800); ok(visionCalls === 1, `re-asking the same photo made ${visionCalls} calls`);
});

await test("provider failure: concise error with Retry and Enter manually; Retry works; failure was not cached", async () => {
  await setKey(page, true); visionCalls = 0; mode = "429";
  await openForm(); await upload(PNG2);
  ok(await waitFor(async () => /rate-limiting|busy/i.test(await dialogText())), "no error shown: " + (await dialogText()).slice(0, 300));
  ok(await page.$('[role=dialog] [role=alert]'), "error not announced");
  ok(/Retry/.test(await dialogText()) && /Enter manually/.test(await dialogText()), "missing Retry / Enter manually");
  ok((await typeValue()) === "", "type should stay empty after a failure, not pretend: " + (await typeValue()));
  mode = "ok"; const before = visionCalls;
  await clickText(page, /^Retry$/);
  ok(await waitFor(async () => (await typeValue()) === "button-down"), "Retry did not fill the form");
  ok(visionCalls === before + 1, `retry made ${visionCalls - before} calls`);
});

await test("malformed model answer: clear message, Retry and manual path, never a fake success", async () => {
  await setKey(page, true); mode = "garbage";
  await openForm(); await upload(PNG2);
  ok(await waitFor(async () => /couldn't|form I could read/i.test(await dialogText())), "no error: " + (await dialogText()).slice(0, 300));
  ok(!/AI suggests/.test(await dialogText()), "claimed success on garbage");
  await clickText(page, /Enter manually/);
  await page.select("[role=dialog] select", "tshirt");
  await page.evaluate(() => document.querySelector('[role=dialog] [data-swatch][aria-label="Burgundy"]')?.click());
  await save();
  const row = fake.tables.items.at(-1);
  ok(row.type === "tshirt" && row.colors.includes("burgundy"), `manual save ${row.type}/${row.colors}`);
  mode = "ok";
});

await test("no AI key: new pieces open in manual mode with no AI call, and manual entry saves", async () => {
  await setKey(page, false); visionCalls = 0;
  await openForm();
  ok(!/Looking at your photo/.test(await dialogText()), "AI running without a key");
  await upload(PNG);
  await sleep(1200);
  ok(visionCalls === 0, "AI called without a key");
  await clickText(page, /Fill in with AI/);
  ok(await waitFor(async () => /Gemini or OpenRouter key/.test(await dialogText())), "no 'add a key' message: " + (await dialogText()).slice(0, 300));
  await clickText(page, /Enter manually/);
  await page.select("[role=dialog] select", "hoodie");
  await page.evaluate(() => document.querySelector('[role=dialog] [data-swatch][aria-label="Charcoal"]')?.click());
  await save();
  ok(fake.tables.items.at(-1).type === "hoodie", "manual save failed");
});

await test("local colours appear from the photo without any AI call", async () => {
  await setKey(page, false); visionCalls = 0;
  await openForm(); await clickText(page, /Enter manually/); await upload(PNG);
  ok(await waitFor(async () => (await selected()).length > 0, 3000), "no colour read locally from the photo");
  ok(/Read from your photo/.test(await dialogText()), "no 'read from your photo' hint");
  ok(visionCalls === 0, "network used for local colours");
});

await test("palette: grouped, 50+ swatches, labelled, keyboard-operable, max two, shows Main / Second", async () => {
  await setKey(page, false);
  await openForm(); await clickText(page, /Enter manually/);
  const info = await page.evaluate(() => {
    const sw = [...document.querySelectorAll("[role=dialog] button[data-swatch]")];
    return { n: sw.length, unlabeled: sw.filter((b) => !b.getAttribute("aria-label")).length, groups: document.querySelectorAll('[role=dialog] [role=group][aria-label="Colours"] [role=group]').length };
  });
  ok(info.n >= 50 && info.unlabeled === 0 && info.groups >= 8, JSON.stringify(info));
  await page.focus('[role=dialog] button[data-swatch]'); await page.keyboard.press("ArrowRight");
  const second = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  ok(second && second !== "Black", "arrow key did not move focus: " + second);
  await page.keyboard.press("Space"); await sleep(200);
  ok((await selected()).length === 1, "keyboard select failed");
  for (const c of ["Burgundy", "Sage", "Rose gold"]) await page.evaluate((c) => document.querySelector(`[role=dialog] [data-swatch][aria-label="${c}"], [role=dialog] [data-swatch][aria-label^="${c},"]`)?.click(), c);
  const sel = await selected(); ok(sel.length === 2, "more than two colours kept: " + sel);
  const t = await dialogText(); ok(/Main/.test(t) && /Second/.test(t), "no Main/Second labels");
  ok(/Rose gold/.test(sel.join()), "third pick should replace the second");
});

await test("edit: saved colours (old and new palette ids) show as selected and can be changed", async () => {
  await setKey(page, false);
  fake.tables.items.at(-1).colors = ["denim", "terracotta"];
  await go(page, "/wardrobe/");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Edit /.test(b.getAttribute("aria-label") || "") && /Denim|Terracotta/.test(b.getAttribute("aria-label")))?.click()); await sleep(600);
  const sel = await selected(); ok(sel.length === 2 && /Denim/.test(sel[0]) && /Terracotta/.test(sel[1]), "saved colours not shown: " + sel);
  await page.evaluate(() => document.querySelector('[role=dialog] [data-swatch][aria-label="Plum"]')?.click());
  await save();
  ok(fake.tables.items.some((i) => JSON.stringify(i.colors) === '["denim","plum"]'), "edit not saved: " + JSON.stringify(fake.tables.items.map((i) => i.colors)));
});

await test("the form fits a phone and the palette is reachable", async () => {
  await page.setViewport({ width: 390, height: 780 });
  await setKey(page, true);
  await openForm();
  const o = await page.evaluate(() => ({ x: document.documentElement.scrollWidth > innerWidth + 1, d: (() => { const r = document.querySelector("[role=dialog]")?.getBoundingClientRect(); return r ? r.right <= innerWidth + 1 : false; })() }));
  ok(!o.x && o.d, "horizontal overflow in the form on a phone");
  await page.setViewport({ width: 1280, height: 900 });
});

await test("no uncaught page errors, and nothing left the machine except mocked providers", async () => {
  ok(errors.filter((e) => !/Failed to load resource|net::ERR|429|503/.test(e)).length === 0, errors.slice(0, 3).join(" || "));
  ok(!external.some((h) => !/generativelanguage|groq|openrouter|BLOCKED/.test(h)), [...new Set(external)].join(","));
});

await browser.close();
const bad = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed (MOCKED Supabase + MOCKED AI provider)`);
process.exit(bad.length ? 1 : 0);
