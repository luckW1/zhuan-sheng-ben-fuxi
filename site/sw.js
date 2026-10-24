/* Service Worker —— 离线缓存，保证断网也能复习
 * 版本号说明：每次修改 index.html / css / js 后，必须把 CACHE 版本号 +1，
 * 否则用户手机可能仍读到旧的缓存版本。
 * 当前版本：v10（网络优先更新，避免在线用户长期读取旧缓存）
 */
const CACHE = 'zsb-review-v10';
const CACHE_PREFIX = 'zsb-review-';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css?v=10',
  './css/hljs-light.css?v=10',
  './css/hljs-dark.css?v=10',
  './js/vendor/marked.js?v=10',
  './js/vendor/highlight.min.js?v=10',
  './js/store.js?v=10',
  './js/app.js?v=10',
  './data/meta.json',
  './data/books.json',
  './data/quiz.json',
  './data/cards.json'
];
// 说明：search.json（约 3 MB）与 books/*.json（正文分片）不预缓存，
// 首次使用时由 fetch 处理器动态写入缓存，既保证离线可用，又不拖慢首屏。
// 用户可在「我的」中主动下载全部资料，之后无需逐章访问即可完整离线使用。

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map(async url => {
      try {
        const request = new Request(new URL(url, self.registration.scope), { cache: 'reload' });
        const response = await fetch(request);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        await cache.put(request, response);
      } catch (err) {
        console.warn('缓存失败:', url, err.message);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const oldCaches = keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE);
    await Promise.all(oldCaches.map(k => caches.delete(k)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });
    windows.forEach(client => {
      if (!client.url.startsWith(self.registration.scope)) return;
      client.navigate(client.url).catch(() => {});
    });
  })());
});

self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'CACHE_OFFLINE_PACK') return;
  e.waitUntil(cacheOfflinePack(e.source));
});

async function cacheOfflinePack(client) {
  const post = data => {
    if (client && typeof client.postMessage === 'function') client.postMessage(data);
  };
  try {
    const scope = self.registration.scope;
    const booksUrl = new URL('./data/books.json', scope);
    let booksResponse = await fetch(booksUrl, { cache: 'no-store' });
    if (!booksResponse.ok) {
      const cachedBooks = await caches.match(booksUrl.href);
      if (cachedBooks) booksResponse = cachedBooks;
    }
    if (!booksResponse.ok) throw new Error('无法读取书籍目录');
    const books = await booksResponse.json();
    if (!Array.isArray(books)) throw new Error('书籍目录格式异常');

    const urls = Array.from(new Set([
      ...CORE,
      './manifest.json',
      './icons/icon-192.png',
      './icons/icon-512.png',
      './icons/icon-maskable.png',
      './icons/apple-touch-icon.png',
      './icons/favicon.ico',
      './icons/favicon-64.png',
      './data/search.json',
      ...books.map(book => './data/books/' + book.id + '.json')
    ]));
    const cache = await caches.open(CACHE);
    let done = 0, failed = 0;

    for (let i = 0; i < urls.length; i++) {
      const url = new URL(urls[i], scope);
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        await cache.put(url.href, response);
      } catch (err) {
        failed++;
        console.warn('离线资料缓存失败:', url.href, err.message);
      }
      done++;
      post({ type: 'OFFLINE_PROGRESS', done, total: urls.length, failed });
    }
    post({ type: 'OFFLINE_COMPLETE', done, total: urls.length, failed });
  } catch (err) {
    post({ type: 'OFFLINE_ERROR', message: err.message || '离线资料缓存失败' });
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 页面导航优先取网络，确保 GitHub Pages 更新后立即显示新版本；
  // 断网时再回退到完整缓存。
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(new Request(req, { cache: 'reload' })).then(async res => {
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(req, res.clone());
        }
        return res;
      }).catch(async () => {
        return await caches.match(req) ||
          await caches.match(new URL('./index.html', self.registration.scope).href) ||
          await caches.match(new URL('./', self.registration.scope).href) ||
          new Response('当前处于离线状态，且没有可用的页面缓存。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      })
    );
    return;
  }

  // 正文分片与数据文件：先给缓存保证离线可用，同时后台更新
  const isData = url.pathname.includes('/data/');
  if (isData) {
    e.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 样式与脚本使用带版本号的 URL；同时在后台刷新缓存。
  // 对旧页面留下的无版本 URL 也保持兼容。
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
