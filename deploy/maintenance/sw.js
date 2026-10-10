// Maintenance service worker. It replaces any earlier TaxiFlow worker (same
// /sw.js path), deletes every cache that worker created (including the cached
// legacy app shell), reloads open pages so they show the maintenance page from
// the network, and then unregisters itself. It never serves anything from cache.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: "window" });
      await self.registration.unregister();
      await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => undefined)));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
