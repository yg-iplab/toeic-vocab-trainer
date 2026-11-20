// 2台の端末の記録を合わせる（マージ読み込み・v0.9）。架空のデータだけで確かめる
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBackup, parseBackup } from "../src/data/backup";
import { db, getMeta, TrainerDB, useDatabase } from "../src/data/db";
import { applyMerge, backupRecords, localRecords, mergeRecords, replayCard, RESET_META_KEY, type Records } from "../src/data/merge";
import { recordAnswer, type AnswerInput } from "../src/data/record";
import { resetRecords } from "../src/data/reset";
import { makeScheduler } from "../src/srs/scheduler";
import type { Rating, Round } from "../src/types";
import { fakeDeruItem, fakeItem } from "./helpers";

const scheduler = makeScheduler(0.9);
const T0 = new Date(2026, 10, 17, 9, 0).getTime();
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const W1 = fakeItem(1).id;
const W2 = fakeItem(2).id;
const G1 = fakeDeruItem(1).id;
let n = 0;

function answer(id: string, now: number, rating: Rating, over: Partial<AnswerInput> = {}) {
  return recordAnswer(
    { id, mode: "daily", format: id.startsWith("deru") ? "part5" : "mc", correct: rating > 1, ms: 1500, unsure: false, rating, retry: false, now, ...over },
    scheduler,
  );
}

/** 端末を1台ぶん用意する（別名のDB） */
function device(): TrainerDB {
  const d = new TrainerDB(`merge-${++n}`);
  useDatabase(d);
  return d;
}

async function snapshot(d: TrainerDB): Promise<Records> {
  useDatabase(d);
  return localRecords();
}

/** バックアップのJSONを通して渡す（実際の書き出し → 読み込みと同じ道） */
async function backupOf(d: TrainerDB) {
  useDatabase(d);
  return parseBackup(JSON.stringify(await buildBackup(Date.now())));
}

let iphone: TrainerDB;
let ipad: TrainerDB;

beforeEach(async () => {
  // iPhone で2日解いてから、iPad に「戻す」で同じ記録を入れた状態から始める
  iphone = device();
  await answer(W1, T0, 3);
  await answer(W2, T0 + 1000, 1);
  await answer(W1, T0 + DAY, 3);
  ipad = device();
  const b = await backupOf(iphone);
  useDatabase(ipad);
  await db.cards.bulkPut(b.cards);
  await db.logs.bulkPut(b.logs);
});

describe("回答をたどって予定を作り直す", () => {
  it("記録するときと同じ予定になる（ずらし fuzz があっても同じ）", async () => {
    useDatabase(iphone);
    const logs = (await db.logs.toArray()).filter((l) => l.id === W1);
    expect(replayCard(W1, logs, scheduler)).toEqual(await db.cards.get(W1));
  });
});

describe("マージ読み込み", () => {
  it("同じ記録どうしなら、何も足さない", async () => {
    const m = mergeRecords(await snapshot(ipad), backupRecords(await backupOf(iphone)), scheduler);
    expect(m.summary.added).toEqual({ kinfre: 0, deru1000: 0 });
    expect(m.summary.recomputed).toBe(0);
    expect(m.logs).toHaveLength(3);
  });

  it("両方の端末で別々に解いた回答が、両方残る（二重にならない）", async () => {
    useDatabase(iphone);
    await answer(W2, T0 + 2 * DAY, 3); // iPhone だけで解いた
    await answer(G1, T0 + 2 * DAY + 1000, 1);
    useDatabase(ipad);
    await answer(W1, T0 + 2 * DAY + HOUR, 1); // iPad だけで解いた

    const m = mergeRecords(await snapshot(ipad), backupRecords(await backupOf(iphone)), scheduler);
    expect(m.summary.added).toEqual({ kinfre: 1, deru1000: 1 });
    useDatabase(ipad);
    await applyMerge(m);
    const logs = await db.logs.orderBy("ts").toArray();
    expect(logs.map((l) => l.id)).toEqual([W1, W2, W1, W2, G1, W1]);
    expect(new Set(logs.map((l) => l.seq)).size).toBe(6); // 番号がぶつからない

    // 予定は、合わせた全部の回答をたどったものと同じ
    for (const id of [W1, W2, G1]) {
      expect(await db.cards.get(id)).toEqual(replayCard(id, logs.filter((l) => l.id === id), scheduler));
    }
    expect((await db.cards.get(G1))?.miss_count).toBe(1);

    // もう一度同じバックアップを合わせても、増えない
    const again = mergeRecords(await snapshot(ipad), backupRecords(await backupOf(iphone)), scheduler);
    expect(again.summary.added).toEqual({ kinfre: 0, deru1000: 0 });
  });

  it("相手にしか回答が無い語は、相手の予定をそのまま使う（計算し直さない）", async () => {
    useDatabase(iphone);
    await answer(G1, T0 + 2 * DAY, 3);
    const theirs = await db.cards.get(G1);
    const m = mergeRecords(await snapshot(ipad), backupRecords(await backupOf(iphone)), scheduler);
    expect(m.summary.recomputed).toBe(0);
    expect(m.cards.find((c) => c.id === G1)).toEqual(theirs);
  });

  it("自分のメモは、あとで書き直した方を残す", async () => {
    useDatabase(iphone);
    await db.notes.bulkPut([
      { id: W1, mnemonic: "新しい覚え方", updated_at: T0 + 5 * DAY },
      { id: W2, mnemonic: "古い覚え方", updated_at: T0 },
    ]);
    useDatabase(ipad);
    await db.notes.bulkPut([
      { id: W1, mnemonic: "古い", updated_at: T0 },
      { id: W2, mnemonic: "iPadで書き直した", updated_at: T0 + 3 * DAY },
    ]);
    const m = mergeRecords(await snapshot(ipad), backupRecords(await backupOf(iphone)), scheduler);
    const byId = new Map(m.notes.map((x) => [x.id, x.mnemonic]));
    expect(byId.get(W1)).toBe("新しい覚え方");
    expect(byId.get(W2)).toBe("iPadで書き直した");
    expect(m.summary.updatedNotes).toBe(1);
  });

  it("同じ周回は進んだ方の位置を残し、相手だけの周回は番号を付け直して足す。回答の周回番号も付け直す", async () => {
    const shared: Round = { deck: "kinfre", no: 1, label: "1周目：本編", itemIds: [W1, W2, fakeItem(3).id], cursor: 1, order: "seq", startedAt: T0 };
    useDatabase(iphone);
    await db.rounds.add({ ...shared, cursor: 2 });
    const grammarRid = await db.rounds.add({ deck: "deru1000", no: 1, label: "1周目：第1章", itemIds: [G1], cursor: 0, order: "seq", startedAt: T0 + DAY });
    await answer(G1, T0 + 2 * DAY, 3, { mode: "round", rid: grammarRid, roundNo: 1 });
    useDatabase(ipad);
    await db.rounds.add({ deck: "kinfre", no: 9, label: "iPadだけの周回", itemIds: [W1], cursor: 0, order: "seq", startedAt: T0 - DAY, finishedAt: T0 });
    await db.rounds.add({ ...shared });

    const m = mergeRecords(await snapshot(ipad), backupRecords(await backupOf(iphone)), scheduler);
    useDatabase(ipad);
    await applyMerge(m);
    const rounds = await db.rounds.toArray();
    expect(rounds).toHaveLength(3);
    expect(rounds.find((r) => r.label === shared.label)?.cursor).toBe(2);
    const grammar = rounds.find((r) => r.deck === "deru1000")!;
    expect(grammar.cursor).toBe(1);
    expect(new Set(rounds.map((r) => r.rid)).size).toBe(3);
    const g = (await db.logs.toArray()).find((l) => l.id === G1)!;
    expect(g.rid).toBe(grammar.rid);
  });

  it("進行中の周回は教材ごとに1つにする（新しく始めた方を残す）", async () => {
    useDatabase(iphone);
    await db.rounds.add({ deck: "kinfre", no: 2, label: "2周目：iPhone", itemIds: [W1], cursor: 0, order: "seq", startedAt: T0 + 2 * DAY });
    useDatabase(ipad);
    await db.rounds.add({ deck: "kinfre", no: 2, label: "2周目：iPad", itemIds: [W2], cursor: 0, order: "seq", startedAt: T0 + 3 * DAY });
    const m = mergeRecords(await snapshot(ipad), backupRecords(await backupOf(iphone)), scheduler);
    const open = m.rounds.filter((r) => r.finishedAt === undefined);
    expect(open.map((r) => r.label)).toEqual(["2周目：iPad"]);
  });

  it("やり直した教材には、やり直す前の古い記録を入れない（やり直しの時刻はバックアップで伝わる）", async () => {
    useDatabase(ipad);
    await resetRecords(["kinfre"], T0 + 2 * DAY);
    await answer(W1, T0 + 3 * DAY, 3);
    useDatabase(iphone);
    await answer(G1, T0 + 2 * DAY + HOUR, 3); // 文法はやり直していないので入る

    const m = mergeRecords(await snapshot(ipad), backupRecords(await backupOf(iphone)), scheduler);
    expect(m.summary.dropped).toBe(3);
    expect(m.summary.added).toEqual({ kinfre: 0, deru1000: 1 });
    expect(m.cards.map((c) => c.id).sort()).toEqual([G1, W1].sort());

    // 逆向き（やり直していない iPhone に、やり直した iPad の記録を合わせる）でも、古い単語の記録は消える
    const back = mergeRecords(await snapshot(iphone), backupRecords(await backupOf(ipad)), scheduler);
    expect(back.logs.map((l) => l.id).sort()).toEqual([G1, W1].sort());
    expect(back.resets.kinfre).toBe(T0 + 2 * DAY);
    expect(back.cards.find((c) => c.id === W2)).toBeUndefined();
    useDatabase(iphone);
    await applyMerge(back);
    expect(await getMeta(RESET_META_KEY, {})).toEqual({ kinfre: T0 + 2 * DAY });
  });

  it("合わせても、教材・設定・最後のバックアップの日時には触らない", async () => {
    useDatabase(ipad);
    await db.items.put(fakeItem(1));
    await db.meta.bulkPut([
      { key: "settings", value: { setSize: 30 } },
      { key: "lastBackupAt", value: T0 },
    ]);
    useDatabase(iphone);
    await answer(W2, T0 + 2 * DAY, 3);
    const m = mergeRecords(await snapshot(ipad), backupRecords(await backupOf(iphone)), scheduler);
    useDatabase(ipad);
    await applyMerge(m);
    expect(await db.items.count()).toBe(1);
    expect(await getMeta("settings", {})).toEqual({ setSize: 30 });
    expect(await getMeta("lastBackupAt", 0)).toBe(T0);
  });
});
