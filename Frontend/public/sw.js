/*
 * Drape's service worker: cache-first for the app's own, content-hashed files (scripts, styles, fonts, icons).
 * Those URLs change whenever their content does, so a cached copy is never stale — and repeat visits stop
 * re-checking dozens of files with the network. Pages (HTML) and every other origin (Supabase, the AI
 * providers, weather) are never touched, so a new deploy is picked up immediately and data is always live.
 */
const CACHE = "drape-assets-v1";
const MAX_ENTRIES = 160;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

const cacheable = (url) => url.origin === self.location.origin && /\/(_next\/static|icons)\//.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!cacheable(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone()).then(async () => {
          // Keep it bounded: drop the oldest files once there are too many (old deploys' chunks).
          const keys = await cache.keys();
          for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(stale);
        });
      }
      return response;
    })()
  );
});
