// Service Worker for Web Push Notifications
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
