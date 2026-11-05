/* 유림 가계부 서비스워커 — 앱 셸 오프라인 캐싱 */
const CACHE = 'yunseul-v4';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Supabase 요청은 캐시하지 않고 그대로 네트워크로
  if (url.origin !== self.location.origin) {
    // 글꼴·라이브러리(CDN)는 한 번 받으면 캐시해서 오프라인에서도 열리게
    if (/cdn\.jsdelivr\.net$/.test(url.hostname) && e.request.method === 'GET') {
      e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return res;
      })));
    }
    return;
  }

  const isShell = e.request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html') || url.pathname.endsWith('.js');
  if (isShell) {
    // 앱 화면·코드는 네트워크 우선 → 수정사항이 바로 반영됨, 오프라인이면 캐시
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        const key = e.request.mode === 'navigate' ? './index.html' : e.request;
        caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }
  // 그 외 자산(아이콘 등)은 캐시 우선
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
    )
  );
});
