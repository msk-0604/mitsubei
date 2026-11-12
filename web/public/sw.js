/*
 * MITUBEI Service Worker
 * - キャッシュするのは、ビルド済みの静的ファイル（/_next/static/）とアイコンだけ。
 * - API（/api/）や画面の HTML は一切キャッシュしない（顧客情報・価格表・見積書を端末に残さないため）。
 * - オフライン時の画面遷移には、簡単な案内だけを表示する。
 */
const CACHE = "mitubei-static-v1";
const OFFLINE_HTML =
  '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>オフライン | MITUBEI</title>' +
  '<body style="font-family:sans-serif;background:#f8fafc;color:#334155;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">' +
  '<div style="text-align:center;padding:24px"><p style="font-weight:700;color:#2563eb;font-size:20px">MITUBEI</p><p>インターネットに接続されていません。<br>接続を確認してから、もう一度お試しください。</p></div></body></html>';

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || /^\/(icon|apple-icon|favicon)/.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } })),
    );
  }
  // それ以外（API など）はブラウザの通常処理に任せる（Service Worker ではキャッシュしない）
});
