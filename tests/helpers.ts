// テスト用の共通部品（教材本文は使わず、架空のデータだけで作る）
import { crc32, deflateRawSync } from "node:zlib";
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

/** テスト用の ZIP を作る（中身は架空のバイト列だけ）。deflate＝true なら圧縮して入れる */
export function makeZip(files: { name: string; data: Uint8Array<ArrayBuffer>; deflate?: boolean }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const body = f.deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, f.deflate ? 8 : 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, f.deflate ? 8 : 0, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), name, body);
    centrals.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = centrals.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of parts) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

/** 架空の「音声」（中身は無音を表す 0 のバイト列。再生はしない） */
export function silentBytes(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(n);
}
