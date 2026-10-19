// 端末内データベース（IndexedDB）。Dexie は IndexedDB を使いやすくする道具
import Dexie, { type Table } from "dexie";
import type { CardState, Item, ReviewLog, Round, Settings, UserNote } from "../types";
import { DEFAULT_SETTINGS } from "../types";

export type MetaRow = { key: string; value: unknown };

export class TrainerDB extends Dexie {
  items!: Table<Item, string>;
  cards!: Table<CardState, string>;
  logs!: Table<ReviewLog, number>;
  notes!: Table<UserNote, string>;
  rounds!: Table<Round, number>;
  meta!: Table<MetaRow, string>;

  constructor(name = "kinfre-trainer") {
    super(name);
    this.version(1).stores({
      items: "id, order, section, part",
      cards: "id, due, status, miss_count",
      logs: "++seq, id, ts, day, round",
      notes: "id",
      rounds: "++rid, no, finishedAt",
      meta: "key",
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
export async function upsertItems(items: Item[]) {
  await db.items.bulkPut(items);
  await setMeta("itemsImportedAt", Date.now());
}
