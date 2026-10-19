// 発音ボタン：正解を入れた文を作り、端末の読み上げ機能に英語（米国）で渡す
import { afterEach, describe, expect, it } from "vitest";
import { canSpeak, filledSentence, speak, stopSpeaking } from "../src/lib/speech";
import { DEFAULT_SETTINGS } from "../src/types";

type Spoken = { text: string; lang: string; rate: number; voice?: { name: string } };

/** 読み上げ機能のにせもの（話した内容を記録する） */
function fakeSpeech(voices: { name: string; lang: string; localService: boolean }[]) {
  const spoken: Spoken[] = [];
  let cancels = 0;
  class Utterance {
    lang = "";
    rate = 1;
    voice?: { name: string };
    constructor(public text: string) {}
  }
  const g = globalThis as Record<string, unknown>;
  g.SpeechSynthesisUtterance = Utterance;
  g.window = {
    speechSynthesis: {
      getVoices: () => voices,
      speak: (u: Spoken) => spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice }),
      cancel: () => cancels++,
    },
  };
  return { spoken, cancels: () => cancels };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.SpeechSynthesisUtterance;
});

describe("発音ボタン", () => {
  it("問題文の空所に正解を入れた文", () => {
    expect(filledSentence("Q1 The fictional ------- is  here.", "beta1")).toBe("Q1 The fictional beta1 is here.");
  });

  it("英語（米国）の端末内の声で、設定の速さで読む。前の読み上げは止める", () => {
    const s = fakeSpeech([
      { name: "架空JP", lang: "ja-JP", localService: true },
      { name: "架空US-net", lang: "en-US", localService: false },
      { name: "架空US", lang: "en-US", localService: true },
    ]);
    expect(canSpeak()).toBe(true);
    expect(speak("The fictional beta1 is here.", 0.9)).toBe(true);
    expect(s.spoken).toEqual([{ text: "The fictional beta1 is here.", lang: "en-US", rate: 0.9, voice: expect.objectContaining({ name: "架空US" }) }]);
    expect(s.cancels()).toBe(1);
    stopSpeaking();
    expect(s.cancels()).toBe(2);
    expect(speak("   ")).toBe(false);
  });

  it("読み上げ機能の無い環境ではボタンを出さない・何もしない", () => {
    expect(canSpeak()).toBe(false);
    expect(speak("text")).toBe(false);
  });

  it("文法の解説は既定で毎回開く・読み上げは少しゆっくり", () => {
    expect(DEFAULT_SETTINGS.deruAlwaysExplain).toBe(true);
    expect(DEFAULT_SETTINGS.speechRate).toBe(0.9);
  });
});
