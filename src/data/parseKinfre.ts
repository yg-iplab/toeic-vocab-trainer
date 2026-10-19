// 金フレの章ファイル（Drive の kinfre/chapters/*.md）と JSONL を Item に変換する
// 章ファイルの形は scripts/build_exports.py の md_entry() が書き出すもの:
//   ## 032 sample
//   - 番号: kinfre-0032
//   - 章: （レベル名） / track 1
//   - 品詞: 名 / 動
//   - 日本語訳: ...
import type { ChapterInfo, Item, KinfreItem } from "../types";

export type ParseResult<T extends Item = Item> = { items: T[]; skipped: string[]; chapters?: ChapterInfo[] };

const EMPTY_VALUES = new Set(["", "—", "-", "（未記入）", "（未収録）", "None", "null"]);

const FIELD_KEYS: Record<string, keyof RawEntry> = {
  番号: "id",
  章: "chapter",
  品詞: "pos",
  日本語訳: "ja",
  例文EN: "example_en",
  例文JA: "example_ja",
  穴あき: "example_en_blank",
  右欄補足: "notes_right",
  出るパート: "appear_parts",
  覚え方: "mnemonic",
  ミス: "wrong_note",
  品質: "quality",
};

type RawEntry = {
  heading: string;
  id?: string;
  chapter?: string;
  pos?: string;
  ja?: string;
  example_en?: string;
  example_ja?: string;
  example_en_blank?: string;
  notes_right?: string;
  appear_parts?: string;
  mnemonic?: string;
  wrong_note?: string;
  quality?: string;
};

/** Drive の表示で付くことがある Markdown のエスケープ（\# や \_）を外す */
export function unescapeMd(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, "$1");
}

function clean(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return EMPTY_VALUES.has(t) ? undefined : t;
}

/** "kinfre-0032" → 本編32 / "kinfre-s01-0021" → Supplement 1 の 21 */
export function parseId(id: string): { part: string; no: number } | null {
  const main = /^kinfre-(\d{4})$/.exec(id);
  if (main) return { part: "main", no: Number(main[1]) };
  const sup = /^kinfre-(s\d{2})-(\d{4})$/.exec(id);
  if (sup) return { part: sup[1], no: Number(sup[2]) };
  return null;
}

/** 並び順: 本編 1–1000 のあとに Supplement */
export function orderOf(part: string, no: number): number {
  if (part === "main") return no;
  const s = Number(part.slice(1));
  return 10000 * s + no;
}

function splitPos(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(/[\/／・,、]/)
    .map((s) => s.trim())
    .filter((s) => s && !EMPTY_VALUES.has(s));
}

function toItem(raw: RawEntry): KinfreItem | string {
  const headWord = raw.heading.replace(/^\S+\s*/, "").trim();
  const id = clean(raw.id);
  if (!id) return `番号なし: ${raw.heading}`;
  const parsed = parseId(id);
  if (!parsed) return `番号の形が不明: ${id}`;
  const word = clean(headWord);
  if (!word) return `単語なし（未収録）: ${id}`;
  const ja = clean(raw.ja);
  if (!ja) return `日本語訳なし: ${id}`;

  const chapter = clean(raw.chapter) ?? "";
  const trackMatch = /track\s*(\d+)/i.exec(chapter);
  const section = chapter.replace(/\s*\/\s*track\s*\S+\s*$/i, "").trim();

  return {
    id,
    deck: "kinfre",
    part: parsed.part,
    no: parsed.no,
    order: orderOf(parsed.part, parsed.no),
    section,
    track: trackMatch ? Number(trackMatch[1]) : undefined,
    word,
    pos: splitPos(clean(raw.pos)),
    ja,
    example_en: clean(raw.example_en),
    example_ja: clean(raw.example_ja),
    example_en_blank: clean(raw.example_en_blank),
    notes_right: clean(raw.notes_right),
    appear_parts: clean(raw.appear_parts)?.split(/[・,、\s]+/).filter(Boolean),
    quality: clean(raw.quality),
    mnemonic_src: clean(raw.mnemonic),
    wrong_note_src: clean(raw.wrong_note),
  };
}

/** 章ファイル（Markdown）1本を読む */
export function parseKinfreMarkdown(text: string): ParseResult<KinfreItem> {
  const items: KinfreItem[] = [];
  const skipped: string[] = [];
  let cur: RawEntry | null = null;
  let lastKey: keyof RawEntry | null = null;

  const flush = () => {
    if (!cur) return;
    const r = toItem(cur);
    if (typeof r === "string") skipped.push(r);
    else items.push(r);
    cur = null;
    lastKey = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = unescapeMd(rawLine).trimEnd();
    const head = /^##\s+(.+)$/.exec(line);
    if (head) {
      flush();
      cur = { heading: head[1].trim() };
      continue;
    }
    if (!cur) continue;
    const field = /^-\s*([^:：]+?)\s*[:：]\s?(.*)$/.exec(line);
    if (field && FIELD_KEYS[field[1]]) {
      lastKey = FIELD_KEYS[field[1]];
      (cur as Record<string, string>)[lastKey] = field[2];
      continue;
    }
    if (field) {
      // 状態・自分の例文など、取り込まない項目
      lastKey = null;
      continue;
    }
    // 値が改行で続いている行は、直前の項目につなげる
    if (lastKey && line.trim() && !line.startsWith("#")) {
      const prev = (cur as Record<string, string>)[lastKey] ?? "";
      (cur as Record<string, string>)[lastKey] = `${prev} ${line.trim()}`;
    }
  }
  flush();
  return { items, skipped };
}

/** JSONL（1行1語。knowledge/schema.md の形）を読む */
export function parseKinfreJsonl(text: string): ParseResult<KinfreItem> {
  const items: KinfreItem[] = [];
  const skipped: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      skipped.push(`${i + 1}行目: JSONとして読めない`);
      return;
    }
    const str = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : undefined);
    const pos = Array.isArray(row.pos) ? (row.pos as string[]).join(" / ") : str("pos");
    const raw: RawEntry = {
      heading: `${row.no ?? ""} ${str("word") ?? ""}`,
      id: str("id"),
      chapter: `${str("section") ?? ""}${row.track ? ` / track ${row.track}` : ""}`,
      pos,
      ja: str("ja"),
      example_en: str("example_en"),
      example_ja: str("example_ja"),
      example_en_blank: str("example_en_blank"),
      notes_right: str("notes_right"),
      appear_parts: Array.isArray(row.appear_parts) ? (row.appear_parts as unknown[]).join("・") : undefined,
      quality: str("quality"),
      mnemonic: str("mnemonic"),
      wrong_note: str("wrong_note"),
    };
    const r = toItem(raw);
    if (typeof r === "string") skipped.push(r);
    else items.push(r);
  });
  return { items, skipped };
}

/** ファイル名で読み分ける */
export function parseKinfreFile(name: string, text: string): ParseResult<KinfreItem> {
  if (/\.jsonl$/i.test(name)) return parseKinfreJsonl(text);
  return parseKinfreMarkdown(text);
}
