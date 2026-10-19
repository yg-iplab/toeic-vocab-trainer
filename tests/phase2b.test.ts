// Phase 2b：解き方（tips）の読み込み・表示用の読み取り、DB の版上げ（版2 → 版3）、文法の類題、進捗グラフの集計
// 教材の中身は使わず、架空のデータだけで確かめる
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBackup, BACKUP_VERSION } from "../src/data/backup";
import { db, TrainerDB, upsertItems, upsertTips, useDatabase } from "../src/data/db";
import { parseMaterialFile } from "../src/data/parseFile";
import { sameSection, sameSectionTag, sectionTag } from "../src/data/sections";
import { passRates, recentMissIds } from "../src/data/stats";
import { parseTipsFile, sectionChapterIndex, tipsButtonLabel, tipsForItem, tipsHeading, tipsView } from "../src/data/tips";
import { inlineText, parseInline, parseMarkdown, splitRow, type Block } from "../src/lib/markdown";
import { seededRng } from "../src/lib/random";
import { emptyState, makeScheduler } from "../src/srs/scheduler";
import { buildDailySet, similarFresh } from "../src/srs/session";
import { DEFAULT_SETTINGS, type CardState, type ChapterInfo, type ReviewLog, type Round, type TipsDoc } from "../src/types";
import { fakeDeruChapterMd, fakeDeruItem, fakeDeruItems, fakeItems } from "./helpers";

const NOW = new Date(2026, 9, 19, 9, 0).getTime();
const DAY = 86400000;
const scheduler = makeScheduler(0.9);

/** 架空の解き方ファイル（実ファイルと同じ書き方。中身はすべて作り物） */
function fakeTipsMd(heading: string): string {
  return [
    `# ${heading}`,
    "",
    "架空の変換メモ1",
    "架空の変換メモ2",
    "",
    "| 架空の列 | 架空の対応表 | 架空の頁 | 架空の元 |",
    "| --- | --- | --- | --- |",
    "| 架空 | p01 | 1 | a.png |",
    "",
    "---",
    "",
    "## 架空の手順",
    "",
    "1. 架空の一歩目",
    "   架空の続きの行",
    "",
    "   架空の続きの段落",
    "2. 架空の二歩目",
    "   - 架空の入れ子A",
    "   - 架空の入れ子B",
    "",
    "### 架空の表",
    "",
    "| 形 | 例 |",
    "| :--- | ---: |",
    "| **架空の太字** | <u>架空の下線</u><br>架空の2行目 |",
    "",
    "> 架空の引用",
    "",
    "```",
    "架空の図   ← 字下げを残す",
    "    架空の2行目",
    "```",
  ].join("\n");
}

const kinds = (bs: Block[]) => bs.map((b) => b.t);

describe("Markdown の読み取り（解き方の表示用）", () => {
  it("見出し・段落・リスト（続きの段落と入れ子）・表・引用・コードの枠・区切り線", () => {
    const blocks = parseMarkdown(fakeTipsMd("第3章《架空》の解き方"));
    expect(kinds(blocks)).toEqual(["h", "p", "table", "hr", "h", "list", "h", "table", "quote", "code"]);
    const list = blocks[5] as Extract<Block, { t: "list" }>;
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(2);
    expect(kinds(list.items[0])).toEqual(["p", "p"]); // 字下げした続きの段落は同じ項目
    expect(inlineText((list.items[0][0] as Extract<Block, { t: "p" }>).c)).toBe("架空の一歩目 架空の続きの行");
    expect(kinds(list.items[1])).toEqual(["p", "list"]);
    const table = blocks[7] as Extract<Block, { t: "table" }>;
    expect(table.align).toEqual(["left", "right"]);
    expect(table.rows[0][0]).toEqual([{ t: "b", c: [{ t: "text", v: "架空の太字" }] }]);
    expect(table.rows[0][1]).toEqual([{ t: "u", c: [{ t: "text", v: "架空の下線" }] }, { t: "br" }, { t: "text", v: "架空の2行目" }]);
    expect((blocks[9] as Extract<Block, { t: "code" }>).v).toBe("架空の図   ← 字下げを残す\n    架空の2行目");
  });

  it("段落の改行は改行として残し、太字が行をまたいでもよい", () => {
    const [p] = parseMarkdown("架空の**一行目\n二行目**の続き");
    expect(p).toEqual({
      t: "p",
      c: [{ t: "text", v: "架空の" }, { t: "b", c: [{ t: "text", v: "一行目" }, { t: "br" }, { t: "text", v: "二行目" }] }, { t: "text", v: "の続き" }],
    });
  });

  it("知らないタグ・閉じていない記号は文字のまま（HTML として扱わない）", () => {
    expect(parseInline("<script>x</script> **閉じない")).toEqual([{ t: "text", v: "<script>x</script> **閉じない" }]);
    expect(parseInline("`a|b` と \\*記号\\*")).toEqual([{ t: "code", v: "a|b" }, { t: "text", v: " と *記号*" }]);
  });

  it("「**太字**」で始まる行は箇条書きにしない。番号の続きは開始番号を残す", () => {
    expect(kinds(parseMarkdown("**架空**：説明"))).toEqual(["p"]);
    const blocks = parseMarkdown("1. 架空A\n\n架空の段落\n\n2. 架空B");
    expect(kinds(blocks)).toEqual(["list", "p", "list"]);
    expect((blocks[2] as Extract<Block, { t: "list" }>).start).toBe(2);
  });

  it("表のマスは \\| と `…` の中の | で区切らない", () => {
    expect(splitRow("| a \\| b | `c|d` | e |")).toEqual(["a \\| b", "`c|d`", "e"]);
  });
});

describe("解き方ファイルの読み込み（中身で見分ける）", () => {
  it("見出しの「第N章」で章、「使い方」で巻頭", () => {
    expect(tipsHeading(fakeTipsMd("第3章《架空》の解き方"))).toMatchObject({ key: "c03", order: 3 });
    expect(tipsHeading("# 架空の本の使い方\n\n本文")).toMatchObject({ key: "intro", order: 0 });
    expect(tipsHeading("# 架空の履歴\n\n- 第1章 済み")).toBeNull();
    expect(tipsHeading("本文だけ")).toBeNull();
  });

  it("同じ「教材データを読み込む」で、問題・単語・解き方を見分ける", () => {
    const tips = parseMaterialFile("03_x.md", fakeTipsMd("第3章《架空》の解き方"), NOW);
    expect(tips.items).toHaveLength(0);
    expect(tips.tips?.[0]).toMatchObject({ key: "c03", fileName: "03_x.md", importedAt: NOW });
    const chapter = parseMaterialFile("01_x.md", fakeDeruChapterMd({ heading: "第1章 架空A", from: 1, to: 3 }));
    expect(chapter.items).toHaveLength(3);
    expect(chapter.tips).toBeUndefined();
    const log = parseMaterialFile("_LOG.md", "# 架空の履歴\n\n本文", NOW);
    expect(log.items).toHaveLength(0);
    expect(log.tips).toBeUndefined();
  });

  it("Drive の表示で付くエスケープ（\\# \\-）は外して保存する", () => {
    const md = fakeTipsMd("第2章《架空》の解き方").replace(/^(#+)/gm, (m) => m.replace(/#/g, "\\#")).replace(/^- /gm, "\\- ");
    const doc = parseTipsFile("02.md", md, NOW)!;
    expect(doc.key).toBe("c02");
    expect(doc.md.startsWith("# 第2章")).toBe(true);
    expect(kinds(parseMarkdown(doc.md))[0]).toBe("h");
  });

  it("表示では見出しを外し、最初の区切り線より前（変換メモ）を分ける", () => {
    const view = tipsView({ md: fakeTipsMd("第3章《架空》の解き方") });
    expect(kinds(view.preface)).toEqual(["p", "table"]);
    expect(kinds(view.body)[0]).toBe("h");
    // 区切り線の前に見出しがあれば分けない
    const plain = tipsView({ md: "# 架空\n\n## 架空の節\n\n本文\n\n---\n\n後ろ" });
    expect(plain.preface).toHaveLength(0);
    expect(kinds(plain.body)).toEqual(["h", "p", "hr", "p"]);
  });
});

describe("分野（section）の照合", () => {
  it("末尾の「問題」を外し、略した書き方も同じ分野とみなす", () => {
    expect(sectionTag("アルファ 問題")).toBe("アルファ");
    expect(sectionTag("アルファの問題")).toBe("アルファ");
    expect(sameSection("アルファ問題", "アルファ")).toBe(true);
    expect(sameSection("ベータ拡張問題", "ベータ")).toBe(true);
    expect(sameSection("ガンマ語or デルタ語問題", "ガ or デ")).toBe(true);
    // 「A」と「A or B」は別の分野
    expect(sameSection("ガンマ語", "ガンマ語orデルタ語")).toBe(false);
    expect(sameSection("アルファ", "ベータ")).toBe(false);
    expect(sameSectionTag("", "")).toBe(false);
  });

  it("模試の問題は、同じ分野の問題がいちばん多い章の解き方を出す", () => {
    const items = [
      fakeDeruItem(1, { chapter: "c01", section: "アルファ問題" }),
      fakeDeruItem(2, { chapter: "c01", section: "アルファ問題" }),
      fakeDeruItem(3, { chapter: "c02", section: "アルファ問題" }),
      fakeDeruItem(4, { chapter: "c02", section: "ベータ問題" }),
      fakeDeruItem(5, { chapter: "m01", section: "アルファ" }),
      fakeDeruItem(6, { chapter: "m01", section: "ベータ" }),
      fakeDeruItem(7, { chapter: "m01", section: "そのほか" }),
    ];
    const index = sectionChapterIndex(items);
    expect(index("アルファ")).toBe("c01");
    expect(index("ベータ")).toBe("c02");
    expect(index("そのほか")).toBeUndefined();
    const doc = (key: string): TipsDoc => ({ key, title: `架空${key}`, order: Number(key.slice(1)), md: "", fileName: "", importedAt: NOW });
    const tips = new Map([doc("c01"), doc("c02")].map((d) => [d.key, d]));
    expect(tipsForItem(items[0], tips, index)).toMatchObject({ viaSection: false, doc: { key: "c01" } });
    const viaSection = tipsForItem(items[5], tips, index)!;
    expect(viaSection).toMatchObject({ viaSection: true, doc: { key: "c02" } });
    expect(tipsButtonLabel(viaSection)).toBe("この分野の解き方（第2章）");
    expect(tipsForItem(items[6], tips, index)).toBeUndefined();
    expect(tipsForItem(items[0], new Map(), index)).toBeUndefined();
  });
});

describe("DB の版上げ（版2 → 版3）", () => {
  it("版2の記録（単語・文法・周回・メモ・設定・章の表）がすべて残り、解き方の表が増える", async () => {
    const name = `v2-${Date.now()}`;
    // Phase 2 と同じ形の DB を作る
    const old = new Dexie(name);
    old.version(1).stores({
      items: "id, order, section, part",
      cards: "id, due, status, miss_count",
      logs: "++seq, id, ts, day, round",
      notes: "id",
      rounds: "++rid, no, finishedAt",
      meta: "key",
    });
    old.version(2).stores({ items: "id, deck, order, section, part", rounds: "++rid, deck, no, finishedAt", chapters: "key, deck" });
    await old.open();
    await old.table("items").bulkPut([...fakeItems(5), ...fakeDeruItems(5)]);
    await old.table("logs").bulkAdd([
      { id: "kinfre-0001", ts: NOW, day: "2026-10-19", mode: "round", round: 1, rid: 1, format: "mc", correct: false, chosen: "kinfre-0003", ms: 900, unsure: false, rating: 1, retry: false },
      { id: "deru1000-0002", ts: NOW + 1, day: "2026-10-19", mode: "round", round: 1, rid: 2, format: "part5", correct: false, chosen: "B", ms: 9000, unsure: true, rating: 1, retry: false },
    ]);
    await old.table("cards").bulkPut([
      { id: "kinfre-0001", due: NOW, fsrs: {}, status: "missed", miss_count: 1, correct_count: 0 },
      { id: "deru1000-0002", due: NOW, fsrs: {}, status: "missed", miss_count: 2, correct_count: 1 },
    ]);
    await old.table("notes").bulkPut([
      { id: "kinfre-0001", mnemonic: "架空の覚え方" },
      { id: "deru1000-0002", custom_note: "架空のメモ" },
    ]);
    await old.table("rounds").bulkAdd([
      { deck: "kinfre", no: 1, label: "1周目：架空", itemIds: ["kinfre-0001"], cursor: 1, order: "seq", startedAt: NOW },
      { deck: "deru1000", no: 1, label: "1周目：架空", itemIds: ["deru1000-0002"], cursor: 1, order: "seq", startedAt: NOW },
    ]);
    await old.table("meta").bulkPut([
      { key: "settings", value: { ...DEFAULT_SETTINGS, deck: "deru1000", deruSetSize: 15 } },
      { key: "lastBackupAt", value: NOW - DAY },
    ]);
    await old.table("chapters").put({ key: "c01", deck: "deru1000", label: "第1章 架空", order: 1, tips: [{ k: "要点", v: "架空" }] });
    const before = Object.fromEntries(await Promise.all(old.tables.map(async (t) => [t.name, await t.toArray()] as const)));
    old.close();

    const upgraded = new TrainerDB(name);
    useDatabase(upgraded);
    await upgraded.open();
    expect(upgraded.verno).toBe(3);
    for (const [table, rows] of Object.entries(before)) expect(await upgraded.table(table).toArray()).toEqual(rows);
    expect(await upgraded.tips.count()).toBe(0);

    // 解き方を読み込んでも、記録は変わらない。同じ章は置き換え
    const doc = parseTipsFile("01.md", fakeTipsMd("第1章《架空》の解き方"), NOW)!;
    await upsertTips([doc]);
    await upsertTips([{ ...doc, title: "差し替え" }]);
    expect(await upgraded.tips.count()).toBe(1);
    expect((await upgraded.tips.get("c01"))?.title).toBe("差し替え");
    expect(await upgraded.logs.toArray()).toEqual(before.logs);

    // バックアップは版2のまま、解き方（教材）を入れない
    const b = await buildBackup(NOW);
    expect(b.version).toBe(2);
    expect(BACKUP_VERSION).toBe(2);
    expect(JSON.stringify(b)).not.toContain("架空の手順");
    upgraded.close();
  });
});

describe("文法の類題（今日の学習）", () => {
  const items = Array.from({ length: 40 }, (_, k) => fakeDeruItem(k + 1, { chapter: "c01", section: k % 2 === 0 ? "アルファ問題" : "ベータ問題" }));
  const settings = { ...DEFAULT_SETTINGS, deck: "deru1000" as const };
  const missedCard = (id: string): CardState => {
    const s = emptyState(id, NOW - DAY);
    // ミスしたが、復習の期限はまだ先
    return { ...s, due: NOW + 3 * DAY, fsrs: { ...s.fsrs, state: 1, due: NOW + 3 * DAY, last_review: NOW - DAY }, status: "missed", miss_count: 1, last_correct: false };
  };

  beforeEach(() => {
    useDatabase(new TrainerDB(`similar-${Date.now()}-${Math.random()}`));
  });

  it("最近ミスした分野と同じ分野の、まだ解いていない問題を「新しい問題」の枠で先に出す", () => {
    // 3番（アルファ）をミス。期限の来た復習は無いので、枠は 新しい問題5 → ほか → 番号順の埋め合わせ
    const cards = new Map([["deru1000-0003", missedCard("deru1000-0003")]]);
    const set = buildDailySet({ items, cards, settings, now: NOW, rng: seededRng(1), scheduler, newIntroducedToday: 0, recentMissIds: ["deru1000-0003"] });
    const by = (src: string) => set.filter((q) => q.source === src).map((q) => q.item.no).sort((a, b) => a - b);
    expect(set).toHaveLength(10);
    expect(by("similar")).toEqual([1, 5, 7, 9, 11]);
    expect(by("other")).toEqual([3]);
    expect(by("new")).toEqual([2, 4, 6, 8]);
  });

  it("1日の新しい問題の上限は類題にも効く。ミスが無ければ今までどおり番号順", () => {
    const cards = new Map([["deru1000-0003", missedCard("deru1000-0003")]]);
    const limited = buildDailySet({ items, cards, settings, now: NOW, rng: seededRng(1), scheduler, newIntroducedToday: 18, recentMissIds: ["deru1000-0003"] });
    expect(limited.filter((q) => q.source === "similar" || q.source === "new")).toHaveLength(2);
    const none = buildDailySet({ items, cards: new Map(), settings, now: NOW, rng: seededRng(1), scheduler, newIntroducedToday: 0 });
    expect(none.every((q) => q.source === "new")).toBe(true);
    expect(none.map((q) => q.item.no).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("ミスした分野が2つなら、新しいミスの分野から交互に並べる", () => {
    const fresh = items.filter((i) => i.no > 4);
    const order = similarFresh(fresh, [items[1], items[0]]).slice(0, 4).map((i) => i.no);
    expect(order).toEqual([6, 5, 8, 7]); // ベータ（2番のミスが新しい）→ アルファ → …
  });

  it("単語の今日の学習には類題を入れない", () => {
    const words = fakeItems(30);
    const set = buildDailySet({
      items: words,
      cards: new Map(),
      settings: DEFAULT_SETTINGS,
      now: NOW,
      rng: seededRng(1),
      scheduler,
      newIntroducedToday: 0,
      recentMissIds: ["kinfre-0001"],
    });
    expect(set.some((q) => q.source === "similar")).toBe(false);
  });

  it("最近のミスは直近7日・新しい順・重複なし（正解は入れない）", () => {
    const log = (id: string, ts: number, correct: boolean): ReviewLog => ({
      id, ts, day: "", mode: "daily", format: "part5", correct, ms: 1, unsure: false, rating: correct ? 3 : 1, retry: false,
    });
    const logs = [log("a", NOW - 8 * DAY, false), log("b", NOW - 2 * DAY, false), log("c", NOW - DAY, true), log("b", NOW - 3 * DAY, false), log("d", NOW - 1000, false)];
    expect(recentMissIds(logs, NOW)).toEqual(["d", "b"]);
  });
});

describe("進捗グラフ（周回ごとの正答率）", () => {
  const chapters = new Map<string, ChapterInfo>([
    ["c01", { key: "c01", deck: "deru1000", label: "第1章 架空", order: 1, tips: [] }],
    ["m01", { key: "m01", deck: "deru1000", label: "架空模試 セット1", order: 101, tips: [] }],
  ]);
  const items = [
    ...Array.from({ length: 4 }, (_, k) => fakeDeruItem(k + 1, { chapter: "c01" })),
    ...Array.from({ length: 2 }, (_, k) => fakeDeruItem(k + 5, { chapter: "m01" })),
  ];
  const round = (rid: number, no: number, startedAt: number, parentRid?: number): Round => ({
    rid, deck: "deru1000", no, label: `${no}周目`, itemIds: [], cursor: 0, order: "seq", startedAt, parentRid,
  });
  let seq = 0;
  const log = (id: number, rid: number, round: number, correct: boolean, extra: Partial<ReviewLog> = {}): ReviewLog => ({
    seq: ++seq, id: `deru1000-${String(id).padStart(4, "0")}`, ts: NOW + seq, day: "", mode: "round", rid, round, format: "part5", correct, ms: 1, unsure: false, rating: correct ? 3 : 1, retry: false, ...extra,
  });

  it("章・模試セットごとに、各周の最初の回答だけで数える（もう一度・ミスだけの周回は入れない）", () => {
    const rounds = [round(1, 1, NOW), round(2, 1, NOW + 10, 1), round(3, 2, NOW + 20)];
    const logs = [
      log(1, 1, 1, false), log(2, 1, 1, true), log(3, 1, 1, true), log(4, 1, 1, false),
      log(1, 1, 1, true, { retry: true }), // その場のもう一度
      log(1, 2, 1, true), log(4, 2, 1, true), // ミスだけの周回
      log(1, 3, 2, true), log(2, 3, 2, true), log(3, 3, 2, true), log(4, 3, 2, false), log(5, 3, 2, true), log(6, 3, 2, false),
      log(2, 3, 2, false), // 同じ周の2回目は数えない
      log(3, 0, 0, false, { mode: "daily", rid: undefined, round: undefined }),
    ];
    const g = passRates(items, rounds, logs, chapters);
    expect(g.map((x) => x.key)).toEqual(["c01", "m01"]);
    expect(g[0].passes).toEqual([
      { rid: 1, no: 1, answered: 4, correct: 2 },
      { rid: 3, no: 2, answered: 4, correct: 3 },
    ]);
    expect(g[1].passes).toEqual([{ rid: 3, no: 2, answered: 2, correct: 1 }]);
  });

  it("範囲ごとに直近の周だけ（既定4周）。周回が無ければ空", () => {
    const rounds = Array.from({ length: 6 }, (_, k) => round(k + 1, k + 1, NOW + k));
    const logs = rounds.map((r) => log(1, r.rid!, r.no, true));
    expect(passRates(items, rounds, logs, chapters)[0].passes.map((p) => p.no)).toEqual([3, 4, 5, 6]);
    expect(passRates(items, [], [], chapters)).toEqual([]);
  });

  it("単語は track ごと", async () => {
    const words = fakeItems(30); // track は 25語ずつ
    const r = round(1, 1, NOW);
    const logs = [log(0, 1, 1, true, { id: "kinfre-0001" }), log(0, 1, 1, false, { id: "kinfre-0026" })];
    const g = passRates(words, [{ ...r, deck: "kinfre" }], logs);
    expect(g.map((x) => [x.key, x.passes[0].correct, x.passes[0].answered])).toEqual([
      ["t01", 1, 1],
      ["t02", 0, 1],
    ]);
  });
});

describe("取り込みの流れ", () => {
  it("解き方だけを読み込んでも、問題と記録はそのまま", async () => {
    useDatabase(new TrainerDB(`import-${Date.now()}`));
    await upsertItems(fakeDeruItems(3));
    const r = parseMaterialFile("04.md", fakeTipsMd("第4章《架空》の解き方"), NOW);
    await upsertTips(r.tips!);
    expect(await db.items.count()).toBe(3);
    expect((await db.tips.get("c04"))?.order).toBe(4);
  });
});
