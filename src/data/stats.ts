// 記録画面・ホーム画面の集計
import { deckOf, type CardState, type ChapterInfo, type Deck, type Item, type ReviewLog, type Round } from "../types";

/** 数え方（単語は「語」、文法は「問」） */
export function unit(deck: Deck): string {
  return deck === "deru1000" ? "問" : "語";
}

export function itemsOfDeck(items: Item[], deck: Deck): Item[] {
  return items.filter((i) => i.deck === deck);
}

export function logsOfDeck(logs: ReviewLog[], deck: Deck): ReviewLog[] {
  return logs.filter((l) => deckOf(l.id) === deck);
}

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

/** 類題を探すときに見る、最近のミスの日数 */
export const RECENT_MISS_DAYS = 7;

/** 最近ミスした問題（新しい順・重複なし） */
export function recentMissIds(logs: ReviewLog[], now: number, days = RECENT_MISS_DAYS): string[] {
  const since = now - days * 86400000;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of logs.filter((x) => !x.correct && x.ts >= since && x.ts <= now).sort((a, b) => b.ts - a.ts)) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l.id);
  }
  return out;
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

/** 範囲のまとまり：単語は track ごと、文法は章・模試セットごと */
export function groupOf(i: Item, chapters: Map<string, ChapterInfo>): { key: string; label: string } {
  if (i.deck === "deru1000") return { key: i.chapter, label: chapters.get(i.chapter)?.label ?? i.chapter };
  return i.part === "main"
    ? { key: `t${String(i.track ?? 0).padStart(2, "0")}`, label: `track ${i.track ?? "?"}（${i.section}）` }
    : { key: i.part, label: i.section || i.part };
}

/** まとまりの順（文法は章 → 模試セット、単語は教材の順） */
function sortByGroup(items: Item[], chapters: Map<string, ChapterInfo>): Item[] {
  const chapterOrder = (i: Item) => (i.deck === "deru1000" ? (chapters.get(i.chapter)?.order ?? 999) : 0);
  return items.slice().sort((a, b) => chapterOrder(a) - chapterOrder(b) || a.order - b.order);
}

/** 単語は track ごと、文法は章・模試セットごとの進み具合 */
export function groupStats(items: Item[], cards: Map<string, CardState>, chapters: Map<string, ChapterInfo> = new Map()): GroupStat[] {
  const groups = new Map<string, GroupStat>();
  for (const i of sortByGroup(items, chapters)) {
    const { key, label } = groupOf(i, chapters);
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

/** 進捗グラフに出す周の数（まとまりごとに、新しいほうから） */
export const CHART_PASSES = 4;

export type PassRate = { rid: number; no: number; answered: number; correct: number };
export type GroupPasses = { key: string; label: string; passes: PassRate[] };

/**
 * まとまり（章・模試セット・track）ごとに、周回ごとの正答率
 * - 数えるのは各周の最初の回答だけ（その場のもう一度・「ミスだけもう1周」は入れない）
 * - 周は始めた順。まとまりごとに、その範囲を解いた周だけを新しいほうから CHART_PASSES まで
 */
export function passRates(
  items: Item[],
  rounds: Round[],
  logs: ReviewLog[],
  chapters: Map<string, ChapterInfo> = new Map(),
  max = CHART_PASSES,
): GroupPasses[] {
  const main = new Map(rounds.filter((r) => r.rid !== undefined && r.parentRid === undefined).map((r) => [r.rid!, r]));
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const firstTry = new Map<string, ReviewLog>(); // "rid:id" → 最初の回答
  for (const l of logs.slice().sort((a, b) => a.ts - b.ts)) {
    if (l.mode !== "round" || l.retry || l.rid === undefined || !main.has(l.rid) || !itemsById.has(l.id)) continue;
    const k = `${l.rid}:${l.id}`;
    if (!firstTry.has(k)) firstTry.set(k, l);
  }
  const byGroup = new Map<string, Map<number, PassRate>>();
  for (const l of firstTry.values()) {
    const { key } = groupOf(itemsById.get(l.id)!, chapters);
    const passes = byGroup.get(key) ?? new Map<number, PassRate>();
    const p = passes.get(l.rid!) ?? { rid: l.rid!, no: main.get(l.rid!)!.no, answered: 0, correct: 0 };
    p.answered++;
    if (l.correct) p.correct++;
    passes.set(l.rid!, p);
    byGroup.set(key, passes);
  }
  const out: GroupPasses[] = [];
  const done = new Set<string>();
  for (const i of sortByGroup(items, chapters)) {
    const { key, label } = groupOf(i, chapters);
    if (done.has(key)) continue;
    done.add(key);
    const passes = byGroup.get(key);
    if (!passes) continue;
    const list = [...passes.values()].sort((a, b) => main.get(a.rid)!.startedAt - main.get(b.rid)!.startedAt || a.rid - b.rid);
    out.push({ key, label, passes: list.slice(-max) });
  }
  return out;
}

/** ミスした問題（ミス回数の多い順） */
export function missedItems<T extends Item>(items: T[], cards: Map<string, CardState>): { item: T; card: CardState }[] {
  return items
    .map((item) => ({ item, card: cards.get(item.id) }))
    .filter((x): x is { item: T; card: CardState } => (x.card?.miss_count ?? 0) > 0)
    .sort(
      (a, b) =>
        b.card.miss_count - a.card.miss_count ||
        Number(b.card.status === "missed") - Number(a.card.status === "missed") ||
        a.item.order - b.item.order,
    );
}

/** 表示用の番号（単語の本編は 032、Supplement は S1-021、文法は 0042） */
export function noLabel(item: Item): string {
  if (item.deck === "deru1000") return String(item.no).padStart(4, "0");
  if (item.part === "main") return String(item.no).padStart(item.no >= 1000 ? 4 : 3, "0");
  return `S${Number(item.part.slice(1))}-${String(item.no).padStart(3, "0")}`;
}
