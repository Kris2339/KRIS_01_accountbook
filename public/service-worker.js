const CACHE = "accountbook-shell-classic-1.0.1";
const SHELL = [
  "/",
  "/legacy-storage.js?v=classic-1",
  "/core.js",
  "/sync.js",
  "/manifest.json",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const path of SHELL) {
        const response = await fetch(path);
        if (response.ok && !response.redirected)
          await cache.put(path, response);
      }
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (
          key.startsWith("saenghwal-gagyebu-") ||
          (key.startsWith("accountbook-shell-") && key !== CACHE)
        )
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/login.html"
  )
    return;
  if (
    !SHELL.some((x) => new URL(x, url.origin).pathname === url.pathname) &&
    url.pathname !== "/index.html"
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok && !response.redirected)
          await cache.put(event.request, response.clone());
        return response;
      } catch {
        return (
          (await cache.match(event.request)) ||
          (event.request.mode === "navigate" ? await cache.match("/") : null) ||
          Response.error()
        );
      }
    })(),
  );
});
