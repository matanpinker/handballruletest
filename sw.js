/* ============================================================
   Service Worker — עבודה אופליין מלאה
   • קליפת האפליקציה (HTML/אייקון/מניפסט) נשמרת במטמון
   • הספריות מה-CDN (React / Supabase / הגופנים) נשמרות גם הן
   • קריאות ל-Supabase לעולם לא נשמרות במטמון
============================================================ */
const VERSION = 'hb-v3';
const CORE_CACHE = 'hb-core-' + VERSION;
const RUNTIME_CACHE = 'hb-runtime-' + VERSION;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.png'
];

/* נטענות בהתקנה כדי שהאפליקציה תעבוד גם אם ההפעלה הבאה היא ללא רשת */
const CDN_ASSETS = [
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=Space+Mono:wght@400;700&display=swap'
];

const isSupabase = url => /supabase\.co$/.test(url.hostname);

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const core = await caches.open(CORE_CACHE);
    await Promise.all(CORE_ASSETS.map(u =>
      core.add(new Request(u, { cache: 'reload' })).catch(() => {})
    ));
    const rt = await caches.open(RUNTIME_CACHE);
    await Promise.all(CDN_ASSETS.map(u =>
      rt.add(new Request(u, { mode: 'cors', credentials: 'omit' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CORE_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isSupabase(url)) return; // נתוני משתמש — תמיד מהרשת בלבד

  const cacheName = url.origin === self.location.origin ? CORE_CACHE : RUNTIME_CACHE;

  /* ניווט: רשת תחילה, ובכישלון — הדף מהמטמון (כולל קישורי הזמנה עם #join=) */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CORE_CACHE);
        c.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        const c = await caches.open(CORE_CACHE);
        return (await c.match('./index.html')) ||
               (await c.match('./')) ||
               new Response('<h1>אין חיבור לאינטרנט</h1>', {
                 status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' }
               });
      }
    })());
    return;
  }

  /* שאר המשאבים: מטמון תחילה + רענון שקט ברקע */
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      fetch(req).then(r => {
        if (r && (r.ok || r.type === 'opaque')) {
          caches.open(cacheName).then(c => c.put(req, r)).catch(() => {});
        }
      }).catch(() => {});
      return cached;
    }
    try {
      const fresh = await fetch(req);
      if (fresh && (fresh.ok || fresh.type === 'opaque')) {
        const c = await caches.open(cacheName);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
