// 画面で使うデータをまとめて読み込む
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FSRS } from "ts-fsrs";
import { db, getMeta, getSettings } from "../data/db";
import { sectionChapterIndex } from "../data/tips";
import { makeScheduler } from "../srs/scheduler";
import type { CardState, ChapterInfo, Item, ReviewLog, Round, Settings, TipsDoc, UserNote } from "../types";
import { DEFAULT_SETTINGS } from "../types";

export type StoreData = {
  loaded: boolean;
  items: Item[];
  itemsById: Map<string, Item>;
  chapters: Map<string, ChapterInfo>; // 文法の章・模試セット
  tips: Map<string, TipsDoc>; // 文法の解き方（章ごと・巻頭）
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
  chapters: new Map(),
  tips: new Map(),
  cards: new Map(),
  notes: new Map(),
  logs: [],
  rounds: [],
  settings: DEFAULT_SETTINGS,
};

export type Store = StoreData & {
  reload: () => Promise<void>;
  scheduler: FSRS;
  chapterOfSection: (section: string) => string | undefined; // 分野 → いちばん問題の多い章
};

export function useStore(): Store {
  const [data, setData] = useState<StoreData>(EMPTY);

  const reload = useCallback(async () => {
    const [items, chapters, tips, cards, notes, logs, rounds, settings, lastBackupAt] = await Promise.all([
      db.items.orderBy("order").toArray(),
      db.chapters.orderBy("key").toArray(),
      db.tips.toArray(),
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
      chapters: new Map(chapters.sort((a, b) => a.order - b.order).map((c) => [c.key, c])),
      tips: new Map(tips.map((t) => [t.key, t])),
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
  const chapterOfSection = useMemo(() => sectionChapterIndex(data.items), [data.items]);
  return { ...data, reload, scheduler, chapterOfSection };
}
