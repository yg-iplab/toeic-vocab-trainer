// 例文の見せ方（v0.8）：読み取りのかけらを表示で落とし、見出し語を太字にする。文はすべて架空
import { describe, expect, it } from "vitest";
import { cleanExample, highlightParts } from "../src/lib/itemText";

describe("例文の読み取りのかけらを表示で落とす", () => {
  it("見出し語のすぐ前後に残ったハイフンを落とす", () => {
    expect(cleanExample("We will zorbify- the plan today.", "zorbify")).toBe("We will zorbify the plan today.");
    expect(cleanExample("We will -zorbify the plan.", "zorbify")).toBe("We will zorbify the plan.");
    expect(cleanExample("We will zorbify-- the plan.", "zorbify")).toBe("We will zorbify the plan.");
    expect(cleanExample("We zorbified-, then left.", "zorbify")).toBe("We zorbified, then left.");
  });

  it("見出し語の隣に1つだけ立っているハイフン・頭文字＋ハイフンのかけらを落とす", () => {
    expect(cleanExample("We will - zorbify the plan.", "zorbify")).toBe("We will zorbify the plan.");
    expect(cleanExample("We will zorbify - the plan.", "zorbify")).toBe("We will zorbify the plan.");
    expect(cleanExample("We will z--- zorbify the plan.", "zorbify")).toBe("We will zorbify the plan.");
  });

  it("かけらが2つ続いても、記号の混ざったかけら（|-- など）でも落とす", () => {
    expect(cleanExample("We will - - zorbify the plan.", "zorbify")).toBe("We will zorbify the plan.");
    expect(cleanExample("We will |-- zorbify the plan.", "zorbify")).toBe("We will zorbify the plan.");
    expect(cleanExample("We will --!!- zorbify the plan.", "zorbify")).toBe("We will zorbify the plan.");
    expect(cleanExample("Zorbify -- - now.", "zorbify")).toBe("Zorbify now.");
  });

  it("ハイフンでつないだ本物の語や、見出し語から離れたハイフンは変えない", () => {
    expect(cleanExample("A blib-blob zorbify meeting - maybe.", "zorbify")).toBe("A blib-blob zorbify meeting - maybe.");
    expect(cleanExample("Send the zib-zab to zorbify the zubs.", "zorbify")).toBe("Send the zib-zab to zorbify the zubs.");
    expect(cleanExample("We set up a zorb-free area.", "zorb-free")).toBe("We set up a zorb-free area.");
  });

  it("見出し語が例文に無い（⚠ の語）ときは、穴の手がかりを残すため何も落とさない", () => {
    expect(cleanExample("We will z--- the plan.", "zorbify")).toBe("We will z--- the plan.");
  });

  it("全角の英数字・記号を半角にする", () => {
    expect(cleanExample("Ｗe ｚorbify the plan，today．", "zorbify")).toBe("We zorbify the plan,today.");
  });
});

describe("例文の中の見出し語を太字にする", () => {
  it("活用した形も、語のまとまりごと太字にする（語幹で探す）", () => {
    expect(highlightParts("We zorbified the plan.", "zorbify")).toEqual([
      { text: "We ", hit: false },
      { text: "zorbified", hit: true },
      { text: " the plan.", hit: false },
    ]);
  });

  it("2語以上の見出し語は、続いて出てくればまとめて太字", () => {
    expect(highlightParts("So zorb out the files.", "zorb out")).toEqual([
      { text: "So ", hit: false },
      { text: "zorb out", hit: true },
      { text: " the files.", hit: false },
    ]);
  });

  it("数字の入った語も1つの語として扱う", () => {
    expect(highlightParts("We zorb2ed the plan.", "zorb2")).toEqual([
      { text: "We ", hit: false },
      { text: "zorb2ed", hit: true },
      { text: " the plan.", hit: false },
    ]);
  });

  it("文頭の大文字でも見つける。見つからなければ文のまま", () => {
    expect(highlightParts("Zorbify it now.", "zorbify")[0]).toEqual({ text: "Zorbify", hit: true });
    expect(highlightParts("No zib here.", "zorbify")).toEqual([{ text: "No zib here.", hit: false }]);
  });
});
