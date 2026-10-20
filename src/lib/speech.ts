// 発音の確認：端末の読み上げ機能（Web Speech API の合成音声）で英文を読む
// 公式の音声ではない。端末に入っている英語の声を使うので、電波が無くても動く（iPhone は Siri の声）
// 公式音声（audioPlayer）と同時には鳴らさない
import { stopClip } from "./audioPlayer";

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** 英語（米国）の声。端末の中にある声を優先する */
function englishVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "en-US" && v.localService) ??
    voices.find((v) => v.lang.replace("_", "-").startsWith("en-US")) ??
    voices.find((v) => v.lang.startsWith("en"))
  );
}

/** 読み上げる（前の読み上げは止める）。読めないときは false */
export function speak(text: string, rate = 1): boolean {
  if (!canSpeak() || !text.trim()) return false;
  stopClip();
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = rate;
  const voice = englishVoice();
  if (voice) u.voice = voice;
  synth.speak(u);
  return true;
}

/** 合成音声も公式音声も止める */
export function stopSpeaking() {
  stopClip();
  if (canSpeak()) window.speechSynthesis.cancel();
}

/** 文法の問題文の空所（-------）に正解を入れた文 */
export function filledSentence(stem: string, answer: string): string {
  return stem.replace(/-{3,}/, answer).replace(/\s+/g, " ").trim();
}
