// 学習記録をやり直す（v0.8.1）：回答の記録・復習の予定・周回だけを消し、教材・音声・設定・メモ・時間の表は残す
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getSettings, saveSettings, db, TrainerDB, useDatabase } from "../src/data/db";
import { recordCounts, resetRecords } from "../src/data/reset";
import { applyReview, makeScheduler } from "../src/srs/scheduler";
import { DEFAULT_SETTINGS, type ReviewLog } from "../src/types";
import { fakeDeruItem, fakeItem } from "./helpers";

const NOW = new Date(2026, 10, 17, 9, 0).getTime();
const scheduler = makeScheduler(0.9);
let n = 0;

const log = (id: string, ts: number): ReviewLog => ({
  id, ts, day: "2026-11-17", mode: "daily", format: "mc", correct: true, ms: 1000, unsure: false, rating: 3, retry: false,
});

beforeEach(async () => {
  useDatabase(new TrainerDB(`reset-${++n}`));
  const w = fakeItem(1);
  const g = fakeDeruItem(1);
  await db.items.bulkPut([w, fakeItem(2), g]);
  await db.cards.bulkPut([applyReview(undefined, w.id, 3, NOW, scheduler), applyReview(undefined, g.id, 1, NOW, scheduler)]);
  await db.logs.bulkAdd([log(w.id, NOW), log(w.id, NOW + 1), log(g.id, NOW + 2)]);
  await db.rounds.bulkAdd([
    { deck: "kinfre", no: 1, label: "本編 1–2", itemIds: [w.id, fakeItem(2).id], cursor: 1, order: "seq", startedAt: NOW },
    { deck: "deru1000", no: 1, label: "第1章", itemIds: [g.id], cursor: 1, order: "seq", startedAt: NOW },
  ]);
  await db.notes.bulkPut([{ id: w.id, mnemonic: "架空の覚え方" }, { id: g.id, custom_note: "架空のメモ" }]);
  await db.audio.put({ key: "kinfre-en-01", deck: "kinfre", track: 1, data: new ArrayBuffer(4), type: "audio/mpeg", size: 4, name: "fict_en01.mp3", importedAt: NOW });
  await db.audioSegs.put({ id: w.id, key: "kinfre-en-01", word: [0, 1] });
  await saveSettings({ ...DEFAULT_SETTINGS, setSize: 20, newPerDay: 30, hardMs: 6000 });
});

describe("学習記録をやり直す", () => {
  it("消す前に、教材ごとの件数を数える（確認の画面に出す）", async () => {
    expect(await recordCounts()).toEqual({
      kinfre: { answers: 2, studied: 1, rounds: 1 },
      deru1000: { answers: 1, studied: 1, rounds: 1 },
    });
  });

  it("単語だけ：単語の記録・復習の予定・周回を消し、文法の記録は残す", async () => {
    await resetRecords(["kinfre"]);
    expect((await db.cards.toArray()).map((c) => c.id)).toEqual([fakeDeruItem(1).id]);
    expect((await db.logs.toArray()).map((l) => l.id)).toEqual([fakeDeruItem(1).id]);
    expect((await db.rounds.toArray()).map((r) => r.deck)).toEqual(["deru1000"]);
  });

  it("両方：記録はすべて消える。教材・公式音声・時間の表・設定・自分のメモは残る", async () => {
    await resetRecords(["kinfre", "deru1000"]);
    expect(await db.cards.count()).toBe(0);
    expect(await db.logs.count()).toBe(0);
    expect(await db.rounds.count()).toBe(0);
    expect(await db.items.count()).toBe(3);
    expect(await db.audio.count()).toBe(1);
    expect(await db.audioSegs.count()).toBe(1);
    expect(await db.notes.count()).toBe(2);
    expect(await getSettings()).toMatchObject({ setSize: 20, newPerDay: 30, hardMs: 6000 });
    expect(await recordCounts()).toEqual({
      kinfre: { answers: 0, studied: 0, rounds: 0 },
      deru1000: { answers: 0, studied: 0, rounds: 0 },
    });
  });
});
