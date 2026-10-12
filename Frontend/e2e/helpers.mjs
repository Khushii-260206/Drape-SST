import { BASE, sleep } from "./harness.mjs";
export const results = [];
export async function check(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS ", name); }
  catch (e) { results.push(["FAIL", name, String(e.message ?? e)]); console.log("FAIL ", name, "-", String(e.message ?? e).split("\n")[0]); }
}
export const ok = (c, m) => { if (!c) throw new Error(m); };
export const text = (page) => page.evaluate(() => document.body.innerText);
export async function clickText(page, re, scope = "button,a") {
  let el = null;
  for (let i = 0; i < 25 && !el; i++) { // poll up to ~4s: the page may still be hydrating or a dialog still opening
    const h = await page.evaluateHandle((src, scope) => [...document.querySelectorAll(scope)].find((e) => new RegExp(src, "i").test(e.innerText || e.getAttribute("aria-label") || "") && e.offsetParent !== null), re.source, scope);
    el = h.asElement(); if (!el) await sleep(160);
  }
  if (!el) throw new Error(`no visible element matching ${re}`);
  if (process.env.E2E_TRACE) console.log("    click:", await el.evaluate((e) => (e.innerText || e.getAttribute("aria-label") || "").slice(0, 40)));
  await el.evaluate((e) => e.scrollIntoView({ block: "center" })); // like a person scrolling, so a sticky bar can't cover the target
  await el.click(); await sleep(400);
}
const EMAIL = "asha@example.com", PASSWORD = "correct-horse";
/** Opens the app; if the sign-in screen is up, signs in (or creates the account the first time). */
export async function signIn(page, { create = false, email = EMAIL, password = PASSWORD } = {}) {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" });
  if (!(await page.$("#auth-email"))) return;
  await submitCredentials(page, { create, email, password });
}
/** Fills in and submits the sign-in form that is already on screen (no reload, so the page keeps its state). */
export async function submitCredentials(page, { create = false, email = EMAIL, password = PASSWORD } = {}) {
  await page.bringToFront(); // input events to a background tab never complete
  if (create) { await clickText(page, /^Create an account$/); }
  await page.type("#auth-email", email); await page.type("#auth-password", password);
  await page.click("form button[type=submit]");
  await page.waitForFunction(() => !document.querySelector("#auth-email"), { timeout: 10000 }) // wait for the session, not a fixed delay
    .catch(async () => { throw new Error("sign-in did not complete: " + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, " | ").slice(0, 300)); });
  await sleep(500);
}
export async function welcome(page, name = "Asha", creds = {}) {
  await signIn(page, creds);
  await enterName(page, name);
}
export async function enterName(page, name) {
  await page.waitForSelector('input[placeholder="Your name"], nav', { timeout: 10000 });
  if (await page.$('input[placeholder="Your name"]')) { await page.type('input[placeholder="Your name"]', name); await page.click("form button"); await sleep(600); }
}
/** Settings -> Sign out -> confirm, in the page as it is. */
export async function uiSignOut(page) {
  await page.bringToFront(); // input events to a background tab never complete
  await go(page, "/settings/");
  await clickText(page, /Sign out/);
  await clickText(page, /^Sign out$/, "[role=dialog] button, [role=alertdialog] button, dialog button").catch(() => {}); await sleep(900);
}
export async function go(page, path) { await page.goto(BASE + path, { waitUntil: "networkidle2" }); await sleep(600); }
export async function addItem(page, file, { type = "tshirt", color = "Navy", note = "" } = {}) {
  await clickText(page, /Add clothing item|Add your first clothing item/);
  const front = await page.$('input[type=file][aria-label="Front photo"], input[type=file]'); await front.uploadFile(file); await sleep(900);
  await page.select("[role=dialog] select", type);
  await page.evaluate((c) => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === c || b.innerText.trim() === c)?.click(), color);
  if (note) await page.type("[role=dialog] textarea", note);
  await page.evaluate(() => document.querySelector("[role=dialog] button[type=submit]").click()); await sleep(1500);
}
