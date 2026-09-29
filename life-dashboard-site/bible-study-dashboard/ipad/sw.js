"use strict";
const PREFIX = `esv-study-shell:${self.registration.scope}:`;
const CACHE = `${PREFIX}v4`;
const ASSETS = ["index.html", "offline.js", "manifest.webmanifest", "icon.png"];
const absolute = (path) => new URL(path, self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map((path) => new Request(absolute(path), { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: "window" });
    await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => null)));
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const root = absolute("./");
  const index = absolute("index.html");
  const path = url.origin + url.pathname;
  const key = path === root || path === index ? index : path;
  if (!ASSETS.some((asset) => absolute(asset) === key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(key) || fetch(event.request);
  })());
});

self.addEventListener("message", (event) => {
  if (!["CHECK_OFFLINE", "SAVE_OFFLINE"].includes(event.data?.type) || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    if (event.data.type === "SAVE_OFFLINE") {
      const missing = [];
      for (const path of ASSETS) {
        if (!await cache.match(absolute(path))) missing.push(absolute(path));
      }
      try { await cache.addAll(missing); } catch (_) { /* The readback below reports incomplete downloads. */ }
    }
    const files = await Promise.all(ASSETS.map((path) => cache.match(absolute(path))));
    event.ports[0].postMessage({ ready: files.every(Boolean) });
  })());
});
