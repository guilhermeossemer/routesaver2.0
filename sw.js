const CACHE_NAME = "routesaver-v16";

const urlsToCache = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./public/pages/dashboard.html",
  "./public/pages/register.html",
  "./public/css/auth.css",
  "./public/css/dashboard.css",
  "./public/css/style.css",
  "./public/js/auth.js",
  "./public/js/dashboard.js",
  "./public/js/firebase-config.js",
  "./public/js/map-provider.js",
  "./public/js/maps-config.js",
  "./public/js/route-geometry.js",
  "./public/img/favicon-64.png",
  "./public/img/favicon-192.png",
  "./public/img/favicon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== location.origin
  ) {
    return;
  }

  const needsFreshVersion =
    event.request.mode === "navigate" ||
    ["script", "style", "manifest"].includes(event.request.destination);

  event.respondWith(needsFreshVersion
    ? fetchAndUpdateCache(event.request)
    : caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetchAndUpdateCache(event.request);
    })
  );
});

async function fetchAndUpdateCache(request) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
    throw error;
  }
}
