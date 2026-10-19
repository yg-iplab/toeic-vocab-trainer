// 回答後の教材の見せ方（例文の全文・読み取り漏れの印・解説から拾う語彙）。架空の文だけで確かめる
import { describe, expect, it } from "vitest";
import { exampleMissesWord, exampleText, vocabFromExplanation } from "../src/lib/itemText";

describe("例文", () => {
  it("全文（例文EN）を優先し、穴あきは全文が無いときだけ", () => {
    expect(exampleText({ word: "fictword", example_en: "We fictworded it.", example_en_blank: "We f--- it." })).toBe("We fictworded it.");
    expect(exampleText({ word: "fictword", example_en_blank: "We f--- it." })).toBe("We f--- it.");
    expect(exampleText({ word: "fictword" })).toBeUndefined();
  });

  it("見出し語（活用形を含む）が入っていなければ読み取り漏れとみなす", () => {
    expect(exampleMissesWord({ word: "fictword", example_en: "We fictworded it." })).toBe(false); // -ed
    expect(exampleMissesWord({ word: "fictify", example_en: "It fictifies them." })).toBe(false); // y → ies も語幹で拾う
    expect(exampleMissesWord({ word: "Fictword", example_en: "FICTWORD is here." })).toBe(false); // 大文字小文字は見ない
    expect(exampleMissesWord({ word: "fict on", example_en: "We ficted on it." })).toBe(false); // 2語以上は最初の語で
    expect(exampleMissesWord({ word: "fictword", example_en: "We read f" })).toBe(true); // 頭文字だけ残った
    expect(exampleMissesWord({ word: "fictword", example_en: "We read" })).toBe(true);
    expect(exampleMissesWord({ word: "fictword" })).toBe(false); // 例文が無ければ印を出さない
  });
});

describe("解説から拾う語彙", () => {
  it("「英語（訳）」の組を、出てきた順に・同じ語は1回だけ", () => {
    const text = "空所には fictadverb（架空の副詞）が入る。(A) fictadj（架空の形容詞）は形容詞。(B) fictadverb（架空の副詞）";
    expect(vocabFromExplanation(text)).toEqual([
      { en: "fictadverb", ja: "架空の副詞" },
      { en: "fictadj", ja: "架空の形容詞" },
    ]);
  });

  it("熟語・半角かっこ・〜で始まる訳も拾う。英語だけのかっこ・長い説明・1文字は拾わない", () => {
    const text = "be fict to do（まさに〜しそうだ）。fictverb (〜を架空にする)。〈架空〉（= fict text only）。X（記号）。fictlong（" + "あ".repeat(31) + "）";
    expect(vocabFromExplanation(text)).toEqual([
      { en: "be fict to do", ja: "まさに〜しそうだ" },
      { en: "fictverb", ja: "〜を架空にする" },
    ]);
  });

  it("英語は直前の5語まで（文ごと拾わない）・上限の数まで", () => {
    expect(vocabFromExplanation("Fict aa bb cc dd ee（架空）")).toEqual([{ en: "aa bb cc dd ee", ja: "架空" }]);
    const many = Array.from({ length: 12 }, (_, i) => `fict${"abcdefghijkl"[i]}（訳${i}）`).join("、");
    expect(vocabFromExplanation(many)).toHaveLength(8);
    expect(vocabFromExplanation(undefined)).toEqual([]);
  });
});
