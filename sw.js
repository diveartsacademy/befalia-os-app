// Minimal service worker — caches the app shell so it installs and opens fast.
const CACHE = 'befalia-os-v10';
const SHELL = ['./index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  const url = e.request.url;
  // Never cache API calls — always go to network for fresh Notion data.
  if (url.indexOf('/api/') !== -1) { return; }
  e.respondWith(
    fetch(e.request).catch(function () { return caches.match(e.request); })
  );
});
