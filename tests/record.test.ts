// 記録が残ること（このアプリで一番大事な所）を確かめるテスト
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBackup, missListMarkdown, overlayJsonl, parseBackup, restoreBackup } from "../src/data/backup";
import { db, TrainerDB, upsertItems, useDatabase } from "../src/data/db";
import { recordAnswer } from "../src/data/record";
import { activeRound, startMissedRound, startRound } from "../src/data/rounds";
import { roundStats } from "../src/data/stats";
import { seededRng } from "../src/lib/random";
import { makeScheduler } from "../src/srs/scheduler";
import { fakeItems } from "./helpers";

const NOW = new Date(2026, 9, 19, 9, 0).getTime();
const scheduler = makeScheduler(0.9);
let n = 0;

beforeEach(async () => {
  useDatabase(new TrainerDB(`test-${++n}`));
  await upsertItems(fakeItems(30));
});

function answer(id: string, correct: boolean, extra: Partial<Parameters<typeof recordAnswer>[0]> = {}) {
  return recordAnswer(
    { id, mode: "daily", format: "mc", correct, ms: 1200, unsure: false, rating: correct ? 3 : 1, retry: false, now: NOW, ...extra },
    scheduler,
  );
}

describe("回答の記録", () => {
  it("1回答ごとにログと状態が保存され、DBを開き直しても残る", async () => {
    await answer("kinfre-0001", false, { chosen: "kinfre-0005" });
    await answer("kinfre-0001", true, { now: NOW + 60000, retry: true });
    const name = db.name;
    db.close();
    const reopened = new TrainerDB(name);
    const logs = await reopened.logs.toArray();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ id: "kinfre-0001", correct: false, chosen: "kinfre-0005", day: "2026-10-19", rating: 1 });
    const card = await reopened.cards.get("kinfre-0001");
    expect(card).toMatchObject({ miss_count: 1, correct_count: 1 });
    reopened.close();
  });

  it("教材を読み込み直しても学習記録は消えない", async () => {
    await answer("kinfre-0002", false);
    await upsertItems(fakeItems(30));
    expect(await db.logs.count()).toBe(1);
    expect((await db.cards.get("kinfre-0002"))?.miss_count).toBe(1);
  });
});

describe("周回", () => {
  it("初回の回答で位置が進み、もう一度では進まない。最後まで行くと完了", async () => {
    const items = await db.items.toArray();
    const round = await startRound(items, { kind: "range", from: 1, to: 3 }, "1–3", "seq", seededRng(1), NOW);
    expect(round).toMatchObject({ no: 1, cursor: 0 });
    const base = { mode: "round" as const, rid: round.rid, roundNo: 1 };
    await answer("kinfre-0001", false, base);
    await answer("kinfre-0001", true, { ...base, retry: true });
    expect((await db.rounds.get(round.rid!))?.cursor).toBe(1);
    await answer("kinfre-0002", true, base);
    await answer("kinfre-0003", false, base);
    const done = await db.rounds.get(round.rid!);
    expect(done?.cursor).toBe(3);
    expect(done?.finishedAt).toBeDefined();

    const [stat] = roundStats(await db.rounds.toArray(), await db.logs.toArray());
    expect(stat).toMatchObject({ answered: 3, correct: 1 });
    expect(stat.missedIds).toEqual(["kinfre-0001", "kinfre-0003"]);

    const missed = await startMissedRound(done!, stat.missedIds, NOW + 1000);
    expect(missed).toMatchObject({ no: 1, itemIds: ["kinfre-0001", "kinfre-0003"] });
    expect((await activeRound())?.rid).toBe(missed.rid);

    const second = await startRound(items, { kind: "all" }, "本編", "seq", seededRng(1), NOW + 2000);
    expect(second.no).toBe(2);
    expect((await db.rounds.get(missed.rid!))?.finishedAt).toBeDefined();
  });
});

describe("バックアップ", () => {
  it("書き出し → 全部消えた端末に読み込み → 記録が元どおり", async () => {
    await answer("kinfre-0001", false);
    await answer("kinfre-0005", true);
    await db.notes.put({ id: "kinfre-0001", mnemonic: "テストの覚え方", wrong_note: "似た語と混同" });
    const text = JSON.stringify(await buildBackup(NOW));
    expect(text).not.toContain("意味1"); // 教材本文は入れない

    useDatabase(new TrainerDB(`test-restore-${n}`));
    await upsertItems(fakeItems(30));
    await restoreBackup(parseBackup(text));
    expect(await db.logs.count()).toBe(2);
    expect((await db.cards.get("kinfre-0001"))?.miss_count).toBe(1);
    expect((await db.notes.get("kinfre-0001"))?.mnemonic).toBe("テストの覚え方");
    expect(await db.items.count()).toBe(30);
  });

  it("別のファイルは読み込まない", () => {
    expect(() => parseBackup("{}")).toThrow("このアプリのバックアップファイルではありません");
    expect(() => parseBackup("not json")).toThrow("JSONとして読めません");
  });

  it("ミス一覧.md と オーバーレイ互換 JSONL を書き出す", async () => {
    const items = await db.items.toArray();
    const round = await startRound(items, { kind: "range", from: 1, to: 2 }, "1–2", "seq", seededRng(1), NOW);
    await answer("kinfre-0001", false, { mode: "round", rid: round.rid, roundNo: 1, chosen: "kinfre-0007" });
    await answer("kinfre-0002", true, { mode: "round", rid: round.rid, roundNo: 1 });
    await db.notes.put({ id: "kinfre-0001", wrong_note: "似た語と混同" });
    const cards = new Map((await db.cards.toArray()).map((c) => [c.id, c]));
    const notes = new Map((await db.notes.toArray()).map((x) => [x.id, x]));
    const md = missListMarkdown(items, cards, notes, await db.logs.toArray(), NOW);
    expect(md).toContain("## 001 word1（ミス1回・状態: missed）");
    expect(md).toContain("- 周回: 1周目 ×");
    expect(md).toContain("- ミス: 似た語と混同");
    expect(md).toContain("- 取り違えた語: word7（意味7）");
    expect(md).not.toContain("word2");

    const lines = overlayJsonl(cards, notes).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ id: "kinfre-0001", status: "missed", miss_count: 1, last_reviewed: "2026-10-19", mnemonic: "", wrong_note: "似た語と混同", custom_example: "" });
    expect(lines[1]).toMatchObject({ id: "kinfre-0002", status: "learning", miss_count: 0 });
  });
});
