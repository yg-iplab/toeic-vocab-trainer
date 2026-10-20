// 公式音声：ZIP の読み取り・ファイル名の見分け・時間の表・取り込み・DB 版4・バックアップに入れないこと
// 音声は架空のバイト列（無音の 0）だけ。教材の音声・文は使わない
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { audioSummary, classifyAudio, clipsFor, deleteAudio, formatBytes, importAudioFiles, parseAudioIndex } from "../src/data/audio";
import { buildBackup } from "../src/data/backup";
import { db, TrainerDB, upsertItems, useDatabase } from "../src/data/db";
import { listZip, readZipEntry } from "../src/lib/zip";
import { DEFAULT_SETTINGS } from "../src/types";
import { fakeDeruItem, fakeItem, makeZip, silentBytes } from "./helpers";

const NOW = new Date(2026, 9, 20, 9, 0).getTime();
const zipFile = (name: string, files: Parameters<typeof makeZip>[0]) => new File([makeZip(files)], name, { type: "application/zip" });
const indexFile = (items: unknown[]) => new File([JSON.stringify({ app: "kinfre-trainer", kind: "audio-index", version: 1, items })], "fict_index.json");

beforeEach(() => {
  useDatabase(new TrainerDB(`audio-${Date.now()}-${Math.random()}`));
});

describe("ZIP を端末の中で開く", () => {
  it("目次を読み、圧縮あり・なしのどちらも1本ずつ取り出せる", async () => {
    const a = silentBytes(5000);
    const b = Uint8Array.from({ length: 300 }, (_, i) => i % 7);
    const f = zipFile("fict.zip", [
      { name: "dir/fict_en01.mp3", data: a, deflate: true },
      { name: "fict_0002.mp3", data: b },
    ]);
    const entries = await listZip(f);
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ["dir/fict_en01.mp3", 8, 5000],
      ["fict_0002.mp3", 0, 300],
    ]);
    const outA = await readZipEntry(f, entries[0], "audio/mpeg");
    expect(outA.type).toBe("audio/mpeg");
    expect(new Uint8Array(await outA.arrayBuffer())).toEqual(a);
    expect(new Uint8Array(await (await readZipEntry(f, entries[1])).arrayBuffer())).toEqual(b);
  });

  it("ZIP でなければ分かる言葉で断る", async () => {
    await expect(listZip(new File([silentBytes(100)], "x.zip"))).rejects.toThrow("ZIP ファイルとして読めません");
  });
});

describe("ファイル名の見分け", () => {
  it("単語は「…en＋2桁」（track）、文法は「…＋4桁」（問題番号）。ほかは使わない", () => {
    expect(classifyAudio("fict_en01.mp3")).toEqual({ deck: "kinfre", key: "kinfre-en-01", track: 1 });
    expect(classifyAudio("folder/FICT-EN19.MP3")).toEqual({ deck: "kinfre", key: "kinfre-en-19", track: 19 });
    expect(classifyAudio("Fict_0042.mp3")).toEqual({ deck: "deru1000", key: "deru1000-0042" });
    expect(classifyAudio("fict_head01.mp3")).toBeNull();
    expect(classifyAudio("fict_en01.txt")).toBeNull();
  });
});

describe("時間の表", () => {
  it("番号と秒だけを読む。おかしな秒・番号は飛ばす", () => {
    const segs = parseAudioIndex(
      JSON.stringify({
        kind: "audio-index",
        items: [
          { id: "kinfre-0001", track: 1, word: [0.4, 1.1], example: [1.5, 3.2] },
          { id: "kinfre-0002", track: 1, word: [5, 4] }, // 終わりが先
          { id: "deru1000-0001", track: 1, word: [0, 1] }, // 単語ではない
          { id: "kinfre-0003", track: 12, example: [7.1, 9.9] },
        ],
      }),
    );
    expect(segs).toEqual([
      { id: "kinfre-0001", key: "kinfre-en-01", word: [0.4, 1.1], example: [1.5, 3.2] },
      { id: "kinfre-0003", key: "kinfre-en-12", word: undefined, example: [7.1, 9.9] },
    ]);
    expect(() => parseAudioIndex("{}")).toThrow("時間の表ではありません");
    expect(() => parseAudioIndex("not json")).toThrow("JSON");
  });
});

describe("音声の取り込み", () => {
  it("ZIP と時間の表をまとめて取り込み、端末にある track だけ入れる。バックアップには入れない", async () => {
    await upsertItems([fakeItem(1, { track: 1 }), fakeItem(2, { track: 1 }), fakeDeruItem(1)]);
    const progress: string[] = [];
    const r = await importAudioFiles(
      [
        zipFile("fict_en.zip", [
          { name: "fict_en01.mp3", data: silentBytes(4000), deflate: true },
          { name: "fict_en05.mp3", data: silentBytes(1000), deflate: true }, // 端末に無い track
          { name: "readme.txt", data: silentBytes(10) },
        ]),
        zipFile("fict_q.zip", [{ name: "Fict_0001.mp3", data: silentBytes(2000) }]),
        indexFile([
          { id: "kinfre-0001", track: 1, word: [0.4, 1.0], example: [1.4, 3.0] },
          { id: "kinfre-0002", track: 1, word: [3.4, 4.0], example: [4.4, 6.0] },
        ]),
      ],
      { wantTracks: new Set([1]), now: NOW, onProgress: (d, t) => progress.push(`${d}/${t}`) },
    );
    expect(r.added).toEqual({ kinfre: 1, deru1000: 1 });
    expect(r.bytes).toBe(6000);
    expect(r.segs).toBe(2);
    expect(r.skipped).toEqual(["fict_en05.mp3: 時間の表で使わない音声（Supplement など）なので入れません", "readme.txt: このアプリで使う音声ではないので入れません"]);
    expect(progress).toEqual(["0/2", "1/2", "2/2"]);

    const row = await db.audio.get("kinfre-en-01");
    expect(row).toMatchObject({ deck: "kinfre", track: 1, size: 4000, name: "fict_en01.mp3", importedAt: NOW });
    expect(row?.blob.type).toBe("audio/mpeg");
    expect(await audioSummary()).toEqual({ kinfre: { files: 1, bytes: 4000 }, deru1000: { files: 1, bytes: 2000 }, segs: 2 });

    // 鳴らす場所：単語は track の何秒〜何秒、文法は1問1本
    const keys = new Set(await db.audio.toCollection().primaryKeys());
    const segs = new Map((await db.audioSegs.toArray()).map((s) => [s.id, s]));
    expect(clipsFor(fakeItem(2, { track: 1 }), keys, segs)).toEqual({
      word: { key: "kinfre-en-01", range: [3.4, 4.0] },
      example: { key: "kinfre-en-01", range: [4.4, 6.0] },
    });
    expect(clipsFor(fakeItem(3), keys, segs)).toEqual({}); // 時間の表に無い語は合成音声
    expect(clipsFor(fakeDeruItem(1), keys, segs)).toEqual({ sentence: { key: "deru1000-0001" } });
    expect(clipsFor(fakeDeruItem(2), keys, segs)).toEqual({});

    // バックアップに音声・時間の表は入らない
    const b = await buildBackup(NOW);
    expect(Object.keys(b)).not.toContain("audio");
    expect(JSON.stringify(b)).not.toMatch(/kinfre-en-01|audioSegs/);

    // 消すと鳴らせなくなる（学習記録は別）
    await deleteAudio("kinfre");
    expect(await audioSummary()).toEqual({ kinfre: { files: 0, bytes: 0 }, deru1000: { files: 1, bytes: 2000 }, segs: 0 });
  });

  it("本の track とファイルの番号がずれる所は、時間の表の file で決める（表に無いファイルは入れない）", async () => {
    await upsertItems([fakeItem(901, { track: 19 })]);
    const r = await importAudioFiles(
      [
        zipFile("fict_en.zip", [
          { name: "fict_en18.mp3", data: silentBytes(800), deflate: true },
          { name: "fict_en19.mp3", data: silentBytes(300), deflate: true },
        ]),
        indexFile([{ id: "kinfre-0901", track: 19, file: "18", word: [0.3, 0.9], example: [1.2, 2.8] }]),
      ],
      { wantTracks: new Set([19]), now: NOW },
    );
    expect(r.added.kinfre).toBe(1);
    expect(await db.audio.toCollection().primaryKeys()).toEqual(["kinfre-en-18"]);
    expect(r.skipped).toEqual(["fict_en19.mp3: 時間の表で使わない音声（Supplement など）なので入れません"]);
    const keys = new Set(await db.audio.toCollection().primaryKeys());
    const segs = new Map((await db.audioSegs.toArray()).map((s) => [s.id, s]));
    expect(clipsFor(fakeItem(901, { track: 19 }), keys, segs).word).toEqual({ key: "kinfre-en-18", range: [0.3, 0.9] });
  });

  it("時間の表がまだ無いときは、端末にある語の track の音声だけ入れる", async () => {
    const r = await importAudioFiles(
      [
        zipFile("fict_en.zip", [
          { name: "fict_en02.mp3", data: silentBytes(100), deflate: true },
          { name: "fict_en06.mp3", data: silentBytes(100), deflate: true },
        ]),
      ],
      { wantTracks: new Set([2]), now: NOW },
    );
    expect(await db.audio.toCollection().primaryKeys()).toEqual(["kinfre-en-02"]);
    expect(r.skipped).toEqual(["fict_en06.mp3: 端末に無い track（Supplement など）なので入れません"]);
  });

  it("ZIP でなく MP3 を直接選んでもよい。同じ音声を読み込み直すと置き換え", async () => {
    const mp3 = (n: number) => new File([silentBytes(n)], "Fict_0003.mp3", { type: "audio/mpeg" });
    await importAudioFiles([mp3(100)], { now: NOW });
    await importAudioFiles([mp3(150)], { now: NOW + 1 });
    expect(await db.audio.count()).toBe(1);
    expect((await db.audio.get("deru1000-0003"))?.size).toBe(150);
  });

  it("容量の表示", () => {
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(2048)).toBe("2KB");
    expect(formatBytes(6.5 * 1024 * 1024)).toBe("6.5MB");
  });
});

describe("DB 版4（音声の表を足すだけ）", () => {
  it("版3の DB を開くと、記録・設定・解き方はそのままで、音声の表が空で足される", async () => {
    const name = `v3-${Date.now()}`;
    const old = new Dexie(name);
    old.version(1).stores({ items: "id, order, section, part", cards: "id, due, status, miss_count", logs: "++seq, id, ts, day, round", notes: "id", rounds: "++rid, no, finishedAt", meta: "key" });
    old.version(2).stores({ items: "id, deck, order, section, part", rounds: "++rid, deck, no, finishedAt", chapters: "key, deck" });
    old.version(3).stores({ tips: "key" });
    await old.open();
    await old.table("items").bulkPut([fakeItem(1), fakeDeruItem(1)]);
    await old.table("logs").add({ id: "kinfre-0001", ts: NOW, day: "2026-10-20", mode: "round", round: 1, rid: 1, format: "mc", correct: false, chosen: "kinfre-0002", ms: 900, unsure: false, rating: 1, retry: false });
    await old.table("cards").put({ id: "kinfre-0001", due: NOW, fsrs: {}, status: "missed", miss_count: 1, correct_count: 0 });
    await old.table("notes").put({ id: "kinfre-0001", mnemonic: "架空の覚え方" });
    await old.table("rounds").add({ deck: "kinfre", no: 1, label: "1周目：架空", itemIds: ["kinfre-0001"], cursor: 1, order: "seq", startedAt: NOW });
    await old.table("meta").bulkPut([
      { key: "settings", value: { ...DEFAULT_SETTINGS, setSize: 15 } },
      { key: "lastBackupAt", value: NOW },
    ]);
    await old.table("tips").put({ key: "c01", title: "架空の解き方", order: 1, md: "# 架空", fileName: "01.md", importedAt: NOW });
    const before = Object.fromEntries(await Promise.all(old.tables.map(async (t) => [t.name, await t.toArray()] as const)));
    old.close();

    const upgraded = new TrainerDB(name);
    useDatabase(upgraded);
    await upgraded.open();
    expect(upgraded.verno).toBe(4);
    for (const [table, rows] of Object.entries(before)) expect(await upgraded.table(table).toArray()).toEqual(rows);
    expect(await upgraded.audio.count()).toBe(0);
    expect(await upgraded.audioSegs.count()).toBe(0);
    upgraded.close();
  });
});
