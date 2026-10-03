// Caché simple: guarda la app para que abra sin internet. Subir CACHE al cambiar archivos.
const CACHE = 'bravo-v7';
const ARCHIVOS = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.json',
  'data/ejercicios.json', 'data/plan.json',
  'fonts/barlow-condensed-latin-700-normal.woff2', 'fonts/barlow-condensed-latin-800-normal.woff2',
  'fonts/barlow-latin-400-normal.woff2', 'fonts/barlow-latin-600-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (para recibir cambios), si falla usa la caché.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(req, copia));
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
