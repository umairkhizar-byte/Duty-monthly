// Bump this version any time you change app.js / index.html / styles,
// so returning phones pick up the new files instead of an old cached copy.
const CACHE_NAME = 'duty-roster-cache-v1';

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Never cache Firebase/Firestore traffic - that data must always be live.
  if (url.includes('googleapis.com') || url.includes('gstatic.com/firebasejs') || url.includes('firebaseio.com')) {
    return;
  }

  // App shell: cache-first, falling back to network, so the app still opens offline.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
