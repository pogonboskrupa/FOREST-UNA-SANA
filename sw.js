// =====================================================================
// Service Worker — UNA SANA FOREST
// Promijeni APP_VERSION pri svakom deploymentu → okida update
// =====================================================================
const APP_VERSION = '1.2.7';
const APP_CACHE   = 'usf-app-v' + APP_VERSION;
const TILE_CACHE  = 'usf-tiles-v1';
const LIB_CACHE   = 'usf-lib-v1';

// App shell koji se uvijek precachira
const APP_SHELL = [
  './static/libs/protomaps-leaflet.js',
  './static/js/terrain-layers.js',
  './',
  './index.html',
  './static/js/offline-layer.js',
  './static/js/reliable-fetch.js',
  './static/libs/leaflet.min.js',
  './static/libs/leaflet.min.css',
  './static/libs/proj4.js',
  './static/libs/turf.min.js',
  './static/libs/sql-wasm.js',
  './static/libs/sql-wasm.wasm',
  './static/libs/firebase/firebase-app-compat.js',
  './static/libs/firebase/firebase-auth-compat.js',
  './static/libs/firebase/firebase-firestore-compat.js',
  './static/js/firebase-init.js',
  './static/js/road-design.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ─── INSTALL ─────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache =>
      // Otporno precachiranje — jedan nedostajući fajl (npr. u APK assets-u)
      // ne smije srušiti instalaciju cijelog service workera.
      Promise.allSettled(
        APP_SHELL.map(u =>
          fetch(u, { cache: 'reload' })
            .then(r => { if (r.ok) return cache.put(u, r); })
            .catch(() => {})
        )
      )
    )
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('usf-app-') && k !== APP_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH ───────────────────────────────────────────────────────────

// Helper — cache-then-fetch pattern for tile caches
// Pregledane pločice se čuvaju TRAJNO (bez FIFO trima) — korisnik ih briše sam
// kroz podešavanja. Protiv browser evikcije pri punom disku se štitimo sa
// navigator.storage.persist() (traži se iz aplikacije pri startu); na stvarno
// punom disku cache.put baci QuotaExceededError i tiho se preskoči.
function _tileRespond(event, cacheName) {
  event.respondWith(
    caches.open(cacheName).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try {
        const resp = await fetch(event.request);
        if (resp.ok) {
          try { await cache.put(event.request, resp.clone()); } catch(e) {}
        }
        return resp;
      } catch {
        return cached || new Response('', { status: 503 });
      }
    })
  );
}

self.addEventListener('fetch', event => {
  const url = event.request.url;

  if (
    url.includes('tile.opentopomap.org') ||
    url.includes('tile.openstreetmap.org') ||
    url.includes('arcgisonline.com') ||
    url.includes('.google.com/vt/')
  ) {
    _tileRespond(event, TILE_CACHE);
    return;
  }

  // API pozivi — nikad ne keširati
  if (url.includes('firestore.googleapis.com') || url.includes('firebaseio.com') ||
      url.includes('identitytoolkit.googleapis.com') ||
      url.includes('firms.modaps.eosdis.nasa.gov') ||
      url.includes('globalforestwatch.org') || url.includes('effis') ||
      url.includes('elevation-tiles-prod')) {
    return;
  }

  // CDN biblioteke — keš pri prvom učitavanju
  if (
    url.includes('cdnjs.cloudflare.com') ||
    url.includes('cdn.jsdelivr.net') ||
    url.includes('unpkg.com')
  ) {
    event.respondWith(
      caches.open(LIB_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const resp = await fetch(event.request);
          if (resp.ok) try { await cache.put(event.request, resp.clone()); } catch(e) {}
          return resp;
        } catch {
          return cached || new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  if (
    url.startsWith(self.location.origin) ||
    event.request.mode === 'navigate'
  ) {
    // Navigacije (index.html) dohvati BEZ HTTP keša — inače browser/CDN servira staru
    // verziju do isteka max-age pa update kasni. Ostalo: normalan network-first.
    const isNav = event.request.mode === 'navigate';
    const req = isNav ? new Request(event.request, { cache: 'no-store' }) : event.request;
    event.respondWith(
      fetch(req)
        .then(async resp => {
          if (resp.ok) {
            try { const rc = resp.clone(); const c = await caches.open(APP_CACHE); await c.put(event.request, rc); } catch(e) {}
          }
          return resp;
        })
        .catch(async () => (await caches.match(event.request)) || (isNav && await caches.match('./index.html')) || new Response('Nije dostupno offline', { status: 503 }))
    );
  }
});

// ─── BACKGROUND RECORDING STATE ──────────────────────────────────────
// Web Lock drži SW živ dok traje snimanje; SW periodično pinga stranicu
let _recLockRelease = null;  // otpušta Web Lock kad snimanje stane
let _swPingTimer    = null;  // interval koji šalje 'sw-ping' stranici

function _startRecLock() {
  if (_recLockRelease || !('locks' in self.navigator || 'locks' in navigator)) return;
  const locks = (self.navigator || navigator).locks;
  if (!locks) return;
  locks.request('gps-rec-bg', { mode: 'shared' }, () =>
    new Promise(resolve => { _recLockRelease = resolve; })
  ).catch(() => {});
  // Periodično pinkaj stranicu — ona restartuje GPS ako se ugasio
  _swPingTimer = setInterval(() => {
    self.clients.matchAll({ type: 'window', includeUncontrolled: false })
      .then(clients => clients.forEach(c => c.postMessage({ type: 'sw-ping' })));
  }, 20000);
}

function _stopRecLock() {
  if (_recLockRelease) { _recLockRelease(); _recLockRelease = null; }
  if (_swPingTimer)    { clearInterval(_swPingTimer); _swPingTimer = null; }
}

// ─── MESSAGE ─────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  // Heartbeat od stranice tokom GPS snimanja — drži SW budan
  if (event.data?.type === 'gps-heartbeat') {
    event.source?.postMessage({ type: 'heartbeat-ack' });
    return;
  }
  // Pokaži notifikaciju snimanja + uzmi Web Lock (Foreground Service ekvivalent)
  if (event.data?.type === 'show-rec-notification') {
    const { nm, dist } = event.data;
    event.waitUntil(self.registration.showNotification('🔴 GPS Snimanje — ' + (nm || 'trag'), {
      body: dist ? `Snimljeno: ${dist}` : 'Snimanje traga u toku...',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'gps-recording',
      requireInteraction: true,
      silent: true,
      actions: [
        { action: 'pause',  title: '⏸ Pauza' },
        { action: 'stop',   title: '⏹ Stop'  }
      ]
    }));
    _startRecLock();
    return;
  }
  // Zatvori notifikaciju i otpusti Web Lock
  if (event.data?.type === 'hide-rec-notification') {
    event.waitUntil(self.registration.getNotifications({ tag: 'gps-recording' })
      .then(ns => ns.forEach(n => n.close())));
    _stopRecLock();
    return;
  }
  // Upozorenje na nov požar u blizini. requireInteraction: korisnik je na
  // terenu i telefon mu je u džepu — obavještenje ne smije samo proći i nestati.
  if (event.data?.type === 'show-pozar-notification') {
    const { naslov, tijelo, la, lo } = event.data;
    event.waitUntil(self.registration.showNotification(naslov || '🔥 Nov požar u blizini', {
      body: tijelo,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'pozar-blizu',
      data: { la, lo },
      requireInteraction: true,
      vibrate: [300, 120, 300]
    }));
    return;
  }
});

// ─── NOTIFICATION CLICK ───────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data;
  if (event.action === 'stop' || event.action === 'pause') {
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        clients.forEach(c => c.postMessage({ type: 'rec-action', action: event.action }));
        if (clients.length === 0) return self.clients.openWindow('./');
      }));
  } else if (data?.la && data?.lo) {
    event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].postMessage({ type: 'pan-to', la: data.la, lo: data.lo });
        return clients[0].focus();
      } else {
        return self.clients.openWindow('./');
      }
    }));
  } else {
    event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('./');
    }));
  }
});
