// データやコードを更新したら必ず番号を上げる（上げ忘れると端末に古い版が残る）
const CACHE = 'kunitori-goyomi-v11';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/main.js',
  'js/game.js',
  'js/battle.js',
  'js/ai.js',
  'js/turn.js',
  'js/map.js',
  'data/clans.json',
  'data/provinces.json',
  'data/rules.json',
  'data/coast.json',
  'data/generals.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// ブラウザに残った古い控えを取りこまないよう、入れ替えのときは必ずサーバーから取り直す
self.addEventListener('install', (e) => {
  const requests = ASSETS.map((url) => new Request(url, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// HTML と JSON は最新を優先し、圏外のときだけキャッシュを使う
function networkFirst(req) {
  return fetch(req)
    .then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })
    .catch(() => caches.match(req));
}

function cacheFirst(req) {
  return caches.match(req).then((hit) => hit || fetch(req));
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const fresh = e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('.json');
  e.respondWith(fresh ? networkFirst(e.request) : cacheFirst(e.request));
});
