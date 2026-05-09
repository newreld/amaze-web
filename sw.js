// AMAZE service worker — pre-cache everything, serve cache-first.
// Bump CACHE on every release to force fresh assets on next launch.

const CACHE = 'amaze-v11';

const ASSETS = [
  '.',
  'index.html',
  'main.js',
  'game.js',
  'maze.js',
  'style.css',
  'manifest.json',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'assets/branch_trunk_1.png',
  'assets/branch_trunk_2.png',
  'assets/branch_drood_1.png',
  'assets/branch_drood_2.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Only intercept GETs.  Other methods (rare for a static game) pass through.
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
