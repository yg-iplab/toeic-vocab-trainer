// 4択・Part 5 の結果を FSRS の評価に変える
// 運用ルールをそのまま使う：単語は「3秒で出なければ見る」、文法は「1問20〜30秒」（秒数は設定で変えられる）
import type { Rating } from "../types";

/**
 * firstTime＝はじめて解く語（v0.8〜・単語だけ）。迷わず速く正解したら「簡単」にして、次は1週間ほど先にする
 * （紙の本で1周済みの語を、同じ日に2回・数日後にもう1回と短い間隔で出さないため。当て推量のときは「あやふや」を押す）
 */
export function ratingForChoice(correct: boolean, ms: number, unsure: boolean, hardMs: number, firstTime = false): Rating {
  if (!correct) return 1; // もう一度
  if (unsure || ms > hardMs) return 2; // 難しい
  return firstTime ? 4 : 3; // 簡単 / 正解
}

export const RATING_LABEL: Record<Rating, string> = {
  1: "もう一度",
  2: "難しい",
  3: "正解",
  4: "簡単",
};
