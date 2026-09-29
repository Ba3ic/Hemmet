// Hemmet – service worker.
// Appskalet cachas så att appen startar utan nät. Data från Supabase och SMHI hämtas
// från nätet i första hand och från cachen när nätet saknas (läsa offline).
// Höj VERSION när du lägger till eller tar bort filer i SHELL.

const VERSION = 'v1';
const SHELL_CACHE = `hemmet-shell-${VERSION}`;
const CDN_CACHE = 'hemmet-cdn';
const DATA_CACHE = 'hemmet-data';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/auth.js',
  'js/config.js',
  'js/state.js',
  'js/supabase.js',
  'js/realtime.js',
  'js/theme.js',
  'js/ui.js',
  'js/images.js',
  'js/events.js',
  'js/idag.js',
  'js/kalender.js',
  'js/listor.js',
  'js/anteckningar.js',
  'js/utgifter.js',
  'js/installningar.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('hemmet-shell-') && k !== SHELL_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Appen ber oss rensa cachad data vid utloggning.
self.addEventListener('message', (event) => {
  if (event.data === 'clear-data') event.waitUntil(caches.delete(DATA_CACHE));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Appens egna filer
  if (url.origin === self.location.origin) {
    // Nätet först, så att ändringar (t.ex. i config.js) syns direkt; cachen när nätet saknas.
    event.respondWith(networkFirst(req, SHELL_CACHE, req.mode === 'navigate' ? 'index.html' : null, { ignoreSearch: true }));
    return;
  }

  // supabase-js från CDN (versionslåst, ändras aldrig)
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(req, CDN_CACHE));
    return;
  }

  // Data: Supabase REST (inte inloggning eller lagring) och SMHI-prognoser
  if ((url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/')) ||
      url.hostname === 'opendata-download-metfcst.smhi.se') {
    event.respondWith(networkFirst(req, DATA_CACHE));
  }
});

async function networkFirst(req, cacheName, fallbackPath, matchOpts = {}) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreVary: true, ...matchOpts }) ||
      (fallbackPath && await cache.match(fallbackPath));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
