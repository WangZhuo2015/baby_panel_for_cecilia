// Service Worker – PWA lifecycle + Push notifications
// Cache version: bump when deploying a new version
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

// Assets to pre-cache during install
const PRECACHE_ASSETS = [
  OFFLINE_URL,
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

// ===== Lifecycle =====

self.addEventListener('install', (event) => {
  // Pre-cache the offline fallback page and critical assets
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // Clean up old caches and take control of all pages immediately
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('static-') && key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ===== Fetch =====

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  if (!request.url.startsWith(self.location.origin)) return;

  // Navigation requests (HTML pages) → network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Static assets (JS, CSS, images, fonts) → network-first, no caching
  // We intentionally do NOT cache these so the app always gets fresh
  // content from the server. The SW's role here is to ensure it doesn't
  // block requests by simply passing them through.
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
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
