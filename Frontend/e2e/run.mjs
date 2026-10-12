// MOCKED end-to-end run in real Chrome. Supabase and all AI providers are fakes (see harness.mjs); this proves the UI
// logic, not a real Supabase project or a live AI key. Usage: npm run build (dummy env) -> serve out/ -> npm run e2e
import { writeFileSync } from "node:fs";
import { launch, BASE, sleep, png } from "./harness.mjs";
import { check, ok, text, clickText, welcome, go, addItem, results } from "./helpers.mjs";

const PNG = "/tmp/drape-e2e-photo.png";
writeFileSync(PNG, png(300, 400, [30, 60, 120]));
const TXT = "/tmp/drape-e2e-notes.txt"; writeFileSync(TXT, "not an image");

let aiMode = "ok"; let reply = "A navy tee with jeans works for brunch.";
const sse = (t) => `data: ${JSON.stringify({ model: "mock-model", choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`;
const ai = (url, body) => {
  if (!/generativelanguage|groq\.com|openrouter\.ai/.test(url)) return undefined;
  if (aiMode === "429") return { status: 429, body: JSON.stringify({ error: { message: "rate limited" } }) };
  if (aiMode === "401") return { status: 401, body: JSON.stringify({ error: { message: "bad key" } }) };
  return JSON.parse(body || "{}").stream ? { contentType: "text/event-stream", body: sse(reply) } : { body: JSON.stringify({ model: "mock-model", choices: [{ message: { content: "ready" } }] }) };
};

const { browser, open, fake, errors, external } = await launch({ ai });
let page = await open();
// Each check runs on a fresh tab (same browser storage, same fake backend) so one check can't poison the next.
const test = async (name, fn, viewport) => { await page.close().catch(() => {}); page = await open(viewport); await check(name, fn); };

await test("signed out: only the sign-in screen, and no data or photo request is made", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" }); await sleep(500);
  ok(await page.$("#auth-email"), "no sign-in screen");
  ok(fake.log.every((l) => !/\/rest\/v1|\/storage\/v1/.test(l)), "data requested before signing in: " + fake.log.join(" | "));
});

await test("signed out: an unknown address shows the not-found page (no sign-in form), a real page still shows sign-in", async () => {
  await page.goto(BASE + "/does-not-exist/", { waitUntil: "networkidle2" }); await sleep(500);
  ok(/Nothing hanging here/.test(await text(page)), "not-found page not shown for an unknown address");
  ok(!(await page.$("#auth-email")), "sign-in form shown on an unknown address");
  ok(await page.$("main#main h1"), "not-found page has no main landmark");
  ok(fake.log.every((l) => !/\/rest\/v1|\/storage\/v1/.test(l)), "data requested on the not-found page");
  await page.goto(BASE + "/wardrobe/", { waitUntil: "networkidle2" }); await sleep(500);
  ok(await page.$("#auth-email"), "real page /wardrobe/ lost its sign-in screen");
});

await test("signed out: the skip link is on the sign-in screen, is the first Tab stop, is visible on focus, and moves to main", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" }); await sleep(500);
  await page.mouse.click(2, 2); // a click on the page edge makes the next Tab start from the top of the page
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { text: a.textContent.trim(), href: a.getAttribute("href"), visible: r.width > 1 && r.height > 1 && getComputedStyle(a).position === "fixed" }; });
  ok(first.href === "#main" && /skip to content/i.test(first.text), "first Tab stop is not the skip link: " + JSON.stringify(first));
  ok(first.visible, "skip link is not visible when focused");
  await page.keyboard.press("Enter"); await sleep(200);
  ok((await page.evaluate(() => location.hash)) === "#main", "skip link did not move to #main");
});

await test("sign-in: a wrong password is refused, an account is created, the name step follows and survives reload", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" });
  await clickText(page, /^Create an account$/);
  await page.type("#auth-email", "asha@example.com"); await page.type("#auth-password", "short");
  await page.click("form button[type=submit]"); await sleep(400);
  ok(/at least 8/i.test(await text(page)), "short password not refused");
  await page.focus("#auth-password"); for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace"); // remove "short"
  await page.type("#auth-password", "correct-horse");
  await page.click("form button[type=submit]"); await sleep(1200);
  ok(await page.$('input[placeholder="Your name"]'), "name step not shown after sign-up");
  await page.click("form button"); await sleep(300);
  ok(/Please enter a name/i.test(await text(page)), "no validation message for empty name");
  await page.type('input[placeholder="Your name"]', "Asha"); await page.click("form button"); await sleep(700);
  ok(/Asha/.test(await text(page)), "name not shown after welcome");
  await page.reload({ waitUntil: "networkidle2" }); await sleep(800);
  ok(/Asha/.test(await text(page)) && !(await page.$("#auth-email")), "signed out or name lost on reload");
});

await test("wardrobe: add a piece with a photo -> row + photo + thumbnail saved, card shown", async () => {
  await go(page, "/wardrobe/"); await addItem(page, PNG, { note: "Navy tee" });
  ok(fake.tables.items.length === 1, "row not saved");
  const id = fake.tables.items[0].id;
  const uid = fake.tables.items[0].user_id; ok(uid, "row has no owner");
  ok(fake.objects.has(`${uid}/${id}/front`) && fake.objects.has(`${uid}/${id}/front_sm`), "photo or thumbnail not uploaded under the user's folder");
  ok(/1 piece/.test(await text(page)), "count not updated");
});

await test("wardrobe: photo preview renders and persists after reload", async () => {
  await go(page, "/wardrobe/");
  const loaded = await page.evaluate(() => [...document.querySelectorAll("main img")].some((i) => i.complete && i.naturalWidth > 0));
  ok(loaded, "no decoded photo on the card after reload");
});

await test("wardrobe: edit changes the saved piece", async () => {
  await go(page, "/wardrobe/");
  await clickText(page, /Edit Navy T-shirt/);
  await page.select("[role=dialog] select", "hoodie");
  await page.evaluate(() => { const t = document.querySelector("[role=dialog] textarea"); t.focus(); t.select(); });
  await page.keyboard.type("Warm hoodie"); await page.evaluate(() => document.querySelector("button[type=submit]").click()); await sleep(1200);
  ok(fake.tables.items[0].type === "hoodie" && fake.tables.items[0].description === "Warm hoodie", `row is ${fake.tables.items[0].type}/${fake.tables.items[0].description}`);
});

await test("wardrobe: favourite persists", async () => {
  await go(page, "/wardrobe/");
  await clickText(page, /Add .* to favou/); await sleep(500);
  ok(fake.tables.items[0].favorite === true, "favourite not saved");
});

await test("upload errors: missing policy / bucket / oversize / wrong type are explained in the form", async () => {
  const cases = [["rls", /no policy/i], ["no-bucket", /doesn't exist/i], ["too-large", /too large/i], ["bad-mime", /JPEG, PNG or WebP/i]];
  for (const [fault, re] of cases) {
    fake.faults.storage = fault; const before = fake.tables.items.length;
    await go(page, "/wardrobe/"); await addItem(page, PNG, { type: "jeans" });
    ok(re.test(await text(page)), `no clear message for ${fault}`);
    ok(fake.tables.items.length === before, `a row was saved despite ${fault}`);
    await page.keyboard.press("Escape"); await clickText(page, /^Cancel$/).catch(() => {});
  }
  fake.faults.storage = undefined;
});

await test("upload: a non-image file is refused before upload", async () => {
  await go(page, "/wardrobe/"); const n = fake.objects.size;
  await clickText(page, /Add clothing item/); const f = await page.$("input[type=file]"); await f.uploadFile(TXT); await sleep(900);
  ok(fake.objects.size === n, "a non-image was uploaded"); ok(/photo|image|read|support/i.test(await text(page)), "no message about the bad file");
  await clickText(page, /^Cancel$/).catch(() => {});
});

await test("wardrobe: delete removes the row and its photos", async () => {
  await go(page, "/wardrobe/"); await clickText(page, /^Remove (?!.*favour)/);
  await clickText(page, /^Remove$/, "[role=dialog] button");
  await sleep(1000);
  ok(fake.tables.items.length === 0, `row still present (${fake.tables.items.length})`);
  ok(fake.objects.size === 0, `photos left behind: ${[...fake.objects.keys()].join(",")}`);
  ok(/Nothing here yet/.test(await text(page)), "empty state not shown");
});

await test("settings: theme switches to dark and persists", async () => {
  await go(page, "/settings/"); await clickText(page, /^Dark$/);
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "theme not dark");
  await page.reload({ waitUntil: "networkidle2" }); ok(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "theme lost on reload");
  await clickText(page, /^Light$/);
});

await test("settings: a pasted key is tested against its provider (MOCK) and saved", async () => {
  await go(page, "/settings/"); await clickText(page, /^Groq/);
  await page.type("#api-key", "MOCK-KEY-groq"); await clickText(page, /Save & (test|check)"?|Save & (test|check)/); await sleep(1200);
  ok(/Connected/i.test(await text(page)), "no 'Connected' result");
  const stored = await page.evaluate(() => localStorage.getItem("my-wardrobe:settings:v1") ?? "");
  ok(stored.includes("MOCK-KEY-groq"), "pasted key not kept in this browser");
});

await test("settings: a rejected key shows a clear auth error", async () => {
  aiMode = "401"; await go(page, "/settings/"); await clickText(page, /^Groq/);
  await page.type("#api-key", "MOCK-KEY-bad"); await clickText(page, /Save & (test|check)/); await sleep(1200);
  ok(/rejected your API key/i.test(await text(page)), "no auth error shown"); aiMode = "ok";
});

const freshChat = async () => { await go(page, "/"); await page.evaluate(() => localStorage.removeItem("drape:router:v1")); await go(page, "/"); };
await test("chat: a message gets a streamed (MOCK) reply with the loading state cleared", async () => {
  await go(page, "/wardrobe/"); await addItem(page, PNG, { type: "tshirt", color: "Navy" }); await freshChat(); await page.type('textarea[aria-label="Message your stylist"]', "What should I wear to brunch?");
  await page.click('button[aria-label="Send message"]'); await sleep(2000);
  const t = await text(page); ok(/What should I wear to brunch/.test(t), "user message missing"); ok(/navy tee with jeans/.test(t), "assistant reply missing");
  ok(!(await page.$('button[aria-label="Stop generating"]')), "still shows generating");
});

await test("chat: provider rate-limit shows a readable error, not a crash", async () => {
  await freshChat(); aiMode = "429"; await page.type('textarea[aria-label="Message your stylist"]', "Another idea?");
  await page.click('button[aria-label="Send message"]'); await sleep(2000);
  ok(/busy|rate-limit/i.test(await text(page)), "no rate-limit message"); aiMode = "ok";
});

await test("chat: a reply citing two pieces offers Save look, and it lands in Outfits", async () => {
  await go(page, "/wardrobe/"); await addItem(page, PNG, { type: "tshirt", color: "Navy" }); await addItem(page, PNG, { type: "jeans", color: "Blue" });
  const [a, b] = fake.tables.items.map((i) => i.id); ok(a && b, "need two items");
  reply = `## Brunch look\n- [[${a}]] with [[${b}]]\n\nEasy and light.`;
  await freshChat(); await page.type('textarea[aria-label="Message your stylist"]', "Brunch look please");
  await page.click('button[aria-label="Send message"]'); await sleep(2500);
  const t0 = await text(page); ok(/Save look/.test(t0), "no Save look button; reply area: " + t0.replace(/\n+/g, " / ").slice(-300));
  await clickText(page, /Save look/); for (let i = 0; i < 20 && !fake.tables.outfits.length; i++) await sleep(200);
  ok(fake.tables.outfits.length === 1, "outfit not saved; page says: " + (await text(page)).replace(/\n+/g, " / ").slice(-260) + " | log: " + fake.log.slice(-4).join(", ")); await go(page, "/outfits/");
  ok(/Brunch/i.test(await text(page)), "saved look not listed on Outfits");
});

await test("profile: edits are saved to the database (MOCK) and reload", async () => {
  await go(page, "/profile/"); await page.type('input[placeholder="e.g. 175"]', "168"); await clickText(page, /^Woman$/); await clickText(page, /^Olive$/);
  await sleep(2500); ok(fake.tables.profile.length === 1, "profile not saved");
  await go(page, "/profile/"); ok(await page.evaluate(() => [...document.querySelectorAll("input")].some((i) => i.value === "168")), "height lost after reload");
});

await test("settings: sign out returns to the sign-in screen, keeps the data, and signing back in restores it", async () => {
  const before = fake.tables.items.length; await go(page, "/settings/");
  // Something the account would leave behind, plus a pasted AI key (a device setting that is meant to stay).
  await page.evaluate(() => { localStorage.setItem("drape:active-chat", "abcd1234"); localStorage.setItem("drape:place:v1", JSON.stringify({ name: "X", lat: 1, lon: 2 })); });
  const keyBefore = await page.evaluate(() => localStorage.getItem("my-wardrobe:settings:v1"));
  await clickText(page, /Sign out/);
  await clickText(page, /^Sign out$/, "[role=dialog] button, [role=alertdialog] button, dialog button").catch(() => {}); await sleep(900);
  ok(await page.$("#auth-email"), "sign-in screen not shown"); ok(fake.tables.items.length === before, "data was deleted");
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^drape:(identity|active-chat|place|weather|photo-urls|last-user|cache)/.test(k)));
  ok(left.length === 0, "sign-out left account data in the browser: " + left.join(", "));
  ok((await page.evaluate(() => localStorage.getItem("my-wardrobe:settings:v1"))) === keyBefore, "sign-out changed the saved AI settings");
  await welcome(page, "Asha"); await go(page, "/wardrobe/");
  const back = await text(page); ok(new RegExp(`\\b${before} pieces?\\b`).test(back), `wardrobe not back after signing in: ${back.slice(0, 200).replace(/\n/g, " | ")}`);
});

await test("offline: wardrobe shows an offline notice instead of crashing", async () => {
  await welcome(page, "Asha"); await go(page, "/wardrobe/"); await page.setOfflineMode(true); await sleep(800);
  const t = await text(page); await page.setOfflineMode(false);
  ok(/offline|connection/i.test(t), "no offline indication");
});

// ---- layout at three widths, every page
for (const [w, h] of [[390, 844], [820, 1180], [1440, 900]]) {
  await test(`layout ${w}px: no horizontal overflow, nav present, on every page`, async () => {
    await page.setViewport({ width: w, height: h });
    for (const p of ["/", "/wardrobe/", "/outfits/", "/profile/", "/settings/"]) {
      await go(page, p);
      const o = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, nav: !!document.querySelector("nav") }));
      ok(o.over <= 1, `${p} overflows by ${o.over}px`); ok(o.nav, `${p} has no nav`);
      await page.screenshot({ path: `/tmp/drape-shots/${w}${p.replace(/\//g, "_")}.png` });
    }
  });
}
await page.setViewport({ width: 1280, height: 900 });

await test("accessibility basics: every page has a heading, labelled inputs/buttons, a skip link", async () => {
  for (const p of ["/", "/wardrobe/", "/outfits/", "/profile/", "/settings/"]) {
    await go(page, p);
    const r = await page.evaluate(() => {
      const name = (e) => (e.getAttribute("aria-label") || e.innerText || e.title || e.labels?.[0]?.innerText || e.getAttribute("placeholder") || "").trim();
      return { h: !!document.querySelector("h1,h2"), skip: !!document.querySelector('a[href="#main"],a[href^="#"]'),
        unnamed: [...document.querySelectorAll("button,input:not([type=hidden]),select,textarea")].filter((e) => !name(e)).map((e) => e.outerHTML.slice(0, 80)) };
    });
    ok(r.h, `${p} has no heading`); ok(r.skip, `${p} has no skip link`); ok(r.unnamed.length === 0, `${p} unnamed controls: ${r.unnamed.slice(0, 2).join(" ")}`);
  }
});

await test("no uncaught page errors during the whole run", async () => { ok(errors.filter((e) => !/Failed to load resource|net::ERR/.test(e)).length === 0, errors.slice(0, 3).join(" || ")); });
await test("nothing left the machine except mocked AI providers", async () => { ok(!external.some((h) => !/generativelanguage|groq|openrouter|BLOCKED/.test(h)), [...new Set(external)].join(",")); });

await browser.close();
const bad = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed (MOCKED Supabase + MOCKED AI providers)`);
process.exit(bad.length ? 1 : 0);
