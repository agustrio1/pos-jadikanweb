/* Service worker POS JadikanWeb. Ditulis tangan, tanpa dependensi.
   Naikkan VERSION jika logika caching berubah. */
const VERSION = "v1";
const STATIC_CACHE = `pos-static-${VERSION}`;
const PAGE_CACHE = `pos-pages-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon.svg", "/manifest.webmanifest"];
// Hanya halaman ini yang boleh dibuka offline dari cache.
const CACHEABLE_PAGES = new Set(["/kasir"]);
const NAV_TIMEOUT_MS = 3000;
const MAX_ASSET_ENTRIES = 150;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("pos-") && !keep.has(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // Data dinamis dan milik pengguna tidak pernah di-cache.
  if (
    path.startsWith("/api/") ||
    path.endsWith(".data") ||
    path === "/__manifest"
  ) {
    return;
  }

  if (path.startsWith("/assets/") || PRECACHE.includes(path)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "CLEAR_PAGES") {
    event.waitUntil(caches.delete(PAGE_CACHE));
  } else if (data.type === "CACHE_URLS" && Array.isArray(data.urls)) {
    event.waitUntil(cacheUrls(data.urls));
  }
});

async function offlineResponse() {
  const cache = await caches.open(STATIC_CACHE);
  const page = await cache.match(OFFLINE_URL);
  return (
    page ||
    new Response("Anda sedang offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}

async function trimAssets(cache) {
  const keys = await cache.keys();
  const assets = keys.filter(
    (key) => new URL(key.url).pathname.startsWith("/assets/"),
  );
  const extra = assets.length - MAX_ASSET_ENTRIES;
  if (extra > 0) {
    await Promise.all(assets.slice(0, extra).map((key) => cache.delete(key)));
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const res = await fetch(request);
  if (res.status === 200 && res.type === "basic") {
    await cache.put(request, res.clone());
    await trimAssets(cache);
  }
  return res;
}

async function handleNavigation(event) {
  const request = event.request;
  const path = new URL(request.url).pathname;
  const networkPromise = fetch(request);

  if (!CACHEABLE_PAGES.has(path)) {
    try {
      return await networkPromise;
    } catch {
      return offlineResponse();
    }
  }

  const cache = await caches.open(PAGE_CACHE);
  const key = new Request(self.location.origin + path);

  const fresh = networkPromise.then((res) => {
    // Jangan menyimpan redirect (mis. sesi habis -> /login) atau error.
    if (res.status === 200 && res.type === "basic" && !res.redirected) {
      event.waitUntil(cache.put(key, res.clone()));
    }
    return res;
  });

  const cached = await cache.match(key);
  if (!cached) {
    try {
      return await fresh;
    } catch {
      return offlineResponse();
    }
  }

  // Ada cadangan: tunggu jaringan sebentar, lalu pakai cache.
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve(null), NAV_TIMEOUT_MS),
  );
  const result = await Promise.race([fresh.catch(() => null), timeout]);
  return result || cached;
}

async function cacheUrls(urls) {
  const origin = self.location.origin;
  const staticCache = await caches.open(STATIC_CACHE);
  const pageCache = await caches.open(PAGE_CACHE);

  await Promise.allSettled(
    urls.map(async (raw) => {
      const url = new URL(raw, origin);
      if (url.origin !== origin) return;

      if (url.pathname.startsWith("/assets/")) {
        if (await staticCache.match(url.href)) return;
        const res = await fetch(url.href);
        if (res.status === 200 && res.type === "basic") {
          await staticCache.put(url.href, res);
        }
        return;
      }

      if (CACHEABLE_PAGES.has(url.pathname)) {
        // redirect "manual": sesi habis tidak boleh tersimpan sebagai halaman kasir.
        const res = await fetch(url.href, {
          credentials: "same-origin",
          redirect: "manual",
        });
        if (res.status === 200 && res.type === "basic") {
          await pageCache.put(new Request(origin + url.pathname), res);
        }
      }
    }),
  );
  await trimAssets(staticCache);
}