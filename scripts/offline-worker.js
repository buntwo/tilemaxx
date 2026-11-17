/* ASSETS, OCR_ASSETS, OCR_CACHE_NAME and CACHE_NAME are supplied by build-offline.mjs. */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Install atomically: a partial download must never replace a working app.
      await cache.addAll(ASSETS);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (
          (name.startsWith("tilemaxx-app-") && name !== CACHE_NAME) ||
          (name.startsWith("tilemaxx-ocr-") && name !== OCR_CACHE_NAME)
        )
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  const path = request.mode === "navigate" ? "/index.html" : url.pathname;
  if (!ASSETS.includes(path) && !OCR_ASSETS.includes(path)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(
        OCR_ASSETS.includes(path) ? OCR_CACHE_NAME : CACHE_NAME,
      );
      const cached = await cache.match(path);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(path, response.clone());
      return response;
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.kind === "activate-update") {
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        // The requesting idle tab will reload. Do not disrupt other running tabs.
        const activating = clients.length <= 1;
        event.ports[0]?.postMessage({ activating });
        if (activating) await self.skipWaiting();
      })(),
    );
    return;
  }
  if (event.data?.kind !== "prepare-offline") return;
  const port = event.ports[0];
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(OCR_CACHE_NAME);
        // Reuse unchanged OCR assets across app updates.
        // Sequential copies bound memory while preparing the larger OCR files.
        for (const path of OCR_ASSETS) {
          if (!(await cache.match(path))) await cache.add(path);
        }
        port?.postMessage({ ready: true });
      } catch {
        port?.postMessage({ ready: false });
      }
    })(),
  );
});
