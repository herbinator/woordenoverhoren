// Verhoog dit nummer bij elke nieuwe versie, dan halen apparaten de update op.
const CACHE = 'woordenoverhoren-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './logic.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('woordenoverhoren-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Tekstherkenning (script, wasm, taalbestanden) van de CDN: eenmaal ophalen en bewaren.
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Eigen bestanden: met internet altijd de nieuwste versie, zonder internet uit de cache.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        try {
          const res = await fetch(req, { cache: 'no-cache' });
          if (res.ok) c.put(req, res.clone());
          return res;
        } catch {
          return (await c.match(req, { ignoreSearch: true })) || Response.error();
        }
      }),
    );
  }
});
