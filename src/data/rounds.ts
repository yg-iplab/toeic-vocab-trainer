// 周回（1周目・2周目…）の作成。進行中の周回と「何周目」は教材ごと
import type { Rng } from "../lib/random";
import { roundItemIds, type RoundScope } from "../srs/session";
import type { Deck, Item, Round } from "../types";
import { db } from "./db";

/** 版1の記録には deck が無いので、単語として扱う */
export function roundDeck(r: Pick<Round, "deck">): Deck {
  return r.deck ?? "kinfre";
}

export function pickActiveRound(rounds: Round[], deck: Deck): Round | undefined {
  return rounds
    .filter((r) => r.finishedAt === undefined && roundDeck(r) === deck)
    .sort((a, b) => (b.rid ?? 0) - (a.rid ?? 0))[0];
}

export function pickNextRoundNo(rounds: Round[], deck: Deck): number {
  return rounds.filter((r) => r.parentRid === undefined && roundDeck(r) === deck).reduce((m, r) => Math.max(m, r.no), 0) + 1;
}

export async function activeRound(deck: Deck = "kinfre"): Promise<Round | undefined> {
  return pickActiveRound(await db.rounds.toArray(), deck);
}

/** 次の「何周目」。ミスだけの周回は数えない */
export async function nextRoundNo(deck: Deck = "kinfre"): Promise<number> {
  return pickNextRoundNo(await db.rounds.toArray(), deck);
}

/** 同じ教材の進行中の周回を閉じてから、新しい周回を入れる（別の教材の周回はそのまま） */
async function openRound(round: Round, now: number): Promise<Round> {
  await db.transaction("rw", db.rounds, async () => {
    const open = (await db.rounds.toArray()).filter((r) => r.finishedAt === undefined && roundDeck(r) === round.deck);
    for (const r of open) await db.rounds.put({ ...r, finishedAt: now });
    round.rid = await db.rounds.add(round);
  });
  return round;
}

export async function startRound(
  items: Item[],
  scope: RoundScope,
  scopeLabel: string,
  order: Round["order"],
  rng: Rng,
  now: number,
  deck: Deck = "kinfre",
): Promise<Round> {
  const no = await nextRoundNo(deck);
  return openRound(
    {
      deck,
      no,
      label: `${no}周目：${scopeLabel}`,
      itemIds: roundItemIds(items, scope, order, rng, deck),
      cursor: 0,
      order,
      startedAt: now,
    },
    now,
  );
}

/** 「この周のミスだけもう1周」 */
export async function startMissedRound(parent: Round, missedIds: string[], now: number): Promise<Round> {
  const deck = roundDeck(parent);
  return openRound(
    {
      deck,
      no: parent.no,
      label: `${parent.no}周目のミスだけ（${missedIds.length}${deck === "deru1000" ? "問" : "語"}）`,
      itemIds: missedIds.slice(),
      cursor: 0,
      order: "seq",
      startedAt: now,
      parentRid: parent.rid,
    },
    now,
  );
}
