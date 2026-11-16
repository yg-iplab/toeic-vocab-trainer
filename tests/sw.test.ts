// Service Worker（public/sw.js）を、にせものの caches・fetch の上で動かして確かめる
// 確かめたいこと：新しい版を出したあと、電波のある所で1回開いただけでも、次に電波なしで開ける
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://example.test";
const BASE = `${ORIGIN}/app/`;
const SW_SRC = readFileSync(new URL("../public/sw.js", import.meta.url), "utf-8");

type Res = { status: number; body: string };

/** にせもののサーバー（url → 応答）。offline のときは fetch が失敗する */
class FakeNet {
  files = new Map<string, Res>();
  offline = false;
  log: string[] = [];
  set(path: string, body: string, status = 200) {
    this.files.set(new URL(path, BASE).href, { status, body });
  }
  fetch = async (input: string | { url: string }): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.url, BASE).href;
    this.log.push(url);
    if (this.offline) throw new TypeError("Failed to fetch");
    const f = this.files.get(url) ?? { status: 404, body: "not found" };
    return new Response(f.body, { status: f.status });
  };
}

class FakeCache {
  store = new Map<string, Response>();
  constructor(private net: FakeNet) {}
  private key(req: string | { url: string }) {
    return new URL(typeof req === "string" ? req : req.url, BASE).href;
  }
  async put(req: string | { url: string }, res: Response) {
    this.store.set(this.key(req), res);
  }
  async match(req: string | { url: string }) {
    return this.store.get(this.key(req))?.clone();
  }
  async addAll(reqs: string[]) {
    const got: [string, Response][] = [];
    for (const r of reqs) {
      const res = await this.net.fetch(r);
      if (!res.ok) throw new TypeError(`addAll: ${r} ${res.status}`);
      got.push([this.key(r), res]);
    }
    for (const [k, v] of got) this.store.set(k, v);
  }
}

class FakeCaches {
  map = new Map<string, FakeCache>();
  constructor(private net: FakeNet) {}
  async open(name: string) {
    if (!this.map.has(name)) this.map.set(name, new FakeCache(this.net));
    return this.map.get(name)!;
  }
  async keys() {
    return [...this.map.keys()];
  }
  async delete(name: string) {
    return this.map.delete(name);
  }
  async match(req: string | { url: string }) {
    for (const c of this.map.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

/** sw.js を1つ読み込む（保存名は差し替えられる＝新しい版の公開を真似る） */
function loadSw(net: FakeNet, caches: FakeCaches, cacheName?: string) {
  const handlers = new Map<string, (e: unknown) => void>();
  const self = {
    location: { origin: ORIGIN, href: `${BASE}sw.js` },
    addEventListener: (type: string, fn: (e: unknown) => void) => handlers.set(type, fn),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  const src = cacheName ? SW_SRC.replace(/const CACHE = "[^"]+";/, `const CACHE = "${cacheName}";`) : SW_SRC;
  new Function("self", "caches", "fetch", src)(self, caches, net.fetch);
  const waitFor = async (type: string) => {
    let p: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
  };
  return {
    install: () => waitFor("install"),
    activate: () => waitFor("activate"),
    /** 画面を開く（mode=navigate）か、JS・CSS を読む */
    request: async (path: string, navigate = false): Promise<Response | undefined> => {
      let p: Promise<Response | undefined> | undefined;
      const req = { url: new URL(path, BASE).href, method: "GET", mode: navigate ? "navigate" : "cors" };
      handlers.get("fetch")!({ request: req, respondWith: (x: Promise<Response | undefined>) => (p = x) });
      if (!p) return net.fetch(req); // SW が受け持たない
      const res = await p;
      await new Promise((r) => setTimeout(r, 0)); // 保存（cache.put）が終わるのを待つ
      return res;
    },
  };
}

function indexHtml(hash: string) {
  return `<!doctype html><html><head><script type="module" crossorigin src="./assets/index-${hash}.js"></script><link rel="stylesheet" crossorigin href="./assets/index-${hash}.css"></head><body><div id="root"></div></body></html>`;
}

function publish(net: FakeNet, hash: string) {
  net.set("./", indexHtml(hash));
  net.set("./index.html", indexHtml(hash));
  net.set(`./assets/index-${hash}.js`, `js-${hash}`);
  net.set(`./assets/index-${hash}.css`, `css-${hash}`);
  for (const f of ["manifest.webmanifest", "icon.svg", "icon-192.png", "apple-touch-icon.png"]) net.set(`./${f}`, f);
}

describe("Service Worker（電波なしで開く）", () => {
  it("入れたときに、画面と一緒に JS・CSS も先に保存する（初回でも電波なしで開ける）", async () => {
    const net = new FakeNet();
    const caches = new FakeCaches(net);
    publish(net, "aaa");
    const sw = loadSw(net, caches);
    await sw.install();
    await sw.activate();

    net.offline = true;
    const page = await sw.request("./", true);
    expect(await page!.text()).toContain("index-aaa.js");
    expect(await (await sw.request("./assets/index-aaa.js"))!.text()).toBe("js-aaa");
    expect(await (await sw.request("./assets/index-aaa.css"))!.text()).toBe("css-aaa");
  });

  it("新しい版を出したあと、電波のある所で1回開いただけでも、次に電波なしで開ける", async () => {
    const net = new FakeNet();
    const caches = new FakeCaches(net);
    publish(net, "aaa");
    const v1 = loadSw(net, caches, "vocab-trainer-test1");
    await v1.install();
    await v1.activate();

    // 新しい版を公開 → 電波のある所で1回開く（古い SW が画面を受け持ち、新しい SW が入る）
    publish(net, "bbb");
    await v1.request("./", true);
    const v2 = loadSw(net, caches, "vocab-trainer-test2");
    await v2.install();
    await v2.activate();
    expect(await caches.keys()).toEqual(["vocab-trainer-test2"]); // 古い保存は消える

    net.offline = true;
    const page = await v2.request("./", true);
    const html = await page!.text();
    expect(html).toContain("index-bbb.js");
    expect(await (await v2.request("./assets/index-bbb.js"))!.text()).toBe("js-bbb");
    expect(await (await v2.request("./assets/index-bbb.css"))!.text()).toBe("css-bbb");
  });

  it("JS・CSS を取れなかったら、新しい版は入らない（古い版が残る）", async () => {
    const net = new FakeNet();
    const caches = new FakeCaches(net);
    publish(net, "aaa");
    const v1 = loadSw(net, caches, "vocab-trainer-test1");
    await v1.install();
    await v1.activate();

    publish(net, "ccc");
    net.files.delete(new URL("./assets/index-ccc.js", BASE).href); // 公開の途中など
    const v2 = loadSw(net, caches, "vocab-trainer-test2");
    await expect(v2.install()).rejects.toThrow();
  });

  it("サーバーのエラー画面は保存しない（電波なしのときは前の正しい画面を出す）", async () => {
    const net = new FakeNet();
    const caches = new FakeCaches(net);
    publish(net, "aaa");
    const sw = loadSw(net, caches);
    await sw.install();
    await sw.activate();

    net.set("./", "server error", 500);
    const bad = await sw.request("./", true);
    expect(bad!.status).toBe(500);

    net.offline = true;
    const page = await sw.request("./", true);
    expect(await page!.text()).toContain("index-aaa.js");
  });
});
