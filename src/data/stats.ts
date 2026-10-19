// 記録画面・ホーム画面の集計
import type { CardState, Item, ReviewLog, Round } from "../types";

/** 語ごとに、最初に解いた日 */
export function firstDayById(logs: ReviewLog[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of logs.slice().sort((a, b) => a.ts - b.ts)) if (!m.has(l.id)) m.set(l.id, l.day);
  return m;
}

/** 今日はじめて解いた語の数（1日の新規上限に使う） */
export function newIntroducedOn(logs: ReviewLog[], day: string): number {
  let n = 0;
  for (const d of firstDayById(logs).values()) if (d === day) n++;
  return n;
}

export function dayStats(logs: ReviewLog[], day: string) {
  const today = logs.filter((l) => l.day === day && !l.retry);
  return { answered: today.length, correct: today.filter((l) => l.correct).length };
}

export type RoundStat = {
  round: Round;
  answered: number;
  correct: number;
  missedIds: string[];
};

/** 周回ごとの成績（セット内のもう一度は数えない） */
export function roundStats(rounds: Round[], logs: ReviewLog[]): RoundStat[] {
  return rounds
    .slice()
    .sort((a, b) => (b.rid ?? 0) - (a.rid ?? 0))
    .map((round) => {
      const inRound = new Set(round.itemIds);
      const first = new Map<string, ReviewLog>();
      for (const l of logs) {
        if (l.mode !== "round" || l.retry || l.rid !== round.rid || !inRound.has(l.id)) continue;
        if (!first.has(l.id)) first.set(l.id, l);
      }
      const answered = [...first.values()];
      return {
        round,
        answered: answered.length,
        correct: answered.filter((l) => l.correct).length,
        missedIds: answered.filter((l) => !l.correct).map((l) => l.id),
      };
    });
}

export type GroupStat = { key: string; label: string; total: number; studied: number; known: number; missed: number };

/** レベル（章）・track ごとの進み具合 */
export function groupStats(items: Item[], cards: Map<string, CardState>): GroupStat[] {
  const groups = new Map<string, GroupStat>();
  for (const i of items.slice().sort((a, b) => a.order - b.order)) {
    const key = i.part === "main" ? `t${String(i.track ?? 0).padStart(2, "0")}` : i.part;
    const label = i.part === "main" ? `track ${i.track ?? "?"}（${i.section}）` : i.section || i.part;
    const g = groups.get(key) ?? { key, label, total: 0, studied: 0, known: 0, missed: 0 };
    const c = cards.get(i.id);
    g.total++;
    if (c && c.status !== "new") g.studied++;
    if (c?.status === "known") g.known++;
    if (c?.status === "missed") g.missed++;
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** ミスした語（ミス回数の多い順） */
export function missedItems(items: Item[], cards: Map<string, CardState>): { item: Item; card: CardState }[] {
  return items
    .map((item) => ({ item, card: cards.get(item.id) }))
    .filter((x): x is { item: Item; card: CardState } => (x.card?.miss_count ?? 0) > 0)
    .sort(
      (a, b) =>
        b.card.miss_count - a.card.miss_count ||
        Number(b.card.status === "missed") - Number(a.card.status === "missed") ||
        a.item.order - b.item.order,
    );
}

/** 表示用の番号（本編は 032、Supplement は S1-021） */
export function noLabel(item: Item): string {
  if (item.part === "main") return String(item.no).padStart(item.no >= 1000 ? 4 : 3, "0");
  return `S${Number(item.part.slice(1))}-${String(item.no).padStart(3, "0")}`;
}
