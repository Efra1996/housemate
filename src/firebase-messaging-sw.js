/* A small native Push API handler; no SDK, credentials, or app cache in the worker. */
self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const data = payload?.data || {};
  event.waitUntil(self.registration.showNotification('Semana organizada', {
    body: 'Las tareas de la semana ya están organizadas.',
    icon: '/assets/icon/housemate-192.png',
    tag: typeof data.weekStart === 'string' ? `organized-${data.weekStart}` : 'organized-week',
    data: { url: new URL('/tabs/calendar', self.location.origin).href },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL('/tabs/calendar', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.navigate(url);
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
