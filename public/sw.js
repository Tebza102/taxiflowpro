const CACHE_NAME = "taxiflow-pro-v3";
const APP_SHELL = ["/", "/manifest.webmanifest", "/pwa-192.png", "/pwa-512.png"];
const STATIC_ASSET_PATTERN =
  /\.(?:js|css|png|jpg|jpeg|svg|webp|gif|ico|woff2?|ttf|otf|json|webmanifest)$/i;
const BLOCKED_PATH_PREFIXES = ["/api/", "/functions/", "/analytics/", "/platform/"];

const isBlockedRequest = (requestUrl) => {
  const { hostname, pathname } = new URL(requestUrl);

  if (hostname.includes("supabase")) {
    return true;
  }

  return BLOCKED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
};

const isStaticAssetRequest = (requestUrl) => {
  const { pathname } = new URL(requestUrl);
  return APP_SHELL.includes(pathname) || STATIC_ASSET_PATTERN.test(pathname);
};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (isBlockedRequest(event.request.url)) {
    // Operational data must always bypass the worker cache.
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached ?? caches.match("/"))),
    );
    return;
  }

  if (!isStaticAssetRequest(event.request.url)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request).then((response) => {
        if (!response.ok) {
          return response;
        }

        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }),
  );
});
