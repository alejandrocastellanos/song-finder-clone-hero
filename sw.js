/* Caches the app itself so it opens offline and installs as an app. Songs and searches always go to the network. */
// named after the app version (the badge in index.html), so each release replaces the cache
const CACHE = 'chb-v1.7.0';
const SHELL = ['./', 'index.html', 'i18n.js', 'app.js', 'analytics.js', 'community.js', 'core/chb-core.js', 'packs.js', 'fx.js', 'preview.js', 'autochart.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  // 'reload' skips the browser's HTTP cache, so a new version never stores the old files
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first, so updates show up right away; the cache is the offline fallback.
  // 'no-cache' asks the server each time (GitHub Pages lets browsers keep files 10 minutes), so right after
  // publishing a page never mixes the new index.html with the old scripts; unchanged files come back as a quick 304.
  e.respondWith(
    // a page load (mode 'navigate') can't be copied with new options, so it goes by its address
    fetch(e.request.mode === 'navigate' ? new Request(url.href, { cache: 'no-cache' }) : new Request(e.request, { cache: 'no-cache' })).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
