import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseId, parseKinfreFile, parseKinfreJsonl, parseKinfreMarkdown } from "../src/data/parseKinfre";

const md = readFileSync(new URL("./fixtures/sample_track.md", import.meta.url), "utf-8");

describe("章ファイル（Markdown）の読み込み", () => {
  const { items, skipped } = parseKinfreMarkdown(md);

  it("単語のある項目だけ取り込み、未収録は飛ばす", () => {
    expect(items.map((i) => i.id)).toEqual(["kinfre-0001", "kinfre-0002", "kinfre-0004", "kinfre-s01-0021"]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("kinfre-0003");
  });

  it("番号・章・track・品詞・訳を分ける", () => {
    const a = items[0];
    expect(a).toMatchObject({ part: "main", no: 1, order: 1, section: "テスト用レベル", track: 1, word: "schedule" });
    expect(a.pos).toEqual(["名", "動"]);
    expect(a.ja).toBe("予定（表）／予定を組む");
    expect(a.example_ja).toBe("会議は予定どおりだ。");
  });

  it("（未記入）は空にし、書かれた覚え方は取り込む", () => {
    expect(items[0].mnemonic_src).toBeUndefined();
    expect(items[1].mnemonic_src).toBe("①語源: テスト ②語呂: テスト");
  });

  it("改行で続く値を1つにつなげる", () => {
    expect(items[1].notes_right).toBe("改行のある補足の1行目 2行目に続く。");
  });

  it("Drive 表示のエスケープ（\\# や \\-）が付いていても読める", () => {
    expect(items[2]).toMatchObject({ id: "kinfre-0004", word: "deadline", ja: "締め切り" });
  });

  it("Supplement は本編のあとに並ぶ", () => {
    const s = items[3];
    expect(s).toMatchObject({ part: "s01", no: 21, section: "Supplement 1", track: undefined });
    expect(s.order).toBeGreaterThan(1000);
  });
});

describe("JSONL の読み込み", () => {
  it("schema.md の形を読む", () => {
    const line = JSON.stringify({
      id: "kinfre-0032",
      section: "テスト用レベル",
      track: 1,
      no: 32,
      word: "sample",
      pos: ["名", "動"],
      ja: "見本／試す",
      example_en: "a free sample",
      quality: "ok",
    });
    const { items, skipped } = parseKinfreJsonl(`${line}\n{壊れた行\n`);
    expect(items[0]).toMatchObject({ id: "kinfre-0032", word: "sample", track: 1, pos: ["名", "動"] });
    expect(skipped).toHaveLength(1);
  });

  it("拡張子で読み分ける", () => {
    expect(parseKinfreFile("a.md", md).items).toHaveLength(4);
    expect(parseKinfreFile("a.jsonl", "").items).toHaveLength(0);
  });
});

describe("番号の読み取り", () => {
  it("本編と Supplement", () => {
    expect(parseId("kinfre-1000")).toEqual({ part: "main", no: 1000 });
    expect(parseId("kinfre-s07-0003")).toEqual({ part: "s07", no: 3 });
    expect(parseId("deru1000-0001")).toBeNull();
  });
});
