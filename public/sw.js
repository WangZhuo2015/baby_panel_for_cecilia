// Service Worker – PWA lifecycle + Multi-strategy Caching + Push notifications
const CACHE_VERSION = 'v1.2.0';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const IMMUTABLE_CACHE = `immutable-${CACHE_VERSION}`;
const MEDIA_CACHE = `media-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

// Assets to pre-cache during install
const PRECACHE_ASSETS = [
  OFFLINE_URL,
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/icon.svg',
  '/icons.svg',
];

const VALID_CACHES = [STATIC_CACHE, IMMUTABLE_CACHE, MEDIA_CACHE];
// 各运行时缓存条目上限：防 Cache Storage 无限增长（quota 满会连坐整站存储）
const MAX_MEDIA_ENTRIES = 300;
const MAX_IMMUTABLE_ENTRIES = 400;

// Handle messages from pages
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(Promise.all(VALID_CACHES.map((name) => caches.delete(name))));
  }
});

// ===== Lifecycle =====
// ⚠️ 不在 install 里自动 skipWaiting：新版本必须等页面用户点击「更新」后才接管，
//    否则部署瞬间所有在线页面被强刷、未提交的表单数据全部丢失。

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !VALID_CACHES.includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ===== Cache write helpers =====

async function putAndTrim(cacheName, request, response, maxEntries) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  try {
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      await cache.delete(keys[0]); // FIFO 淘汰最旧
    }
  } catch {
    /* 清理失败不影响本次响应 */
  }
}

// ===== Fetch Strategies =====

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests —— 必须用 URL.origin 精确比较，
  // startsWith 子串匹配会被 baby.zwang.fun.evil.com 这类域绕过（缓存投毒面）
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Range/分段请求直通：206 Partial 入缓存会让残片永久顶替完整资源
  if (request.headers.has('range')) return;

  const pathname = url.pathname;

  // 1. Navigation requests → Network-First；网关错误(502/503 实体页)同样回退 offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok && response.type !== 'opaqueredirect') {
            throw new Error(`gateway ${response.status}`);
          }
          return response;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // 2. Next.js static immutable chunks → Cache-First with Network fallback
  if (pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request)
          .then((networkResponse) => {
            if (networkResponse.ok && networkResponse.status !== 206) {
              event.waitUntil(
                putAndTrim(IMMUTABLE_CACHE, request, networkResponse.clone(), MAX_IMMUTABLE_ENTRIES).catch(() => {})
              );
            }
            return networkResponse;
          });
      })
    );
    return;
  }

  // 3. Static media, icons, and images → Stale-While-Revalidate
  // ⚠️ /uploads/*（宝宝头像/医学影像）刻意排除：Cache API 不遵守 private 头，
  //    缓存后登出也无法清理，共享电脑上构成隐私泄露。
  const isStaticImage =
    (pathname.startsWith('/icons/') ||
      pathname.startsWith('/images/') ||
      pathname === '/favicon.svg' ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.svg') ||
      pathname.endsWith('.jpg') ||
      pathname.endsWith('.jpeg') ||
      pathname.endsWith('.webp') ||
      pathname.endsWith('.ico')) &&
    !pathname.startsWith('/uploads/');

  if (isStaticImage && !pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok && networkResponse.status !== 206) {
                const copy = networkResponse.clone();
                event.waitUntil(
                  putAndTrim(MEDIA_CACHE, request, copy, MAX_MEDIA_ENTRIES).catch(() => {})
                );
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);

          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // 4. API endpoints → Network-Only with graceful offline JSON response
  if (pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: "网络连接不可用，请检查您的网络连接。" }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );
    return;
  }

  // 5. Default fallback
  event.respondWith(
    fetch(request).catch(async () => {
      const match = await caches.match(request);
      return match || new Response("Network error", { status: 503 });
    })
  );
});


// ===== Push Notifications =====

self.addEventListener('push', function (event) {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || '您有一条新通知',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      vibrate: [100, 50, 100],
      tag: data.tag || 'baby-panel', // 同 tag 去重，连环推送不堆叠
      data: {
        url: data.url || '/notifications',
      },
    };

    event.waitUntil(self.registration.showNotification(data.title || '宝宝成长助手', options));
  } catch {
    // If data isn't JSON, show as plain text
    event.waitUntil(
      self.registration.showNotification('宝宝成长助手', {
        body: event.data.text(),
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        vibrate: [100, 50, 100],
      })
    );
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const raw = event.notification.data?.url || '/notifications';
  let target;
  try {
    target = new URL(raw, self.location.origin);
  } catch {
    return;
  }
  // 仅允许站内路径：推送 payload 被伪造时不可导流到外部域
  if (target.origin !== self.location.origin) return;
  const urlToOpen = target.href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      // Focus 精确匹配同一路径的窗口（includes 会误中 /settings/notifications-x 这类页面）
      for (const client of windowClients) {
        if ('focus' in client) {
          try {
            if (new URL(client.url).pathname === target.pathname) {
              return client.focus();
            }
          } catch { /* ignore malformed client urls */ }
        }
      }
      // 已有窗口但不在目标页 → 导航它而非开新窗
      for (const client of windowClients) {
        if ('navigate' in client) {
          return client.navigate(urlToOpen);
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
