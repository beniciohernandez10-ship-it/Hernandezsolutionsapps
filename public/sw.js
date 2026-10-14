/*
 * Hernandez Solutions IT Center service worker.
 *
 * Purpose: make the portal installable and keep static build assets fast.
 * It deliberately NEVER caches pages, API responses, tickets or identity data:
 * everything except immutable /_next/static/ assets goes straight to the network.
 * Signing out sends Clear-Site-Data, which also clears this cache.
 */
const STATIC_CACHE = "itc-static-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/_next/static/")) return; // network only

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    }),
  );
});
