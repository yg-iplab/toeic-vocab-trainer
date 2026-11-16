import { describe, expect, it } from "vitest";
import { seededRng } from "../src/lib/random";
import { ratingForChoice } from "../src/srs/rating";
import { applyReview, makeScheduler, statusOf } from "../src/srs/scheduler";
import { newIntroducedOn, weakIds } from "../src/data/stats";
import { buildDailySet, buildExtraSet, dailyLeft, examTime, freshInOrder, LEECH_MISSES, makeQuestion, pickDistractors, requeueIfWrong, roundItemIds } from "../src/srs/session";
import type { ReviewLog } from "../src/types";
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

describe("はじめての語を迷わず速く正解（2b）", () => {
  it("はじめての語だけ「簡単」。あやふや・遅い・2回目以降はこれまでどおり", () => {
    expect(ratingForChoice(true, 1000, false, 3000, true)).toBe(4);
    expect(ratingForChoice(true, 1000, true, 3000, true)).toBe(2);
    expect(ratingForChoice(true, 3500, false, 3000, true)).toBe(2);
    expect(ratingForChoice(false, 1000, false, 3000, true)).toBe(1);
    expect(ratingForChoice(true, 1000, false, 3000, false)).toBe(3);
    expect(ratingForChoice(true, 1000, false, 3000)).toBe(3);
  });

  it("「簡単」なら、次は数日以上あと（同じ日に何度も出さない）", () => {
    const s = applyReview(undefined, "kinfre-0001", 4, NOW, scheduler);
    expect(s.fsrs.state).toBe(2);
    expect(s.due - NOW).toBeGreaterThanOrEqual(5 * DAY);
  });
});

describe("遅い正解でも学習の段階を進める（2a）", () => {
  it("はじめての語を2回続けて遅く正解すると、学習の段階を抜けて日単位の復習になる", () => {
    let s = applyReview(undefined, "kinfre-0001", 2, NOW, scheduler);
    expect(s.fsrs.state).toBe(1);
    expect(s.due - NOW).toBeGreaterThanOrEqual(10 * 60000); // 1つ先の段階（10分）
    const t = s.due;
    s = applyReview(s, "kinfre-0001", 2, t, scheduler);
    expect(s.fsrs.state).toBe(2);
    expect(s.due - t).toBeGreaterThanOrEqual(DAY - 60000);
  });

  it("忘れて学び直し中の語も、遅い正解で日単位の復習に戻る", () => {
    let s = applyReview(undefined, "kinfre-0001", 4, NOW, scheduler);
    const t1 = s.due;
    s = applyReview(s, "kinfre-0001", 1, t1, scheduler); // 忘れた
    expect(s.fsrs.state).toBe(3);
    const t2 = s.due;
    s = applyReview(s, "kinfre-0001", 2, t2, scheduler);
    expect(s.fsrs.state).toBe(2);
  });

  it("遅い正解の記憶の強さは、速い正解より弱いまま（次の復習が早い）", () => {
    const slow = applyReview(applyReview(undefined, "a", 2, NOW, scheduler), "a", 2, NOW + 10 * 60000, scheduler);
    const fast = applyReview(applyReview(undefined, "a", 3, NOW, scheduler), "a", 3, NOW + 10 * 60000, scheduler);
    expect(slow.fsrs.stability).toBeLessThan(fast.fsrs.stability);
    expect(slow.due).toBeLessThan(fast.due);
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

  it("正解と同じ意味を含む訳は誤答にしない（区切り・かっこ・〜を外して比べる）", () => {
    const pool = [
      fakeItem(1, { ja: "（〜を）受け取る／得る", pos: ["動"], section: "S" }),
      fakeItem(2, { ja: "得る", pos: ["動"], section: "S" }),
      fakeItem(3, { ja: "獲得する、得る", pos: ["動"], section: "S" }),
      fakeItem(4, { ja: "〜を受け取る", pos: ["動"], section: "S" }),
      fakeItem(5, { ja: "得点する", pos: ["動"], section: "S" }),
      fakeItem(6, { ja: "送る", pos: ["動"], section: "S" }),
      fakeItem(7, { ja: "断る", pos: ["動"], section: "S" }),
      fakeItem(8, { ja: "届ける", pos: ["動"], section: "S" }),
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const d = pickDistractors(pool[0], pool, seededRng(seed)).map((x) => x.no);
      expect(d).toHaveLength(3);
      expect(d).not.toContain(2);
      expect(d).not.toContain(3);
      expect(d).not.toContain(4);
    }
  });

  it("訳に「／」がある語は、誤答も「／」のある訳を優先する（形だけで正解が分からないように）", () => {
    const pool = [
      fakeItem(1, { ja: "確認する／確かめる", pos: ["動"], section: "S" }),
      ...[2, 3, 4, 5, 6].map((n) => fakeItem(n, { ja: `動詞の意味${n}`, pos: ["動"], section: "S" })),
      ...[7, 8, 9].map((n) => fakeItem(n, { ja: `前の意味${n}／後の意味${n}`, pos: ["動"], section: "T" })),
      fakeItem(10, { ja: "名詞の意味A／名詞の意味B", pos: ["名"], section: "S" }),
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const d = pickDistractors(pool[0], pool, seededRng(seed)).map((x) => x.no);
      expect(d.sort((a, b) => a - b)).toEqual([7, 8, 9]); // 同じ品詞で「／」あり（レベルが違っても）
    }
    // 「／」の無い語は、誤答も「／」の無い訳から
    for (let seed = 1; seed <= 20; seed++) {
      const d = pickDistractors(pool[1], pool, seededRng(seed));
      for (const x of d) expect(x.ja).not.toContain("／");
    }
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

  it("期限前でも、しつこい苦手（ミス3回以上で、最近7日にもミス）を1問混ぜる", () => {
    const entries: [number, { dueOffset: number; miss_count?: number }][] = [];
    for (let no = 1; no <= 30; no++) entries.push([no, { dueOffset: -DAY }]);
    entries.push([90, { dueOffset: 3 * DAY, miss_count: LEECH_MISSES }]);
    const cards = cardsWith(entries);
    const set = buildDailySet({ items, cards, settings, now: NOW, rng: seededRng(10), scheduler, newIntroducedToday: 0, recentMissIds: [fakeItem(90).id] });
    expect(set.find((q) => q.item.id === fakeItem(90).id)?.source).toBe("leech");
    // 最近ミスしていなければ（そのあと正解を続けていれば）、もう毎セットには出さない
    const old = buildDailySet({ items, cards, settings, now: NOW, rng: seededRng(10), scheduler, newIntroducedToday: 0, recentMissIds: [] });
    expect(old.some((q) => q.item.id === fakeItem(90).id)).toBe(false);
  });

  it("まだ何も解いていなければ新しい語を番号順に", () => {
    const set = buildDailySet({ items, cards: new Map(), settings, now: NOW, rng: seededRng(11), scheduler, newIntroducedToday: 0 });
    expect(set.map((q) => q.item.no).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("今日の新規が上限に達し、復習の時期が来た語も無ければ空（＝今日の分は終わり）", () => {
    const entries: [number, { dueOffset: number }][] = [];
    for (let no = 1; no <= 5; no++) entries.push([no, { dueOffset: 2 * DAY }]);
    const cards = cardsWith(entries);
    const set = buildDailySet({ items, cards, settings, now: NOW, rng: seededRng(12), scheduler, newIntroducedToday: 20 });
    expect(set).toHaveLength(0);
    expect(dailyLeft({ items, cards, settings, now: NOW, scheduler, newIntroducedToday: 20 })).toEqual({ due: 0, newLeft: 0 });
  });

  it("復習が残っている間は、期限前の語で埋めない", () => {
    const entries: [number, { dueOffset: number }][] = [];
    for (let no = 1; no <= 3; no++) entries.push([no, { dueOffset: -DAY }]);
    for (let no = 4; no <= 30; no++) entries.push([no, { dueOffset: 2 * DAY }]);
    const set = buildDailySet({ items, cards: cardsWith(entries), settings, now: NOW, rng: seededRng(14), scheduler, newIntroducedToday: 20 });
    expect(set.map((q) => q.item.no).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(set.every((q) => q.source === "due")).toBe(true);
  });

  it("新しい語は1日の上限まで、セットの残りいっぱいに出す（「残りの半分まで」にしない）", () => {
    const entries: [number, { dueOffset: number }][] = [];
    for (let no = 1; no <= 2; no++) entries.push([no, { dueOffset: -DAY }]);
    for (let no = 3; no <= 32; no++) entries.push([no, { dueOffset: 2 * DAY }]);
    const big = { ...settings, setSize: 20, newPerDay: 30 };
    const set = buildDailySet({ items, cards: cardsWith(entries), settings: big, now: NOW, rng: seededRng(15), scheduler, newIntroducedToday: 0 });
    expect(set).toHaveLength(20);
    expect(set.filter((q) => q.source === "due")).toHaveLength(2);
    expect(set.filter((q) => q.source === "new")).toHaveLength(18);
    expect(set.some((q) => q.source === "other")).toBe(false);
  });

  it("新しい語の始まりの番号を選べる（最後まで行ったら最初へ）", () => {
    const from41 = buildDailySet({ items, cards: new Map(), settings: { ...settings, newStartNo: 41 }, now: NOW, rng: seededRng(16), scheduler, newIntroducedToday: 0 });
    expect(from41.map((q) => q.item.no).sort((a, b) => a - b)).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
    expect(freshInOrder(items, new Map(), 97).slice(0, 6).map((i) => i.no)).toEqual([97, 98, 99, 100, 1, 2]);
    const solved = cardsWith([[41, { dueOffset: 2 * DAY }], [42, { dueOffset: 2 * DAY }]]);
    expect(freshInOrder(items, solved, 41).slice(0, 2).map((i) => i.no)).toEqual([43, 44]);
  });

  it("周回ではじめて解いた語は、今日の新規の数に入れない", () => {
    const log = (id: string, ts: number, mode: "round" | "daily", day = "2026-11-16"): ReviewLog => ({
      id, ts, day, mode, format: "mc", correct: true, ms: 1, unsure: false, rating: 3, retry: false,
    });
    const logs = [log("a", 1, "round"), log("b", 2, "daily"), log("a", 3, "daily"), log("c", 4, "daily", "2026-11-15"), log("c", 5, "daily")];
    expect(newIntroducedOn(logs, "2026-11-16")).toBe(1); // b だけ（a は周回が先、c は前の日が先）
  });

  it("追加で回す：期限前の語を、試験の時刻に思い出せる確率が低い順に。直前に答えた語は出さない", () => {
    const entries: [number, { dueOffset: number; stability: number }][] = [
      [1, { dueOffset: 2 * DAY, stability: 30 }],
      [2, { dueOffset: 2 * DAY, stability: 3 }],
      [3, { dueOffset: 2 * DAY, stability: 10 }],
      [4, { dueOffset: -DAY, stability: 1 }], // 期限が来ている（今日の学習のほう）
    ];
    const cards = cardsWith(entries);
    const justNow = cards.get(fakeItem(1).id)!;
    cards.set(fakeItem(5).id, { ...justNow, id: fakeItem(5).id, fsrs: { ...justNow.fsrs, stability: 0.5, last_review: NOW - 5 * 60000 } });
    const small = { ...settings, setSize: 2, examDate: "2026-12-19" };
    const set = buildExtraSet({ items, cards, settings: small, now: NOW, rng: seededRng(17), scheduler });
    expect(set.map((q) => q.item.no).sort((a, b) => a - b)).toEqual([2, 3]);
    expect(examTime("2026-12-19")).toBe(new Date(2026, 11, 19, 13, 0).getTime());
  });

  it("Supplement は設定でオンにしたときだけ", () => {
    const sup = fakeItem(1, { id: "kinfre-s01-0001", part: "s01", order: 10001, ja: "補足の意味" });
    const set = buildDailySet({ items: [sup], cards: new Map(), settings, now: NOW, rng: seededRng(13), scheduler, newIntroducedToday: 0 });
    expect(set).toHaveLength(0);
    const on = buildDailySet({ items: [sup], cards: new Map(), settings: { ...settings, includeSupplement: true }, now: NOW, rng: seededRng(13), scheduler, newIntroducedToday: 0 });
    expect(on).toHaveLength(1);
  });
});

describe("苦手だけの周回（7）", () => {
  it("範囲の中で、ミスしたことのある語と、最後の回答が「難しい」「あやふや」だった語を番号順に", () => {
    const items = fakeItems(20);
    const card = (no: number, miss: number): [string, CardState] => {
      const id = fakeItem(no).id;
      const s = applyReview(undefined, id, 3, NOW, scheduler);
      return [id, { ...s, miss_count: miss }];
    };
    const cards = new Map([card(3, 1), card(5, 0), card(7, 0), card(9, 2), card(15, 1)]);
    const log = (no: number, ts: number, rating: 1 | 2 | 3 | 4, extra: Partial<ReviewLog> = {}): ReviewLog => ({
      id: fakeItem(no).id, ts, day: "2026-11-16", mode: "daily", format: "mc", correct: rating > 1, ms: 1, unsure: false, rating, retry: false, ...extra,
    });
    const logs = [
      log(5, 2, 2), // 最後が「難しい」
      log(7, 1, 2), log(7, 3, 3), // 前は「難しい」でも、最後は「正解」
      log(8, 4, 3, { unsure: true, rating: 2 }), // あやふや（記録上は難しい）
      log(6, 5, 3), log(6, 6, 2, { retry: true }), // セット内のもう一度は見ない
    ];
    expect(weakIds(items, cards, logs, 1, 10).map((id) => Number(id.slice(-4)))).toEqual([3, 5, 8, 9]);
    expect(weakIds(items, cards, logs, 11, 20).map((id) => Number(id.slice(-4)))).toEqual([15]);
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
