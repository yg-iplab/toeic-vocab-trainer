// 公式音声を鳴らす部分（lib/audioPlayer）を、にせものの Audio で確かめる（音は出さない）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPlayerForTest, clipUrl, playClip, readyUrl, stopClip } from "../src/lib/audioPlayer";

class FakeAudio extends EventTarget {
  static last: FakeAudio | null = null;
  src = "";
  paused = true;
  currentTime = 0;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  nextPlay: () => Promise<void> = () => Promise.resolve();
  constructor() {
    super();
    FakeAudio.last = this;
  }
  play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return this.nextPlay();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}

const g = globalThis as unknown as { Audio?: unknown };

beforeEach(() => {
  __resetPlayerForTest();
  g.Audio = FakeAudio;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete g.Audio;
});

describe("音声の URL を用意する", () => {
  it("同じ音声を同時に2回用意しても、読み込みと URL を作るのは1回（約6MB を2つ作らない）", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-1");
    const load = vi.fn(async () => new Blob([new Uint8Array(10)]));
    const [a, b] = await Promise.all([clipUrl("kinfre-en-01", load), clipUrl("kinfre-en-01", load)]);
    expect(a).toBe("blob:test-1");
    expect(b).toBe("blob:test-1");
    expect(load).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(readyUrl("kinfre-en-01")).toBe("blob:test-1");
  });

  it("持つ本数を超えたら、古い URL を手放す", async () => {
    let n = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test-${++n}`);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const load = async () => new Blob([new Uint8Array(1)]);
    for (let k = 1; k <= 7; k++) await clipUrl(`kinfre-en-${k}`, load);
    expect(revoke).toHaveBeenCalledWith("blob:test-1");
    expect(readyUrl("kinfre-en-1")).toBeUndefined();
    expect(readyUrl("kinfre-en-7")).toBe("blob:test-7");
  });
});

describe("鳴らす・止める", () => {
  it("鳴り始める前に別の 🔊 を押しても、前の「終わりで止める係」が残らない（次の音がすぐ止まらない）", () => {
    playClip("blob:x", [1, 2]);
    playClip("blob:x", [3, 4]);
    const audio = FakeAudio.last!;
    audio.currentTime = 3;
    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("timeupdate"));
    expect(audio.paused).toBe(false); // 前の係（終わり 2秒）が動くと、ここで止まってしまう
    expect(audio.src).toBe("blob:x#t=3.00,4.00");
    audio.currentTime = 4;
    audio.dispatchEvent(new Event("timeupdate"));
    expect(audio.paused).toBe(true); // 自分の終わり（4秒）では止まる
  });

  it("割り込みで前の再生が中断されたとき（AbortError）は ⚠ を出さない", async () => {
    const fail = vi.fn();
    playClip("blob:x", [1, 2], 1, undefined, fail);
    const audio = FakeAudio.last!;
    audio.nextPlay = () => Promise.reject(Object.assign(new Error("interrupted"), { name: "AbortError" }));
    playClip("blob:x", [3, 4], 1, undefined, fail);
    await vi.runAllTimersAsync();
    expect(fail).not.toHaveBeenCalled();
    audio.nextPlay = () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    playClip("blob:x", [3, 4], 1, undefined, fail);
    await vi.runAllTimersAsync();
    expect(fail).toHaveBeenCalledWith("もう一度押してください");
  });

  it("止めたあと、画面ロックやイヤホンのボタンで再生が始まっても止める（1本 約13分が続けて鳴らない）", () => {
    playClip("blob:x", [1, 2]);
    const audio = FakeAudio.last!;
    stopClip();
    expect(audio.paused).toBe(true);
    audio.play(); // アプリの外からの再生
    expect(audio.paused).toBe(true);
    playClip("blob:x", [1, 2]); // アプリの 🔊 はふつうに鳴る
    expect(audio.paused).toBe(false);
  });

  it("速さは公式音声にもそのまま効く（既定は 100%）", () => {
    playClip("blob:x", [1, 2]);
    expect(FakeAudio.last!.playbackRate).toBe(1);
    playClip("blob:x", [1, 2], 0.8);
    expect(FakeAudio.last!.playbackRate).toBe(0.8);
    expect(FakeAudio.last!.defaultPlaybackRate).toBe(0.8);
  });
});
