// 1セット（既定10問）の出題を組み立てる部分
import type { FSRS } from "ts-fsrs";
import { shuffle, type Rng } from "../lib/random";
import type { CardState, Format, Item, Question, Round, Settings } from "../types";
import { retrievability } from "./scheduler";

/** ミス3回以上は「しつこい苦手」 */
export const LEECH_MISSES = 3;
/** セット内で同じ語をもう一度出すのは2回まで */
export const MAX_RETRY = 2;

export function poolOf(items: Item[], settings: Pick<Settings, "includeSupplement">): Item[] {
  return items.filter((i) => settings.includeSupplement || i.part === "main");
}

/**
 * 4択の誤答を選ぶ。似た選択肢ほど力がつくので
 * 「同じ品詞・同じレベル」→「同じ品詞」→「それ以外」の順で取る
 */
export function pickDistractors(item: Item, pool: Item[], rng: Rng, n = 3): Item[] {
  const ok = pool.filter(
    (o) => o.id !== item.id && o.ja !== item.ja && !o.ja.includes(item.ja) && !item.ja.includes(o.ja),
  );
  const pos0 = item.pos[0];
  const samePos = ok.filter((o) => pos0 && o.pos[0] === pos0);
  const sameLevel = samePos.filter((o) => o.section === item.section);
  const picked: Item[] = [];
  for (const group of [sameLevel, samePos, ok]) {
    for (const o of shuffle(group, rng)) {
      if (picked.length >= n) break;
      if (!picked.some((p) => p.ja === o.ja)) picked.push(o);
    }
    if (picked.length >= n) break;
  }
  return picked;
}

export function makeQuestion(
  item: Item,
  pool: Item[],
  format: Format,
  rng: Rng,
  source: Question["source"],
  retry = false,
): Question {
  if (format === "flip") return { item, retry, source };
  const options = shuffle([item, ...pickDistractors(item, pool, rng)], rng);
  return {
    item,
    choices: options.map((o) => o.ja),
    choiceIds: options.map((o) => o.id),
    answerIndex: options.indexOf(item),
    retry,
    source,
  };
}

/** 間違えた問題を、同じセットの最後にもう一度入れる（選択肢は並べ替える） */
export function requeueIfWrong(
  queue: Question[],
  q: Question,
  correct: boolean,
  retries: Map<string, number>,
  pool: Item[],
  format: Format,
  rng: Rng,
): Question[] {
  if (correct) return queue;
  const n = retries.get(q.item.id) ?? 0;
  if (n >= MAX_RETRY) return queue;
  retries.set(q.item.id, n + 1);
  return [...queue, makeQuestion(q.item, pool, format, rng, "retry", true)];
}

type DailyArgs = {
  items: Item[];
  cards: Map<string, CardState>;
  settings: Settings;
  now: number;
  rng: Rng;
  scheduler: FSRS;
  newIntroducedToday: number;
};

export function dueItems(items: Item[], cards: Map<string, CardState>, now: number, scheduler: FSRS): Item[] {
  const r = (i: Item) => retrievability(cards.get(i.id), now, scheduler);
  return items
    .filter((i) => {
      const c = cards.get(i.id);
      return c !== undefined && c.fsrs.state !== 0 && c.due <= now;
    })
    .sort((a, b) => r(a) - r(b) || (cards.get(b.id)?.miss_count ?? 0) - (cards.get(a.id)?.miss_count ?? 0));
}

/**
 * 今日の学習（忘却曲線モード）
 * - 約7割: 復習期限が来た語。思い出せる確率が低い順（ミスした語ほど早く・多く戻る）
 * - 約3割: 他の語。しつこい苦手（期限前でも1問）→ 新しい語 → しばらく見ていない語
 * どちらかが足りなければ、もう片方で埋める
 */
export function buildDailySet(a: DailyArgs): Question[] {
  const { items, cards, settings, now, rng, scheduler } = a;
  const pool = poolOf(items, settings);
  const size = settings.setSize;
  const r = (i: Item) => retrievability(cards.get(i.id), now, scheduler);

  const due = dueItems(pool, cards, now, scheduler);
  const dueQuota = Math.round(size * settings.reviewRatio);
  const picked: Question[] = due.slice(0, dueQuota).map((i) => makeQuestion(i, pool, settings.format, rng, "due"));
  const used = new Set(picked.map((q) => q.item.id));
  const take = (list: Item[], max: number, source: Question["source"]) => {
    for (const i of list) {
      if (picked.length >= size || max <= 0) break;
      if (used.has(i.id)) continue;
      picked.push(makeQuestion(i, pool, settings.format, rng, source));
      used.add(i.id);
      max--;
    }
  };

  const othersRoom = size - picked.length;
  const notDue = pool.filter((i) => {
    const c = cards.get(i.id);
    return c !== undefined && c.fsrs.state !== 0 && c.due > now;
  });
  const leeches = notDue.filter((i) => (cards.get(i.id)?.miss_count ?? 0) >= LEECH_MISSES).sort((x, y) => r(x) - r(y));
  const fresh = pool.filter((i) => !cards.get(i.id) || cards.get(i.id)!.fsrs.state === 0).sort((x, y) => x.order - y.order);
  const newAllowed = Math.max(0, settings.newPerDay - a.newIntroducedToday);
  const stale = notDue.slice().sort((x, y) => r(x) - r(y));

  take(leeches, 1, "leech");
  take(fresh, Math.min(newAllowed, Math.ceil(othersRoom / 2)), "new");
  take(stale, size, "other");
  // まだ足りなければ、残りの復習 → 新しい語で埋める
  take(due, size, "due");
  take(fresh, Math.max(0, newAllowed - picked.filter((q) => q.source === "new").length), "new");

  return shuffle(picked, rng);
}

/** 周回モード: 前回の続きから setSize 問 */
export function buildRoundSet(
  round: Round,
  itemsById: Map<string, Item>,
  pool: Item[],
  settings: Settings,
  rng: Rng,
): Question[] {
  return round.itemIds
    .slice(round.cursor, round.cursor + settings.setSize)
    .map((id) => itemsById.get(id))
    .filter((i): i is Item => i !== undefined)
    .map((i) => makeQuestion(i, pool, settings.format, rng, "round"));
}

export type RoundScope =
  | { kind: "all" }
  | { kind: "section"; section: string }
  | { kind: "track"; track: number }
  | { kind: "range"; from: number; to: number }
  | { kind: "ids"; ids: string[] };

/** 周回の対象（並び順つき） */
export function roundItemIds(items: Item[], scope: RoundScope, order: Round["order"], rng: Rng): string[] {
  const sorted = items.slice().sort((a, b) => a.order - b.order);
  let picked: Item[];
  switch (scope.kind) {
    case "all":
      picked = sorted.filter((i) => i.part === "main");
      break;
    case "section":
      picked = sorted.filter((i) => i.section === scope.section);
      break;
    case "track":
      picked = sorted.filter((i) => i.part === "main" && i.track === scope.track);
      break;
    case "range":
      picked = sorted.filter((i) => i.part === "main" && i.no >= scope.from && i.no <= scope.to);
      break;
    case "ids": {
      const want = new Set(scope.ids);
      picked = sorted.filter((i) => want.has(i.id));
      break;
    }
  }
  const ids = picked.map((i) => i.id);
  return order === "shuffle" ? shuffle(ids, rng) : ids;
}
