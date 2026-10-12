// LOCAL + MOCKED timing probe (not part of `npm run e2e`): real Chrome against the static build, in-memory Supabase with ZERO
// network latency and a fake vision model that answers after a fixed delay. It shows how much time the CLIENT spends
// (decode, resize, local colour read, render); real provider and Supabase latency come on top and are NOT measured here.
import { writeFileSync } from "node:fs";
import { launch, sleep, png } from "./harness.mjs";
import { clickText, welcome } from "./helpers.mjs";

const AI_DELAY_MS = Number(process.env.AI_DELAY_MS ?? 800);
const BIG = "/tmp/drape-perf-photo.png";
writeFileSync(BIG, png(1600, 2000, [30, 60, 120]));
const answer = { type: "button-down", colors: ["white"], confidence: "high", alternatives: [] };
let visionCalls = 0;
const ai = (url, body) => {
  if (!/generativelanguage|groq\.com|openrouter\.ai/.test(url)) return undefined;
  if (!/image_url/.test(body || "")) return { body: JSON.stringify({ model: "m", choices: [{ message: { content: "ready" } }] }) };
  visionCalls++;
  return { delay: AI_DELAY_MS, body: JSON.stringify({ model: "m", choices: [{ message: { content: JSON.stringify(answer) } }] }) };
};
const { browser, open, fake } = await launch({ ai });
const page = await open();
await page.evaluateOnNewDocument(() => localStorage.setItem("my-wardrobe:settings:v1", JSON.stringify({ provider: "gemini", rolling: true, keys: { gemini: "MOCK" }, models: {} })));
await welcome(page, "Perf", { create: true });

const until = async (fn, ms = 20000) => { const t = performance.now(); while (performance.now() - t < ms) { if (await fn()) return performance.now(); await sleep(15); } return NaN; };
const row = (label, ms) => console.log(`${label.padEnd(58)} ${Number.isFinite(ms) ? ms.toFixed(0).padStart(6) + " ms" : "   n/a"}`);

// 1. Page load with a 60-piece wardrobe (warm and cold caches)
const uid = fake.users.get("asha@example.com").id;
for (let i = 0; i < 60; i++) {
  const id = i.toString(16).padStart(8, "0");
  fake.objects.set(`${uid}/${id}/front`, 5000); fake.objects.set(`${uid}/${id}/front_sm`, 900);
  fake.tables.items.push({ user_id: uid, id, type: "tshirt", category: "top", colors: ["navy"], description: "", has_back: false, favorite: false, wear_count: 0, last_worn: null, created_at: 1000 + i, updated_at: 1000 });
}
await page.evaluate(() => Object.keys(localStorage).filter((k) => /^drape:(cache|photo-urls)/.test(k)).forEach((k) => localStorage.removeItem(k))); // cold: no cached rows, no remembered photo links
let t0 = performance.now(); await page.goto(process.env.BASE_URL ?? (await import("./harness.mjs")).BASE + "/wardrobe/", { waitUntil: "domcontentloaded" });
let t = await until(() => page.evaluate(() => { const im = [...document.querySelectorAll("main img")]; return im.length >= 8 && im.slice(0, 8).every((i) => i.complete && i.naturalWidth > 0); }));
row("wardrobe of 60: first screenful of photos, COLD (no cache)", t - t0);
t0 = performance.now(); await page.reload({ waitUntil: "domcontentloaded" });
t = await until(() => page.evaluate(() => { const im = [...document.querySelectorAll("main img")]; return im.length >= 8 && im.slice(0, 8).every((i) => i.complete && i.naturalWidth > 0); }));
row("wardrobe of 60: first screenful of photos, WARM (cached)", t - t0);

// 2. Add a piece: photo choice -> preview -> local colours -> AI suggestion
await clickText(page, /Add clothing item/); await sleep(300);
visionCalls = 0;
const input = await page.$("[role=dialog] input[type=file]");
t0 = performance.now(); await input.uploadFile(BIG);
const preview = await until(() => page.evaluate(() => document.querySelectorAll("[role=dialog] img").length > 0));
row("photo chosen (1600x2000) -> preview visible", preview - t0);
const local = await until(() => page.evaluate(() => /Read from your photo/.test(document.querySelector("[role=dialog]")?.innerText ?? "") || /Chosen by the AI/.test(document.querySelector("[role=dialog]")?.innerText ?? "")));
row("photo chosen -> colours filled in (local, no network)", local - t0);
const aiDone = await until(() => page.evaluate(() => /AI suggests/.test(document.querySelector("[role=dialog]")?.innerText ?? "")));
row(`photo chosen -> AI type suggestion (mock model = ${AI_DELAY_MS} ms)`, aiDone - t0);
row("   of which client overhead beyond the model's own delay", aiDone - t0 - AI_DELAY_MS);
console.log(`vision calls for this photo: ${visionCalls}`);
await browser.close().catch(() => {});
process.exit(0);
