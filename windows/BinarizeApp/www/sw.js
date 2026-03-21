const CACHE_NAME = "kakoapp-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./main.js",
  "./pixel-dither.html",
  "./manga-tone.html",
  "./flipnote-dither.html",
  "./manifest.webmanifest",
  "./offline.html",
  "./pwa.js",
  "./icons/icon-180.png",
  "./icons/icon-256.png",
  "./icons/icon-512.png",
  "./wasm/lineart_wasm.js",
  "./wasm/lineart_wasm_bg.wasm",
  "./wasm-fill/fill_wasm.js",
  "./wasm-fill/fill_wasm_bg.wasm"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./offline.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        return response;
      });
    })
  );
});
