// 画面で使うデータをまとめて読み込む
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FSRS } from "ts-fsrs";
import { db, getMeta, getSettings } from "../data/db";
import { makeScheduler } from "../srs/scheduler";
import type { CardState, Item, ReviewLog, Round, Settings, UserNote } from "../types";
import { DEFAULT_SETTINGS } from "../types";

export type StoreData = {
  loaded: boolean;
  items: Item[];
  itemsById: Map<string, Item>;
  cards: Map<string, CardState>;
  notes: Map<string, UserNote>;
  logs: ReviewLog[];
  rounds: Round[];
  settings: Settings;
  lastBackupAt?: number;
};

const EMPTY: StoreData = {
  loaded: false,
  items: [],
  itemsById: new Map(),
  cards: new Map(),
  notes: new Map(),
  logs: [],
  rounds: [],
  settings: DEFAULT_SETTINGS,
};

export type Store = StoreData & { reload: () => Promise<void>; scheduler: FSRS };

export function useStore(): Store {
  const [data, setData] = useState<StoreData>(EMPTY);

  const reload = useCallback(async () => {
    const [items, cards, notes, logs, rounds, settings, lastBackupAt] = await Promise.all([
      db.items.orderBy("order").toArray(),
      db.cards.toArray(),
      db.notes.toArray(),
      db.logs.orderBy("ts").toArray(),
      db.rounds.toArray(),
      getSettings(),
      getMeta<number | undefined>("lastBackupAt", undefined),
    ]);
    setData({
      loaded: true,
      items,
      itemsById: new Map(items.map((i) => [i.id, i])),
      cards: new Map(cards.map((c) => [c.id, c])),
      notes: new Map(notes.map((n) => [n.id, n])),
      logs,
      rounds,
      settings,
      lastBackupAt,
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const scheduler = useMemo(() => makeScheduler(data.settings.retention), [data.settings.retention]);
  return { ...data, reload, scheduler };
}
