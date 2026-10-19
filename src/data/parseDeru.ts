// 文法（Part 5）の章ファイル（Drive の deru1000/chapters/*.md）を DeruItem に変換する
// 章ファイルの形:
//   # （章の見出し）              ← 「第N章 …」または「… セットN」
//   - （要点の名前）: …           ← 最初の問題より前の箇条書き（解き方の要点など）
//   ## 0035
//   - id: deru1000-0035
//   - section: （分野）
//   - block: （ブロック）（ローカル1）
//   - stem: （英文。空所は -------）
//   - choices:
//     - (A) …
//   - answer: B
//   - explanation: … / translation: … / vocab: … / quality: ok
import { LETTERS, type ChapterInfo, type DeruItem } from "../types";
import { unescapeMd, type ParseResult } from "./parseKinfre";

const EMPTY_VALUES = new Set(["", "—", "-", "（未記入）", "（未収録）", "None", "null"]);

/** 章ファイル冒頭の箇条書きのうち、変換の記録（出典・番号の範囲など）は要点に入れない */
const META_KEY = /^(出典|生成|通し番号|収録|本ファイル|分割|紙面|件数|更新|section|id|src)/i;

const FIELDS = new Set(["id", "section", "block", "stem", "choices", "answer", "explanation", "translation", "vocab", "quality"]);

type RawEntry = { heading: string; f: Record<string, string>; choices: { letter: string; text: string }[] };

function clean(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return EMPTY_VALUES.has(t) ? undefined : t;
}

/** 中身が文法の章ファイルか（金フレのファイルと見分ける） */
export function isDeruText(text: string): boolean {
  return /^\s*[-*]\s*id\s*[:：]\s*deru1000-\d{4}/m.test(unescapeMd(text));
}

/** 末尾の（ローカル1）や（例題1／…）を外して、ブロックのまとまりにする */
export function blockGroup(block: string): string {
  return block.replace(/\s*[（(][^（）()]*[）)]\s*$/, "").trim();
}

/** 章ファイルの見出し（なければファイル名）から、章か模試セットかを決める */
export function chapterOf(h1: string | undefined, fileName: string): { key: string; label: string; order: number } {
  const text = blockGroup(h1?.replace(/^#+\s*/, "").trim() ?? "");
  const make = (kind: "c" | "m", n: number, label: string) => ({
    key: `${kind}${String(n).padStart(2, "0")}`,
    label,
    order: (kind === "c" ? 0 : 100) + n,
  });
  const ch = /第\s*(\d+)\s*章/.exec(text);
  if (ch) return make("c", Number(ch[1]), text);
  const set = /セット\s*(\d+)/.exec(text) ?? /セット\s*(\d+)/.exec(fileName);
  if (set) return make("m", Number(set[1]), text || `セット${set[1]}`);
  const num = /^(\d{1,2})_/.exec(fileName);
  if (num) return make("c", Number(num[1]), text || fileName.replace(/\.md$/i, ""));
  return { key: "x00", label: text || fileName.replace(/\.md$/i, ""), order: 999 };
}

function toItem(raw: RawEntry, chapter: string): DeruItem | string {
  const f = raw.f;
  const headNo = /^(\d{3,4})\b/.exec(raw.heading)?.[1];
  const id = clean(f.id) ?? (headNo ? `deru1000-${headNo.padStart(4, "0")}` : undefined);
  if (!id) return `番号なし: ${raw.heading}`;
  const m = /^deru1000-(\d{4})$/.exec(id);
  if (!m) return `番号の形が不明: ${id}`;
  const stem = clean(f.stem);
  if (!stem) return `問題文なし: ${id}`;
  const choices = raw.choices.slice().sort((a, b) => a.letter.localeCompare(b.letter));
  if (choices.length < 2) return `選択肢が足りない: ${id}`;
  if (choices.some((c, i) => c.letter !== LETTERS[i])) return `選択肢の記号が飛んでいる: ${id}`;
  const answer = /[A-H]/.exec((clean(f.answer) ?? "").toUpperCase())?.[0];
  if (!answer || LETTERS.indexOf(answer) >= choices.length) return `正解が選択肢にない: ${id}`;
  const blockFull = clean(f.block) ?? "";
  const no = Number(m[1]);
  return {
    id,
    deck: "deru1000",
    no,
    order: no,
    section: clean(f.section) ?? "",
    chapter,
    block: blockGroup(blockFull) || "（ブロックなし）",
    blockFull: blockFull || undefined,
    stem: stem.replace(/\s*\n\s*/g, " "),
    choices: choices.map((c) => c.text.trim()),
    answer,
    explanation: clean(f.explanation),
    translation: clean(f.translation),
    vocab: clean(f.vocab),
    quality: clean(f.quality),
  };
}

/** 章ファイル（Markdown）1本を読む */
export function parseDeruMarkdown(text: string, fileName = ""): ParseResult<DeruItem> {
  const items: DeruItem[] = [];
  const skipped: string[] = [];
  const tips: { k: string; v: string }[] = [];
  let h1: string | undefined;
  let seenEntry = false;
  let cur: RawEntry | null = null;
  let lastKey: string | null = null;
  const pending: RawEntry[] = [];

  const flush = () => {
    if (cur) pending.push(cur);
    cur = null;
    lastKey = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = unescapeMd(rawLine).trimEnd();
    if (!seenEntry && h1 === undefined) {
      const top = /^#\s+(.+)$/.exec(line);
      if (top) {
        h1 = top[1].trim();
        continue;
      }
    }
    const head = /^##\s+(.+)$/.exec(line);
    if (head) {
      flush();
      if (/^\d{3,4}\b/.test(head[1].trim())) {
        cur = { heading: head[1].trim(), f: {}, choices: [] };
        seenEntry = true;
      }
      continue;
    }
    if (!cur) {
      // 最初の問題より前の箇条書き＝章の要点
      if (!seenEntry) {
        const bullet = /^[-*]\s*([^:：]+?)\s*[:：]\s*(.+)$/.exec(line);
        if (bullet && !META_KEY.test(bullet[1].trim())) tips.push({ k: bullet[1].trim(), v: bullet[2].trim() });
      }
      continue;
    }
    const entry: RawEntry = cur;
    if (lastKey === "choices") {
      const choice = /^\s*(?:[-*]\s*)?[(（]([A-H])[)）]\s?(.*)$/.exec(line);
      if (choice && (/^\s/.test(line) || /^[(（]/.test(line))) {
        entry.choices.push({ letter: choice[1], text: choice[2] });
        continue;
      }
    }
    const field = /^[-*]\s*([A-Za-z_]+)\s*[:：]\s?(.*)$/.exec(line);
    if (field) {
      const key = field[1].toLowerCase();
      lastKey = FIELDS.has(key) ? key : null;
      if (lastKey && lastKey !== "choices") entry.f[lastKey] = field[2];
      continue;
    }
    if (/^-{3,}$/.test(line.trim()) || line.startsWith("#")) {
      lastKey = null;
      continue;
    }
    // 値が改行で続いている行（語彙の箇条書きなど）は、直前の項目につなげる
    if (lastKey && lastKey !== "choices" && line.trim()) {
      const nested = /^\s+[-*]\s+(.*)$/.exec(line);
      const add = (nested ? nested[1] : line).trim();
      const prev = entry.f[lastKey] ?? "";
      entry.f[lastKey] = prev.trim() ? `${prev}\n${add}` : add;
    }
  }
  flush();

  const ch = chapterOf(h1, fileName);
  for (const raw of pending) {
    const r = toItem(raw, ch.key);
    if (typeof r === "string") skipped.push(r);
    else items.push(r);
  }
  const chapters: ChapterInfo[] = items.length ? [{ key: ch.key, deck: "deru1000", label: ch.label, order: ch.order, tips }] : [];
  return { items, skipped, chapters };
}

/** 同じ章の分割ファイルをまとめる。要点は新しいほうを優先し、無い項目は前のものを残す */
export function mergeChapters(base: ChapterInfo[], add: ChapterInfo[]): ChapterInfo[] {
  const map = new Map(base.map((c) => [c.key, c]));
  for (const c of add) {
    const prev = map.get(c.key);
    if (!prev) {
      map.set(c.key, c);
      continue;
    }
    const keys = new Set(c.tips.map((t) => t.k));
    map.set(c.key, {
      ...prev,
      label: prev.label.length <= c.label.length ? prev.label : c.label,
      tips: [...prev.tips.filter((t) => !keys.has(t.k)), ...c.tips],
    });
  }
  return [...map.values()].sort((a, b) => a.order - b.order);
}
