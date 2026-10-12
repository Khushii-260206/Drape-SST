// MOCKED browser harness. Drives real Chrome against the static export, but every request to the (dummy) Supabase host is
// answered by the in-memory fake from tests/fake-supabase.ts, and the AI providers are answered by canned replies.
// Nothing here reaches a real Supabase project or AI provider. Needs: npm i --no-save puppeteer-core (Chrome installed).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { deflateSync } from "node:zlib";
const require = createRequire(process.env.PUPPETEER_DIR ? process.env.PUPPETEER_DIR + "/package.json" : import.meta.url);
const puppeteer = require("puppeteer-core");
const { FakeSupabase } = await import("../tests/fake-supabase.ts");

// Browser: $CHROME, else the first installed of Brave / Chrome / Chromium. (Chrome 156 crashed mid-run on one machine, so Brave goes first.)
const CANDIDATES = [
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/brave-browser", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
export const CHROME = process.env.CHROME ?? CANDIDATES.find((p) => existsSync(p));
if (!CHROME) throw new Error("No Chrome/Brave/Chromium found. Set CHROME=/path/to/browser.");

// Site: $BASE_URL if you serve it yourself, otherwise out/ is served from here. It must be the mock build (npm run e2e:build),
// so a build made with real Supabase settings can never be what the browser tests drive.
let server;
export let BASE = process.env.BASE_URL;
if (!BASE) {
  const out = path.resolve(import.meta.dirname, "../.e2e-out");
  if (!existsSync(out + "/index.html")) throw new Error("Frontend/.e2e-out is missing. Run: npm run e2e:build");
  const built = readdirSync(out + "/_next/static/chunks").filter((f) => f.endsWith(".js")).some((f) => readFileSync(`${out}/_next/static/chunks/${f}`, "utf8").includes("mock-project.invalid"));
  if (!built) throw new Error("Frontend/.e2e-out was not built for the browser tests (it does not use the mock Supabase host). Run: npm run e2e:build");
  // A build older than the source would silently test yesterday's code (that once produced a false photo-expiry failure).
  const newest = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(path.join(dir, e.name)) : statSync(path.join(dir, e.name)).mtimeMs), 0);
  const srcRoot = path.resolve(import.meta.dirname, "..");
  const sourceTime = Math.max(newest(srcRoot + "/src"), statSync(srcRoot + "/next.config.ts").mtimeMs, statSync(srcRoot + "/package.json").mtimeMs);
  if (statSync(out + "/index.html").mtimeMs < sourceTime) throw new Error("Frontend/.e2e-out is older than the source, so it would test stale code. Run: npm run e2e:build (or npm run e2e, which rebuilds first)");
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".txt": "text/plain" };
  server = createServer((req, res) => {
    let file = path.join(out, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(out)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    // Like GitHub Pages: an unknown address gets the site's own 404.html, with a 404 status.
    let status = 200;
    if (!existsSync(file)) { file = path.join(out, "404.html"); status = 404; if (!existsSync(file)) { res.writeHead(404).end("not found"); return; } }
    res.writeHead(status, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  BASE = `http://localhost:${server.address().port}`;
}
export const stopServer = () => server?.close();

// A real, valid PNG (solid colour) so the browser can decode it for thumbnails and previews.
export function png(w = 64, h = 64, rgb = [200, 120, 150]) {
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    let x = 0xffffffff; for (const b of buf) x = t[(x ^ b) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };

/** ai: (url, body) => { status, body, stream? } | undefined */
export async function launch({ ai, width = 1280, height = 900 } = {}) {
  const fake = new FakeSupabase();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, dumpio: Boolean(process.env.E2E_DUMPIO), args: ["--no-sandbox", `--user-data-dir=/tmp/drape-chrome-${process.pid}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-features=OptimizationHints,MediaRouter"] });
  const errors = [];
  const external = [];
  /** failNextImages: that many signed-photo downloads are refused (as an expired link would be) before they succeed again. */
  const photoFaults = { failNextImages: 0 };
  /** A fresh tab in the same browser context: same localStorage, same fake backend. */
  async function open(viewport = { width, height }) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.setBypassServiceWorker(true); // the production service worker is a caching layer, not UI logic
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.setRequestInterception(true);
    page.on("request", async (req) => {
      const url = new URL(req.url());
      if (url.origin === BASE) return req.continue();
      if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: CORS });
      if (url.hostname === "mock-project.invalid") {
        if (url.pathname.startsWith("/storage/v1/object/sign/") && req.method() === "GET" && photoFaults.failNextImages > 0) { photoFaults.failNextImages--; return req.respond({ status: 400, headers: CORS, contentType: "application/json", body: '{"error":"InvalidJWT","message":"exp claim timestamp check failed"}' }); }
        if (url.pathname.startsWith("/storage/v1/object/sign/") && req.method() === "GET") return req.respond({ status: 200, contentType: "image/png", headers: CORS, body: png() });
        const init = { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined };
        let res;
        try { res = await fake.handle(req.url(), init); } catch { return req.abort("connectionfailed"); } // a simulated network failure
        return req.respond({ status: res.status, headers: { ...CORS, "content-type": res.headers.get("content-type") ?? "application/json" }, body: Buffer.from(await res.arrayBuffer()) });
      }
      const a = ai?.(req.url(), req.postData());
      if (a) { external.push(url.hostname); if (a.delay) await sleep(a.delay); return req.respond({ status: a.status ?? 200, headers: { ...CORS, "content-type": a.contentType ?? "application/json" }, body: a.body }); }
      external.push("BLOCKED:" + url.hostname); // weather, fonts, anything else never leaves the machine
      return req.abort("blockedbyclient");
    });
    page.on("dialog", (d) => void d.accept());
    return page;
  }
  return { browser, open, fake, errors, external, photoFaults };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
