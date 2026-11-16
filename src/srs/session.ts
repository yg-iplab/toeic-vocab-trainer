// 1セット（既定10問）の出題を組み立てる部分
import type { FSRS } from "ts-fsrs";
import { sameSectionTag, sectionTag } from "../data/sections";
import { shuffle, type Rng } from "../lib/random";
import {
  deckSettings,
  LETTERS,
  type CardState,
  type Deck,
  type DeruItem,
  type Item,
  type KinfreFormat,
  type KinfreItem,
  type Question,
  type Round,
  type Settings,
} from "../types";
import { retrievability } from "./scheduler";

/** ミス3回以上は「しつこい苦手」 */
export const LEECH_MISSES = 3;
/** セット内で同じ問題をもう一度出すのは2回まで */
export const MAX_RETRY = 2;

/** 今日の学習・周回で出す範囲（表示中の教材だけ。単語の Supplement は設定しだい） */
export function poolOf(items: Item[], settings: Pick<Settings, "includeSupplement" | "deck">, deck: Deck = settings.deck): Item[] {
  return items.filter((i) => i.deck === deck && (i.deck !== "kinfre" || settings.includeSupplement || i.part === "main"));
}

/** 訳を意味ごとに分ける（「／」「、」などで区切り、かっこの中・〜・空白を外す）。誤答の重なりを見るため */
export function meaningParts(ja: string): string[] {
  return ja
    .replace(/[（(][^）)]*[）)]/g, "")
    .split(/[／/、，,；;]/)
    .map((s) => s.replace(/[〜～~\s]/g, ""))
    .filter((s) => s.length > 0);
}

/** 2つの訳が意味を1つでも共有しているか（同じ、または2文字以上の片方がもう片方に含まれる） */
export function meaningsOverlap(a: string, b: string): boolean {
  const pa = meaningParts(a);
  const pb = meaningParts(b);
  return pa.some((x) => pb.some((y) => x === y || (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x)))));
}

const hasSlash = (ja: string) => /[／/]/.test(ja);

/**
 * 4択の誤答を選ぶ（単語だけ。文法は本の選択肢をそのまま使う）。似た選択肢ほど力がつくので
 * 「同じ品詞・同じレベル」→「同じ品詞」→「それ以外」の順で取る
 * v0.8〜 正解と意味を共有する訳は外す（正しい意味を選んで×にならないように）。
 * 訳の「／」の有無は正解とそろえる（品詞の次に優先。形だけで正解が分からないように）
 */
export function pickDistractors(item: KinfreItem, pool: Item[], rng: Rng, n = 3): KinfreItem[] {
  const ok = pool.filter(
    (o): o is KinfreItem =>
      o.deck === "kinfre" &&
      o.id !== item.id &&
      o.ja !== item.ja &&
      !o.ja.includes(item.ja) &&
      !item.ja.includes(o.ja) &&
      !meaningsOverlap(o.ja, item.ja),
  );
  const pos0 = item.pos[0];
  const samePos = ok.filter((o) => pos0 && o.pos[0] === pos0);
  const sameLevel = samePos.filter((o) => o.section === item.section);
  const shape = hasSlash(item.ja);
  const sameShape = (list: KinfreItem[]) => list.filter((o) => hasSlash(o.ja) === shape);
  const picked: KinfreItem[] = [];
  for (const group of [sameShape(sameLevel), sameShape(samePos), sameLevel, samePos, sameShape(ok), ok]) {
    for (const o of shuffle(group, rng)) {
      if (picked.length >= n) break;
      if (!picked.some((p) => p.ja === o.ja)) picked.push(o);
    }
    if (picked.length >= n) break;
  }
  return picked;
}

/** 文法の1問。選択肢は本の順のまま（正解の記号がずれないように並べ替えない） */
export function part5Question(item: DeruItem, source: Question["source"], retry = false): Question {
  return {
    item,
    choices: item.choices,
    choiceIds: item.choices.map((_, i) => LETTERS[i]),
    answerIndex: LETTERS.indexOf(item.answer),
    retry,
    source,
  };
}

export function makeQuestion(
  item: Item,
  pool: Item[],
  format: KinfreFormat,
  rng: Rng,
  source: Question["source"],
  retry = false,
): Question {
  if (item.deck === "deru1000") return part5Question(item, source, retry);
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

/** 間違えた問題を、同じセットの最後にもう一度入れる（単語の4択は選択肢を並べ替える） */
export function requeueIfWrong(
  queue: Question[],
  q: Question,
  correct: boolean,
  retries: Map<string, number>,
  pool: Item[],
  format: KinfreFormat,
  rng: Rng,
): Question[] {
  if (correct) return queue;
  const n = retries.get(q.item.id) ?? 0;
  if (n >= MAX_RETRY) return queue;
  retries.set(q.item.id, n + 1);
  return [...queue, makeQuestion(q.item, pool, format, rng, "retry", true)];
}

export type DailyArgs = {
  items: Item[];
  cards: Map<string, CardState>;
  settings: Settings;
  now: number;
  rng: Rng;
  scheduler: FSRS;
  newIntroducedToday: number; // この教材で今日はじめて解いた数（周回で解いた分は入れない）
  deck?: Deck; // 省略時は表示中の教材
  recentMissIds?: string[]; // 最近ミスした問題（新しい順）。しつこい苦手の判定と文法の類題に使う
};

/** まだ解いていない問題を、設定の開始番号から番号順に（最後まで行ったら最初へ戻る） */
export function freshInOrder(pool: Item[], cards: Map<string, CardState>, startNo = 1): Item[] {
  const fresh = pool.filter((i) => !cards.get(i.id) || cards.get(i.id)!.fsrs.state === 0).sort((x, y) => x.order - y.order);
  const k = fresh.findIndex((i) => i.no >= startNo);
  return k <= 0 ? fresh : [...fresh.slice(k), ...fresh.slice(0, k)];
}

/** 今日の残り：復習の時期が来た数と、今日まだ出せる新しい問題の数（両方0なら「今日の分は終わり」） */
export function dailyLeft(a: Omit<DailyArgs, "rng">): { due: number; newLeft: number } {
  const deck = a.deck ?? a.settings.deck;
  const { newPerDay } = deckSettings(a.settings, deck);
  const pool = poolOf(a.items, a.settings, deck);
  const due = dueItems(pool, a.cards, a.now, a.scheduler).length;
  const freshCount = pool.filter((i) => !a.cards.get(i.id) || a.cards.get(i.id)!.fsrs.state === 0).length;
  return { due, newLeft: Math.min(freshCount, Math.max(0, newPerDay - a.newIntroducedToday)) };
}

/**
 * 文法の類題：最近ミスした問題と同じ分野の、まだ解いていない問題
 * ミスの新しい分野から順に、分野を入れ替えながら1問ずつ並べる（同じ分野ばかりにならないように）
 */
export function similarFresh(fresh: Item[], missed: Item[]): Item[] {
  const tags: string[] = [];
  for (const m of missed) {
    if (m.deck !== "deru1000" || !m.section) continue;
    const t = sectionTag(m.section);
    if (!tags.some((x) => sameSectionTag(x, t))) tags.push(t);
  }
  const groups = tags.map((t) => fresh.filter((i) => i.deck === "deru1000" && sameSectionTag(sectionTag(i.section), t)));
  const out: Item[] = [];
  const seen = new Set<string>();
  for (let k = 0; groups.some((g) => k < g.length); k++) {
    for (const g of groups) {
      const i = g[k];
      if (i && !seen.has(i.id)) {
        out.push(i);
        seen.add(i.id);
      }
    }
  }
  return out;
}

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
 * 今日の学習（忘却曲線モード）。表示中の教材だけで組む（v0.8 で組み直し）
 * - 復習の時期が来た問題を先に。思い出せる確率が低い順（ミスした問題ほど早く・多く戻る）。1セットの約7割
 * - 残りは新しい問題（設定の開始番号から番号順。1日の上限まで）。足りなければ復習で埋める
 * - しつこい苦手（ミス3回以上で、最近7日にもミスした問題）を、期限前でも1セットに1問
 * - 文法の新しい問題の枠は、半分まで「類題」（最近ミスした分野の、まだ解いていない問題）を先に出す
 * - 復習も新しい問題も残っていなければ空（＝今日の分は終わり）。期限前の問題は buildExtraSet で、押したときだけ出す
 */
export function buildDailySet(a: DailyArgs): Question[] {
  const { items, cards, settings, now, rng, scheduler } = a;
  const deck = a.deck ?? settings.deck;
  const { setSize: size, newPerDay, newStartNo } = deckSettings(settings, deck);
  const pool = poolOf(items, settings, deck);
  const r = (i: Item) => retrievability(cards.get(i.id), now, scheduler);
  const make = (i: Item, source: Question["source"]) => makeQuestion(i, pool, settings.format, rng, source);

  const due = dueItems(pool, cards, now, scheduler);
  const fresh = freshInOrder(pool, cards, newStartNo);
  const newAllowed = Math.min(fresh.length, Math.max(0, newPerDay - a.newIntroducedToday));
  if (due.length === 0 && newAllowed === 0) return [];

  const picked: Question[] = [];
  const used = new Set<string>();
  const take = (list: Item[], max: number, source: Question["source"]) => {
    for (const i of list) {
      if (picked.length >= size || max <= 0) break;
      if (used.has(i.id)) continue;
      picked.push(make(i, source));
      used.add(i.id);
      max--;
    }
  };

  const recent = new Set(a.recentMissIds ?? []);
  const leeches = pool
    .filter((i) => {
      const c = cards.get(i.id);
      return c !== undefined && c.fsrs.state !== 0 && c.due > now && c.miss_count >= LEECH_MISSES && recent.has(i.id);
    })
    .sort((x, y) => r(x) - r(y));

  const byId = new Map(pool.map((i) => [i.id, i]));
  const missed = (a.recentMissIds ?? []).map((id) => byId.get(id)).filter((i): i is Item => i !== undefined);
  const similar = deck === "deru1000" ? similarFresh(fresh, missed) : [];

  take(due, Math.round(size * settings.reviewRatio), "due");
  take(leeches, 1, "leech");
  const newSlots = Math.min(newAllowed, size - picked.length);
  take(similar, Math.ceil(newSlots / 2), "similar");
  take(fresh, newSlots - picked.filter((q) => q.source === "similar").length, "new");
  take(due, size, "due"); // 新しい問題が足りなければ、残りの復習で埋める

  return shuffle(picked, rng);
}

/** 試験の時刻（試験日の13時。TOEIC の公開テストは午後） */
export function examTime(examDate: string): number {
  const [y, m, d] = examDate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 13, 0).getTime();
}

/** 追加で回すときに、直前に答えた問題は出さない（同じ問題を数分おきに見ても身につきにくい） */
export const EXTRA_SKIP_RECENT_MS = 60 * 60000;

/**
 * 追加で回す（今日の分が終わったあと、押したときだけ）。期限前の問題を、試験の時刻に思い出せる確率が低い順に
 * 試験の前に忘れかけそうな問題から出すので、試験日より後に復習が来る問題も、余った時間で試験前にもう一度見られる
 */
export function buildExtraSet(a: Omit<DailyArgs, "newIntroducedToday" | "recentMissIds">): Question[] {
  const { items, cards, settings, now, rng, scheduler } = a;
  const deck = a.deck ?? settings.deck;
  const { setSize: size } = deckSettings(settings, deck);
  const pool = poolOf(items, settings, deck);
  const at = Math.max(now, examTime(settings.examDate));
  const rAt = (i: Item) => retrievability(cards.get(i.id), at, scheduler);
  const list = pool
    .filter((i) => {
      const c = cards.get(i.id);
      if (!c || c.fsrs.state === 0 || c.due <= now) return false;
      return c.fsrs.last_review === null || now - c.fsrs.last_review >= EXTRA_SKIP_RECENT_MS;
    })
    .sort((x, y) => rAt(x) - rAt(y))
    .slice(0, size);
  return shuffle(
    list.map((i) => makeQuestion(i, pool, settings.format, rng, "other")),
    rng,
  );
}

/** 周回モード: 前回の続きから1セット分 */
export function buildRoundSet(
  round: Round,
  itemsById: Map<string, Item>,
  pool: Item[],
  settings: Settings,
  rng: Rng,
): Question[] {
  const { setSize } = deckSettings(settings, round.deck ?? "kinfre");
  return round.itemIds
    .slice(round.cursor, round.cursor + setSize)
    .map((id) => itemsById.get(id))
    .filter((i): i is Item => i !== undefined)
    .map((i) => makeQuestion(i, pool, settings.format, rng, "round"));
}

export type RoundScope =
  | { kind: "all" } // 単語は本編すべて、文法はすべて
  | { kind: "section"; section: string } // 単語：レベル別
  | { kind: "track"; track: number } // 単語：track 別
  | { kind: "range"; from: number; to: number } // 番号で指定
  | { kind: "ids"; ids: string[] }
  | { kind: "chapters" } // 文法：章（模試以外）すべて
  | { kind: "mocks" } // 文法：模試セットすべて
  | { kind: "chapter"; chapter: string } // 文法：1つの章・模試セット
  | { kind: "block"; chapter: string; block: string }; // 文法：章の中のブロック

/** 文法の章キーが模試セットか */
export function isMockChapter(key: string): boolean {
  return key.startsWith("m");
}

/** 周回の対象（並び順つき） */
export function roundItemIds(items: Item[], scope: RoundScope, order: Round["order"], rng: Rng, deck: Deck = "kinfre"): string[] {
  const sorted = items.filter((i) => i.deck === deck).sort((a, b) => a.order - b.order);
  const isMain = (i: Item) => i.deck !== "kinfre" || i.part === "main";
  let picked: Item[];
  switch (scope.kind) {
    case "all":
      picked = sorted.filter(isMain);
      break;
    case "section":
      picked = sorted.filter((i) => i.section === scope.section);
      break;
    case "track":
      picked = sorted.filter((i) => i.deck === "kinfre" && i.part === "main" && i.track === scope.track);
      break;
    case "range":
      picked = sorted.filter((i) => isMain(i) && i.no >= scope.from && i.no <= scope.to);
      break;
    case "ids": {
      const want = new Set(scope.ids);
      picked = sorted.filter((i) => want.has(i.id));
      break;
    }
    case "chapters":
      picked = sorted.filter((i) => i.deck === "deru1000" && !isMockChapter(i.chapter));
      break;
    case "mocks":
      picked = sorted.filter((i) => i.deck === "deru1000" && isMockChapter(i.chapter));
      break;
    case "chapter":
      picked = sorted.filter((i) => i.deck === "deru1000" && i.chapter === scope.chapter);
      break;
    case "block":
      picked = sorted.filter((i) => i.deck === "deru1000" && i.chapter === scope.chapter && i.block === scope.block);
      break;
  }
  const ids = picked.map((i) => i.id);
  return order === "shuffle" ? shuffle(ids, rng) : ids;
}
