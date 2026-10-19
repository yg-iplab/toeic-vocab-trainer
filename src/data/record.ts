// 回答を記録する。1回答ごとに「ログ追加＋状態更新＋周回の位置」を1つの処理（トランザクション）で保存する
import type { FSRS } from "ts-fsrs";
import { localDay } from "../lib/date";
import { applyReview } from "../srs/scheduler";
import type { CardState, Format, Mode, Rating, ReviewLog } from "../types";
import { db } from "./db";

export type AnswerInput = {
  id: string;
  mode: Mode;
  rid?: number; // 周回のID
  roundNo?: number; // 何周目か
  format: Format;
  correct: boolean;
  chosen?: string;
  ms: number;
  unsure: boolean;
  rating: Rating;
  retry: boolean;
  now: number;
};

export async function recordAnswer(a: AnswerInput, scheduler: FSRS): Promise<CardState> {
  return db.transaction("rw", db.cards, db.logs, db.rounds, async () => {
    const prev = await db.cards.get(a.id);
    const next = applyReview(prev, a.id, a.rating, a.now, scheduler);
    const log: ReviewLog = {
      id: a.id,
      ts: a.now,
      day: localDay(a.now),
      mode: a.mode,
      round: a.roundNo,
      rid: a.rid,
      format: a.format,
      correct: a.correct,
      chosen: a.chosen,
      ms: Math.round(a.ms),
      unsure: a.unsure,
      rating: a.rating,
      retry: a.retry,
    };
    await db.logs.add(log);
    await db.cards.put(next);
    // 周回は、初回の回答で1つ進める（セット内のもう一度では進めない）
    if (a.mode === "round" && a.rid !== undefined && !a.retry) {
      const round = await db.rounds.get(a.rid);
      if (round && round.itemIds[round.cursor] === a.id) {
        round.cursor += 1;
        if (round.cursor >= round.itemIds.length) round.finishedAt = a.now;
        await db.rounds.put(round);
      }
    }
    return next;
  });
}
