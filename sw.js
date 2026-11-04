// 앱 셸만 미리 저장. 지도 타일(openstreetmap.org)과 외부 링크는 저장하지 않음.
const CACHE = 'popup-tour-v3';
const SHELL = ['./', 'index.html', 'app.js', 'data.js', 'manifest.webmanifest', 'vendor/leaflet.js', 'vendor/leaflet.css', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 타일·네이버 등 외부는 네트워크 그대로
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
