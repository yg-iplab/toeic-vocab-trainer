// 端末内データベース（IndexedDB）。Dexie は IndexedDB を使いやすくする道具
import Dexie, { type Table } from "dexie";
import type { CardState, ChapterInfo, Item, ReviewLog, Round, Settings, UserNote } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { mergeChapters } from "./parseDeru";

export type MetaRow = { key: string; value: unknown };

/** DB の名前は変えない（変えると、これまでの記録が見えなくなる） */
export const DB_NAME = "kinfre-trainer";

export class TrainerDB extends Dexie {
  items!: Table<Item, string>;
  cards!: Table<CardState, string>;
  logs!: Table<ReviewLog, number>;
  notes!: Table<UserNote, string>;
  rounds!: Table<Round, number>;
  meta!: Table<MetaRow, string>;
  chapters!: Table<ChapterInfo, string>;

  constructor(name = DB_NAME) {
    super(name);
    // 版1（Phase 1・単語だけ）
    this.version(1).stores({
      items: "id, order, section, part",
      cards: "id, due, status, miss_count",
      logs: "++seq, id, ts, day, round",
      notes: "id",
      rounds: "++rid, no, finishedAt",
      meta: "key",
    });
    // 版2（Phase 2・文法を追加）。記録（cards・logs・notes）はそのまま引き継ぐ
    this.version(2)
      .stores({
        items: "id, deck, order, section, part",
        rounds: "++rid, deck, no, finishedAt",
        chapters: "key, deck",
      })
      .upgrade(async (tx) => {
        await tx
          .table("items")
          .toCollection()
          .modify((i: Partial<Item>) => {
            if (!i.deck) i.deck = "kinfre";
          });
        await tx
          .table("rounds")
          .toCollection()
          .modify((r: Partial<Round>) => {
            if (!r.deck) r.deck = "kinfre";
          });
      });
  }
}

export let db = new TrainerDB();

/** テスト用に別名のDBへ切り替える */
export function useDatabase(next: TrainerDB) {
  db = next;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

export async function getSettings(): Promise<Settings> {
  const saved = await getMeta<Partial<Settings>>("settings", {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(s: Settings) {
  await setMeta("settings", s);
}

/** 教材を取り込む。学習記録（cards・logs・notes）には触らない */
export async function upsertItems(items: Item[], chapters: ChapterInfo[] = []) {
  await db.transaction("rw", db.items, db.chapters, db.meta, async () => {
    await db.items.bulkPut(items);
    if (chapters.length) {
      // 分割ファイルを別々に読み込んでも、章の要点が消えないようにまとめる
      const prev = await db.chapters.bulkGet(chapters.map((c) => c.key));
      await db.chapters.bulkPut(mergeChapters(prev.filter((c) => c !== undefined), chapters));
    }
    await setMeta("itemsImportedAt", Date.now());
  });
}
