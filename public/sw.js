const CACHE = "folio-v3";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(new Request("/", { headers: { Accept: "text/html" } }));
        if (response && response.ok) await cache.put("/", await settled(response));
      } catch {
        /* online install can retry on the next visit */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function settled(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  return new Response(body, { status: 200, statusText: "OK", headers });
}

/** Firefox refuses Cache.put for a navigate-mode request. Store a plain GET. */
function cacheKey(request) {
  if (request.mode !== "navigate") return request;
  return new Request(request.url, { method: "GET" });
}

async function store(request, response) {
  if (!response || !response.ok) return response;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(cacheKey(request), await settled(response.clone()));
  } catch {
    /* A full disk, or a response Firefox will not store, must not drop the page. */
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached =
        (await cache.match(request.mode === "navigate" ? request.url : request)) ||
        (request.mode === "navigate" ? await cache.match("/") : undefined);
      if (request.mode === "navigate") {
        try {
          return await store(request, await fetch(request));
        } catch {
          return cached || Response.error();
        }
      }
      const fresh = fetch(request)
        .then((response) => store(request, response))
        .catch(() => null);
      if (cached) {
        event.waitUntil(fresh);
        return cached;
      }
      return (await fresh) || Response.error();
    })(),
  );
});

