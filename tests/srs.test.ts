import { describe, expect, it } from "vitest";
import { seededRng } from "../src/lib/random";
import { ratingForChoice } from "../src/srs/rating";
import { applyReview, makeScheduler, statusOf } from "../src/srs/scheduler";
import { buildDailySet, LEECH_MISSES, makeQuestion, pickDistractors, requeueIfWrong, roundItemIds } from "../src/srs/session";
import { DEFAULT_SETTINGS, type CardState, type Question } from "../src/types";
import { fakeItem, fakeItems } from "./helpers";

const NOW = new Date(2026, 9, 19, 9, 0).getTime();
const DAY = 86400000;
const scheduler = makeScheduler(0.9);

describe("4択の結果 → 評価", () => {
  it("×はもう一度、遅い正解・あやふやは難しい、速い正解は正解", () => {
    expect(ratingForChoice(false, 500, false, 3000)).toBe(1);
    expect(ratingForChoice(true, 3500, false, 3000)).toBe(2);
    expect(ratingForChoice(true, 1000, true, 3000)).toBe(2);
    expect(ratingForChoice(true, 1000, false, 3000)).toBe(3);
  });
});

describe("FSRS の状態更新", () => {
  it("×でミス回数が増え、状態は missed。次は短い間隔で戻る", () => {
    const s = applyReview(undefined, "kinfre-0001", 1, NOW, scheduler);
    expect(s).toMatchObject({ miss_count: 1, correct_count: 0, status: "missed", last_correct: false });
    expect(s.due - NOW).toBeLessThan(DAY);
  });

  it("正解を重ねると間隔が延び、ミス回数は残る", () => {
    let s = applyReview(undefined, "kinfre-0001", 1, NOW, scheduler);
    let t = NOW;
    for (let i = 0; i < 6; i++) {
      t = Math.max(s.due, t + 60000);
      s = applyReview(s, "kinfre-0001", 3, t, scheduler);
    }
    expect(s.miss_count).toBe(1);
    expect(s.correct_count).toBe(6);
    expect(s.status).not.toBe("missed");
    expect(s.due - t).toBeGreaterThan(DAY);
  });

  it("状態の決め方", () => {
    const f = { due: 0, stability: 30, difficulty: 5, elapsed_days: 0, scheduled_days: 30, learning_steps: 0, reps: 5, lapses: 0, state: 2, last_review: 0 };
    expect(statusOf(f, undefined)).toBe("new");
    expect(statusOf(f, false)).toBe("missed");
    expect(statusOf(f, true)).toBe("known");
    expect(statusOf({ ...f, stability: 3 }, true)).toBe("learning");
  });
});

describe("4択の選択肢", () => {
  const items = fakeItems(60);
  it("正解1つ＋重複しない誤答3つ。同じ品詞を優先", () => {
    const target = items[2]; // 品詞「動」
    const d = pickDistractors(target, items, seededRng(1));
    expect(d).toHaveLength(3);
    expect(new Set(d.map((x) => x.ja)).size).toBe(3);
    expect(d.map((x) => x.id)).not.toContain(target.id);
    for (const x of d) expect(x.pos[0]).toBe("動");
  });

  it("正解の位置を覚えている", () => {
    const q = makeQuestion(items[0], items, "mc", seededRng(2), "new");
    expect(q.choices).toHaveLength(4);
    expect(q.choices![q.answerIndex!]).toBe(items[0].ja);
    expect(q.choiceIds![q.answerIndex!]).toBe(items[0].id);
    expect(q.choiceIds!.map((id) => items.find((i) => i.id === id)!.ja)).toEqual(q.choices);
  });
});

describe("セット内のもう一度", () => {
  it("×の問題を最後に足す。同じ語は2回まで", () => {
    const items = fakeItems(10);
    const q = makeQuestion(items[0], items, "mc", seededRng(3), "due");
    const retries = new Map<string, number>();
    let queue: Question[] = [q];
    queue = requeueIfWrong(queue, q, false, retries, items, "mc", seededRng(4));
    queue = requeueIfWrong(queue, q, false, retries, items, "mc", seededRng(5));
    queue = requeueIfWrong(queue, q, false, retries, items, "mc", seededRng(6));
    expect(queue).toHaveLength(3);
    expect(queue[1]).toMatchObject({ retry: true, source: "retry" });
    expect(requeueIfWrong([q], q, true, new Map(), items, "mc", seededRng(7))).toHaveLength(1);
  });
});

describe("今日の学習の組み立て", () => {
  const items = fakeItems(100);
  const settings = { ...DEFAULT_SETTINGS, setSize: 10, reviewRatio: 0.7, newPerDay: 20 };

  function cardsWith(entries: [number, Partial<CardState> & { dueOffset: number; stability?: number }][]) {
    const m = new Map<string, CardState>();
    for (const [no, e] of entries) {
      const id = fakeItem(no).id;
      const due = NOW + e.dueOffset;
      m.set(id, {
        id,
        due,
        fsrs: { due, stability: e.stability ?? 2, difficulty: 5, elapsed_days: 0, scheduled_days: 2, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: NOW - 3 * DAY },
        status: e.status ?? "learning",
        miss_count: e.miss_count ?? 0,
        correct_count: 1,
        last_correct: true,
      });
    }
    return m;
  }

  it("期限切れが多いときは 7問が復習・3問が他", () => {
    const entries: [number, { dueOffset: number }][] = [];
    for (let no = 1; no <= 30; no++) entries.push([no, { dueOffset: -DAY }]);
    for (let no = 31; no <= 50; no++) entries.push([no, { dueOffset: 5 * DAY }]);
    const set = buildDailySet({ items, cards: cardsWith(entries), settings, now: NOW, rng: seededRng(8), scheduler, newIntroducedToday: 0 });
    expect(set).toHaveLength(10);
    expect(set.filter((q) => q.source === "due")).toHaveLength(7);
    expect(new Set(set.map((q) => q.item.id)).size).toBe(10);
  });

  it("ミスの多い語ほど思い出せる確率が低く、先に選ばれる", () => {
    const entries: [number, { dueOffset: number; stability: number; miss_count?: number }][] = [];
    for (let no = 1; no <= 20; no++) entries.push([no, { dueOffset: -DAY, stability: 20 }]);
    entries.push([77, { dueOffset: -DAY, stability: 0.5, miss_count: 3 }]);
    const set = buildDailySet({ items, cards: cardsWith(entries), settings, now: NOW, rng: seededRng(9), scheduler, newIntroducedToday: 0 });
    expect(set.map((q) => q.item.id)).toContain(fakeItem(77).id);
  });

  it("期限前でも、しつこい苦手（ミス3回以上）を1問混ぜる", () => {
    const entries: [number, { dueOffset: number; miss_count?: number }][] = [];
    for (let no = 1; no <= 30; no++) entries.push([no, { dueOffset: -DAY }]);
    entries.push([90, { dueOffset: 3 * DAY, miss_count: LEECH_MISSES }]);
    const set = buildDailySet({ items, cards: cardsWith(entries), settings, now: NOW, rng: seededRng(10), scheduler, newIntroducedToday: 0 });
    expect(set.find((q) => q.item.id === fakeItem(90).id)?.source).toBe("leech");
  });

  it("まだ何も解いていなければ新しい語を番号順に", () => {
    const set = buildDailySet({ items, cards: new Map(), settings, now: NOW, rng: seededRng(11), scheduler, newIntroducedToday: 0 });
    expect(set.map((q) => q.item.no).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("今日の新規が上限に達していたら新しい語は出さない", () => {
    const entries: [number, { dueOffset: number }][] = [];
    for (let no = 1; no <= 5; no++) entries.push([no, { dueOffset: 2 * DAY }]);
    const set = buildDailySet({ items, cards: cardsWith(entries), settings, now: NOW, rng: seededRng(12), scheduler, newIntroducedToday: 20 });
    expect(set.every((q) => q.source !== "new")).toBe(true);
    expect(set).toHaveLength(5);
  });

  it("Supplement は設定でオンにしたときだけ", () => {
    const sup = fakeItem(1, { id: "kinfre-s01-0001", part: "s01", order: 10001, ja: "補足の意味" });
    const set = buildDailySet({ items: [sup], cards: new Map(), settings, now: NOW, rng: seededRng(13), scheduler, newIntroducedToday: 0 });
    expect(set).toHaveLength(0);
    const on = buildDailySet({ items: [sup], cards: new Map(), settings: { ...settings, includeSupplement: true }, now: NOW, rng: seededRng(13), scheduler, newIntroducedToday: 0 });
    expect(on).toHaveLength(1);
  });
});

describe("周回の対象", () => {
  const items = fakeItems(100);
  it("範囲・track・順番どおり／シャッフル", () => {
    expect(roundItemIds(items, { kind: "range", from: 11, to: 15 }, "seq", seededRng(1))).toEqual(
      [11, 12, 13, 14, 15].map((n) => fakeItem(n).id),
    );
    expect(roundItemIds(items, { kind: "track", track: 2 }, "seq", seededRng(1))).toHaveLength(25);
    const sh = roundItemIds(items, { kind: "all" }, "shuffle", seededRng(1));
    expect(sh).toHaveLength(100);
    expect(sh).not.toEqual(items.map((i) => i.id));
  });
});
