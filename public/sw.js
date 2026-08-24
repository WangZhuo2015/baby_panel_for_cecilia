// Service Worker – PWA lifecycle + Multi-strategy Caching + Push notifications
const CACHE_VERSION = 'v1.1.0';
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

// Handle direct message to skip waiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ===== Lifecycle =====

self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force active immediately
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  // Clean up all old caches completely and take control of all clients immediately
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

// ===== Fetch Strategies =====

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  if (!request.url.startsWith(self.location.origin)) return;

  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. Navigation requests (HTML pages) → Network-First with /offline.html fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // 2. Next.js static immutable chunks / styles (/_next/static/*) → Cache-First with Network fallback
  if (pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(IMMUTABLE_CACHE).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. Static media, icons, and images (/icons/*, /images/*, images) → Stale-While-Revalidate
  const isStaticImage =
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/images/') ||
    pathname === '/favicon.svg' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.ico');

  if (isStaticImage && !pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok) {
                cache.put(request, networkResponse.clone());
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

  const urlToOpen = event.notification.data?.url || '/notifications';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      // Focus existing window if available
      for (const client of windowClients) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
