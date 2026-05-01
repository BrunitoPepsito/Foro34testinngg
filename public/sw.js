/* Foro34 service worker — handles Web Push notifications.
 * Intentionally minimal: no caching, no offline; just push + click routing.
 * If you add caching later, bump the cache name on every deploy. */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_e) { payload = {}; }
  const title = payload.title || 'Foro34';
  const opts = {
    body: payload.body || '',
    tag: payload.tag || 'foro34',
    icon: '/img/logo-34.svg',
    badge: '/img/favicon.svg',
    data: payload.data || { url: '/' },
    renotify: false,
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        // Same-origin tab? Focus it and post a message so the SPA can route.
        if (new URL(c.url).origin === self.location.origin) {
          c.focus();
          c.postMessage({ type: 'notification:click', data });
          return;
        }
      } catch (_e) { /* ignore */ }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
