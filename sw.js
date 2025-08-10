const CONFIG_BASE = './';

// Try to fetch a practice config JSON (e.g., Z00085.json in repo root)
async function fetchConfig(practiceCode){
  try{
    const res = await fetch(`${CONFIG_BASE}${practiceCode}.json`, {cache:'no-cache'});
    if(!res.ok) return null;
    const cfg = await res.json();
    return cfg;
  }catch(e){ return null; }
}

const CACHE_NAME = 'froom-pwa-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k!==CACHE_NAME ? caches.delete(k) : null)))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
