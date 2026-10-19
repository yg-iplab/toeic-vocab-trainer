// テスト用の共通部品（教材本文は使わず、架空のデータだけで作る）
import type { DeruItem, KinfreItem } from "../src/types";

export function fakeItem(no: number, over: Partial<KinfreItem> = {}): KinfreItem {
  return {
    id: `kinfre-${String(no).padStart(4, "0")}`,
    deck: "kinfre",
    part: "main",
    no,
    order: no,
    section: no <= 50 ? "テストA" : "テストB",
    track: Math.ceil(no / 25),
    word: `word${no}`,
    pos: [no % 3 === 0 ? "動" : "名"],
    ja: `意味${no}`,
    ...over,
  };
}

export function fakeItems(n: number): KinfreItem[] {
  return Array.from({ length: n }, (_, i) => fakeItem(i + 1));
}

/** 架空の文法問題（正解の記号は番号から決める：1→B, 2→C, 3→D, 4→A …） */
export function fakeAnswer(no: number): string {
  return "ABCD"[no % 4];
}

export function fakeDeruItem(no: number, over: Partial<DeruItem> = {}): DeruItem {
  return {
    id: `deru1000-${String(no).padStart(4, "0")}`,
    deck: "deru1000",
    no,
    order: no,
    section: no % 2 ? "テスト分野X" : "テスト分野Y",
    chapter: no <= 20 ? "c01" : no <= 30 ? "c02" : "m01",
    block: no <= 10 ? "練習ブロック前" : "練習ブロック後",
    stem: `Q${no} The fictional ------- is here.`,
    choices: [`alpha${no}`, `beta${no}`, `gamma${no}`, `delta${no}`],
    answer: fakeAnswer(no),
    explanation: `架空の解説${no}`,
    translation: `架空の訳${no}`,
    ...over,
  };
}

export function fakeDeruItems(n: number): DeruItem[] {
  return Array.from({ length: n }, (_, i) => fakeDeruItem(i + 1));
}

/** 架空の文法の章ファイル（実ファイルと同じ書き方。中身はすべて作り物） */
export function fakeDeruChapterMd(opts: { heading: string; from: number; to: number; blocks?: string[]; escape?: boolean }): string {
  const blocks = opts.blocks ?? ["練習ブロック：前半", "練習ブロック：後半"];
  const lines = [
    `# ${opts.heading}`,
    "",
    `- 通し番号レンジ: ${opts.from}–${opts.to}`,
    "- 出典: テスト用の架空データ",
    "- 要点A: 架空の要点その1",
    "- 要点B: ①架空の手順 ②架空の手順",
    "",
    "> ※架空のファイルです",
    "",
    "---",
  ];
  const span = opts.to - opts.from + 1;
  for (let n = opts.from; n <= opts.to; n++) {
    const no = String(n).padStart(4, "0");
    const block = blocks[Math.min(blocks.length - 1, Math.floor(((n - opts.from) * blocks.length) / span))];
    lines.push(
      `## ${no}`,
      `- id: deru1000-${no}`,
      `- section: テスト分野${n % 2 ? "X" : "Y"}`,
      `- block: ${block}（ローカル${n - opts.from + 1}）`,
      `- src: p0001`,
      `- stem: Q${n} The fictional ------- is here.`,
      "- choices:",
      `  - (A) alpha${n}`,
      `  - (B) beta${n}`,
      `  - (C) gamma${n}`,
      `  - (D) delta${n}`,
      `- answer: ${fakeAnswer(n)}`,
      `- explanation: 架空の解説${n}`,
      `- translation: 架空の訳${n}`,
      "- vocab:",
      `  - word${n}: 架空の語彙`,
      "- quality: ok",
      "---",
    );
  }
  const text = lines.join("\n");
  // Drive の表示で付くことがあるエスケープ（\# \- \_）を再現する
  return opts.escape ? text.replace(/^#+/gm, (m) => m.replace(/#/g, "\\#")).replace(/^- /gm, "\\- ").replace(/_/g, "\\_") : text;
}
