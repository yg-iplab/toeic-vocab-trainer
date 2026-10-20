// 公式音声を鳴らす。端末の DB に入れた1本（Blob）を、指定の秒だけ再生する
// iPhone は「押した直後」に play() を呼ばないと鳴らないことがあるので、音声の URL は画面を出したときに先に用意しておく

let el: HTMLAudioElement | null = null;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let onStop: (() => void) | undefined;

// key → Blob の URL（最近使った数本だけ持つ。1本 数MB なので増やしすぎない）
const urls = new Map<string, string>();
const MAX_URLS = 6;

/** 音声の URL を用意する（同じ key は使い回す） */
export async function clipUrl(key: string, load: (key: string) => Promise<Blob | undefined>): Promise<string | undefined> {
  const hit = urls.get(key);
  if (hit) {
    urls.delete(key);
    urls.set(key, hit); // 最近使った順にする
    return hit;
  }
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
}

/** すでに用意してある URL（無ければ undefined） */
export function readyUrl(key: string): string | undefined {
  return urls.get(key);
}

/** 再生を止める */
export function stopClip() {
  clearTimeout(stopTimer);
  stopTimer = undefined;
  if (el && !el.paused) el.pause();
  onStop?.();
  onStop = undefined;
}

/** 音声の src（秒の指定はメディアフラグメント #t=開始,終了 で渡す） */
export function clipSrc(url: string, range?: [number, number]): string {
  return range ? `${url}#t=${range[0].toFixed(2)},${range[1].toFixed(2)}` : url;
}

/**
 * 鳴らす。range があれば、その秒だけ（終わりで止める）。rate は速さ（1 がふつう）
 * 止める仕組みは2重：メディアフラグメントの終わり＋タイマー（フラグメントに対応しない端末のため）
 */
export function playClip(url: string, range: [number, number] | undefined, rate = 1, stopOthers?: () => void): boolean {
  stopClip();
  stopOthers?.();
  if (typeof Audio === "undefined") return false;
  el ??= new Audio();
  const audio = el;
  audio.src = clipSrc(url, range);
  audio.playbackRate = rate;
  (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  if (range) {
    const [start, end] = range;
    const seek = () => {
      if (Math.abs(audio.currentTime - start) > 0.3) audio.currentTime = start;
    };
    const arm = () => {
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => audio.pause(), Math.max(0, ((end - audio.currentTime) / rate) * 1000) + 80);
    };
    const check = () => {
      if (audio.currentTime >= end) audio.pause();
    };
    audio.addEventListener("loadedmetadata", seek, { once: true });
    audio.addEventListener("playing", arm, { once: true });
    audio.addEventListener("timeupdate", check);
    onStop = () => audio.removeEventListener("timeupdate", check);
  }
  void audio.play()?.catch(() => undefined);
  return true;
}
