// 文法の章ファイルの読み込み（架空のデータだけで確かめる）
import { describe, expect, it } from "vitest";
import { blockGroup, chapterOf, isDeruText, mergeChapters, parseDeruMarkdown } from "../src/data/parseDeru";
import { parseMaterialFile } from "../src/data/parseFile";
import type { DeruItem } from "../src/types";
import { fakeDeruChapterMd } from "./helpers";

const chapterA = fakeDeruChapterMd({ heading: "第1章 テスト用の章A", from: 1, to: 12 });

describe("文法の章ファイル（Markdown）", () => {
  const { items, skipped, chapters } = parseDeruMarkdown(chapterA, "01_testA_1.md");

  it("1問ずつ取り込み、番号・章・ブロックを分ける", () => {
    expect(skipped).toEqual([]);
    expect(items.map((i) => i.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(items[0]).toMatchObject({
      id: "deru1000-0001",
      deck: "deru1000",
      order: 1,
      section: "テスト分野X",
      chapter: "c01",
      block: "練習ブロック：前半",
      blockFull: "練習ブロック：前半（ローカル1）",
      stem: "Q1 The fictional ------- is here.",
      answer: "B",
      explanation: "架空の解説1",
      translation: "架空の訳1",
      vocab: "word1: 架空の語彙",
      quality: "ok",
    });
    expect(items[11].block).toBe("練習ブロック：後半");
  });

  it("選択肢は本のまま（記号を外して A→D の順）", () => {
    expect(items[2].choices).toEqual(["alpha3", "beta3", "gamma3", "delta3"]);
  });

  it("最初の問題より前の箇条書きは章の要点。変換の記録（出典・番号の範囲）は入れない", () => {
    expect(chapters).toHaveLength(1);
    expect(chapters![0]).toMatchObject({ key: "c01", label: "第1章 テスト用の章A", order: 1 });
    expect(chapters![0].tips).toEqual([
      { k: "要点A", v: "架空の要点その1" },
      { k: "要点B", v: "①架空の手順 ②架空の手順" },
    ]);
  });

  it("Drive の表示で付くエスケープ（\\# \\- \\_）があっても読める", () => {
    const escaped = parseDeruMarkdown(fakeDeruChapterMd({ heading: "第2章 テスト用の章B", from: 13, to: 15, escape: true }), "02_testB.md");
    expect(escaped.items.map((i) => i.id)).toEqual(["deru1000-0013", "deru1000-0014", "deru1000-0015"]);
    expect(escaped.items[0].chapter).toBe("c02");
    expect(escaped.items[0].choices).toHaveLength(4);
  });

  it("模試セットの見出しは m で始まる章になる", () => {
    const mock = parseDeruMarkdown(fakeDeruChapterMd({ heading: "テスト模試 セット3", from: 40, to: 42, blocks: ["テスト模試 セット3"] }), "10_mock_3_1.md");
    expect(mock.items[0]).toMatchObject({ chapter: "m03", block: "テスト模試 セット3" });
    expect(mock.chapters![0]).toMatchObject({ key: "m03", order: 103 });
  });

  it("選択肢が足りない・正解が選択肢にない問題は飛ばして理由を残す", () => {
    const broken = [
      "# 第1章 テスト用の章A",
      "## 0050",
      "- id: deru1000-0050",
      "- stem: Q50 -------.",
      "- choices:",
      "  - (A) one",
      "- answer: A",
      "## 0051",
      "- id: deru1000-0051",
      "- stem: Q51 -------.",
      "- choices:",
      "  - (A) one",
      "  - (B) two",
      "  - (C) three",
      "- answer: D",
      "## 0052",
      "- id: deru1000-0052",
      "- stem: Q52 ------- 10:30.",
      "- choices:",
      "  - (A) at 10:30",
      "  - (B) on",
      "  - (C) in",
      "- answer: (A)",
    ].join("\n");
    const r = parseDeruMarkdown(broken, "x.md");
    expect(r.items.map((i) => i.id)).toEqual(["deru1000-0052"]);
    expect(r.items[0].choices[0]).toBe("at 10:30");
    expect(r.items[0].answer).toBe("A");
    expect(r.skipped).toEqual(["選択肢が足りない: deru1000-0050", "正解が選択肢にない: deru1000-0051"]);
  });
});

describe("章・ブロックの見分け方", () => {
  it("ブロックは末尾の（…）を外したもの", () => {
    expect(blockGroup("練習ブロック：前半（ローカル3）")).toBe("練習ブロック：前半");
    expect(blockGroup("例題（例題1／架空のタイプ）")).toBe("例題");
    expect(blockGroup("区切りなし")).toBe("区切りなし");
  });

  it("見出しが無いときはファイル名の番号で章を決める", () => {
    expect(chapterOf(undefined, "03_test.md")).toMatchObject({ key: "c03" });
    expect(chapterOf(undefined, "15_mock_セット8_1.md")).toMatchObject({ key: "m08" });
  });

  it("分割ファイルを別々に読んでも、章の要点はまとまる", () => {
    const a = { key: "c01", deck: "deru1000" as const, label: "第1章 A", order: 1, tips: [{ k: "要点", v: "1" }] };
    const b = { ...a, tips: [] };
    const c = { ...a, tips: [{ k: "まとめ", v: "2" }] };
    expect(mergeChapters([a], [b])[0].tips).toEqual([{ k: "要点", v: "1" }]);
    expect(mergeChapters([a], [c])[0].tips).toEqual([
      { k: "要点", v: "1" },
      { k: "まとめ", v: "2" },
    ]);
  });
});

describe("教材ファイルの読み分け", () => {
  it("中身で単語と文法を見分ける", () => {
    expect(isDeruText(chapterA)).toBe(true);
    expect(isDeruText("## 001 word\n- 番号: kinfre-0001\n- 日本語訳: 意味")).toBe(false);
    const g = parseMaterialFile("01_testA.md", chapterA);
    expect(g.items[0].deck).toBe("deru1000");
    const w = parseMaterialFile("01_test.md", "## 001 word1\n- 番号: kinfre-0001\n- 章: テスト / track 1\n- 日本語訳: 意味1\n");
    expect(w.items[0].deck).toBe("kinfre");
    expect((g.items as DeruItem[]).every((i) => i.choices.length === 4)).toBe(true);
  });
});
