const CACHE_NAME = 'saenghwal-gagyebu-v4';
const urlsToCache = [
  '/manifest.json'
];

// 설치 이벤트: 필요한 파일들을 캐시에 저장
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  // 새 Service Worker를 즉시 활성화
  self.skipWaiting();
});

// 활성화 이벤트: 오래된 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // 즉시 모든 클라이언트에서 Service Worker 제어 시작
  self.clients.claim();
});

// Fetch 이벤트: 네트워크 우선, 실패 시 캐시 사용 (Network First)
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  const isStaticGet = event.request.method === 'GET' && requestUrl.origin === self.location.origin;

  // API 응답은 개인정보이며 최신성이 중요하므로 절대 캐시하지 않습니다.
  if (!isStaticGet || requestUrl.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 응답이 유효하면 캐시에도 저장
        const cacheControl = response.headers.get('cache-control') || '';
        if (response && response.status === 200 && !response.redirected && !cacheControl.includes('no-store')) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 시 캐시에서 반환
        return caches.match(event.request).then((response) => {
          if (response) {
            return response;
          }
          return Response.error();
        });
      })
  );
});
