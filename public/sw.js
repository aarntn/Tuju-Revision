const cacheName = "jalan-pulang-v5";
const mapAssets = new Set(["/drive-car.png", "/garage/kart-coral-top.webp", "/stops/rnr.png", "/stops/layby.png", "/stops/home.png", "/welcome-route.svg", "/kl-map-preview.jpg", "/kl-ipoh-drive-preview.webp"]);
const shell = ["/", "/?t=1", "/?welcome=1", "/?home=1", "/?t=1&home=1", "/plan", "/share", "/about", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", ...mapAssets];
const dataPaths = new Set(["/api/weather", "/api/prayer"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then(async (cache) => {
    const assets = new Set();
    await Promise.allSettled(shell.map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) return;
      await cache.put(path, response.clone());
      if (!response.headers.get("Content-Type")?.includes("text/html")) return;
      const html = await response.text();
      for (const [, asset] of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assets.add(asset);
    }));
    await Promise.allSettled([...assets].map((url) => cache.add(url)));
    await self.skipWaiting();
  }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("jalan-pulang-") && key !== cacheName).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_ASSETS" || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter((value) => {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
  });
  event.waitUntil(caches.open(cacheName).then((cache) => Promise.allSettled(urls.map(async (url) => {
    if (!(await cache.match(url))) await cache.add(url);
  }))));
});

async function serve(request, asset, navigation, api) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(request);
  if (asset && saved) return saved;
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone()).catch(() => {});
      return response;
    }
    if (!saved || response.status < 500) return response;
  } catch {
    const { pathname, searchParams } = new URL(request.url);
    if (!saved && navigation && ["/", "/plan"].includes(pathname)) {
      const rootQuery = new URLSearchParams();
      if (pathname === "/") {
        for (const key of ["t", "home", "welcome"]) if (searchParams.get(key) === "1") rootQuery.set(key, "1");
      }
      const fallback = rootQuery.size ? pathname + "?" + rootQuery : pathname;
      const page = await cache.match(fallback) ?? await cache.match(pathname);
      if (page) return page;
    }
  }
  if (saved && api) {
    const data = await saved.json();
    for (const item of [data.warnings, data.forecast, data.source]) {
      if (item?.status === "live") item.status = "cached";
    }
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  }
  return saved ?? new Response("Offline", { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const api = dataPaths.has(url.pathname);
  const asset = url.pathname.startsWith("/_next/static/") || mapAssets.has(url.pathname) || url.pathname.startsWith("/icon-");
  const navigation = request.mode === "navigate" && ["/", "/plan", "/about", "/share"].includes(url.pathname);
  if (asset || navigation || api) event.respondWith(serve(request, asset, navigation, api));
});
