// Service worker: makes the game installable and caches the mobile asset set for fast reloads.
// Paths are relative to the worker's location, so it works under any sub-path (e.g. /swat-shooter/).
const CACHE = 'swat-v1.3.0';
const BASE = new URL('./', self.location).href;
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'assets/ui/icon-192.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new URL(u, BASE).href))).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('swat-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET' || !req.url.startsWith(BASE)) return;
  const path = req.url.slice(BASE.length).split('?')[0];
  // big, versioned-by-content files: cache first (mobile assets, three.js, PeerJS, UI images, fonts)
  if (/^(assets-mobile|libs|assets\/ui|assets\/fonts)\//.test(path)) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok && res.status === 200) c.put(req, res.clone()); return res;
    }));
    return;
  }
  // desktop assets are not cached (too large); everything else: network first, cache as offline fallback
  if (/^assets\//.test(path)) return;
  e.respondWith(fetch(req).then(res => { if (res.ok && res.status === 200) { const cl = res.clone(); caches.open(CACHE).then(c => c.put(req, cl)); } return res; })
    .catch(() => caches.match(req).then(r => r || caches.match(new URL('index.html', BASE).href))));
});
