// Saves the app on the phone so it works with no internet connection.
//
// Online, it always fetches the latest version (so updates show up on their
// own) and saves a copy. Offline, or on a very slow connection, it uses the
// saved copy. Your own sounds are stored separately and are never touched.
const VERSION = 'spookboard-v4';
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // cache: 'reload' skips the browser's own cache, so we never save a stale file.
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first, with a short timeout so a weak connection never stalls the app.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      try {
        const fresh = await Promise.race([
          fetch(e.request, { cache: 'no-cache' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 3000)),
        ]);
        if (fresh.ok) cache.put(e.request, fresh.clone());
        return fresh;
      } catch {
        const saved = await cache.match(e.request, { ignoreSearch: true });
        return saved || Response.error();
      }
    })(),
  );
});
