// 2台の端末の記録を合わせる（マージ読み込み・v0.9〜）
// 「戻す」は全部を置き換えるが、こちらは この端末の記録を残したまま、バックアップにしかない回答だけを足す。
// - 回答の記録（logs）：「語の番号＋回答した時刻＋もう一度か」が同じものは同じ回答とみなし、足さない
// - 復習の予定（cards）：回答が足された語だけ、全部の回答を時刻順にたどって計算し直す（回答を記録するときと同じ計算）
// - 自分のメモ（notes）：あとで書き直した方（updated_at が新しい方）を残す
// - 周回（rounds）：同じ周回（教材・始めた時刻・ラベルが同じ）は、進んだ方の位置を残す。進行中の周回は教材ごとに1つにする
// - 設定・最後のバックアップの日時は この端末のまま
// - 「学習記録をやり直す」をした教材は、やり直した時刻より前の記録を入れない（どちらの端末でやり直しても）
import type { FSRS } from "ts-fsrs";
import { applyReview } from "../srs/scheduler";
import { deckOf, DECKS, type CardState, type Deck, type ReviewLog, type Round, type UserNote } from "../types";
import type { Backup } from "./backup";
import { db, getMeta } from "./db";
import { roundDeck } from "./rounds";

/** 「学習記録をやり直す」をした時刻（教材ごと）。meta に置くのでバックアップにも入る */
export const RESET_META_KEY = "recordsResetAt";
export type ResetMarks = Partial<Record<Deck, number>>;

export type Records = {
  cards: CardState[];
  logs: ReviewLog[];
  notes: UserNote[];
  rounds: Round[];
  resets: ResetMarks;
};

export type MergeSummary = {
  /** バックアップから足す回答の数（教材ごと） */
  added: Record<Deck, number>;
  /** やり直しの時刻より前なので入れない・消す回答の数 */
  dropped: number;
  /** 足す回答のうち、いちばん古い回答の時刻（無ければ undefined） */
  oldestAdded?: number;
  newestAdded?: number;
  addedRounds: number;
  updatedNotes: number;
  /** 復習の予定を計算し直した語・問題の数 */
  recomputed: number;
};

export type MergeResult = Records & { summary: MergeSummary };

const logKey = (l: ReviewLog) => `${l.id}|${l.ts}|${l.retry ? 1 : 0}`;
const roundKey = (r: Round) => `${roundDeck(r)}|${r.startedAt}|${r.no}|${r.label}`;

function minDefined(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/** 回答を時刻順にたどって、復習の予定を作り直す（recordAnswer と同じ計算） */
export function replayCard(id: string, logs: ReviewLog[], scheduler: FSRS): CardState | undefined {
  let state: CardState | undefined;
  for (const l of [...logs].sort((a, b) => a.ts - b.ts || (a.seq ?? 0) - (b.seq ?? 0))) {
    state = applyReview(state, id, l.rating, l.ts, scheduler);
  }
  return state;
}

/** この端末の記録とバックアップの記録を合わせた結果を作る（データベースには書かない） */
export function mergeRecords(local: Records, incoming: Records, scheduler: FSRS): MergeResult {
  // やり直しの時刻は、新しい方を両方の記録に当てる
  const resets: ResetMarks = {};
  for (const d of DECKS) {
    const t = Math.max(local.resets[d] ?? -Infinity, incoming.resets[d] ?? -Infinity);
    if (Number.isFinite(t)) resets[d] = t;
  }
  const cutoff = (deck: Deck) => resets[deck] ?? -Infinity;
  const keepLog = (l: ReviewLog) => l.ts >= cutoff(deckOf(l.id));
  const keepRound = (r: Round) => r.startedAt >= cutoff(roundDeck(r));

  const summary: MergeSummary = { added: { kinfre: 0, deru1000: 0 }, dropped: 0, addedRounds: 0, updatedNotes: 0, recomputed: 0 };

  // ---- 周回 ----
  const rounds: Round[] = local.rounds.filter(keepRound).map((r) => ({ ...r }));
  const byKey = new Map(rounds.map((r) => [roundKey(r), r]));
  let maxRid = local.rounds.reduce((m, r) => Math.max(m, r.rid ?? 0), 0);
  const ridMap = new Map<number, number>(); // バックアップ側の rid → この端末の rid
  for (const r of [...incoming.rounds].filter(keepRound).sort((a, b) => (a.rid ?? 0) - (b.rid ?? 0))) {
    const same = byKey.get(roundKey(r));
    if (same) {
      same.cursor = Math.max(same.cursor, r.cursor);
      same.finishedAt = minDefined(same.finishedAt, r.finishedAt);
      if (r.rid !== undefined && same.rid !== undefined) ridMap.set(r.rid, same.rid);
      continue;
    }
    const rid = ++maxRid;
    if (r.rid !== undefined) ridMap.set(r.rid, rid);
    const parentRid = r.parentRid === undefined ? undefined : ridMap.get(r.parentRid);
    const added: Round = { ...r, rid, parentRid };
    rounds.push(added);
    byKey.set(roundKey(added), added);
    summary.addedRounds++;
  }
  // 進行中の周回は教材ごとに1つ（いちばん新しく始めたものを残し、ほかは そのものが始まった時刻で閉じる）
  for (const d of DECKS) {
    const open = rounds.filter((r) => r.finishedAt === undefined && roundDeck(r) === d).sort((a, b) => b.startedAt - a.startedAt);
    for (const r of open.slice(1)) r.finishedAt = open[0].startedAt;
  }

  // ---- 回答の記録 ----
  const localKept = local.logs.filter(keepLog);
  summary.dropped += local.logs.length - localKept.length;
  const seen = new Set(localKept.map(logKey));
  const addedLogs: ReviewLog[] = [];
  for (const l of incoming.logs) {
    if (!keepLog(l)) {
      summary.dropped++;
      continue;
    }
    const k = logKey(l);
    if (seen.has(k)) continue;
    seen.add(k);
    const { seq: _seq, ...rest } = l;
    addedLogs.push({ ...rest, rid: l.rid === undefined ? undefined : ridMap.get(l.rid) });
    summary.added[deckOf(l.id)]++;
    summary.oldestAdded = Math.min(summary.oldestAdded ?? Infinity, l.ts);
    summary.newestAdded = Math.max(summary.newestAdded ?? -Infinity, l.ts);
  }
  const logs = [...localKept, ...addedLogs];

  // ---- 復習の予定 ----
  const touched = new Set<string>([...addedLogs.map((l) => l.id), ...local.logs.filter((l) => !keepLog(l)).map((l) => l.id)]);
  const finalById = new Map<string, ReviewLog[]>();
  for (const l of logs) finalById.set(l.id, [...(finalById.get(l.id) ?? []), l]);
  const incomingCards = new Map(incoming.cards.map((c) => [c.id, c]));
  const incomingKeys = new Map<string, Set<string>>();
  for (const l of incoming.logs.filter(keepLog)) incomingKeys.set(l.id, (incomingKeys.get(l.id) ?? new Set()).add(logKey(l)));

  const cards: CardState[] = [];
  const ids = new Set([...local.cards.map((c) => c.id), ...finalById.keys()]);
  const localCards = new Map(local.cards.map((c) => [c.id, c]));
  for (const id of ids) {
    const mine = localCards.get(id);
    if (!touched.has(id)) {
      // 回答が増えも減りもしていない語は、この端末の予定のまま。やり直した教材で回答が無い語は消える
      if (mine && (finalById.has(id) || cutoff(deckOf(id)) === -Infinity)) cards.push(mine);
      continue;
    }
    const final = finalById.get(id) ?? [];
    if (final.length === 0) continue;
    // バックアップ側の回答とちょうど同じなら、バックアップの予定をそのまま使う（計算し直さない）
    const theirs = incomingCards.get(id);
    const theirKeys = incomingKeys.get(id);
    if (theirs && theirKeys && theirKeys.size === final.length && final.every((l) => theirKeys.has(logKey(l)))) {
      cards.push(theirs);
      continue;
    }
    const next = replayCard(id, final, scheduler);
    if (next) {
      cards.push(next);
      summary.recomputed++;
    }
  }

  // ---- 自分のメモ ----
  const notes = new Map(local.notes.map((n) => [n.id, n]));
  for (const n of incoming.notes) {
    const mine = notes.get(n.id);
    if (!mine || (n.updated_at ?? 0) > (mine.updated_at ?? 0)) {
      if (!mine || JSON.stringify(mine) !== JSON.stringify(n)) summary.updatedNotes++;
      notes.set(n.id, n);
    }
  }

  return { cards, logs, notes: [...notes.values()], rounds, resets, summary };
}

/** バックアップから合わせる側の記録を取り出す */
export function backupRecords(b: Backup): Records {
  const resets = (b.meta.find((m) => m.key === RESET_META_KEY)?.value ?? {}) as ResetMarks;
  return { cards: b.cards, logs: b.logs, notes: b.notes, rounds: b.rounds, resets };
}

/** この端末の記録を読む */
export async function localRecords(): Promise<Records> {
  return {
    cards: await db.cards.toArray(),
    logs: await db.logs.toArray(),
    notes: await db.notes.toArray(),
    rounds: await db.rounds.toArray(),
    resets: await getMeta<ResetMarks>(RESET_META_KEY, {}),
  };
}

/** 合わせた結果を書く（1つの処理で。途中で失敗したら何も変わらない）。教材・音声・設定には触らない */
export async function applyMerge(m: MergeResult): Promise<void> {
  await db.transaction("rw", [db.cards, db.logs, db.notes, db.rounds, db.meta], async () => {
    await Promise.all([db.cards.clear(), db.logs.clear(), db.notes.clear(), db.rounds.clear()]);
    await db.cards.bulkPut(m.cards);
    await db.logs.bulkPut(m.logs); // この端末の回答は番号（seq）のまま、足した回答には新しい番号が付く
    await db.notes.bulkPut(m.notes);
    await db.rounds.bulkPut(m.rounds);
    if (Object.keys(m.resets).length) await db.meta.put({ key: RESET_META_KEY, value: m.resets });
  });
}
