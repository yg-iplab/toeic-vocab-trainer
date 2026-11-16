// 公式音声を鳴らす。端末の DB に入れた1本（Blob）を、指定の秒だけ再生する
// iPhone は「押した直後」に play() を呼ばないと鳴らないことがあるので、音声の URL は画面を出したときに先に用意しておく

let el: HTMLAudioElement | null = null;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let detach: (() => void) | undefined; // いまの再生に付けた「止める係」を外す
let active = false; // アプリの 🔊 で鳴らしている最中か

// key → Blob の URL（最近使った数本だけ持つ。1本 数MB なので増やしすぎない）
const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | undefined>>(); // 読み込み中（同じ音声を2回読まない）
const MAX_URLS = 6;

/** テスト用：持っている状態を空にする */
export function __resetPlayerForTest() {
  el = null;
  clearTimeout(stopTimer);
  stopTimer = undefined;
  detach = undefined;
  active = false;
  urls.clear();
  pending.clear();
}

/** 音声の URL を用意する（同じ key は使い回す。読み込み中に同じ key を頼まれても、読み込みは1回だけ） */
export async function clipUrl(key: string, load: (key: string) => Promise<Blob | undefined>): Promise<string | undefined> {
  const hit = urls.get(key);
  if (hit) {
    urls.delete(key);
    urls.set(key, hit); // 最近使った順にする
    return hit;
  }
  const wait = pending.get(key);
  if (wait) return wait;
  const p = (async () => {
    const blob = await load(key);
    if (!blob) return undefined;
    const url = URL.createObjectURL(blob);
    urls.set(key, url);
    while (urls.size > MAX_URLS) {
      const [oldKey, oldUrl] = urls.entries().next().value as [string, string];
      urls.delete(oldKey);
      URL.revokeObjectURL(oldUrl);
    }
    return url;
  })();
  pending.set(key, p);
  try {
    return await p;
  } finally {
    pending.delete(key);
  }
}

/** すでに用意してある URL（無ければ undefined） */
export function readyUrl(key: string): string | undefined {
  return urls.get(key);
}

function audioEl(): HTMLAudioElement {
  if (!el) {
    const a = new Audio();
    // 止めたあと、画面ロックの再生ボタンやイヤホンのボタンで1本（約13分）が続きから鳴らないようにする
    a.addEventListener("play", () => {
      if (!active) a.pause();
    });
    el = a;
  }
  return el;
}

/** 再生を止める */
export function stopClip() {
  clearTimeout(stopTimer);
  stopTimer = undefined;
  active = false;
  detach?.();
  detach = undefined;
  if (el && !el.paused) el.pause();
}

/** 音声の src（秒の指定はメディアフラグメント #t=開始,終了 で渡す） */
export function clipSrc(url: string, range?: [number, number]): string {
  return range ? `${url}#t=${range[0].toFixed(2)},${range[1].toFixed(2)}` : url;
}

/**
 * 鳴らす。range があれば、その秒だけ（終わりで止める）。rate は速さ（1 がふつう）
 * 止める仕組みは2重：メディアフラグメントの終わり＋タイマー（フラグメントに対応しない端末のため）
 * 前の再生に付けた係はすべて外してから鳴らす（鳴り始める前に別の 🔊 を押しても、次の音がすぐ止まらない）
 */
export function playClip(url: string, range: [number, number] | undefined, rate = 1, stopOthers?: () => void, onFail?: (why: string) => void): boolean {
  stopClip();
  stopOthers?.();
  if (typeof Audio === "undefined") return false;
  const audio = audioEl();
  const offs: (() => void)[] = [];
  const on = (type: string, fn: () => void, once = false) => {
    audio.addEventListener(type, fn, once ? { once: true } : undefined);
    offs.push(() => audio.removeEventListener(type, fn));
  };
  detach = () => offs.forEach((off) => off());
  const finish = () => {
    active = false;
    clearTimeout(stopTimer);
    audio.pause();
  };

  audio.src = clipSrc(url, range);
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  if (range) {
    const [start, end] = range;
    const seek = () => {
      if (Math.abs(audio.currentTime - start) > 0.3) audio.currentTime = start;
    };
    // タイマーが来たら、本当に終わりまで進んだかを見てから止める（再生の出だしが遅れても語の終わりを切らない）
    const arm = () => {
      clearTimeout(stopTimer);
      if (audio.paused) return;
      const left = end - audio.currentTime;
      if (left <= 0.03) return finish();
      stopTimer = setTimeout(arm, Math.max(20, (left / rate) * 1000));
    };
    const check = () => {
      if (audio.currentTime >= end) finish();
    };
    on("loadedmetadata", seek, true);
    on("playing", arm, true);
    on("timeupdate", check);
  }
  on("ended", () => (active = false), true);
  on("error", () => onFail?.(audio.error ? `読み込めません（${audio.error.code}）` : "読み込めません"), true);
  active = true;
  void audio.play()?.catch((e: Error) => {
    if (e.name === "AbortError") return; // 次の 🔊 で前の再生が中断されただけ
    onFail?.(e.name === "NotAllowedError" ? "もう一度押してください" : `鳴らせません（${e.name}）`);
  });
  return true;
}
