// 学習記録の書き出し・読み込み
// - バックアップJSON: 学習記録すべて（教材本文は入れない。新しい端末では章ファイルを読み込み直す）
// - ミス一覧.md: Drive の 金フレ_学習メモ / NotebookLM に追記できる形
// - entries.jsonl: 既存オーバーレイ（knowledge/overlay/entries.jsonl）と同じ形
import { formatDateTime, localDay } from "../lib/date";
import type { CardState, Item, ReviewLog, Round, UserNote } from "../types";
import { db, setMeta, type MetaRow } from "./db";
import { missedItems, noLabel } from "./stats";

export const BACKUP_APP = "kinfre-trainer";
export const BACKUP_VERSION = 1;

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
  return `kinfre-backup-${localDay(now).replace(/-/g, "")}-${hh}${mm}.json`;
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
  return data as Backup;
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

/** ミス一覧（Drive の学習メモに貼れる Markdown） */
export function missListMarkdown(
  items: Item[],
  cards: Map<string, CardState>,
  notes: Map<string, UserNote>,
  logs: ReviewLog[],
  now: number,
): string {
  const rows = missedItems(items, cards);
  const byId = new Map<string, ReviewLog[]>();
  for (const l of logs) if (!l.retry) byId.set(l.id, [...(byId.get(l.id) ?? []), l]);
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
    const hist = (byId.get(item.id) ?? []).sort((a, b) => a.ts - b.ts);
    const lastMiss = hist.filter((l) => !l.correct).at(-1);
    const rounds = hist
      .filter((l) => l.mode === "round" && l.round !== undefined)
      .map((l) => `${l.round}周目 ${l.correct ? "○" : "×"}`);
    lines.push(`## ${noLabel(item)} ${item.word}（ミス${card.miss_count}回・状態: ${card.status}）`);
    lines.push(`- 番号: ${item.id}`);
    lines.push(`- 日本語訳: ${item.ja}`);
    if (lastMiss) lines.push(`- 最後に間違えた日: ${lastMiss.day}`);
    const confused = [...new Set(hist.filter((l) => !l.correct && l.chosen).map((l) => l.chosen!))]
      .map((cid) => items.find((i) => i.id === cid))
      .filter((i): i is Item => i !== undefined)
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

/** 既存オーバーレイ（1行1語）と同じ形 */
export function overlayJsonl(cards: Map<string, CardState>, notes: Map<string, UserNote>): string {
  const ids = [...new Set([...cards.keys(), ...notes.keys()])].sort();
  return (
    ids
      .map((id) => {
        const c = cards.get(id);
        const n = notes.get(id);
        return JSON.stringify({
          id,
          status: c?.status ?? "new",
          miss_count: c?.miss_count ?? 0,
          last_reviewed: c?.last_reviewed ?? "",
          mnemonic: n?.mnemonic ?? "",
          wrong_note: n?.wrong_note ?? "",
          custom_example: n?.custom_example ?? "",
        });
      })
      .join("\n") + (ids.length ? "\n" : "")
  );
}

/**
 * ファイルとして保存する。iPhone では共有シート →「"ファイル"に保存」で iCloud Drive に置ける
 * 戻り値: 保存できたか（キャンセルなら false）
 */
export async function saveTextFile(filename: string, text: string, mime: string): Promise<boolean> {
  const file = new File([text], filename, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
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
