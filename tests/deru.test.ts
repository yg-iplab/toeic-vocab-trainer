// 文法（Part 5）を足しても、単語の記録が壊れないこと・文法の記録が残ることを確かめる
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildBackup,
  deruMemoMarkdown,
  deruMissListMarkdown,
  logCounts,
  missListMarkdown,
  overlayJsonl,
  parseBackup,
  restoreBackup,
} from "../src/data/backup";
import { db, getSettings, TrainerDB, upsertItems, useDatabase } from "../src/data/db";
import { recordAnswer } from "../src/data/record";
import { activeRound, nextRoundNo, startMissedRound, startRound } from "../src/data/rounds";
import { groupStats, roundStats } from "../src/data/stats";
import { seededRng } from "../src/lib/random";
import { ratingForChoice } from "../src/srs/rating";
import { makeScheduler } from "../src/srs/scheduler";
import { buildDailySet, buildRoundSet, makeQuestion, poolOf, requeueIfWrong, roundItemIds } from "../src/srs/session";
import { DEFAULT_SETTINGS, type ChapterInfo } from "../src/types";
import { fakeAnswer, fakeDeruItem, fakeDeruItems, fakeItems } from "./helpers";

const NOW = new Date(2026, 9, 19, 9, 0).getTime();
const scheduler = makeScheduler(0.9);
const chapters: ChapterInfo[] = [
  { key: "c01", deck: "deru1000", label: "第1章 架空A", order: 1, tips: [{ k: "要点", v: "架空" }] },
  { key: "c02", deck: "deru1000", label: "第2章 架空B", order: 2, tips: [] },
  { key: "m01", deck: "deru1000", label: "架空模試 セット1", order: 101, tips: [] },
];
let n = 0;

beforeEach(async () => {
  useDatabase(new TrainerDB(`deru-${++n}`));
  await upsertItems([...fakeItems(30), ...fakeDeruItems(40)], chapters);
});

function answer(id: string, correct: boolean, extra: Partial<Parameters<typeof recordAnswer>[0]> = {}) {
  const deru = id.startsWith("deru1000-");
  return recordAnswer(
    { id, mode: "daily", format: deru ? "part5" : "mc", correct, ms: deru ? 12000 : 1200, unsure: false, rating: correct ? 3 : 1, retry: false, now: NOW, ...extra },
    scheduler,
  );
}

describe("DB の版上げ（版1 → 版2）", () => {
  it("Phase 1 の単語の記録・周回・メモ・設定がそのまま残り、周回は単語として扱われる", async () => {
    const name = `v1-${n}`;
    // Phase 1 と同じ形の DB を作る
    const old = new Dexie(name);
    old.version(1).stores({
      items: "id, order, section, part",
      cards: "id, due, status, miss_count",
      logs: "++seq, id, ts, day, round",
      notes: "id",
      rounds: "++rid, no, finishedAt",
      meta: "key",
    });
    await old.open();
    await old.table("items").bulkPut(fakeItems(5));
    await old.table("logs").bulkAdd([
      { id: "kinfre-0001", ts: NOW, day: "2026-10-19", mode: "round", round: 1, rid: 1, format: "mc", correct: false, chosen: "kinfre-0003", ms: 900, unsure: false, rating: 1, retry: false },
      { id: "kinfre-0002", ts: NOW + 1, day: "2026-10-19", mode: "round", round: 1, rid: 1, format: "mc", correct: true, ms: 900, unsure: false, rating: 3, retry: false },
    ]);
    await old.table("cards").put({ id: "kinfre-0001", due: NOW, fsrs: {}, status: "missed", miss_count: 1, correct_count: 0 });
    await old.table("notes").put({ id: "kinfre-0001", mnemonic: "架空の覚え方" });
    await old.table("rounds").add({ no: 1, label: "1周目：本編 1–5", itemIds: fakeItems(5).map((i) => i.id), cursor: 2, order: "seq", startedAt: NOW });
    await old.table("meta").put({ key: "settings", value: { setSize: 15, hardMs: 4000, format: "flip" } });
    old.close();

    const upgraded = new TrainerDB(name);
    useDatabase(upgraded);
    expect(await upgraded.logs.count()).toBe(2);
    expect((await upgraded.cards.get("kinfre-0001"))?.miss_count).toBe(1);
    expect((await upgraded.notes.get("kinfre-0001"))?.mnemonic).toBe("架空の覚え方");
    expect((await upgraded.items.get("kinfre-0001"))?.deck).toBe("kinfre");
    const round = await activeRound("kinfre");
    expect(round).toMatchObject({ deck: "kinfre", cursor: 2, no: 1 });
    expect(await activeRound("deru1000")).toBeUndefined();
    expect(await nextRoundNo("kinfre")).toBe(2);
    expect(await nextRoundNo("deru1000")).toBe(1);
    // 前の設定は残し、新しい項目は既定値で足す
    expect(await getSettings()).toMatchObject({ setSize: 15, hardMs: 4000, format: "flip", deck: "kinfre", deruHardMs: 30000, deruSetSize: 10 });
    upgraded.close();
  });

  it("版1のバックアップ（単語だけ・周回に教材の印なし）も読める", async () => {
    const v1 = {
      app: "kinfre-trainer",
      kind: "backup",
      version: 1,
      exportedAt: new Date(NOW).toISOString(),
      cards: [{ id: "kinfre-0001", due: NOW, fsrs: {}, status: "missed", miss_count: 2, correct_count: 0 }],
      logs: [{ id: "kinfre-0001", ts: NOW, day: "2026-10-19", mode: "daily", format: "mc", correct: false, ms: 800, unsure: false, rating: 1, retry: false }],
      notes: [],
      rounds: [{ rid: 1, no: 3, label: "3周目", itemIds: ["kinfre-0001"], cursor: 0, order: "seq", startedAt: NOW }],
      meta: [],
    };
    const b = parseBackup(JSON.stringify(v1));
    expect(b.rounds[0].deck).toBe("kinfre");
    await restoreBackup(b);
    expect((await activeRound("kinfre"))?.no).toBe(3);
    expect((await db.cards.get("kinfre-0001"))?.miss_count).toBe(2);
    expect(logCounts(b.logs)).toEqual({ kinfre: 1, deru1000: 0 });
  });

  it("これより新しい版のバックアップは断る", () => {
    expect(() => parseBackup(JSON.stringify({ app: "kinfre-trainer", kind: "backup", version: 99 }))).toThrow("新しい版");
  });
});

describe("Part 5 の出題と判定", () => {
  it("選択肢は本の順のまま、記録には記号だけを使う", () => {
    const item = fakeDeruItem(3);
    const q = makeQuestion(item, [], "mc", seededRng(1), "new");
    expect(q.choices).toEqual(item.choices);
    expect(q.choiceIds).toEqual(["A", "B", "C", "D"]);
    expect(q.choiceIds![q.answerIndex!]).toBe(fakeAnswer(3));
  });

  it("×はもう一度、30秒より遅い正解・あやふやは難しい、30秒以内の正解は正解", () => {
    const hard = DEFAULT_SETTINGS.deruHardMs;
    expect(hard).toBe(30000);
    expect(ratingForChoice(false, 5000, false, hard)).toBe(1);
    expect(ratingForChoice(true, 31000, false, hard)).toBe(2);
    expect(ratingForChoice(true, 8000, true, hard)).toBe(2);
    expect(ratingForChoice(true, 29000, false, hard)).toBe(3);
  });

  it("間違えた問題はセットの最後にもう一度（選択肢は同じ）", () => {
    const item = fakeDeruItem(5);
    const q = makeQuestion(item, [], "mc", seededRng(1), "due");
    const queue = requeueIfWrong([q], q, false, new Map(), [], "mc", seededRng(2));
    expect(queue).toHaveLength(2);
    expect(queue[1]).toMatchObject({ retry: true, choices: item.choices, answerIndex: q.answerIndex });
  });

  it("今日の学習は表示中の教材だけで、文法の問題数の設定を使う", async () => {
    const items = await db.items.toArray();
    const settings = { ...DEFAULT_SETTINGS, deck: "deru1000" as const, deruSetSize: 5, setSize: 20 };
    const set = buildDailySet({ items, cards: new Map(), settings, now: NOW, rng: seededRng(3), scheduler, newIntroducedToday: 0 });
    expect(set).toHaveLength(5);
    expect(set.every((q) => q.item.deck === "deru1000" && q.choices?.length === 4)).toBe(true);
    expect(poolOf(items, settings)).toHaveLength(40);
    const words = buildDailySet({ items, cards: new Map(), settings: { ...settings, deck: "kinfre" }, now: NOW, rng: seededRng(3), scheduler, newIntroducedToday: 0 });
    expect(words).toHaveLength(20);
    expect(words.every((q) => q.item.deck === "kinfre")).toBe(true);
  });
});

describe("文法の周回", () => {
  it("章・ブロック・模試セット・番号で範囲を選べる（単語は混ざらない）", async () => {
    const items = await db.items.toArray();
    const ids = (scope: Parameters<typeof roundItemIds>[1]) => roundItemIds(items, scope, "seq", seededRng(1), "deru1000");
    expect(ids({ kind: "all" })).toHaveLength(40);
    expect(ids({ kind: "chapters" })).toHaveLength(30);
    expect(ids({ kind: "mocks" })).toHaveLength(10);
    expect(ids({ kind: "chapter", chapter: "c02" })).toEqual(fakeDeruItems(30).slice(20).map((i) => i.id));
    expect(ids({ kind: "block", chapter: "c01", block: "練習ブロック前" })).toHaveLength(10);
    expect(ids({ kind: "range", from: 35, to: 37 })).toEqual(["deru1000-0035", "deru1000-0036", "deru1000-0037"]);
  });

  it("進行中の周回と「何周目」は教材ごと。文法を始めても単語の周回は止まらない", async () => {
    const items = await db.items.toArray();
    const words = await startRound(items, { kind: "all" }, "本編", "seq", seededRng(1), NOW, "kinfre");
    const g1 = await startRound(items, { kind: "chapter", chapter: "c01" }, "第1章", "seq", seededRng(1), NOW + 1, "deru1000");
    expect(g1).toMatchObject({ deck: "deru1000", no: 1, label: "1周目：第1章" });
    expect((await activeRound("kinfre"))?.rid).toBe(words.rid);
    expect((await activeRound("deru1000"))?.rid).toBe(g1.rid);

    const base = { mode: "round" as const, rid: g1.rid, roundNo: 1 };
    await answer("deru1000-0001", false, { ...base, chosen: "A" });
    await answer("deru1000-0002", true, base);
    const fresh = (await db.rounds.get(g1.rid!))!;
    expect(fresh.cursor).toBe(2);
    const set = buildRoundSet(fresh, new Map(items.map((i) => [i.id, i])), [], { ...DEFAULT_SETTINGS, deruSetSize: 5 }, seededRng(1));
    expect(set.map((q) => q.item.no)).toEqual([3, 4, 5, 6, 7]);

    const g2 = await startRound(items, { kind: "mocks" }, "模試", "seq", seededRng(1), NOW + 2, "deru1000");
    expect(g2.no).toBe(2);
    expect((await db.rounds.get(g1.rid!))?.finishedAt).toBeDefined();
    expect((await db.rounds.get(words.rid!))?.finishedAt).toBeUndefined();
    const [stat] = roundStats([(await db.rounds.get(g1.rid!))!], await db.logs.toArray());
    expect(stat.missedIds).toEqual(["deru1000-0001"]);
    const missed = await startMissedRound((await db.rounds.get(g1.rid!))!, stat.missedIds, NOW + 3);
    expect(missed).toMatchObject({ deck: "deru1000", label: "1周目のミスだけ（1問）" });
  });
});

describe("文法の記録と書き出し", () => {
  it("記録・バックアップには選んだ記号だけ（問題文・選択肢は入れない）。戻すと文法の記録も戻る", async () => {
    await answer("deru1000-0004", false, { chosen: "C" });
    await answer("kinfre-0001", true);
    await db.notes.put({ id: "deru1000-0004", custom_note: "架空のメモ" });
    const text = JSON.stringify(await buildBackup(NOW));
    expect(text).not.toMatch(/fictional|alpha\d|架空の解説|架空の訳/);
    const b = parseBackup(text);
    expect(b.version).toBe(2);
    expect(logCounts(b.logs)).toEqual({ kinfre: 1, deru1000: 1 });

    useDatabase(new TrainerDB(`deru-restore-${n}`));
    await upsertItems(fakeDeruItems(40), chapters);
    await restoreBackup(b);
    expect((await db.logs.where("id").equals("deru1000-0004").first())?.chosen).toBe("C");
    expect((await db.cards.get("deru1000-0004"))?.status).toBe("missed");
    expect((await db.notes.get("deru1000-0004"))?.custom_note).toBe("架空のメモ");
    expect(await db.chapters.count()).toBe(3); // 章の情報（端末内の教材側）は消さない
  });

  it("ミス一覧.md（詳しい版）と学習メモ形式、overlay 互換 JSONL", async () => {
    const items = await db.items.toArray();
    const round = await startRound(items, { kind: "chapter", chapter: "c01" }, "第1章", "seq", seededRng(1), NOW, "deru1000");
    const base = { mode: "round" as const, rid: round.rid, roundNo: 1 };
    await answer("deru1000-0001", false, { ...base, chosen: "D" });
    await answer("deru1000-0001", true, { ...base, retry: true, now: NOW + 1000 });
    await answer("deru1000-0002", true, base);
    await answer("kinfre-0003", false);
    await db.notes.put({ id: "deru1000-0001", wrong_note: "架空の取り違え", mnemonic: "架空の覚え方", custom_note: "架空のメモ" });
    const cards = new Map((await db.cards.toArray()).map((c) => [c.id, c]));
    const notes = new Map((await db.notes.toArray()).map((x) => [x.id, x]));
    const logs = await db.logs.toArray();
    const chMap = new Map(chapters.map((c) => [c.key, c]));

    const md = deruMissListMarkdown(items, chMap, cards, notes, logs, NOW);
    expect(md).toContain("## 0001（ミス1回・状態: learning）");
    expect(md).toContain("- 範囲: 第1章 架空A / 練習ブロック前");
    expect(md).toContain("- 正解: (B) beta1");
    expect(md).toContain("- 選んだ答え: (D) delta1");
    expect(md).toContain("- 周回: 1周目 ×");
    expect(md).toContain("- メモ: 架空のメモ");
    expect(md).not.toContain("0002");
    expect(md).not.toContain("kinfre");

    const memo = deruMemoMarkdown(items, cards, notes, logs, NOW);
    expect(memo).toContain("## 0001\n\n- status: learning\n- wrong: 架空の取り違え／(D)を選択・正解(B)・ミス1回\n- mnemonic: 架空の覚え方\n- note: 架空のメモ");

    // 単語のミス一覧には文法が混ざらない
    const words = missListMarkdown(items, cards, notes, logs, NOW);
    expect(words).toContain("word3");
    expect(words).not.toContain("deru1000");

    const lines = overlayJsonl(cards, notes, "deru1000").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.id)).toEqual(["deru1000-0001", "deru1000-0002"]);
    expect(lines[0]).toEqual({
      id: "deru1000-0001",
      status: "learning",
      miss_count: 1,
      last_reviewed: "2026-10-19",
      mnemonic: "架空の覚え方",
      wrong_note: "架空の取り違え",
      custom_note: "架空のメモ",
    });
    expect(overlayJsonl(cards, notes, "kinfre")).not.toContain("deru1000");
  });

  it("範囲別の集計は章・模試セットごと", async () => {
    await answer("deru1000-0031", false);
    const items = (await db.items.toArray()).filter((i) => i.deck === "deru1000");
    const cards = new Map((await db.cards.toArray()).map((c) => [c.id, c]));
    const g = groupStats(items, cards, new Map(chapters.map((c) => [c.key, c])));
    expect(g.map((x) => [x.label, x.total])).toEqual([
      ["第1章 架空A", 20],
      ["第2章 架空B", 10],
      ["架空模試 セット1", 10],
    ]);
    expect(g[2]).toMatchObject({ studied: 1, missed: 1 });
  });
});
