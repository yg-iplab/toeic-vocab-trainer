// 学習記録の書き出し・読み込み
// - バックアップJSON: 学習記録すべて（単語・文法とも。教材本文は入れない。新しい端末では章ファイルを読み込み直す）
// - ミス一覧.md: Drive の学習メモ / NotebookLM に追記できる形（単語・文法それぞれ）
// - entries.jsonl: 既存オーバーレイ（knowledge/overlay/・overlay_deru1000/ の entries.jsonl）と同じ形
import { formatDateTime, localDay } from "../lib/date";
import {
  deckOf,
  LETTERS,
  type CardState,
  type ChapterInfo,
  type Deck,
  type DeruItem,
  type Item,
  type KinfreItem,
  type ReviewLog,
  type Round,
  type UserNote,
} from "../types";
import { db, setMeta, type MetaRow } from "./db";
import { missedItems, noLabel } from "./stats";

/** アプリの名前（バックアップの見分け用）は Phase 1 から変えない。版1のバックアップも読めるように */
export const BACKUP_APP = "kinfre-trainer";
/** 版2：文法（deru1000-）の記録と、周回の教材（deck）が入る */
export const BACKUP_VERSION = 2;

export type Backup = {
  app: typeof BACKUP_APP;
  kind: "backup";
  version: number;
  exportedAt: string;
  cards: CardState[];
  logs: ReviewLog[];
  notes: UserNote[];
  rounds: Round[];
  meta: MetaRow[];
};

export async function buildBackup(now: number): Promise<Backup> {
  return {
    app: BACKUP_APP,
    kind: "backup",
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    cards: await db.cards.toArray(),
    logs: await db.logs.orderBy("ts").toArray(),
    notes: await db.notes.toArray(),
    rounds: await db.rounds.toArray(),
    meta: (await db.meta.toArray()).filter((m) => m.key !== "itemsImportedAt"),
  };
}

export function backupFileName(now: number): string {
  const d = new Date(now);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `toeic-trainer-backup-${localDay(now).replace(/-/g, "")}-${hh}${mm}.json`;
}

export function parseBackup(text: string): Backup {
  let data: Partial<Backup>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JSONとして読めません。バックアップファイルを選んでください。");
  }
  if (data.app !== BACKUP_APP || data.kind !== "backup") throw new Error("このアプリのバックアップファイルではありません。");
  if (typeof data.version !== "number" || data.version > BACKUP_VERSION) throw new Error("新しい版のアプリで作られたバックアップです。アプリを更新してください。");
  for (const k of ["cards", "logs", "notes", "rounds", "meta"] as const) {
    if (!Array.isArray(data[k])) throw new Error(`バックアップの「${k}」が壊れています。`);
  }
  // 版1（単語だけ）の周回には教材の印が無いので、単語として読む
  const rounds = (data.rounds as Round[]).map((r) => ({ ...r, deck: r.deck ?? "kinfre" }));
  return { ...(data as Backup), rounds };
}

/** 教材ごとの回答数（戻す前の確認に出す） */
export function logCounts(logs: Pick<ReviewLog, "id">[]): Record<Deck, number> {
  const out: Record<Deck, number> = { kinfre: 0, deru1000: 0 };
  for (const l of logs) out[deckOf(l.id)]++;
  return out;
}

/** バックアップで置き換える（教材データは消さない） */
export async function restoreBackup(b: Backup) {
  await db.transaction("rw", [db.cards, db.logs, db.notes, db.rounds, db.meta], async () => {
    await Promise.all([db.cards.clear(), db.logs.clear(), db.notes.clear(), db.rounds.clear()]);
    const keepItemsImportedAt = await db.meta.get("itemsImportedAt");
    await db.meta.clear();
    await db.cards.bulkPut(b.cards);
    await db.logs.bulkPut(b.logs);
    await db.notes.bulkPut(b.notes);
    await db.rounds.bulkPut(b.rounds);
    await db.meta.bulkPut(b.meta);
    if (keepItemsImportedAt) await db.meta.put(keepItemsImportedAt);
  });
}

function firstTryLogsById(logs: ReviewLog[]): Map<string, ReviewLog[]> {
  const byId = new Map<string, ReviewLog[]>();
  for (const l of logs) if (!l.retry) byId.set(l.id, [...(byId.get(l.id) ?? []), l]);
  for (const list of byId.values()) list.sort((a, b) => a.ts - b.ts);
  return byId;
}

function roundMarks(hist: ReviewLog[]): string[] {
  return hist.filter((l) => l.mode === "round" && l.round !== undefined).map((l) => `${l.round}周目 ${l.correct ? "○" : "×"}`);
}

/** 単語のミス一覧（Drive の 金フレ_学習メモ に貼れる Markdown） */
export function missListMarkdown(
  allItems: Item[],
  cards: Map<string, CardState>,
  notes: Map<string, UserNote>,
  logs: ReviewLog[],
  now: number,
): string {
  const items = allItems.filter((i): i is KinfreItem => i.deck === "kinfre");
  const rows = missedItems(items, cards);
  const byId = firstTryLogsById(logs);
  const lines = [
    "# 金フレ ミス一覧（アプリ書き出し）",
    "",
    `- 書き出し: ${formatDateTime(now)}`,
    `- 件数: ${rows.length}`,
    "- 出典: 自分で読み込んだ単語帳データ（個人学習用）",
    "",
  ];
  for (const { item, card } of rows) {
    const note = notes.get(item.id);
    const hist = byId.get(item.id) ?? [];
    const lastMiss = hist.filter((l) => !l.correct).at(-1);
    const rounds = roundMarks(hist);
    lines.push(`## ${noLabel(item)} ${item.word}（ミス${card.miss_count}回・状態: ${card.status}）`);
    lines.push(`- 番号: ${item.id}`);
    lines.push(`- 日本語訳: ${item.ja}`);
    if (lastMiss) lines.push(`- 最後に間違えた日: ${lastMiss.day}`);
    const confused = [...new Set(hist.filter((l) => !l.correct && l.chosen).map((l) => l.chosen!))]
      .map((cid) => items.find((i) => i.id === cid))
      .filter((i): i is KinfreItem => i !== undefined)
      .map((i) => `${i.word}（${i.ja}）`);
    if (confused.length) lines.push(`- 取り違えた語: ${confused.join("、")}`);
    if (rounds.length) lines.push(`- 周回: ${rounds.join(" ／ ")}`);
    if (note?.mnemonic) lines.push(`- 覚え方: ${note.mnemonic}`);
    if (note?.wrong_note) lines.push(`- ミス: ${note.wrong_note}`);
    if (note?.custom_example) lines.push(`- 自分の例文: ${note.custom_example}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** 文法の「選んだ答え」を (B) の形にする */
function letterLabel(item: DeruItem, letter: string): string {
  const text = item.choices[LETTERS.indexOf(letter)];
  return text === undefined ? `(${letter})` : `(${letter}) ${text}`;
}

/** 文法のミス一覧（問題文・正解・選んだ答え・周回の○×つき。NotebookLM で読み返す用） */
export function deruMissListMarkdown(
  allItems: Item[],
  chapters: Map<string, ChapterInfo>,
  cards: Map<string, CardState>,
  notes: Map<string, UserNote>,
  logs: ReviewLog[],
  now: number,
): string {
  const items = allItems.filter((i): i is DeruItem => i.deck === "deru1000");
  const rows = missedItems(items, cards);
  const byId = firstTryLogsById(logs);
  const lines = [
    "# 出る1000 ミス一覧（アプリ書き出し）",
    "",
    `- 書き出し: ${formatDateTime(now)}`,
    `- 件数: ${rows.length}`,
    "- 出典: 自分で読み込んだ問題集データ（個人学習用）",
    "",
  ];
  for (const { item, card } of rows) {
    const note = notes.get(item.id);
    const all = logs.filter((l) => l.id === item.id).sort((a, b) => a.ts - b.ts);
    const hist = byId.get(item.id) ?? [];
    const lastMiss = all.filter((l) => !l.correct).at(-1);
    const picked = [...new Set(all.filter((l) => !l.correct && l.chosen).map((l) => l.chosen!))];
    const rounds = roundMarks(hist);
    lines.push(`## ${noLabel(item)}（ミス${card.miss_count}回・状態: ${card.status}）`);
    lines.push(`- 番号: ${item.id}`);
    lines.push(`- 範囲: ${chapters.get(item.chapter)?.label ?? item.chapter} / ${item.block}`);
    if (item.section) lines.push(`- 分野: ${item.section}`);
    lines.push(`- 問題: ${item.stem}`);
    lines.push(`- 正解: ${letterLabel(item, item.answer)}`);
    if (picked.length) lines.push(`- 選んだ答え: ${picked.map((p) => letterLabel(item, p)).join("、")}`);
    if (lastMiss) lines.push(`- 最後に間違えた日: ${lastMiss.day}`);
    if (rounds.length) lines.push(`- 周回: ${rounds.join(" ／ ")}`);
    if (note?.mnemonic) lines.push(`- 覚え方: ${note.mnemonic}`);
    if (note?.wrong_note) lines.push(`- ミス: ${note.wrong_note}`);
    if (note?.custom_note) lines.push(`- メモ: ${note.custom_note}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * 文法の学習メモ形式（Drive の 出る1000_学習メモ にそのまま貼れる形）
 * 学習メモの編集ルールどおり、見出しは「## 番号」、項目は status / wrong / mnemonic / note だけ
 */
export function deruMemoMarkdown(
  allItems: Item[],
  cards: Map<string, CardState>,
  notes: Map<string, UserNote>,
  logs: ReviewLog[],
  now: number,
): string {
  const items = allItems.filter((i): i is DeruItem => i.deck === "deru1000");
  const rows = missedItems(items, cards);
  const lines = [`# 出る1000 学習メモ用（アプリ書き出し ${formatDateTime(now)}・${rows.length}問）`, ""];
  for (const { item, card } of rows) {
    const note = notes.get(item.id);
    const picked = [
      ...new Set(
        logs
          .filter((l) => l.id === item.id && !l.correct && l.chosen)
          .sort((a, b) => a.ts - b.ts)
          .map((l) => `(${l.chosen})`),
      ),
    ];
    const auto = `${picked.length ? `${picked.join("・")}を選択・` : ""}正解(${item.answer})・ミス${card.miss_count}回`;
    lines.push(`## ${noLabel(item)}`, "");
    lines.push(`- status: ${card.status}`);
    lines.push(`- wrong: ${[note?.wrong_note, auto].filter(Boolean).join("／")}`);
    lines.push(`- mnemonic: ${note?.mnemonic ?? ""}`);
    lines.push(`- note: ${note?.custom_note ?? ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** 既存オーバーレイ（1行1問）と同じ形。単語は custom_example、文法は custom_note */
export function overlayJsonl(cards: Map<string, CardState>, notes: Map<string, UserNote>, deck: Deck = "kinfre"): string {
  const ids = [...new Set([...cards.keys(), ...notes.keys()])].filter((id) => deckOf(id) === deck).sort();
  return (
    ids
      .map((id) => {
        const c = cards.get(id);
        const n = notes.get(id);
        const base = {
          id,
          status: c?.status ?? "new",
          miss_count: c?.miss_count ?? 0,
          last_reviewed: c?.last_reviewed ?? "",
          mnemonic: n?.mnemonic ?? "",
          wrong_note: n?.wrong_note ?? "",
        };
        return JSON.stringify(deck === "deru1000" ? { ...base, custom_note: n?.custom_note ?? "" } : { ...base, custom_example: n?.custom_example ?? "" });
      })
      .join("\n") + (ids.length ? "\n" : "")
  );
}

/**
 * ファイルとして保存する。iPhone では共有シート →「"ファイル"に保存」で iCloud Drive に置ける
 * 共有にはファイルだけを渡す（title も渡すと、iPhone はファイル名だけが書かれた .txt も一緒に保存してしまう）
 * 戻り値: 保存できたか（キャンセルなら false）
 */
export async function saveTextFile(filename: string, text: string, mime: string): Promise<boolean> {
  const file = new File([text], filename, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return true;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return false;
      // 共有できなかったときはダウンロードに切り替える
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

export async function markBackedUp(now: number) {
  await setMeta("lastBackupAt", now);
}
