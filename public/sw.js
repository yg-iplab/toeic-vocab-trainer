// オフラインで起動するための Service Worker（教材データはここでは扱わない。IndexedDB 側にある）
// - 入れるとき: 画面（index.html）と、その画面が読む JS・CSS をまとめて先に保存する（v0.8〜）
//   新しい版を出したあと電波のある所で1回開いただけでも、次に電波なしで開けるように。1つでも取れなければ新しい版は入らない（古い版が残る）
// - 画面（HTML）: ネット優先。正しく取れたときだけ保存し、つながらなければ保存済みのものを使う
// - JS・CSS・画像: 保存済み優先。無ければ取ってきて、正しく取れたときだけ保存する
const CACHE = "vocab-trainer-v9";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./apple-touch-icon.png"];

/** index.html が読む JS・CSS（Vite が付ける名前は版ごとに変わるので、画面の中から拾う） */
function assetsOf(html) {
  const out = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)) out.add(m[1]);
  return [...out];
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(SHELL);
      const page = await cache.match("./index.html");
      const html = page ? await page.text() : "";
      await cache.addAll(assetsOf(html));
    }),
  );
});

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
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html").then((hit) => hit || caches.match("./"))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
