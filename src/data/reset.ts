// 学習記録をやり直す（v0.8.1〜）。教材ごとに、回答の記録（○×・時間）・復習の予定（FSRS）・周回だけを消す
// 教材・公式音声・時間の表・設定・自分のメモ（覚え方など）・最後のバックアップの日時は残す
import { deckOf, type Deck } from "../types";
import { db } from "./db";

export type RecordCount = { answers: number; studied: number; rounds: number };

/** 教材ごとの記録の数（消す前の確認に出す） */
export async function recordCounts(): Promise<Record<Deck, RecordCount>> {
  const out: Record<Deck, RecordCount> = {
    kinfre: { answers: 0, studied: 0, rounds: 0 },
    deru1000: { answers: 0, studied: 0, rounds: 0 },
  };
  await db.logs.each((l) => void out[deckOf(l.id)].answers++);
  await db.cards.each((c) => void out[deckOf(c.id)].studied++);
  await db.rounds.each((r) => void out[r.deck ?? "kinfre"].rounds++);
  return out;
}

/** 選んだ教材の記録を消す（1つの処理で。途中で失敗したら何も消えない） */
export async function resetRecords(decks: Deck[]): Promise<void> {
  const want = new Set<Deck>(decks);
  await db.transaction("rw", db.cards, db.logs, db.rounds, async () => {
    await db.cards.filter((c) => want.has(deckOf(c.id))).delete();
    await db.logs.filter((l) => want.has(deckOf(l.id))).delete();
    await db.rounds.filter((r) => want.has(r.deck ?? "kinfre")).delete();
  });
}
