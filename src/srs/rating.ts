// 4択・Part 5 の結果を FSRS の評価に変える
// 運用ルールをそのまま使う：単語は「3秒で出なければ見る」、文法は「1問20〜30秒」（秒数は設定で変えられる）
import type { Rating } from "../types";

export function ratingForChoice(correct: boolean, ms: number, unsure: boolean, hardMs: number): Rating {
  if (!correct) return 1; // もう一度
  if (unsure || ms > hardMs) return 2; // 難しい
  return 3; // 正解
}

export const RATING_LABEL: Record<Rating, string> = {
  1: "もう一度",
  2: "難しい",
  3: "正解",
  4: "簡単",
};
